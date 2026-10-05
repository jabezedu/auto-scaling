const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./db');
const { seedAdminUser, login, authMiddleware } = require('./auth');

const app = express();
const PORT = process.env.PORT || 4004;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3004';

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/login', login);

app.use('/api', authMiddleware);

// List scaling groups
app.get('/api/groups', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT g.*, 
        (SELECT COUNT(*)::int FROM simulation_runs WHERE group_id = g.id) AS run_count
       FROM scaling_groups g 
       ORDER BY g.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List groups error:', err);
    res.status(500).json({ error: 'Failed to retrieve scaling groups' });
  }
});

// Create scaling group
app.post('/api/groups', async (req, res) => {
  const {
    name,
    min_instances = 1,
    max_instances = 10,
    scale_out_cpu = 70,
    scale_out_consecutive = 2,
    scale_in_cpu = 30,
    scale_in_consecutive = 2,
    cooldown_ticks = 3
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const min = parseInt(min_instances, 10);
  const max = parseInt(max_instances, 10);
  const outCpu = parseInt(scale_out_cpu, 10);
  const outConsec = parseInt(scale_out_consecutive, 10);
  const inCpu = parseInt(scale_in_cpu, 10);
  const inConsec = parseInt(scale_in_consecutive, 10);
  const cooldown = parseInt(cooldown_ticks, 10);

  if (min < 1 || min > 10) {
    return res.status(400).json({ error: 'Min instances must be between 1 and 10' });
  }
  if (max < min || max > 20) {
    return res.status(400).json({ error: 'Max instances must be between min and 20' });
  }
  if (outCpu <= inCpu || outCpu > 100 || inCpu < 0) {
    return res.status(400).json({ error: 'Scale out CPU must be higher than scale in CPU (0-100%)' });
  }

  try {
    const result = await db.query(
      `INSERT INTO scaling_groups 
       (user_id, name, min_instances, max_instances, scale_out_cpu, scale_out_consecutive, scale_in_cpu, scale_in_consecutive, cooldown_ticks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.user.userId, name.trim(), min, max, outCpu, outConsec, inCpu, inConsec, cooldown]
    );

    res.status(201).json({ ...result.rows[0], run_count: 0 });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Failed to create scaling group' });
  }
});

// Get runs for a group
app.get('/api/groups/:id/runs', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT id, group_id, load_pattern, total_ticks, peak_instances, scale_out_count, scale_in_count, dropped_ticks, created_at
       FROM simulation_runs
       WHERE group_id = $1
       ORDER BY created_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List runs error:', err);
    res.status(500).json({ error: 'Failed to retrieve simulation runs' });
  }
});

// Get single run with ticks_data
app.get('/api/runs/:runId', async (req, res) => {
  const { runId } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM simulation_runs WHERE id = $1',
      [runId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Simulation run not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get run error:', err);
    res.status(500).json({ error: 'Failed to retrieve simulation run details' });
  }
});

// Run simulation
app.post('/api/groups/:id/simulate', async (req, res) => {
  const { id } = req.params;
  const { load_pattern = 'steady', total_ticks = 30 } = req.body;

  const validPatterns = ['steady', 'ramp', 'spike', 'wave'];
  if (!validPatterns.includes(load_pattern)) {
    return res.status(400).json({ error: `Invalid pattern. Must be one of: ${validPatterns.join(', ')}` });
  }

  const ticks = parseInt(total_ticks, 10);
  if (![30, 60, 120].includes(ticks)) {
    return res.status(400).json({ error: 'Total ticks must be 30, 60, or 120' });
  }

  try {
    const groupRes = await db.query('SELECT * FROM scaling_groups WHERE id = $1', [id]);
    if (groupRes.rows.length === 0) {
      return res.status(404).json({ error: 'Scaling group not found' });
    }
    const group = groupRes.rows[0];

    // Simulation variables
    let running = group.min_instances;
    let booting = []; // array of remaining ticks for each booting instance
    let consecutiveHigh = 0;
    let consecutiveLow = 0;
    let cooldownRemaining = 0;

    let peakInstances = running;
    let scaleOutCount = 0;
    let scaleInCount = 0;
    let droppedTicks = 0;

    const ticksData = [];

    // Helper to generate load for tick t
    function getLoadForTick(t) {
      if (load_pattern === 'steady') {
        return 150;
      }
      if (load_pattern === 'ramp') {
        // Linearly from 50 up to 600
        const progress = t / (ticks - 1);
        return Math.round(50 + progress * 550);
      }
      if (load_pattern === 'spike') {
        // 100 with a burst to 800 for 10 ticks in the middle
        const mid = Math.floor(ticks / 2);
        if (t >= mid - 5 && t < mid + 5) {
          return 800;
        }
        return 100;
      }
      if (load_pattern === 'wave') {
        // Sine wave between 100 and 500
        const period = 20;
        const sineVal = Math.sin((t * 2 * Math.PI) / period);
        return Math.round(300 + 200 * sineVal);
      }
      return 150;
    }

    // Tick by tick execution
    for (let t = 0; t < ticks; t++) {
      // 1. Advance booting instances
      const readyBooting = [];
      const stillBooting = [];
      for (const b of booting) {
        if (b - 1 <= 0) {
          readyBooting.push(b);
        } else {
          stillBooting.push(b - 1);
        }
      }
      running += readyBooting.length;
      booting = stillBooting;

      // 2. Compute current capacity & load
      const currentLoad = getLoadForTick(t);
      const capacity = running * 100;
      const rawCpu = capacity > 0 ? (currentLoad / capacity) * 100 : 100;
      const avgCpu = Math.min(100, Math.round(rawCpu));

      if (avgCpu >= 100 && currentLoad > capacity) {
        droppedTicks++;
      }

      // Track peak
      const totalInstances = running + booting.length;
      if (totalInstances > peakInstances) {
        peakInstances = totalInstances;
      }

      // 3. Scaling decision logic
      let decision = 'NONE';
      let reason = '';

      if (cooldownRemaining > 0) {
        decision = 'COOLDOWN';
        reason = `Cooldown active (${cooldownRemaining} tick${cooldownRemaining > 1 ? 's' : ''} left)`;
        cooldownRemaining--;
      } else {
        if (avgCpu >= group.scale_out_cpu) {
          consecutiveHigh++;
          consecutiveLow = 0;

          if (consecutiveHigh >= group.scale_out_consecutive) {
            if (running + booting.length < group.max_instances) {
              booting.push(2); // takes 2 ticks to boot
              scaleOutCount++;
              cooldownRemaining = group.cooldown_ticks;
              decision = 'SCALE_OUT';
              reason = `CPU ${avgCpu}% >= ${group.scale_out_cpu}% for ${group.scale_out_consecutive} ticks -> Adding +1 instance (booting 2s)`;
            } else {
              decision = 'MAX_REACHED';
              reason = `CPU ${avgCpu}% >= ${group.scale_out_cpu}% but reached max instances limit (${group.max_instances})`;
            }
            consecutiveHigh = 0;
          } else {
            reason = `High CPU ${avgCpu}% (${consecutiveHigh}/${group.scale_out_consecutive} ticks)`;
          }
        } else if (avgCpu <= group.scale_in_cpu) {
          consecutiveLow++;
          consecutiveHigh = 0;

          if (consecutiveLow >= group.scale_in_consecutive) {
            if (running > group.min_instances) {
              running--;
              scaleInCount++;
              cooldownRemaining = group.cooldown_ticks;
              decision = 'SCALE_IN';
              reason = `CPU ${avgCpu}% <= ${group.scale_in_cpu}% for ${group.scale_in_consecutive} ticks -> Terminating 1 instance`;
            } else {
              decision = 'MIN_REACHED';
              reason = `CPU ${avgCpu}% <= ${group.scale_in_cpu}% but reached min instances limit (${group.min_instances})`;
            }
            consecutiveLow = 0;
          } else {
            reason = `Low CPU ${avgCpu}% (${consecutiveLow}/${group.scale_in_consecutive} ticks)`;
          }
        } else {
          consecutiveHigh = 0;
          consecutiveLow = 0;
          reason = `Normal CPU ${avgCpu}% within range [${group.scale_in_cpu}% - ${group.scale_out_cpu}%]`;
        }
      }

      ticksData.push({
        tick: t,
        load: currentLoad,
        capacity,
        running_instances: running,
        booting_instances: booting.length,
        total_instances: running + booting.length,
        avg_cpu: avgCpu,
        decision,
        reason
      });
    }

    // Persist run
    const insertRun = await db.query(
      `INSERT INTO simulation_runs 
       (group_id, load_pattern, total_ticks, peak_instances, scale_out_count, scale_in_count, dropped_ticks, ticks_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        load_pattern,
        ticks,
        peakInstances,
        scaleOutCount,
        scaleInCount,
        droppedTicks,
        JSON.stringify(ticksData)
      ]
    );

    res.status(201).json(insertRun.rows[0]);
  } catch (err) {
    console.error('Simulation error:', err);
    res.status(500).json({ error: 'Failed to run scaling simulation' });
  }
});

async function start() {
  await db.connectWithRetry();
  await seedAdminUser();
  app.listen(PORT, () => {
    console.log(`Auto Scaling Backend running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

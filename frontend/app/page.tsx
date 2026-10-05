'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface ScalingGroup {
  id: number;
  name: string;
  min_instances: number;
  max_instances: number;
  scale_out_cpu: number;
  scale_out_consecutive: number;
  scale_in_cpu: number;
  scale_in_consecutive: number;
  cooldown_ticks: number;
  run_count?: number;
}

interface TickData {
  tick: number;
  load: number;
  capacity: number;
  running_instances: number;
  booting_instances: number;
  total_instances: number;
  avg_cpu: number;
  decision: string;
  reason: string;
}

interface SimulationRun {
  id: number;
  group_id: number;
  load_pattern: string;
  total_ticks: number;
  peak_instances: number;
  scale_out_count: number;
  scale_in_count: number;
  dropped_ticks: number;
  ticks_data: TickData[];
  created_at: string;
}

export default function AutoScalingDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [groups, setGroups] = useState<ScalingGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ScalingGroup | null>(null);
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<SimulationRun | null>(null);

  // Simulation parameters
  const [loadPattern, setLoadPattern] = useState<'steady' | 'ramp' | 'spike' | 'wave'>('spike');
  const [totalTicks, setTotalTicks] = useState<30 | 60 | 120>(60);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simError, setSimError] = useState('');

  // Create group modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [minInst, setMinInst] = useState(2);
  const [maxInst, setMaxInst] = useState(8);
  const [outCpu, setOutCpu] = useState(70);
  const [outConsec, setOutConsec] = useState(2);
  const [inCpu, setInCpu] = useState(30);
  const [inConsec, setInConsec] = useState(2);
  const [cooldown, setCooldown] = useState(3);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!token) {
      router.push('/login');
      return;
    }
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    fetchGroups();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  const fetchGroups = async () => {
    try {
      const res = await apiFetch('/api/groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
        if (data.length > 0) {
          if (!selectedGroup) {
            setSelectedGroup(data[0]);
            fetchRuns(data[0].id);
          } else {
            const current = data.find((g: ScalingGroup) => g.id === selectedGroup.id);
            if (current) setSelectedGroup(current);
            else {
              setSelectedGroup(data[0]);
              fetchRuns(data[0].id);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch groups', err);
    }
  };

  const fetchRuns = async (groupId: number) => {
    try {
      const res = await apiFetch(`/api/groups/${groupId}/runs`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data);
        if (data.length > 0) {
          loadRunDetails(data[0].id);
        } else {
          setSelectedRun(null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch runs', err);
    }
  };

  const loadRunDetails = async (runId: number) => {
    try {
      const res = await apiFetch(`/api/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedRun(data);
      }
    } catch (err) {
      console.error('Failed to load run details', err);
    }
  };

  const handleSelectGroup = (g: ScalingGroup) => {
    setSelectedGroup(g);
    fetchRuns(g.id);
  };

  const handleRunSimulation = async () => {
    if (!selectedGroup) return;
    setSimError('');
    setIsSimulating(true);

    try {
      const res = await apiFetch(`/api/groups/${selectedGroup.id}/simulate`, {
        method: 'POST',
        body: JSON.stringify({ load_pattern: loadPattern, total_ticks: totalTicks }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Simulation failed');
      }
      setSelectedRun(data);
      await fetchRuns(selectedGroup.id);
      await fetchGroups();
    } catch (err: any) {
      setSimError(err.message);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');

    try {
      const res = await apiFetch('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: newGroupName,
          min_instances: minInst,
          max_instances: maxInst,
          scale_out_cpu: outCpu,
          scale_out_consecutive: outConsec,
          scale_in_cpu: inCpu,
          scale_in_consecutive: inConsec,
          cooldown_ticks: cooldown,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create group');
      }
      setIsModalOpen(false);
      setNewGroupName('');
      await fetchGroups();
      handleSelectGroup(data);
    } catch (err: any) {
      setCreateError(err.message);
    }
  };

  // SVG Chart Helpers
  const renderLoadCapacityChart = () => {
    if (!selectedRun || !selectedRun.ticks_data || selectedRun.ticks_data.length === 0) return null;

    const width = 800;
    const height = 220;
    const padding = 40;

    const data = selectedRun.ticks_data;
    const maxVal = Math.max(
      ...data.map((d) => Math.max(d.load, d.capacity)),
      600
    );

    const getX = (t: number) => padding + (t / (data.length - 1 || 1)) * (width - padding * 2);
    const getY = (val: number) => height - padding - (val / maxVal) * (height - padding * 2);

    const loadPoints = data.map((d) => `${getX(d.tick)},${getY(d.load)}`).join(' ');
    const capacityPoints = data.map((d) => `${getX(d.tick)},${getY(d.capacity)}`).join(' ');

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, idx) => {
          const y = height - padding - p * (height - padding * 2);
          const val = Math.round(p * maxVal);
          return (
            <g key={idx}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" className="dark:stroke-slate-700" />
              <text x={padding - 8} y={y + 3} textAnchor="end" className="text-[10px] fill-slate-400 font-mono">
                {val}
              </text>
            </g>
          );
        })}

        {/* Capacity Line (Orange Dashed) */}
        <polyline fill="none" stroke="#ea580c" strokeWidth="2.5" strokeDasharray="4 4" points={capacityPoints} />

        {/* Load Line (Blue Solid) */}
        <polyline fill="none" stroke="#3b82f6" strokeWidth="2" points={loadPoints} />

        {/* Legend */}
        <g transform={`translate(${width - 240}, 15)`}>
          <line x1="0" y1="5" x2="20" y2="5" stroke="#3b82f6" strokeWidth="2" />
          <text x="25" y="8" className="text-[11px] fill-slate-600 dark:fill-slate-300 font-medium">Load (req/s)</text>
          <line x1="110" y1="5" x2="130" y2="5" stroke="#ea580c" strokeWidth="2.5" strokeDasharray="4 4" />
          <text x="135" y="8" className="text-[11px] fill-slate-600 dark:fill-slate-300 font-medium">Capacity</text>
        </g>
      </svg>
    );
  };

  const renderCpuChart = () => {
    if (!selectedRun || !selectedRun.ticks_data || selectedRun.ticks_data.length === 0 || !selectedGroup) return null;

    const width = 800;
    const height = 220;
    const padding = 40;

    const data = selectedRun.ticks_data;
    const getX = (t: number) => padding + (t / (data.length - 1 || 1)) * (width - padding * 2);
    const getY = (cpu: number) => height - padding - (cpu / 100) * (height - padding * 2);

    const cpuPoints = data.map((d) => `${getX(d.tick)},${getY(d.avg_cpu)}`).join(' ');

    const scaleOutY = getY(selectedGroup.scale_out_cpu);
    const scaleInY = getY(selectedGroup.scale_in_cpu);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56">
        {/* Y-axis Labels */}
        {[0, 25, 50, 75, 100].map((cpu) => {
          const y = getY(cpu);
          return (
            <g key={cpu}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" className="dark:stroke-slate-700" />
              <text x={padding - 8} y={y + 3} textAnchor="end" className="text-[10px] fill-slate-400 font-mono">
                {cpu}%
              </text>
            </g>
          );
        })}

        {/* Threshold lines */}
        {/* Scale Out Threshold Line (Red) */}
        <line x1={padding} y1={scaleOutY} x2={width - padding} y2={scaleOutY} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="5 5" />
        <text x={width - padding + 5} y={scaleOutY + 3} className="text-[10px] fill-red-500 font-bold">
          Out ({selectedGroup.scale_out_cpu}%)
        </text>

        {/* Scale In Threshold Line (Green) */}
        <line x1={padding} y1={scaleInY} x2={width - padding} y2={scaleInY} stroke="#10b981" strokeWidth="1.5" strokeDasharray="5 5" />
        <text x={width - padding + 5} y={scaleInY + 3} className="text-[10px] fill-emerald-500 font-bold">
          In ({selectedGroup.scale_in_cpu}%)
        </text>

        {/* CPU Utilization Line */}
        <polyline fill="none" stroke="#f97316" strokeWidth="2.5" points={cpuPoints} />

        {/* Legend */}
        <g transform={`translate(${width - 240}, 15)`}>
          <line x1="0" y1="5" x2="20" y2="5" stroke="#f97316" strokeWidth="2.5" />
          <text x="25" y="8" className="text-[11px] fill-slate-600 dark:fill-slate-300 font-medium">Avg CPU %</text>
        </g>
      </svg>
    );
  };

  const renderInstanceStepChart = () => {
    if (!selectedRun || !selectedRun.ticks_data || selectedRun.ticks_data.length === 0 || !selectedGroup) return null;

    const width = 800;
    const height = 180;
    const padding = 40;

    const data = selectedRun.ticks_data;
    const maxInstVal = Math.max(selectedGroup.max_instances, selectedRun.peak_instances, 6);

    const getX = (t: number) => padding + (t / (data.length - 1 || 1)) * (width - padding * 2);
    const getY = (count: number) => height - padding - (count / maxInstVal) * (height - padding * 2);

    // Build step points
    let runningStep = '';
    let totalStep = '';
    data.forEach((d, i) => {
      const x = getX(d.tick);
      const yR = getY(d.running_instances);
      const yT = getY(d.total_instances);
      if (i === 0) {
        runningStep += `${x},${yR}`;
        totalStep += `${x},${yT}`;
      } else {
        const prevX = getX(d.tick - 1);
        runningStep += ` ${x},${getY(data[i - 1].running_instances)} ${x},${yR}`;
        totalStep += ` ${x},${getY(data[i - 1].total_instances)} ${x},${yT}`;
      }
    });

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44">
        {/* Y ticks */}
        {Array.from({ length: maxInstVal + 1 }).map((_, inst) => {
          if (inst % 2 !== 0 && inst !== maxInstVal) return null;
          const y = getY(inst);
          return (
            <g key={inst}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" className="dark:stroke-slate-700" />
              <text x={padding - 8} y={y + 3} textAnchor="end" className="text-[10px] fill-slate-400 font-mono">
                {inst}
              </text>
            </g>
          );
        })}

        {/* Total (Running + Booting) */}
        <polyline fill="none" stroke="#fdba74" strokeWidth="2" strokeDasharray="3 3" points={totalStep} />

        {/* Running Instances Step Line */}
        <polyline fill="none" stroke="#ea580c" strokeWidth="2.5" points={runningStep} />

        {/* Legend */}
        <g transform={`translate(${width - 270}, 15)`}>
          <line x1="0" y1="5" x2="20" y2="5" stroke="#ea580c" strokeWidth="2.5" />
          <text x="25" y="8" className="text-[11px] fill-slate-600 dark:fill-slate-300 font-medium">Running</text>
          <line x1="90" y1="5" x2="110" y2="5" stroke="#fdba74" strokeWidth="2" strokeDasharray="3 3" />
          <text x="115" y="8" className="text-[11px] fill-slate-600 dark:fill-slate-300 font-medium">Total (+Booting)</text>
        </g>
      </svg>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white font-bold shadow-sm">
              ASG
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-white leading-none">Cloud Auto Scaling</h1>
              <span className="text-xs text-slate-500 dark:text-slate-400">Dynamic Fleet Scaling Simulator</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline-block">
              {user?.email}
            </span>
            <button
              onClick={() => setIsModalOpen(true)}
              className="rounded-lg bg-orange-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-orange-700 transition"
            >
              + New ASG
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-6">
        {/* ASG Selector & Policy Summary */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-xs font-semibold text-slate-500 uppercase mr-1">Groups:</span>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => handleSelectGroup(g)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  selectedGroup?.id === g.id
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>

          {selectedGroup && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-slate-600 dark:text-slate-300">
                Capacity: <strong>{selectedGroup.min_instances} - {selectedGroup.max_instances}</strong> inst
              </span>
              <span className="rounded-md bg-red-50 dark:bg-red-950/40 px-2.5 py-1 text-red-700 dark:text-red-300">
                Out: <strong>&gt;{selectedGroup.scale_out_cpu}%</strong> ({selectedGroup.scale_out_consecutive} ticks)
              </span>
              <span className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
                In: <strong>&lt;{selectedGroup.scale_in_cpu}%</strong> ({selectedGroup.scale_in_consecutive} ticks)
              </span>
              <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-slate-600 dark:text-slate-300">
                Cooldown: <strong>{selectedGroup.cooldown_ticks}s</strong>
              </span>
            </div>
          )}
        </div>

        {/* Simulation Controls Bar */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Load Pattern</label>
                <select
                  value={loadPattern}
                  onChange={(e) => setLoadPattern(e.target.value as any)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  <option value="steady">Steady (150 req/s)</option>
                  <option value="ramp">Ramp (50 to 600 req/s)</option>
                  <option value="spike">Spike (100 with 800 burst)</option>
                  <option value="wave">Wave (Sine 100 - 500 req/s)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Duration</label>
                <select
                  value={totalTicks}
                  onChange={(e) => setTotalTicks(parseInt(e.target.value, 10) as any)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                >
                  <option value={30}>30 Ticks</option>
                  <option value={60}>60 Ticks</option>
                  <option value={120}>120 Ticks</option>
                </select>
              </div>

              <div className="self-end">
                <button
                  onClick={handleRunSimulation}
                  disabled={isSimulating}
                  className="rounded-lg bg-orange-600 px-6 py-2 text-xs font-semibold text-white shadow-sm hover:bg-orange-700 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {isSimulating ? (
                    <>
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Simulating...
                    </>
                  ) : (
                    'Run Simulation'
                  )}
                </button>
              </div>
            </div>

            {/* Run History Selector */}
            {runs.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Run History:</label>
                <select
                  value={selectedRun?.id || ''}
                  onChange={(e) => loadRunDetails(parseInt(e.target.value, 10))}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-white font-mono"
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} - {r.load_pattern} ({r.total_ticks}s) - {new Date(r.created_at).toLocaleTimeString()}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {simError && (
            <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-600 border border-red-200">
              {simError}
            </div>
          )}
        </div>

        {selectedRun ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Peak Instances</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{selectedRun.peak_instances}</div>
                <div className="text-[10px] text-slate-400">Capacity max: {selectedRun.peak_instances * 100} req/s</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Scale-Out Events</div>
                <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">+{selectedRun.scale_out_count}</div>
                <div className="text-[10px] text-slate-400">Instances added</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Scale-In Events</div>
                <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">-{selectedRun.scale_in_count}</div>
                <div className="text-[10px] text-slate-400">Instances terminated</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">100% CPU Ticks</div>
                <div className={`mt-1 text-2xl font-bold ${selectedRun.dropped_ticks > 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>
                  {selectedRun.dropped_ticks}
                </div>
                <div className="text-[10px] text-slate-400">Dropped/saturated traffic</div>
              </div>
            </div>

            {/* Visualizations Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Load vs Capacity Chart */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
                  Traffic Load vs Service Capacity
                </h3>
                <p className="text-xs text-slate-400 mb-3">Requests per second against current provisioned capacity</p>
                {renderLoadCapacityChart()}
              </div>

              {/* CPU Utilization & Thresholds Chart */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
                  Average CPU % & Thresholds
                </h3>
                <p className="text-xs text-slate-400 mb-3">Target tracking with scale out/in trigger lines</p>
                {renderCpuChart()}
              </div>
            </div>

            {/* Instance Count Step Chart */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                Instance Count Timeline (Step Chart)
              </h3>
              <p className="text-xs text-slate-400 mb-3">Running capacity and booting queue (2-tick delay)</p>
              {renderInstanceStepChart()}
            </div>

            {/* Scrollable Event Log */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
                Scaling Actions & Tick Decision Log
              </h3>
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                  <thead className="border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase tracking-wider text-slate-400 sticky top-0 bg-white dark:bg-slate-800">
                    <tr>
                      <th className="py-2 px-3">Tick</th>
                      <th className="py-2 px-3">Load</th>
                      <th className="py-2 px-3">Running / Booting</th>
                      <th className="py-2 px-3">CPU</th>
                      <th className="py-2 px-3">Action</th>
                      <th className="py-2 px-3">Decision Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {selectedRun.ticks_data.map((td) => (
                      <tr key={td.tick} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="py-2 px-3 font-mono font-medium text-slate-500">t={td.tick}s</td>
                        <td className="py-2 px-3 font-mono">{td.load} req/s</td>
                        <td className="py-2 px-3 font-mono">
                          {td.running_instances} inst {td.booting_instances > 0 && <span className="text-amber-500">(+{td.booting_instances} booting)</span>}
                        </td>
                        <td className="py-2 px-3 font-mono font-semibold">
                          <span className={td.avg_cpu >= selectedGroup.scale_out_cpu ? 'text-red-500' : td.avg_cpu <= selectedGroup.scale_in_cpu ? 'text-emerald-500' : 'text-slate-700 dark:text-slate-300'}>
                            {td.avg_cpu}%
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              td.decision === 'SCALE_OUT'
                                ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                                : td.decision === 'SCALE_IN'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : td.decision === 'COOLDOWN'
                                ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                : 'text-slate-400'
                            }`}
                          >
                            {td.decision}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-500 max-w-sm truncate">{td.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="h-64 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center p-6 text-center text-slate-400">
            <p className="text-sm font-medium">No simulation run yet for this group. Click &quot;Run Simulation&quot; above.</p>
          </div>
        )}
      </main>

      {/* Modal: Create Scaling Group */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create Auto Scaling Group</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {createError && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs text-red-600 border border-red-200">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateGroup} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Group Name</label>
                <input
                  type="text"
                  placeholder="production-worker-asg"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Min Instances (1-10)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={minInst}
                    onChange={(e) => setMinInst(parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Max Instances (min-20)</label>
                  <input
                    type="number"
                    min={minInst}
                    max={20}
                    value={maxInst}
                    onChange={(e) => setMaxInst(parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Scale Out CPU %</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={outCpu}
                    onChange={(e) => setOutCpu(parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Scale Out Consecutive</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={outConsec}
                    onChange={(e) => setOutConsec(parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Scale In CPU %</label>
                  <input
                    type="number"
                    min={0}
                    max={outCpu - 1}
                    value={inCpu}
                    onChange={(e) => setInCpu(parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Scale In Consecutive</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={inConsec}
                    onChange={(e) => setInConsec(parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Cooldown Ticks</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={cooldown}
                  onChange={(e) => setCooldown(parseInt(e.target.value, 10))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700"
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

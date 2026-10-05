const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function connectWithRetry(retries = 10, delay = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log('Database connected successfully');
      return pool;
    } catch (err) {
      console.log(`Database connection attempt ${i} failed. Retrying in ${delay / 1000}s...`);
      if (i === retries) {
        throw new Error(`Unable to connect to database after ${retries} attempts: ${err.message}`);
      }
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  connectWithRetry
};

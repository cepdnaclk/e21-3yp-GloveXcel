const { Pool } = require('pg');

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

let pool;

function getPool() {
  if (!pool) {
    const sslEnabled = parseBool(process.env.POSTGRES_SSL, true);
    const rejectUnauthorized = parseBool(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED, false);

    pool = new Pool({
      host: process.env.POSTGRES_HOST,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE,
      port: Number(process.env.POSTGRES_PORT || 5432),
      ssl: sslEnabled ? { rejectUnauthorized } : false,
    });
  }

  return pool;
}

async function connectPostgres() {
  const required = ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing PostgreSQL env vars: ${missing.join(', ')}`);
  }

  const dbPool = getPool();
  const client = await dbPool.connect();

  try {
    await client.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL (Supabase)!');
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  connectPostgres,
};

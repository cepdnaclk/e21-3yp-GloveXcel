const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../env') });

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE,
  port: Number(process.env.POSTGRES_PORT || 5432),
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('--- Tables ---');
    console.log(res.rows.map(r => r.table_name));
    
    // Check columns of patients and doctors
    const colsPatients = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'patients'
    `);
    console.log('\n--- Patients Columns ---');
    console.log(colsPatients.rows);

    const colsDoctors = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'doctors'
    `);
    console.log('\n--- Doctors Columns ---');
    console.log(colsDoctors.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();

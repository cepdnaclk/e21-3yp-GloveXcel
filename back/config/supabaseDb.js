const { Pool } = require('pg');

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

let pool;

const DEFAULT_HOSPITAL_ID = 'H001';
const DEFAULT_DOCTOR_ID = 'DOC-1b402238f4ad4c92a7deedbc1a53c813';

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
    await ensureDoctorPhoneColumn(client);
    await ensureDoctorExists(client, DEFAULT_DOCTOR_ID);
    await ensureChannelRequestsTable(client);
    console.log('✅ Connected to PostgreSQL (Supabase)!');
  } finally {
    client.release();
  }
}

async function getTableColumns(client, tableName) {
  const result = await client.query(
    `
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName]
  );

  return result.rows;
}

async function ensureDoctorPhoneColumn(queryable = getPool()) {
  await queryable.query(`
    ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS phone character varying DEFAULT ''
  `);

  await queryable.query(`
    ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS auth_provider character varying DEFAULT 'local'
  `);
}

function columnNames(columns) {
  return new Set(columns.map((column) => column.column_name));
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function insertDynamicRow(client, tableName, columns, valuesByColumn) {
  const presentColumns = columnNames(columns);
  const insertColumns = Object.keys(valuesByColumn).filter((column) => presentColumns.has(column));

  if (!insertColumns.length) {
    return;
  }

  const placeholders = insertColumns.map((_, index) => `$${index + 1}`);
  const values = insertColumns.map((column) => valuesByColumn[column]);

  await client.query(
    `
    INSERT INTO public.${quoteIdentifier(tableName)} (${insertColumns.map(quoteIdentifier).join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT DO NOTHING
    `,
    values
  );
}

async function ensureHospitalExists(client, hospitalId = DEFAULT_HOSPITAL_ID) {
  const columns = await getTableColumns(client, 'hospitals');
  if (!columns.length) {
    return;
  }

  const found = await client.query(
    'SELECT hospital_id FROM public.hospitals WHERE hospital_id = $1 LIMIT 1',
    [hospitalId]
  );

  if (found.rowCount > 0) {
    return;
  }

  await insertDynamicRow(client, 'hospitals', columns, {
    hospital_id: hospitalId,
    name: 'Default Hospital',
    location: 'Development'
  });
}

async function ensureDoctorExists(client, doctorId) {
  const normalizedDoctorId = (doctorId || '').trim();
  if (!normalizedDoctorId) {
    return;
  }

  const columns = await getTableColumns(client, 'doctors');
  if (!columns.length) {
    return;
  }

  const found = await client.query(
    'SELECT doctor_id FROM public.doctors WHERE doctor_id = $1 LIMIT 1',
    [normalizedDoctorId]
  );

  if (found.rowCount > 0) {
    return;
  }

  await ensureHospitalExists(client);

  await insertDynamicRow(client, 'doctors', columns, {
    doctor_id: normalizedDoctorId,
    name: normalizedDoctorId === DEFAULT_DOCTOR_ID ? 'Default Doctor' : `Doctor ${normalizedDoctorId}`,
    email: `${normalizedDoctorId.toLowerCase()}@glovexcel.local`,
    password_hash: 'development-placeholder',
    hospital_id: DEFAULT_HOSPITAL_ID,
    Verification: 'yes',
    verification: 'yes'
  });
}

async function ensurePatientExists(client, patientId) {
  const normalizedPatientId = (patientId || '').trim();
  if (!normalizedPatientId) {
    return;
  }

  const columns = await getTableColumns(client, 'patients');
  if (!columns.length) {
    return;
  }

  const found = await client.query(
    'SELECT patient_id FROM public.patients WHERE patient_id = $1 LIMIT 1',
    [normalizedPatientId]
  );

  if (found.rowCount > 0) {
    return;
  }

  await ensureHospitalExists(client);

  await insertDynamicRow(client, 'patients', columns, {
    patient_id: normalizedPatientId,
    name: `Patient ${normalizedPatientId}`,
    age: 0,
    email: `${normalizedPatientId.toLowerCase()}@glovexcel.local`,
    password_hash: 'development-placeholder',
    primary_hospital_id: DEFAULT_HOSPITAL_ID
  });
}

async function ensureDoctorAndPatientExist(dbPool, doctorId, patientId) {
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    await ensureDoctorExists(client, doctorId);
    await ensurePatientExists(client, patientId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureChannelRequestsTable(queryable = getPool()) {
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS public.doctor_patient_channel_requests (
      request_id character varying PRIMARY KEY,
      doctor_id character varying NOT NULL,
      patient_id character varying NOT NULL,
      status character varying NOT NULL DEFAULT 'pending',
      requested_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
      responded_at timestamp without time zone,
      CONSTRAINT doctor_patient_channel_requests_doctor_id_fkey
        FOREIGN KEY (doctor_id) REFERENCES public.doctors(doctor_id) ON DELETE CASCADE,
      CONSTRAINT doctor_patient_channel_requests_patient_id_fkey
        FOREIGN KEY (patient_id) REFERENCES public.patients(patient_id) ON DELETE CASCADE,
      CONSTRAINT doctor_patient_channel_requests_status_check
        CHECK (status IN ('pending', 'approved', 'rejected')),
      CONSTRAINT doctor_patient_channel_requests_doctor_patient_unique
        UNIQUE (doctor_id, patient_id)
    )
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS doctor_patient_channel_requests_doctor_status_idx
    ON public.doctor_patient_channel_requests (doctor_id, status)
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS doctor_patient_channel_requests_patient_status_idx
    ON public.doctor_patient_channel_requests (patient_id, status)
  `);
}

module.exports = {
  getPool,
  connectPostgres,
  ensureDoctorAndPatientExist,
  ensureChannelRequestsTable,
  ensureDoctorPhoneColumn,
};

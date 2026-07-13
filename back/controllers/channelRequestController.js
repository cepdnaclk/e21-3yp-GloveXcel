const { getPool, ensureChannelRequestsTable } = require('../config/supabaseDb');

function createRequestId() {
  return `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getUserId(req) {
  return req.user?.sub || req.user?.patient_id || req.user?.doctor_id || null;
}

const requestDoctorChannel = async (req, res) => {
  const patientId = getUserId(req);
  const doctorId = String(req.body?.doctor_id || '').trim();

  if (!patientId) {
    return res.status(401).json({ message: 'Patient token is missing.' });
  }

  if (!doctorId) {
    return res.status(400).json({ message: 'doctor_id is required.' });
  }

  try {
    const pool = getPool();
    await ensureChannelRequestsTable(pool);
    const result = await pool.query(
      `
      INSERT INTO public.doctor_patient_channel_requests
        (request_id, doctor_id, patient_id, status, requested_at, responded_at)
      VALUES ($1, $2, $3, 'pending', CURRENT_TIMESTAMP, NULL)
      ON CONFLICT (doctor_id, patient_id)
      DO UPDATE SET
        status = CASE
          WHEN public.doctor_patient_channel_requests.status = 'approved' THEN 'approved'
          ELSE 'pending'
        END,
        requested_at = CASE
          WHEN public.doctor_patient_channel_requests.status = 'approved'
            THEN public.doctor_patient_channel_requests.requested_at
          ELSE CURRENT_TIMESTAMP
        END,
        responded_at = CASE
          WHEN public.doctor_patient_channel_requests.status = 'approved'
            THEN public.doctor_patient_channel_requests.responded_at
          ELSE NULL
        END
      RETURNING request_id, doctor_id, patient_id, status, requested_at, responded_at
      `,
      [createRequestId(), doctorId, patientId]
    );

    return res.status(201).json({ request: result.rows[0] });
  } catch (error) {
    console.error('[ChannelRequests] Failed to create request:', error);
    return res.status(500).json({ message: 'Failed to send channeling request.' });
  }
};

const channelPatient = async (req, res) => {
  const doctorId = req.user?.role === 'admin'
    ? String(req.body?.doctor_id || '').trim()
    : getUserId(req);
  const patientId = String(req.body?.patient_id || '').trim();

  if (!doctorId) {
    return res.status(req.user?.role === 'admin' ? 400 : 401).json({
      message: req.user?.role === 'admin' ? 'doctor_id is required.' : 'Doctor token is missing.'
    });
  }

  if (!patientId) {
    return res.status(400).json({ message: 'patient_id is required.' });
  }

  try {
    const pool = getPool();
    await ensureChannelRequestsTable(pool);
    const result = await pool.query(
      `
      INSERT INTO public.doctor_patient_channel_requests
        (request_id, doctor_id, patient_id, status, requested_at, responded_at)
      VALUES ($1, $2, $3, 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (doctor_id, patient_id)
      DO UPDATE SET
        status = 'approved',
        responded_at = CURRENT_TIMESTAMP
      RETURNING request_id, doctor_id, patient_id, status, requested_at, responded_at
      `,
      [createRequestId(), doctorId, patientId]
    );

    return res.status(201).json({
      message: 'Patient channeled successfully.',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('[ChannelRequests] Failed to channel patient:', error);
    return res.status(500).json({ message: 'Failed to channel patient.' });
  }
};

async function listByStatus(pool, doctorId, status) {
  const result = await pool.query(
    `
    SELECT
      r.request_id,
      r.doctor_id,
      r.patient_id,
      r.status,
      r.requested_at,
      r.responded_at,
      p.name AS patient_name,
      p.age AS patient_age,
      p.email AS patient_email,
      p.primary_hospital_id,
      h.name AS hospital_name,
      h.location AS hospital_location
    FROM public.doctor_patient_channel_requests r
    JOIN public.patients p ON p.patient_id = r.patient_id
    LEFT JOIN public.hospitals h ON h.hospital_id = p.primary_hospital_id
    WHERE r.doctor_id = $1 AND r.status = $2
    ORDER BY COALESCE(r.responded_at, r.requested_at) DESC
    `,
    [doctorId, status]
  );

  return result.rows;
}

const listDoctorChannelData = async (req, res) => {
  const doctorId = req.user?.role === 'admin'
    ? String(req.query?.doctor_id || '').trim()
    : getUserId(req);

  if (!doctorId) {
    return res.status(400).json({ message: 'doctor_id is required.' });
  }

  try {
    const pool = getPool();
    await ensureChannelRequestsTable(pool);
    const [requests, patients] = await Promise.all([
      listByStatus(pool, doctorId, 'pending'),
      listByStatus(pool, doctorId, 'approved'),
    ]);

    return res.json({ requests, patients });
  } catch (error) {
    console.error('[ChannelRequests] Failed to list doctor data:', error);
    return res.status(500).json({ message: 'Failed to load doctor patient requests.' });
  }
};

const updateChannelRequestStatus = async (req, res) => {
  const requestId = String(req.params.requestId || '').trim();
  const status = String(req.body?.status || '').trim().toLowerCase();
  const doctorId = getUserId(req);

  if (!requestId) {
    return res.status(400).json({ message: 'requestId is required.' });
  }

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'status must be approved or rejected.' });
  }

  try {
    const pool = getPool();
    await ensureChannelRequestsTable(pool);
    const values = req.user?.role === 'admin'
      ? [status, requestId]
      : [status, requestId, doctorId];
    const doctorFilter = req.user?.role === 'admin' ? '' : 'AND doctor_id = $3';

    const result = await pool.query(
      `
      UPDATE public.doctor_patient_channel_requests
      SET status = $1, responded_at = CURRENT_TIMESTAMP
      WHERE request_id = $2 ${doctorFilter}
      RETURNING request_id, doctor_id, patient_id, status, requested_at, responded_at
      `,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Request not found for this doctor.' });
    }

    return res.json({ request: result.rows[0] });
  } catch (error) {
    console.error('[ChannelRequests] Failed to update request:', error);
    return res.status(500).json({ message: 'Failed to update channeling request.' });
  }
};

const removeApprovedPatient = async (req, res) => {
  const patientId = String(req.params.patientId || '').trim();
  const doctorId = req.user?.role === 'admin'
    ? String(req.query?.doctor_id || '').trim()
    : getUserId(req);

  if (!patientId) {
    return res.status(400).json({ message: 'patientId is required.' });
  }

  if (!doctorId) {
    return res.status(req.user?.role === 'admin' ? 400 : 401).json({
      message: req.user?.role === 'admin' ? 'doctor_id is required.' : 'Doctor token is missing.'
    });
  }

  try {
    const pool = getPool();
    await ensureChannelRequestsTable(pool);

    const result = await pool.query(
      `
      DELETE FROM public.doctor_patient_channel_requests
      WHERE patient_id = $1
        AND status = 'approved'
        AND doctor_id = $2
      RETURNING request_id, doctor_id, patient_id, status
      `,
      [patientId, doctorId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Approved patient was not found for this doctor.' });
    }

    return res.json({
      message: 'Patient removed from My Patients.',
      removed: result.rows[0]
    });
  } catch (error) {
    console.error('[ChannelRequests] Failed to remove patient:', error);
    return res.status(500).json({ message: 'Failed to remove patient.' });
  }
};

module.exports = {
  requestDoctorChannel,
  channelPatient,
  listDoctorChannelData,
  updateChannelRequestStatus,
  removeApprovedPatient,
};

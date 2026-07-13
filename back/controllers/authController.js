const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, ensureChannelRequestsTable, ensureDoctorPhoneColumn } = require('../config/supabaseDb');

const pool = getPool();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_PUBLIC_KEY = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
).trim();

const ensureJwtConfigured = (res) => {
    if (!JWT_SECRET) {
        res.status(500).json({ message: 'JWT is not configured on the server.' });
        return false;
    }
    return true;
};

const signAuthToken = (payload) =>
    jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

const normalizeEmail = (email) => (email || '').trim().toLowerCase();
const normalizePhone = (phone) => (phone || '').trim();

const getGoogleProfileName = (supabaseUser) =>
    (
        supabaseUser?.user_metadata?.full_name ||
        supabaseUser?.user_metadata?.name ||
        supabaseUser?.email?.split('@')[0] ||
        ''
    ).trim();

const createOAuthPasswordHash = async (providerUserId) =>
    bcrypt.hash(`google-oauth:${providerUserId}:${Date.now()}`, 10);

const doctorProfilePayload = (doctor) => ({
    doctor_id: doctor.doctor_id,
    name: doctor.name,
    email: doctor.email,
    phone: doctor.phone || '',
    hospital_id: doctor.hospital_id,
    verification: doctor.verification
});

const getSupabaseAuthConfig = (_req, res) => {
    if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
        return res.status(500).json({
            message: 'Supabase Auth is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to env.'
        });
    }

    return res.status(200).json({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_PUBLIC_KEY
    });
};

const isDoctorVerified = (verificationValue) =>
    (verificationValue || '').trim().toLowerCase() === 'yes';

const normalizeDoctorVerification = (verificationValue) =>
    (verificationValue || 'pending').trim().toLowerCase();

const getDoctorVerificationMessage = (verificationValue) => {
    const normalizedStatus = normalizeDoctorVerification(verificationValue);
    if (normalizedStatus === 'no') {
        return 'Doctor account request was rejected. Please contact admin.';
    }
    return 'Doctor account is under review and not verified yet.';
};

const hospitalExists = async (hospitalId) => {
    const found = await pool.query(
        'SELECT hospital_id FROM public.hospitals WHERE hospital_id = $1 LIMIT 1',
        [hospitalId]
    );
    return found.rowCount > 0;
};

const getDoctorHospitalId = async (doctorId) => {
    if (!doctorId) return '';
    const result = await pool.query(
        'SELECT hospital_id FROM public.doctors WHERE doctor_id = $1 LIMIT 1',
        [doctorId]
    );
    return String(result.rows[0]?.hospital_id || '').trim();
};

const getPatientHospitalId = async (patientId) => {
    if (!patientId) return '';
    const result = await pool.query(
        'SELECT primary_hospital_id FROM public.patients WHERE patient_id = $1 LIMIT 1',
        [patientId]
    );
    return String(result.rows[0]?.primary_hospital_id || '').trim();
};

const createHospital = async (req, res) => {
    try {
        const { hospital_id, name, location } = req.body;
        const normalizedHospitalId = (hospital_id || '').trim();
        const normalizedName = (name || '').trim();
        const normalizedLocation = (location || '').trim();

        if (!normalizedHospitalId || !normalizedName) {
            return res.status(400).json({ message: 'hospital_id and name are required.' });
        }

        const inserted = await pool.query(
            `
            INSERT INTO public.hospitals (hospital_id, name, location)
            VALUES ($1, $2, $3)
            RETURNING hospital_id, name, location
            `,
            [normalizedHospitalId, normalizedName, normalizedLocation || null]
        );

        return res.status(201).json({
            message: 'Hospital created successfully.',
            hospital: inserted.rows[0]
        });
    } catch (error) {
        if (error && error.code === '23505') {
            return res.status(409).json({ message: 'Hospital ID already exists.' });
        }
        console.error('CREATE_HOSPITAL_ERROR:', error);
        return res.status(500).json({ message: 'Failed to create hospital.' });
    }
};

const listHospitals = async (_req, res) => {
    try {
        const hospitals = await pool.query(
            `
            SELECT hospital_id, name, location
            FROM public.hospitals
            ORDER BY hospital_id ASC
            `
        );

        return res.status(200).json({ hospitals: hospitals.rows });
    } catch (error) {
        console.error('LIST_HOSPITALS_ERROR:', error);
        return res.status(500).json({ message: 'Failed to load hospitals.' });
    }
};

const listPatients = async (req, res) => {
    try {
        const role = req.user?.role;
        const tokenDoctorId = req.user?.sub;
        const requestedDoctorId = (req.query.doctor_id || '').trim();
        const fetchAll = req.query.all === 'true';
        const discoverPatients = req.query.discover === 'true';
        const includeOtherHospitals = req.query.include_other_hospitals === 'true';
        const doctorId = role === 'doctor'
            ? tokenDoctorId
            : (requestedDoctorId || null);

        if (role === 'doctor' && discoverPatients) {
            await ensureChannelRequestsTable(pool);
            const hospitalId = await getDoctorHospitalId(doctorId);

            if (!hospitalId) {
                return res.status(400).json({ message: 'Doctor hospital was not found.' });
            }

            const hospitalOperator = includeOtherHospitals ? '<>' : '=';
            const patients = await pool.query(
                `
                SELECT
                    p.patient_id,
                    p.name,
                    p.age,
                    p.email,
                    p.primary_hospital_id,
                    h.name AS hospital_name,
                    h.location AS hospital_location,
                    r.request_id,
                    r.status AS channel_status
                FROM public.patients p
                LEFT JOIN public.hospitals h ON h.hospital_id = p.primary_hospital_id
                LEFT JOIN public.doctor_patient_channel_requests r
                    ON r.patient_id = p.patient_id AND r.doctor_id = $1
                WHERE p.primary_hospital_id ${hospitalOperator} $2
                ORDER BY p.name ASC, p.patient_id ASC
                `,
                [doctorId, hospitalId]
            );

            return res.status(200).json({
                patients: patients.rows,
                scope: includeOtherHospitals ? 'other_hospitals' : 'same_hospital',
                hospital_id: hospitalId
            });
        }

        if (doctorId && (role === 'doctor' || !fetchAll)) {
            await ensureChannelRequestsTable(pool);
            const patients = await pool.query(
                `
                SELECT DISTINCT p.patient_id, p.name, p.age, p.email, p.primary_hospital_id
                FROM public.patients p
                INNER JOIN public.doctor_patient_channel_requests r
                    ON r.patient_id = p.patient_id
                WHERE r.doctor_id = $1 AND r.status = 'approved'
                ORDER BY p.name ASC, p.patient_id ASC
                `,
                [doctorId]
            );

            return res.status(200).json({ patients: patients.rows });
        }

        const patients = await pool.query(
            `
            SELECT patient_id, name, age, email, primary_hospital_id
            FROM public.patients
            ORDER BY patient_id ASC
            `
        );

        return res.status(200).json({ patients: patients.rows });
    } catch (error) {
        console.error('LIST_PATIENTS_ERROR:', error);
        return res.status(500).json({ message: 'Failed to load patients.' });
    }
};

const listDoctors = async (req, res) => {
    try {
        await ensureDoctorPhoneColumn();

        const role = req.user?.role;
        const patientId = req.user?.sub;
        const includeOtherHospitals = req.query.include_other_hospitals === 'true';

        if (role === 'patient') {
            await ensureChannelRequestsTable(pool);
            const hospitalId = await getPatientHospitalId(patientId);

            if (!hospitalId) {
                return res.status(400).json({ message: 'Patient hospital was not found.' });
            }

            const hospitalOperator = includeOtherHospitals ? '<>' : '=';
            const doctors = await pool.query(
                `
                SELECT
                    d.doctor_id,
                    d.name,
                    d.email,
                    d.phone,
                    d.hospital_id,
                    h.name AS hospital_name,
                    h.location AS hospital_location,
                    r.request_id,
                    r.status AS channel_status
                FROM public.doctors d
                LEFT JOIN public.hospitals h ON h.hospital_id = d.hospital_id
                LEFT JOIN public.doctor_patient_channel_requests r
                    ON r.doctor_id = d.doctor_id AND r.patient_id = $1
                WHERE d.hospital_id ${hospitalOperator} $2
                  AND LOWER(COALESCE(d."Verification", 'pending')) = 'yes'
                ORDER BY d.name ASC, d.doctor_id ASC
                `,
                [patientId, hospitalId]
            );

            return res.status(200).json({
                doctors: doctors.rows,
                scope: includeOtherHospitals ? 'other_hospitals' : 'same_hospital',
                hospital_id: hospitalId
            });
        }

        const doctors = await pool.query(
            `
            SELECT d.doctor_id, d.name, d.email, d.phone, d.hospital_id, h.name AS hospital_name, h.location AS hospital_location
            FROM public.doctors d
            LEFT JOIN public.hospitals h ON h.hospital_id = d.hospital_id
            WHERE LOWER(COALESCE(d."Verification", 'pending')) = 'yes'
            ORDER BY d.name ASC
            `
        );

        return res.status(200).json({ doctors: doctors.rows });
    } catch (error) {
        console.error('LIST_DOCTORS_ERROR:', error);
        return res.status(500).json({ message: 'Failed to load doctors.' });
    }
};

const getSupabaseUserFromAccessToken = async (accessToken) => {
    if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
        const error = new Error('Supabase Auth is not configured.');
        error.status = 500;
        throw error;
    }

    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_PUBLIC_KEY
        }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.msg || data.message || 'Google session could not be verified.');
        error.status = 401;
        throw error;
    }

    return data;
};

const googleLogin = async (req, res) => {
    try {
        if (!ensureJwtConfigured(res)) {
            return;
        }

        const { access_token, role } = req.body;
        const normalizedRole = (role || '').trim().toLowerCase();

        if (!access_token) {
            return res.status(400).json({ message: 'Google access token is required.' });
        }

        if (!['doctor', 'patient'].includes(normalizedRole)) {
            return res.status(400).json({ message: 'Google login is available only for doctors and patients.' });
        }

        const supabaseUser = await getSupabaseUserFromAccessToken(access_token);
        const normalizedEmail = normalizeEmail(supabaseUser.email);

        if (!normalizedEmail) {
            return res.status(401).json({ message: 'Google account email was not found.' });
        }

        if (normalizedRole === 'doctor') {
            await ensureDoctorPhoneColumn();
            const foundDoctor = await pool.query(
                `
                SELECT doctor_id, name, email, phone, hospital_id, "Verification" AS verification
                FROM public.doctors
                WHERE LOWER(email) = $1
                LIMIT 1
                `,
                [normalizedEmail]
            );

            if (foundDoctor.rowCount === 0) {
                return res.status(200).json({
                    message: 'Select a hospital to create your doctor account.',
                    requiresHospital: true,
                    role: 'doctor',
                    googleProfile: {
                        name: getGoogleProfileName(supabaseUser),
                        email: normalizedEmail
                    }
                });
            }

            const doctor = foundDoctor.rows[0];
            if (!isDoctorVerified(doctor.verification)) {
                return res.status(403).json({ message: getDoctorVerificationMessage(doctor.verification) });
            }

            const token = signAuthToken({
                sub: doctor.doctor_id,
                role: 'doctor',
                email: doctor.email
            });

            return res.status(200).json({
                message: 'Doctor Google login successful.',
                role: 'doctor',
                token,
                profile: doctorProfilePayload(doctor)
            });
        }

        const foundPatient = await pool.query(
            `
            SELECT patient_id, name, age, email, primary_hospital_id
            FROM public.patients
            WHERE LOWER(email) = $1
            LIMIT 1
            `,
            [normalizedEmail]
        );

        if (foundPatient.rowCount === 0) {
            return res.status(200).json({
                message: 'Select a hospital to create your patient account.',
                requiresHospital: true,
                role: 'patient',
                googleProfile: {
                    name: getGoogleProfileName(supabaseUser),
                    email: normalizedEmail
                }
            });
        }

        const patient = foundPatient.rows[0];
        const token = signAuthToken({
            sub: patient.patient_id,
            role: 'patient',
            email: patient.email
        });

        return res.status(200).json({
            message: 'Patient Google login successful.',
            role: 'patient',
            token,
            profile: {
                patient_id: patient.patient_id,
                name: patient.name,
                age: patient.age,
                email: patient.email,
                primary_hospital_id: patient.primary_hospital_id
            }
        });
    } catch (error) {
        console.error('GOOGLE_LOGIN_ERROR:', error);
        return res.status(error.status || 500).json({
            message: error.status === 401 ? error.message : 'Failed to login with Google.'
        });
    }
};

const googleCompleteSignup = async (req, res) => {
    try {
        if (!ensureJwtConfigured(res)) {
            return;
        }

        const { access_token, role, hospital_id } = req.body;
        const normalizedRole = (role || '').trim().toLowerCase();
        const normalizedHospitalId = (hospital_id || '').trim();

        if (!access_token) {
            return res.status(400).json({ message: 'Google access token is required.' });
        }

        if (!['doctor', 'patient'].includes(normalizedRole)) {
            return res.status(400).json({ message: 'Google signup is available only for doctors and patients.' });
        }

        if (!normalizedHospitalId) {
            return res.status(400).json({ message: 'Hospital is required.' });
        }

        const isValidHospital = await hospitalExists(normalizedHospitalId);
        if (!isValidHospital) {
            return res.status(400).json({ message: 'Selected hospital_id does not exist.' });
        }

        const supabaseUser = await getSupabaseUserFromAccessToken(access_token);
        const normalizedEmail = normalizeEmail(supabaseUser.email);
        const googleName = getGoogleProfileName(supabaseUser);

        if (!normalizedEmail || !googleName) {
            return res.status(401).json({ message: 'Google account name or email was not found.' });
        }

        const passwordHash = await createOAuthPasswordHash(supabaseUser.id || normalizedEmail);

        if (normalizedRole === 'doctor') {
            await ensureDoctorPhoneColumn();
            const existingDoctor = await pool.query(
                'SELECT doctor_id FROM public.doctors WHERE LOWER(email) = $1 LIMIT 1',
                [normalizedEmail]
            );

            if (existingDoctor.rowCount > 0) {
                return res.status(409).json({ message: 'Doctor account already exists for this Google email.' });
            }

            const inserted = await pool.query(
                `
                INSERT INTO public.doctors (name, email, password_hash, hospital_id, "Verification", phone, auth_provider)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING doctor_id, name, email, phone, hospital_id, "Verification" AS verification
                `,
                [googleName, normalizedEmail, passwordHash, normalizedHospitalId, 'pending', '', 'google']
            );

            return res.status(201).json({
                message: 'Doctor account created. Please wait for admin approval.',
                requiresApproval: true,
                role: 'doctor',
                profile: inserted.rows[0]
            });
        }

        const existingPatient = await pool.query(
            'SELECT patient_id FROM public.patients WHERE LOWER(email) = $1 LIMIT 1',
            [normalizedEmail]
        );

        if (existingPatient.rowCount > 0) {
            return res.status(409).json({ message: 'Patient account already exists for this Google email.' });
        }

        const inserted = await pool.query(
            `
            INSERT INTO public.patients (name, age, email, password_hash, primary_hospital_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING patient_id, name, age, email, primary_hospital_id
            `,
            [googleName, 0, normalizedEmail, passwordHash, normalizedHospitalId]
        );

        const patient = inserted.rows[0];
        const token = signAuthToken({
            sub: patient.patient_id,
            role: 'patient',
            email: patient.email
        });

        return res.status(201).json({
            message: 'Patient account created successfully.',
            role: 'patient',
            token,
            profile: {
                patient_id: patient.patient_id,
                name: patient.name,
                age: patient.age,
                email: patient.email,
                primary_hospital_id: patient.primary_hospital_id
            }
        });
    } catch (error) {
        console.error('GOOGLE_COMPLETE_SIGNUP_ERROR:', error);
        return res.status(error.status || 500).json({
            message: error.status === 401 ? error.message : 'Failed to complete Google signup.'
        });
    }
};

const doctorSignup = async (req, res) => {
    try {
        await ensureDoctorPhoneColumn();

        const { email, password, hospital_id, name, phone } = req.body;
        const normalizedEmail = (email || '').trim().toLowerCase();
        const normalizedHospitalId = (hospital_id || '').trim();
        const normalizedName = (name || '').trim();
        const normalizedPhone = normalizePhone(phone);

        if (!normalizedEmail || !password || !normalizedHospitalId || !normalizedName || !normalizedPhone) {
            return res.status(400).json({
                message: 'Doctor signup requires name, email, phone, password, and hospital_id.'
            });
        }

        const existingDoctor = await pool.query(
            'SELECT doctor_id FROM public.doctors WHERE email = $1 LIMIT 1',
            [normalizedEmail]
        );

        if (existingDoctor.rowCount > 0) {
            return res.status(409).json({ message: 'Doctor account already exists for this email.' });
        }

        const isValidHospital = await hospitalExists(normalizedHospitalId);
        if (!isValidHospital) {
            return res.status(400).json({ message: 'Selected hospital_id does not exist.' });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const inserted = await pool.query(
            `
            INSERT INTO public.doctors (name, email, password_hash, hospital_id, "Verification", phone, auth_provider)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING doctor_id, name, email, phone, hospital_id, "Verification" AS verification
            `,
            [normalizedName, normalizedEmail, password_hash, normalizedHospitalId, 'pending', normalizedPhone, 'local']
        );

        const doctor = inserted.rows[0];

        return res.status(201).json({
            message: 'Doctor account created successfully.',
            doctor: doctorProfilePayload(doctor)
        });
    } catch (error) {
        console.error('DOCTOR_SIGNUP_ERROR:', error);
        return res.status(500).json({ message: 'Failed to create doctor account.' });
    }
};

const adminSignup = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const normalizedName = (name || '').trim();
        const normalizedEmail = (email || '').trim().toLowerCase();

        if (!normalizedName || !normalizedEmail || !password) {
            return res.status(400).json({
                message: 'Admin signup requires name, email, and password.'
            });
        }

        const existingAdmin = await pool.query(
            'SELECT admin_id FROM public.admins WHERE email = $1 LIMIT 1',
            [normalizedEmail]
        );

        if (existingAdmin.rowCount > 0) {
            return res.status(409).json({ message: 'Admin account already exists for this email.' });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const inserted = await pool.query(
            `
            INSERT INTO public.admins (name, email, password_hash)
            VALUES ($1, $2, $3)
            RETURNING admin_id, name, email
            `,
            [normalizedName, normalizedEmail, password_hash]
        );

        const admin = inserted.rows[0];

        return res.status(201).json({
            message: 'Admin account created successfully.',
            admin: {
                admin_id: admin.admin_id,
                name: admin.name,
                email: admin.email
            }
        });
    } catch (error) {
        console.error('ADMIN_SIGNUP_ERROR:', error);
        return res.status(500).json({ message: 'Failed to create admin account.' });
    }
};

const patientSignup = async (req, res) => {
    try {
        const { name, age, email, primary_hospital_id, password } = req.body;
        const normalizedName = (name || '').trim();
        const normalizedEmail = (email || '').trim().toLowerCase();
        const normalizedPrimaryHospitalId = (primary_hospital_id || '').trim();

        if (!normalizedName || age === undefined || !normalizedEmail || !normalizedPrimaryHospitalId || !password) {
            return res.status(400).json({
                message: 'Patient signup requires name, age, email, primary_hospital_id, and password.'
            });
        }

        const numericAge = Number(age);
        if (!Number.isFinite(numericAge) || numericAge < 0) {
            return res.status(400).json({ message: 'Age must be a valid non-negative number.' });
        }

        const existingPatient = await pool.query(
            'SELECT patient_id FROM public.patients WHERE email = $1 LIMIT 1',
            [normalizedEmail]
        );

        if (existingPatient.rowCount > 0) {
            return res.status(409).json({ message: 'Patient account already exists for this email.' });
        }

        const isValidHospital = await hospitalExists(normalizedPrimaryHospitalId);
        if (!isValidHospital) {
            return res.status(400).json({ message: 'Selected primary_hospital_id does not exist.' });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const inserted = await pool.query(
            `
            INSERT INTO public.patients (name, age, email, password_hash, primary_hospital_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING patient_id, name, age, email, primary_hospital_id
            `,
            [normalizedName, numericAge, normalizedEmail, password_hash, normalizedPrimaryHospitalId]
        );

        const patient = inserted.rows[0];

        return res.status(201).json({
            message: 'Patient account created successfully.',
            patient: {
                patient_id: patient.patient_id,
                name: patient.name,
                age: patient.age,
                email: patient.email,
                primary_hospital_id: patient.primary_hospital_id
            }
        });
    } catch (error) {
        console.error('PATIENT_SIGNUP_ERROR:', error);
        return res.status(500).json({ message: 'Failed to create patient account.' });
    }
};

const doctorLogin = async (req, res) => {
    try {
        if (!ensureJwtConfigured(res)) {
            return;
        }
        await ensureDoctorPhoneColumn();

        const { email, password } = req.body;
        const normalizedEmail = (email || '').trim().toLowerCase();

        if (!normalizedEmail || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        const found = await pool.query(
            `
            SELECT doctor_id, name, email, phone, password_hash, hospital_id, "Verification" AS verification
            FROM public.doctors
            WHERE email = $1
            LIMIT 1
            `,
            [normalizedEmail]
        );

        if (found.rowCount === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const doctor = found.rows[0];

        const isValidPassword = await bcrypt.compare(password, doctor.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        if (!isDoctorVerified(doctor.verification)) {
            return res.status(403).json({ message: getDoctorVerificationMessage(doctor.verification) });
        }

        const token = signAuthToken({
            sub: doctor.doctor_id,
            role: 'doctor',
            email: doctor.email
        });

        return res.status(200).json({
            message: 'Doctor login successful.',
            token,
            doctor: doctorProfilePayload(doctor)
        });
    } catch (error) {
        console.error('DOCTOR_LOGIN_ERROR:', error);
        return res.status(500).json({ message: 'Failed to login doctor.' });
    }
};

const adminLogin = async (req, res) => {
    try {
        if (!ensureJwtConfigured(res)) {
            return;
        }

        const { email, password } = req.body;
        const normalizedEmail = (email || '').trim().toLowerCase();

        if (!normalizedEmail || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        const found = await pool.query(
            `
            SELECT admin_id, name, email, password_hash
            FROM public.admins
            WHERE email = $1
            LIMIT 1
            `,
            [normalizedEmail]
        );

        if (found.rowCount === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const admin = found.rows[0];

        const isValidPassword = await bcrypt.compare(password, admin.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const token = signAuthToken({
            sub: admin.admin_id,
            role: 'admin',
            email: admin.email
        });

        return res.status(200).json({
            message: 'Admin login successful.',
            token,
            admin: {
                admin_id: admin.admin_id,
                name: admin.name,
                email: admin.email
            }
        });
    } catch (error) {
        console.error('ADMIN_LOGIN_ERROR:', error);
        return res.status(500).json({ message: 'Failed to login admin.' });
    }
};

const getPendingDoctorRequests = async (req, res) => {
    try {
        const pendingRequests = await pool.query(
            `
            SELECT d.doctor_id, d.name, d.email, d.phone, d.hospital_id, h.name AS hospital_name, d."Verification" AS verification
            FROM public.doctors d
            LEFT JOIN public.hospitals h ON h.hospital_id = d.hospital_id
            WHERE LOWER(COALESCE(d."Verification", 'pending')) = 'pending'
            ORDER BY d.doctor_id DESC
            `
        );

        return res.status(200).json({
            requests: pendingRequests.rows
        });
    } catch (error) {
        console.error('GET_PENDING_DOCTOR_REQUESTS_ERROR:', error);
        return res.status(500).json({ message: 'Failed to load pending doctor requests.' });
    }
};

const getApprovedDoctors = async (req, res) => {
    try {
        const approvedDoctors = await pool.query(
            `
            SELECT d.doctor_id, d.name, d.email, d.phone, d.hospital_id, h.name AS hospital_name, d."Verification" AS verification
            FROM public.doctors d
            LEFT JOIN public.hospitals h ON h.hospital_id = d.hospital_id
            WHERE LOWER(COALESCE(d."Verification", 'pending')) = 'yes'
            ORDER BY d.doctor_id DESC
            `
        );

        return res.status(200).json({
            doctors: approvedDoctors.rows
        });
    } catch (error) {
        console.error('GET_APPROVED_DOCTORS_ERROR:', error);
        return res.status(500).json({ message: 'Failed to load approved doctors.' });
    }
};

const updateDoctorVerificationStatus = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { status, action } = req.body;
        const normalizedDoctorId = (doctorId || '').trim();

        if (!normalizedDoctorId) {
            return res.status(400).json({ message: 'Invalid doctor id.' });
        }

        let nextStatus = (status || '').trim().toLowerCase();
        if (!nextStatus && action) {
            const normalizedAction = (action || '').trim().toLowerCase();
            if (normalizedAction === 'approve') {
                nextStatus = 'yes';
            }
            if (normalizedAction === 'reject') {
                nextStatus = 'no';
            }
        }

        if (!['yes', 'no', 'pending'].includes(nextStatus)) {
            return res.status(400).json({ message: 'Status must be yes, no, or pending.' });
        }

        const updated = await pool.query(
            `
            UPDATE public.doctors
            SET "Verification" = $1
            WHERE doctor_id = $2
            RETURNING doctor_id, name, email, phone, hospital_id, "Verification" AS verification
            `,
            [nextStatus, normalizedDoctorId]
        );

        if (updated.rowCount === 0) {
            return res.status(404).json({ message: 'Doctor not found.' });
        }

        return res.status(200).json({
            message: `Doctor verification updated to ${nextStatus}.`,
            doctor: updated.rows[0]
        });
    } catch (error) {
        console.error('UPDATE_DOCTOR_VERIFICATION_ERROR:', error);
        return res.status(500).json({ message: 'Failed to update doctor verification.' });
    }
};

const patientLogin = async (req, res) => {
    try {
        if (!ensureJwtConfigured(res)) {
            return;
        }

        const { email, password } = req.body;
        const normalizedEmail = (email || '').trim().toLowerCase();

        if (!normalizedEmail || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        const found = await pool.query(
            `
            SELECT patient_id, name, age, email, password_hash, primary_hospital_id
            FROM public.patients
            WHERE email = $1
            LIMIT 1
            `,
            [normalizedEmail]
        );

        if (found.rowCount === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const patient = found.rows[0];

        const isValidPassword = await bcrypt.compare(password, patient.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const token = signAuthToken({
            sub: patient.patient_id,
            role: 'patient',
            email: patient.email
        });

        return res.status(200).json({
            message: 'Patient login successful.',
            token,
            patient: {
                patient_id: patient.patient_id,
                name: patient.name,
                age: patient.age,
                email: patient.email,
                primary_hospital_id: patient.primary_hospital_id
            }
        });
    } catch (error) {
        console.error('PATIENT_LOGIN_ERROR:', error);
        return res.status(500).json({ message: 'Failed to login patient.' });
    }
};

const login = async (req, res) => {
    try {
        if (!ensureJwtConfigured(res)) {
            return;
        }

        const { email, password, role } = req.body;
        const normalizedEmail = (email || '').trim().toLowerCase();
        const normalizedRole = (role || '').trim().toLowerCase();

        if (!normalizedEmail || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        if (normalizedRole && !['admin', 'doctor', 'patient'].includes(normalizedRole)) {
            return res.status(400).json({ message: 'Invalid role value.' });
        }

        if (normalizedRole === 'admin') {
            const foundAdmin = await pool.query(
                `
                SELECT admin_id, name, email, password_hash
                FROM public.admins
                WHERE email = $1
                LIMIT 1
                `,
                [normalizedEmail]
            );

            if (foundAdmin.rowCount === 0) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            const admin = foundAdmin.rows[0];
            const isValidPassword = await bcrypt.compare(password, admin.password_hash);

            if (!isValidPassword) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            const token = signAuthToken({
                sub: admin.admin_id,
                role: 'admin',
                email: admin.email
            });

            return res.status(200).json({
                message: 'Admin login successful.',
                role: 'admin',
                token,
                profile: {
                    admin_id: admin.admin_id,
                    name: admin.name,
                    email: admin.email
                }
            });
        }

        if (normalizedRole === 'doctor') {
            await ensureDoctorPhoneColumn();
            const foundDoctor = await pool.query(
                `
                SELECT doctor_id, name, email, phone, password_hash, hospital_id, "Verification" AS verification
                FROM public.doctors
                WHERE email = $1
                LIMIT 1
                `,
                [normalizedEmail]
            );

            if (foundDoctor.rowCount === 0) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            const doctor = foundDoctor.rows[0];
            const isValidPassword = await bcrypt.compare(password, doctor.password_hash);

            if (!isValidPassword) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            if (!isDoctorVerified(doctor.verification)) {
                return res.status(403).json({ message: getDoctorVerificationMessage(doctor.verification) });
            }

            const token = signAuthToken({
                sub: doctor.doctor_id,
                role: 'doctor',
                email: doctor.email
            });

            return res.status(200).json({
                message: 'Doctor login successful.',
                role: 'doctor',
                token,
                profile: doctorProfilePayload(doctor)
            });
        }

        if (normalizedRole === 'patient') {
            const foundPatient = await pool.query(
                `
                SELECT patient_id, name, age, email, password_hash, primary_hospital_id
                FROM public.patients
                WHERE email = $1
                LIMIT 1
                `,
                [normalizedEmail]
            );

            if (foundPatient.rowCount === 0) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            const patient = foundPatient.rows[0];
            const isValidPassword = await bcrypt.compare(password, patient.password_hash);

            if (!isValidPassword) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            const token = signAuthToken({
                sub: patient.patient_id,
                role: 'patient',
                email: patient.email
            });

            return res.status(200).json({
                message: 'Patient login successful.',
                role: 'patient',
                token,
                profile: {
                    patient_id: patient.patient_id,
                    name: patient.name,
                    age: patient.age,
                    email: patient.email,
                    primary_hospital_id: patient.primary_hospital_id
                }
            });
        }

        const foundAdmin = await pool.query(
            `
            SELECT admin_id, name, email, password_hash
            FROM public.admins
            WHERE email = $1
            LIMIT 1
            `,
            [normalizedEmail]
        );

        if (foundAdmin.rowCount > 0) {
            const admin = foundAdmin.rows[0];
            const isValidPassword = await bcrypt.compare(password, admin.password_hash);

            if (!isValidPassword) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            const token = signAuthToken({
                sub: admin.admin_id,
                role: 'admin',
                email: admin.email
            });

            return res.status(200).json({
                message: 'Admin login successful.',
                role: 'admin',
                token,
                profile: {
                    admin_id: admin.admin_id,
                    name: admin.name,
                    email: admin.email
                }
            });
        }

        await ensureDoctorPhoneColumn();
        const foundDoctor = await pool.query(
            `
            SELECT doctor_id, name, email, phone, password_hash, hospital_id, "Verification" AS verification
            FROM public.doctors
            WHERE email = $1
            LIMIT 1
            `,
            [normalizedEmail]
        );

        if (foundDoctor.rowCount > 0) {
            const doctor = foundDoctor.rows[0];
            const isValidPassword = await bcrypt.compare(password, doctor.password_hash);

            if (!isValidPassword) {
                return res.status(401).json({ message: 'Invalid email or password.' });
            }

            if (!isDoctorVerified(doctor.verification)) {
                return res.status(403).json({ message: getDoctorVerificationMessage(doctor.verification) });
            }

            const token = signAuthToken({
                sub: doctor.doctor_id,
                role: 'doctor',
                email: doctor.email
            });

            return res.status(200).json({
                message: 'Doctor login successful.',
                role: 'doctor',
                token,
                profile: doctorProfilePayload(doctor)
            });
        }

        const foundPatient = await pool.query(
            `
            SELECT patient_id, name, age, email, password_hash, primary_hospital_id
            FROM public.patients
            WHERE email = $1
            LIMIT 1
            `,
            [normalizedEmail]
        );

        if (foundPatient.rowCount === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const patient = foundPatient.rows[0];
        const isValidPassword = await bcrypt.compare(password, patient.password_hash);

        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const token = signAuthToken({
            sub: patient.patient_id,
            role: 'patient',
            email: patient.email
        });

        return res.status(200).json({
            message: 'Patient login successful.',
            role: 'patient',
            token,
            profile: {
                patient_id: patient.patient_id,
                name: patient.name,
                age: patient.age,
                email: patient.email,
                primary_hospital_id: patient.primary_hospital_id
            }
        });
    } catch (error) {
        console.error('LOGIN_ERROR:', error);
        return res.status(500).json({ message: 'Failed to login.' });
    }
};

const getDoctorProfile = async (req, res) => {
    try {
        await ensureDoctorPhoneColumn();

        const doctorId = String(req.user?.sub || '').trim();
        if (!doctorId) {
            return res.status(400).json({ message: 'Doctor token is missing doctor id.' });
        }

        const found = await pool.query(
            `
            SELECT doctor_id, name, email, phone, hospital_id, "Verification" AS verification
            FROM public.doctors
            WHERE doctor_id = $1
            LIMIT 1
            `,
            [doctorId]
        );

        if (found.rowCount === 0) {
            return res.status(404).json({ message: 'Doctor profile not found.' });
        }

        return res.status(200).json({ profile: doctorProfilePayload(found.rows[0]) });
    } catch (error) {
        console.error('GET_DOCTOR_PROFILE_ERROR:', error);
        return res.status(500).json({ message: 'Failed to load doctor profile.' });
    }
};

const updateDoctorProfile = async (req, res) => {
    try {
        await ensureDoctorPhoneColumn();

        const doctorId = String(req.user?.sub || '').trim();
        const normalizedName = (req.body?.name || '').trim();
        const normalizedPhone = normalizePhone(req.body?.phone);
        const password = String(req.body?.password || '');

        if (!doctorId) {
            return res.status(400).json({ message: 'Doctor token is missing doctor id.' });
        }

        if (!normalizedName || !normalizedPhone) {
            return res.status(400).json({ message: 'Name and phone are required.' });
        }

        if (!password) {
            return res.status(400).json({ message: 'Password is required to update contact details.' });
        }

        const found = await pool.query(
            `
            SELECT doctor_id, password_hash, COALESCE(auth_provider, 'local') AS auth_provider
            FROM public.doctors
            WHERE doctor_id = $1
            LIMIT 1
            `,
            [doctorId]
        );

        if (found.rowCount === 0) {
            return res.status(404).json({ message: 'Doctor profile not found.' });
        }

        const doctor = found.rows[0];
        const isValidPassword = await bcrypt.compare(password, doctor.password_hash);
        const isGoogleOnlyAccount = String(doctor.auth_provider || '').trim().toLowerCase() === 'google';

        if (!isValidPassword && !isGoogleOnlyAccount) {
            return res.status(401).json({ message: 'Password is incorrect.' });
        }

        const nextPasswordHash = isValidPassword
            ? doctor.password_hash
            : await bcrypt.hash(password, 10);

        const updated = await pool.query(
            `
            UPDATE public.doctors
            SET name = $1,
                phone = $2,
                password_hash = $3,
                auth_provider = 'local'
            WHERE doctor_id = $4
            RETURNING doctor_id, name, email, phone, hospital_id, "Verification" AS verification
            `,
            [normalizedName, normalizedPhone, nextPasswordHash, doctorId]
        );

        return res.status(200).json({
            message: 'Doctor profile updated successfully.',
            profile: doctorProfilePayload(updated.rows[0])
        });
    } catch (error) {
        console.error('UPDATE_DOCTOR_PROFILE_ERROR:', error);
        return res.status(500).json({ message: 'Failed to update doctor profile.' });
    }
};

module.exports = {
    getSupabaseAuthConfig,
    createHospital,
    listHospitals,
    listPatients,
    listDoctors,
    adminSignup,
    adminLogin,
    getPendingDoctorRequests,
    getApprovedDoctors,
    updateDoctorVerificationStatus,
    getDoctorProfile,
    updateDoctorProfile,
    doctorSignup,
    patientSignup,
    doctorLogin,
    patientLogin,
    login,
    googleLogin,
    googleCompleteSignup
};

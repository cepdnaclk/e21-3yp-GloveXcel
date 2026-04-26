const bcrypt = require('bcryptjs');
const { getPool } = require('../config/supabaseDb');

const pool = getPool();

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

const doctorSignup = async (req, res) => {
    try {
        const { email, password, hospital_id, name } = req.body;
        const normalizedEmail = (email || '').trim().toLowerCase();
        const normalizedHospitalId = (hospital_id || '').trim();
        const normalizedName = (name || '').trim();

        if (!normalizedEmail || !password || !normalizedHospitalId || !normalizedName) {
            return res.status(400).json({
                message: 'Doctor signup requires email, password, hospital_id, and name.'
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
            INSERT INTO public.doctors (name, email, password_hash, hospital_id, "Verification")
            VALUES ($1, $2, $3, $4, $5)
            RETURNING doctor_id, name, email, hospital_id, "Verification" AS verification
            `,
            [normalizedName, normalizedEmail, password_hash, normalizedHospitalId, 'pending']
        );

        const doctor = inserted.rows[0];

        return res.status(201).json({
            message: 'Doctor account created successfully.',
            doctor: {
                doctor_id: doctor.doctor_id,
                name: doctor.name,
                email: doctor.email,
                hospital_id: doctor.hospital_id,
                verification: doctor.verification
            }
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
        const { email, password } = req.body;
        const normalizedEmail = (email || '').trim().toLowerCase();

        if (!normalizedEmail || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        const found = await pool.query(
            `
            SELECT doctor_id, name, email, password_hash, hospital_id, "Verification" AS verification
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

        return res.status(200).json({
            message: 'Doctor login successful.',
            doctor: {
                doctor_id: doctor.doctor_id,
                name: doctor.name,
                email: doctor.email,
                hospital_id: doctor.hospital_id,
                verification: doctor.verification
            }
        });
    } catch (error) {
        console.error('DOCTOR_LOGIN_ERROR:', error);
        return res.status(500).json({ message: 'Failed to login doctor.' });
    }
};

const adminLogin = async (req, res) => {
    try {
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

        return res.status(200).json({
            message: 'Admin login successful.',
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
            SELECT doctor_id, name, email, hospital_id, "Verification" AS verification
            FROM public.doctors
            WHERE LOWER(COALESCE("Verification", 'pending')) = 'pending'
            ORDER BY doctor_id DESC
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
            RETURNING doctor_id, name, email, hospital_id, "Verification" AS verification
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

        return res.status(200).json({
            message: 'Patient login successful.',
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

            return res.status(200).json({
                message: 'Admin login successful.',
                role: 'admin',
                profile: {
                    admin_id: admin.admin_id,
                    name: admin.name,
                    email: admin.email
                }
            });
        }

        if (normalizedRole === 'doctor') {
            const foundDoctor = await pool.query(
                `
                SELECT doctor_id, name, email, password_hash, hospital_id, "Verification" AS verification
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

            return res.status(200).json({
                message: 'Doctor login successful.',
                role: 'doctor',
                profile: {
                    doctor_id: doctor.doctor_id,
                    name: doctor.name,
                    email: doctor.email,
                    hospital_id: doctor.hospital_id,
                    verification: doctor.verification
                }
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

            return res.status(200).json({
                message: 'Patient login successful.',
                role: 'patient',
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

            return res.status(200).json({
                message: 'Admin login successful.',
                role: 'admin',
                profile: {
                    admin_id: admin.admin_id,
                    name: admin.name,
                    email: admin.email
                }
            });
        }

        const foundDoctor = await pool.query(
            `
            SELECT doctor_id, name, email, password_hash, hospital_id, "Verification" AS verification
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

            return res.status(200).json({
                message: 'Doctor login successful.',
                role: 'doctor',
                profile: {
                    doctor_id: doctor.doctor_id,
                    name: doctor.name,
                    email: doctor.email,
                    hospital_id: doctor.hospital_id,
                    verification: doctor.verification
                }
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

        return res.status(200).json({
            message: 'Patient login successful.',
            role: 'patient',
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

module.exports = {
    createHospital,
    listHospitals,
    adminSignup,
    adminLogin,
    getPendingDoctorRequests,
    updateDoctorVerificationStatus,
    doctorSignup,
    patientSignup,
    doctorLogin,
    patientLogin,
    login
};

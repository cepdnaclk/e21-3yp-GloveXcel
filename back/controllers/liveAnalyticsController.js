const LiveAnalytics = require('../models/LiveAnalytics');

const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function normalizeForceLevel(value) {
    if (value === undefined || value === null || value === '') {
        return 1;
    }

    const level = Number(value);
    return Number.isInteger(level) && level >= 1 && level <= 10 ? level : null;
}

function normalizeMaxAngles(maxAngles = {}) {
    const normalized = {};

    for (const finger of FINGER_KEYS) {
        const value = Number(maxAngles[finger]);
        if (!Number.isFinite(value)) {
            return null;
        }
        normalized[finger] = Number(value.toFixed(1));
    }

    return normalized;
}

function normalizeRepId(value) {
    const repId = String(value || '').trim();
    return repId || null;
}

function normalizeRepNumber(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const repNumber = Number(value);
    return Number.isInteger(repNumber) && repNumber >= 1 ? repNumber : null;
}

const saveLiveAnalytics = async (req, res) => {
    try {
        const { patient_id, doctor_id, exercise_id, rep_id, rep_number, force_level, max_angles } = req.body;

        if (!exercise_id) {
            return res.status(400).json({ error: 'exercise_id is required.' });
        }

        const effectivePatientId = req.user?.role === 'patient'
            ? req.user.sub
            : patient_id;

        if (!effectivePatientId || !doctor_id) {
            return res.status(400).json({ error: 'patient_id and doctor_id are required.' });
        }

        if (req.user && !['patient', 'doctor', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Only patients, doctors, or admins can save live analytics.' });
        }

        const normalizedForceLevel = normalizeForceLevel(force_level);
        if (normalizedForceLevel === null) {
            return res.status(400).json({ error: 'force_level must be an integer between 1 and 10.' });
        }

        const normalizedMaxAngles = normalizeMaxAngles(max_angles);
        if (!normalizedMaxAngles) {
            return res.status(400).json({ error: 'max_angles with all 5 finger values is required.' });
        }

        const normalizedRepId = normalizeRepId(rep_id);
        if (!normalizedRepId) {
            return res.status(400).json({ error: 'rep_id is required.' });
        }

        const normalizedRepNumber = normalizeRepNumber(rep_number);
        if (rep_number !== undefined && rep_number !== null && rep_number !== '' && normalizedRepNumber === null) {
            return res.status(400).json({ error: 'rep_number must be a positive integer.' });
        }

        const maxUpdate = {};
        for (const finger of FINGER_KEYS) {
            maxUpdate[`max_angles.${finger}`] = normalizedMaxAngles[finger];
        }

        const now = Date.now();
        const setUpdate = {
            patient_id: effectivePatientId,
            doctor_id,
            exercise_id,
            rep_id: normalizedRepId,
            force_level: normalizedForceLevel,
            updatedAt: now
        };
        if (normalizedRepNumber !== null) {
            setUpdate.rep_number = normalizedRepNumber;
        }

        const doc = await LiveAnalytics.findOneAndUpdate(
            { patient_id: effectivePatientId, exercise_id, rep_id: normalizedRepId },
            {
                $set: setUpdate,
                $max: maxUpdate,
                $setOnInsert: { createdAt: now }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
        );

        return res.status(200).json({ message: 'Live analytics saved.', analytics: doc });
    } catch (error) {
        console.error('Error saving live analytics:', error);
        return res.status(500).json({ error: 'Failed to save live analytics', details: error.message });
    }
};

const listLiveAnalytics = async (req, res) => {
    try {
        const requestedPatientId = String(req.query.patient_id || '').trim();
        const requestedDoctorId = String(req.query.doctor_id || '').trim();
        const requestedExerciseId = String(req.query.exercise_id || '').trim();

        const effectiveDoctorId = req.user?.role === 'doctor'
            ? req.user.sub
            : requestedDoctorId;
        const effectivePatientId = req.user?.role === 'patient'
            ? req.user.sub
            : requestedPatientId;

        if (req.user && !['doctor', 'admin', 'patient'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Only patients, doctors, or admins can view live analytics.' });
        }

        if (!effectivePatientId) {
            return res.status(400).json({ error: 'patient_id is required.' });
        }

        if (!effectiveDoctorId && req.user?.role !== 'patient') {
            return res.status(400).json({ error: 'doctor_id is required.' });
        }

        const query = { patient_id: effectivePatientId };
        if (effectiveDoctorId) query.doctor_id = effectiveDoctorId;
        if (requestedExerciseId) query.exercise_id = requestedExerciseId;

        const analytics = await LiveAnalytics.find(query)
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();

        return res.status(200).json({ analytics });
    } catch (error) {
        console.error('Error listing live analytics:', error);
        return res.status(500).json({ error: 'Failed to list live analytics', details: error.message });
    }
};

module.exports = { saveLiveAnalytics, listLiveAnalytics };

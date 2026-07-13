const LiveExercise = require('../models/LiveExercise');
const LiveAnalytics = require('../models/LiveAnalytics');

const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function normalizeFingerPayload(fingers = {}) {
    const normalized = {};
    const min_angles = {};
    const max_angles = {};
    const live_angles = {};
    const raw_values = {};

    for (const finger of FINGER_KEYS) {
        const source = fingers[finger] || {};
        const min = Number(source.min);
        const max = Number(source.max);
        const angle = Number(source.angle);
        const raw = Number(source.raw);

        if (![min, max, angle, raw].every(Number.isFinite)) {
            return null;
        }

        normalized[finger] = { min, max, angle };
        min_angles[finger] = min;
        max_angles[finger] = max;
        live_angles[finger] = angle;
        raw_values[finger] = raw;
    }

    return { fingers: normalized, min_angles, max_angles, live_angles, raw_values };
}

function normalizeForceLevel(value) {
    if (value === undefined || value === null || value === '') {
        return 1;
    }

    const level = Number(value);
    return Number.isInteger(level) && level >= 1 && level <= 10 ? level : null;
}

const createLiveExercise = async (req, res) => {
    try {
        const { exercise_id, exercise_name, description, doctor_id, patient_id, fingers, capturedAt, force_level } = req.body;

        if (!exercise_id) {
            return res.status(400).json({ error: 'exercise_id is required.' });
        }

        const normalizedForceLevel = normalizeForceLevel(force_level);
        if (normalizedForceLevel === null) {
            return res.status(400).json({ error: 'force_level must be an integer between 1 and 10.' });
        }

        const normalized = normalizeFingerPayload(fingers);
        if (!normalized) {
            return res.status(400).json({ error: 'fingers with min, max, and angle for all 5 fingers is required.' });
        }

        if (req.user && !['doctor', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Only doctors or admins can create live exercises.' });
        }

        const effectiveDoctorId = req.user?.role === 'doctor'
            ? req.user.sub
            : doctor_id;

        if (!patient_id || !effectiveDoctorId) {
            return res.status(400).json({ error: 'patient_id and doctor_id are required.' });
        }

        const requestedSavedAt = capturedAt ? new Date(capturedAt) : new Date();
        const savedAt = Number.isNaN(requestedSavedAt.getTime()) ? new Date() : requestedSavedAt;
        const fallbackName = `Live Exercise - ${savedAt.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        })}`;
        const displayName = exercise_name || description || fallbackName;

        const doc = await LiveExercise.findOneAndUpdate(
            { exercise_id },
            {
                $set: {
                    exercise_id,
                    exercise_name: displayName,
                    description: description || exercise_name || displayName,
                    doctor_id: effectiveDoctorId,
                    patient_id,
                    force_level: normalizedForceLevel,
                    ...normalized,
                    capturedAt: savedAt,
                    updatedAt: Date.now()
                },
                $setOnInsert: { createdAt: Date.now() }
            },
            { new: true, upsert: true, runValidators: true }
        );

        return res.status(201).json({ message: 'Live exercise saved successfully', exercise: doc });
    } catch (error) {
        console.error('Error saving live exercise:', error);
        return res.status(500).json({ error: 'Failed to save live exercise', details: error.message });
    }
};

const listLiveExercises = async (req, res) => {
    try {
        const query = {};
        if (req.query.doctor_id) query.doctor_id = req.query.doctor_id;
        const effectivePatientId = req.user?.role === 'patient'
            ? req.user.sub
            : req.query.patient_id;
        if (effectivePatientId) query.patient_id = effectivePatientId;

        const exercises = await LiveExercise.find(query).sort({ createdAt: -1 }).limit(50).lean();
        return res.status(200).json({ exercises });
    } catch (error) {
        console.error('Error listing live exercises:', error);
        return res.status(500).json({ error: 'Failed to list live exercises', details: error.message });
    }
};

const getLiveExercise = async (req, res) => {
    try {
        const { exercise_id } = req.params;

        if (!exercise_id) {
            return res.status(400).json({ error: 'exercise_id is required.' });
        }

        const query = { exercise_id };
        if (req.user?.role === 'patient') {
            query.patient_id = req.user.sub;
        } else if (req.query.patient_id) {
            query.patient_id = req.query.patient_id;
        }

        const exercise = await LiveExercise.findOne(query).lean();
        if (!exercise) {
            return res.status(404).json({ error: 'Live exercise not found.' });
        }

        return res.status(200).json({ exercise });
    } catch (error) {
        console.error('Error fetching live exercise:', error);
        return res.status(500).json({ error: 'Failed to fetch live exercise', details: error.message });
    }
};

const deleteLiveExercise = async (req, res) => {
    try {
        const { exercise_id } = req.params;

        if (!exercise_id) {
            return res.status(400).json({ error: 'exercise_id is required.' });
        }

        const deleted = await LiveExercise.findOneAndDelete({ exercise_id });
        if (!deleted) {
            return res.status(404).json({ error: 'Live exercise not found.' });
        }

        const analyticsQuery = { exercise_id };
        if (deleted.patient_id) analyticsQuery.patient_id = deleted.patient_id;
        if (deleted.doctor_id) analyticsQuery.doctor_id = deleted.doctor_id;
        const analyticsDeleteResult = await LiveAnalytics.deleteMany(analyticsQuery);

        return res.status(200).json({
            message: 'Live exercise deleted successfully',
            exercise_id,
            deleted_analytics_count: analyticsDeleteResult.deletedCount || 0
        });
    } catch (error) {
        console.error('Error deleting live exercise:', error);
        return res.status(500).json({ error: 'Failed to delete live exercise', details: error.message });
    }
};

module.exports = { createLiveExercise, listLiveExercises, getLiveExercise, deleteLiveExercise };

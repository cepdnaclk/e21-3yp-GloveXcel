const LiveExercise = require('../models/LiveExercise');

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

const createLiveExercise = async (req, res) => {
    try {
        const { exercise_id, doctor_id, patient_id, fingers, capturedAt } = req.body;
        const forceLevel = req.body.force_level === undefined || req.body.force_level === null || req.body.force_level === ''
            ? 1
            : Number(req.body.force_level);

        if (!exercise_id) {
            return res.status(400).json({ error: 'exercise_id is required.' });
        }

        if (!Number.isInteger(forceLevel) || forceLevel < 1 || forceLevel > 10) {
            return res.status(400).json({ error: 'force_level must be an integer between 1 and 10.' });
        }

        const normalized = normalizeFingerPayload(fingers);
        if (!normalized) {
            return res.status(400).json({ error: 'fingers with min, max, and angle for all 5 fingers is required.' });
        }

        const doc = await LiveExercise.findOneAndUpdate(
            { exercise_id },
            {
                $set: {
                    exercise_id,
                    doctor_id: doctor_id || null,
                    patient_id: patient_id || null,
                    force_level: forceLevel,
                    ...normalized,
                    capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
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
        if (req.query.exercise_id) query.exercise_id = req.query.exercise_id;
        if (req.query.doctor_id) query.doctor_id = req.query.doctor_id;
        if (req.query.patient_id) query.patient_id = req.query.patient_id;

        const exercises = await LiveExercise.find(query).sort({ createdAt: -1 }).limit(50).lean();
        return res.status(200).json({ exercises });
    } catch (error) {
        console.error('Error listing live exercises:', error);
        return res.status(500).json({ error: 'Failed to list live exercises', details: error.message });
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

        return res.status(200).json({ message: 'Live exercise deleted successfully', exercise_id });
    } catch (error) {
        console.error('Error deleting live exercise:', error);
        return res.status(500).json({ error: 'Failed to delete live exercise', details: error.message });
    }
};

module.exports = { createLiveExercise, listLiveExercises, deleteLiveExercise };

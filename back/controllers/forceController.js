const Force = require('../models/Force');

// Default patient context for force control.
const DEFAULT_PATIENT_ID = 'PAT-a7a19957fb68446f8314d672bfccfa8b';

const setForceLevel = async (req, res) => {
    try {
        const { level, patient_id, exercise_id } = req.body;
        const targetPatientId = patient_id || DEFAULT_PATIENT_ID;

        if (!Number.isInteger(level) || level < 1 || level > 10) {
            return res.status(400).json({ error: 'Level must be an integer between 1 and 10.' });
        }

        const doc = await Force.findOneAndUpdate(
            { patient_id: targetPatientId },
            { $set: { patient_id: targetPatientId, level, exercise_id, updatedAt: Date.now() } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({ message: 'Force level saved.', data: doc });
    } catch (error) {
        console.error('Failed to save force level:', error);
        res.status(500).json({ error: 'Failed to save force level.' });
    }
};

const getForceLevel = async (req, res) => {
    try {
        const patientId = req.query.patient_id || req.body.patient_id || DEFAULT_PATIENT_ID;
        const doc = await Force.findOne({ patient_id: patientId });

        if (!doc) {
            return res.status(404).json({ message: 'Force level not set yet.' });
        }

        res.status(200).json(doc);
    } catch (error) {
        console.error('Failed to fetch force level:', error);
        res.status(500).json({ error: 'Failed to fetch force level.' });
    }
};

module.exports = {
    setForceLevel,
    getForceLevel
};
const Force = require('../models/Force');

// Current patient context for force control.
const PATIENT_ID = 'P001';

const setForceLevel = async (req, res) => {
    try {
        const { level } = req.body;

        if (!Number.isInteger(level) || level < 1 || level > 10) {
            return res.status(400).json({ error: 'Level must be an integer between 1 and 10.' });
        }

        const doc = await Force.findOneAndUpdate(
            { patient_id: PATIENT_ID },
            { $set: { patient_id: PATIENT_ID, level, updatedAt: Date.now() } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({ message: 'Force level saved.', data: doc });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save force level.' });
    }
};

const getForceLevel = async (req, res) => {
    try {
        const doc = await Force.findOne({ patient_id: PATIENT_ID });

        if (!doc) {
            return res.status(404).json({ message: 'Force level not set yet.' });
        }

        res.status(200).json(doc);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch force level.' });
    }
};

module.exports = {
    setForceLevel,
    getForceLevel
};
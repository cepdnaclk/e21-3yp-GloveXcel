const DoctorCalibration = require('../models/DoctorCalibration');

// Helper to build update query
const buildUpdateQuery = (body, fingerData) => {
    return { $set: { ...fingerData, updatedAt: Date.now() } };
};

// --- 1. Update Doctor MAX - Thumb ---
const updateDoctorMaxThumb = async (req, res) => {
    try {
        const { doctor_id } = req.params;
        const update = buildUpdateQuery(req.body, { "max.thumb": req.body.thumb });
        const doc = await DoctorCalibration.findOneAndUpdate({ doctor_id }, update, { returnDocument: 'after', upsert: true });
        res.status(200).json(doc);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update doctor max thumb' });
    }
};

// --- 2. Update Doctor MAX - Fingers ---
const updateDoctorMaxFingers = async (req, res) => {
    try {
        const { doctor_id } = req.params;
        const update = buildUpdateQuery(req.body, { 
            "max.index": req.body.index, "max.middle": req.body.middle, "max.ring": req.body.ring, "max.pinky": req.body.pinky 
        });
        const doc = await DoctorCalibration.findOneAndUpdate({ doctor_id }, update, { returnDocument: 'after', upsert: true });
        res.status(200).json(doc);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update doctor max fingers' });
    }
};

// --- 3. Update Doctor MIN - Thumb ---
const updateDoctorMinThumb = async (req, res) => {
    try {
        const { doctor_id } = req.params;
        const update = buildUpdateQuery(req.body, { "min.thumb": req.body.thumb });
        const doc = await DoctorCalibration.findOneAndUpdate({ doctor_id }, update, { returnDocument: 'after', upsert: true });
        res.status(200).json(doc);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update doctor min thumb' });
    }
};

// --- 4. Update Doctor MIN - Fingers ---
const updateDoctorMinFingers = async (req, res) => {
    try {
        const { doctor_id } = req.params;
        const update = buildUpdateQuery(req.body, { 
            "min.index": req.body.index, "min.middle": req.body.middle, "min.ring": req.body.ring, "min.pinky": req.body.pinky 
        });
        const doc = await DoctorCalibration.findOneAndUpdate({ doctor_id }, update, { returnDocument: 'after', upsert: true });
        res.status(200).json(doc);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update doctor min fingers' });
    }
};

// --- 5. Retrieve FULL Doctor Data ---
const getDoctorCalibration = async (req, res) => {
    try {
        const { doctor_id } = req.params;
        const doc = await DoctorCalibration.findOne({ doctor_id });
        if (!doc) return res.status(404).json({ message: 'Doctor profile not found' });
        res.status(200).json(doc);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch doctor data' });
    }
};

module.exports = { 
    updateDoctorMaxThumb, updateDoctorMaxFingers, 
    updateDoctorMinThumb, updateDoctorMinFingers, 
    getDoctorCalibration 
};
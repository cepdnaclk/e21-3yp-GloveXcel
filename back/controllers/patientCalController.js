const PatientCalibration = require('../models/PatientCalibration');

// Helper function to build the update object dynamically
const buildUpdateQuery = (body, fingerData) => {
    const updateQuery = { ...fingerData, updatedAt: Date.now() };
    if (body.level !== undefined) {
        updateQuery.level = body.level; // Only update level if hardware sends it
    }
    return { $set: updateQuery };
};

// --- 1. Update MAX - Thumb ---
const updatePatientMaxThumb = async (req, res) => {
    try {
        const { patient_id } = req.params;
        const updateQuery = buildUpdateQuery(req.body, { "max.thumb": req.body.thumb });

        const updatedDoc = await PatientCalibration.findOneAndUpdate(
            { patient_id: patient_id }, 
            updateQuery, 
            { returnDocument: 'after', upsert: true } 
        );
        res.status(200).json({ message: 'Patient max thumb updated', data: updatedDoc });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update patient max thumb' });
    }
};

// --- 2. Update MAX - Fingers ---
const updatePatientMaxFingers = async (req, res) => {
    try {
        const { patient_id } = req.params;
        const updateQuery = buildUpdateQuery(req.body, { 
            "max.index": req.body.index,
            "max.middle": req.body.middle,
            "max.ring": req.body.ring,
            "max.pinky": req.body.pinky
        });

        const updatedDoc = await PatientCalibration.findOneAndUpdate(
            { patient_id: patient_id }, 
            updateQuery, 
            { returnDocument: 'after', upsert: true } 
        );
        res.status(200).json({ message: 'Patient max fingers updated', data: updatedDoc });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update patient max fingers' });
    }
};

// --- 3. Update MIN - Thumb ---
const updatePatientMinThumb = async (req, res) => {
    try {
        const { patient_id } = req.params;
        const updateQuery = buildUpdateQuery(req.body, { "min.thumb": req.body.thumb });

        const updatedDoc = await PatientCalibration.findOneAndUpdate(
            { patient_id: patient_id }, 
            updateQuery, 
            { returnDocument: 'after', upsert: true } 
        );
        res.status(200).json({ message: 'Patient min thumb updated', data: updatedDoc });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update patient min thumb' });
    }
};

// --- 4. Update MIN - Fingers ---
const updatePatientMinFingers = async (req, res) => {
    try {
        const { patient_id } = req.params;
        const updateQuery = buildUpdateQuery(req.body, { 
            "min.index": req.body.index,
            "min.middle": req.body.middle,
            "min.ring": req.body.ring,
            "min.pinky": req.body.pinky
        });

        const updatedDoc = await PatientCalibration.findOneAndUpdate(
            { patient_id: patient_id }, 
            updateQuery, 
            { returnDocument: 'after', upsert: true } 
        );
        res.status(200).json({ message: 'Patient min fingers updated', data: updatedDoc });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update patient min fingers' });
    }
};

// --- 5. Retrieve FULL Patient Calibration Data ---
const getPatientCalibration = async (req, res) => {
    try {
        const { patient_id } = req.params;
        const doc = await PatientCalibration.findOne({ patient_id: patient_id });
        if (!doc) {
            return res.status(404).json({ message: 'No calibration data exists for this patient' });
        }
        res.status(200).json(doc);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch patient calibration' });
    }
};

module.exports = { 
    updatePatientMaxThumb, 
    updatePatientMaxFingers, 
    updatePatientMinThumb, 
    updatePatientMinFingers, 
    getPatientCalibration 
};
const GloveData = require('../models/GloveData'); // Import the model

// --- Save Hardware Data ---
const saveGloveData = async (req, res) => {
    try {
        const newData = new GloveData(req.body);
        const savedData = await newData.save(); 
        res.status(201).json({ message: 'Saved successfully', data: savedData });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save data' });
    }
};

// --- Retrieve Patient Data ---
const getPatientData = async (req, res) => {
    try {
        const { patient_id } = req.params;
        const data = await GloveData.find({ patient_id: patient_id })
                                    .sort({ timestamp: -1 }) // Newest first
                                    .limit(50);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data' });
    }
};

module.exports = { saveGloveData, getPatientData };
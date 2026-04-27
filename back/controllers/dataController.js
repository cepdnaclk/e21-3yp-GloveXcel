const GloveData = require('../models/GloveData'); 

// --- Save Hardware Data ---
const saveGloveData = async (req, res) => {
    try {
        // 1. HARDWARE OPTIMIZATION: Check if the ESP32/Frontend sent an array of readings
        if (Array.isArray(req.body)) {
            // insertMany is highly optimized in MongoDB for bulk saves
            const savedData = await GloveData.insertMany(req.body);
            return res.status(201).json({ 
                message: 'Bulk hardware data saved successfully', 
                count: savedData.length 
            });
        }

        // 2. Fallback: If it's just a single JSON object reading
        const newData = new GloveData(req.body);
        const savedData = await newData.save(); 
        
        res.status(201).json({ message: 'Single reading saved successfully', data: savedData });
    } catch (error) {
        console.error('Error saving glove data:', error);
        res.status(500).json({ error: 'Failed to save hardware data', details: error.message });
    }
};

// --- Retrieve Patient Data ---
const getPatientData = async (req, res) => {
    try {
        const { patient_id } = req.params;
        
        // 1. Allow frontend to pass an exercise_id in the URL (e.g., ?exercise_id=ex_123)
        const { exercise_id } = req.query; 

        // Build the query
        let query = { patient_id: patient_id };
        if (exercise_id) {
            query.exercise_id = exercise_id;
        }

        // 2. Increase limit to 1000. 50 readings is only a few seconds of glove movement.
        const data = await GloveData.find(query)
                                    .sort({ timestamp: -1 }) // Newest first
                                    .limit(1000); 

        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching patient data:', error);
        res.status(500).json({ error: 'Failed to fetch patient data', details: error.message });
    }
};

module.exports = { saveGloveData, getPatientData };
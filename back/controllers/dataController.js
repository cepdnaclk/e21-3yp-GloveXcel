const GloveData = require('../models/GloveData'); // Import the model

// --- Save Hardware Data ---
// Handles incoming glove sensor data and stores it in the database
const saveGloveData = async (req, res) => {
    try {
        // Create a new glove data record using the request body
        const newData = new GloveData(req.body);

        // Save the new record to the database
        const savedData = await newData.save(); 

        // Return success response with the saved data
        res.status(201).json({ message: 'Saved successfully', data: savedData });
    } catch (error) {
        // Return error response if saving fails
        res.status(500).json({ error: 'Failed to save data' });
    }
};

// --- Retrieve Patient Data ---
// Fetches saved glove data records for a specific patient
const getPatientData = async (req, res) => {
    try {
        // Get the patient ID from the request parameters
        const { patient_id } = req.params;

        // Find the latest 50 records for this patient
        const data = await GloveData.find({ patient_id: patient_id })
                                    .sort({ timestamp: -1 }) // Newest first
                                    .limit(50);

        // Return the patient data as JSON
        res.status(200).json(data);
    } catch (error) {
        // Return error response if fetching fails
        res.status(500).json({ error: 'Failed to fetch data' });
    }
};

// Export the functions so they can be used in routes
module.exports = { saveGloveData, getPatientData };
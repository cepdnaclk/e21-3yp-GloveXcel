const DoctorCalibration = require('../models/DoctorCalibration');

// Helper function used to prepare the update object for MongoDB
const buildUpdateQuery = (body, fingerData) => {
    // Updates only the provided finger values and refreshes the updatedAt time
    return { $set: { ...fingerData, updatedAt: Date.now() } };
};

// --- 1. Update Doctor MAX - Thumb ---
// Updates the doctor's maximum calibration value for the thumb
const updateDoctorMaxThumb = async (req, res) => {
    try {
        // Get doctor ID from the URL parameters
        const { doctor_id } = req.params;

        // Build update query for max thumb value
        const update = buildUpdateQuery(req.body, { "max.thumb": req.body.thumb });

        // Update existing doctor calibration or create one if it does not exist
        const doc = await DoctorCalibration.findOneAndUpdate({ doctor_id }, update, { returnDocument: 'after', upsert: true });

        // Return the updated doctor calibration data
        res.status(200).json(doc);
    } catch (error) {
        // Return error if the update fails
        res.status(500).json({ error: 'Failed to update doctor max thumb' });
    }
};

// --- 2. Update Doctor MAX - Fingers ---
// Updates the doctor's maximum calibration values for the fingers except thumb
const updateDoctorMaxFingers = async (req, res) => {
    try {
        // Get doctor ID from the URL parameters
        const { doctor_id } = req.params;

        // Build update query for max index, middle, ring, and pinky values
        const update = buildUpdateQuery(req.body, { 
            "max.index": req.body.index, "max.middle": req.body.middle, "max.ring": req.body.ring, "max.pinky": req.body.pinky 
        });

        // Update existing doctor calibration or create one if it does not exist
        const doc = await DoctorCalibration.findOneAndUpdate({ doctor_id }, update, { returnDocument: 'after', upsert: true });

        // Return the updated doctor calibration data
        res.status(200).json(doc);
    } catch (error) {
        // Return error if the update fails
        res.status(500).json({ error: 'Failed to update doctor max fingers' });
    }
};

// --- 3. Update Doctor MIN - Thumb ---
// Updates the doctor's minimum calibration value for the thumb
const updateDoctorMinThumb = async (req, res) => {
    try {
        // Get doctor ID from the URL parameters
        const { doctor_id } = req.params;

        // Build update query for min thumb value
        const update = buildUpdateQuery(req.body, { "min.thumb": req.body.thumb });

        // Update existing doctor calibration or create one if it does not exist
        const doc = await DoctorCalibration.findOneAndUpdate({ doctor_id }, update, { returnDocument: 'after', upsert: true });

        // Return the updated doctor calibration data
        res.status(200).json(doc);
    } catch (error) {
        // Return error if the update fails
        res.status(500).json({ error: 'Failed to update doctor min thumb' });
    }
};

// --- 4. Update Doctor MIN - Fingers ---
// Updates the doctor's minimum calibration values for the fingers except thumb
const updateDoctorMinFingers = async (req, res) => {
    try {
        // Get doctor ID from the URL parameters
        const { doctor_id } = req.params;

        // Build update query for min index, middle, ring, and pinky values
        const update = buildUpdateQuery(req.body, { 
            "min.index": req.body.index, "min.middle": req.body.middle, "min.ring": req.body.ring, "min.pinky": req.body.pinky 
        });

        // Update existing doctor calibration or create one if it does not exist
        const doc = await DoctorCalibration.findOneAndUpdate({ doctor_id }, update, { returnDocument: 'after', upsert: true });

        // Return the updated doctor calibration data
        res.status(200).json(doc);
    } catch (error) {
        // Return error if the update fails
        res.status(500).json({ error: 'Failed to update doctor min fingers' });
    }
};

// --- 5. Retrieve FULL Doctor Data ---
// Retrieves the full calibration profile for a specific doctor
const getDoctorCalibration = async (req, res) => {
    try {
        // Get doctor ID from the URL parameters
        const { doctor_id } = req.params;

        // Search for the doctor's calibration profile
        const doc = await DoctorCalibration.findOne({ doctor_id });

        // Return 404 if no doctor profile is found
        if (!doc) return res.status(404).json({ message: 'Doctor profile not found' });

        // Return the full doctor calibration data
        res.status(200).json(doc);
    } catch (error) {
        // Return error if fetching data fails
        res.status(500).json({ error: 'Failed to fetch doctor data' });
    }
};

// Export all controller functions for use in the route file
module.exports = { 
    updateDoctorMaxThumb, updateDoctorMaxFingers, 
    updateDoctorMinThumb, updateDoctorMinFingers, 
    getDoctorCalibration 
};
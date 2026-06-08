const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    // Links to the SQL session summary
    exercise_id: { type: String, required: true }, 
    patient_id: { type: String, required: true },
    
    // Tracking the exercise progress
    set_num: { type: Number, required: true },     // e.g., Set 1, 2, or 3
    force_level: { type: Number, required: true }, // The motor resistance level (e.g., 0-10)

    // Finger flexion data
    thumb: { type: Number, required: true },
    index: { type: Number, required: true },
    middle: { type: Number, required: true },
    ring: { type: Number, required: true },
    pinky: { type: Number, required: true },
    
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GloveData', sessionSchema);
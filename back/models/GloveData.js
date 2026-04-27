// models/GloveData.js
const mongoose = require('mongoose');

const gloveDataSchema = new mongoose.Schema({
    // Using String to match your ObjectId/String output from the database
    exercise_id: { type: String, required: true }, 
    patient_id: { type: String, required: true },
    set_num: { type: String, required: true },     
    
    // Finger flexion data (Int32)
    thumb: { type: Number, required: true },
    index: { type: Number, required: true },
    middle: { type: Number, required: true },
    ring: { type: Number, required: true },
    pinky: { type: Number, required: true },
    
    // Resistance mechanism state
    force_level: { type: Number, required: true }, 
    
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GloveData', gloveDataSchema);
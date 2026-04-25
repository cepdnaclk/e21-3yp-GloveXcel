const mongoose = require('mongoose');

const fingerStructure = {
    thumb: { type: Number, default: 0 },
    index: { type: Number, default: 0 },
    middle: { type: Number, default: 0 },
    ring: { type: Number, default: 0 },
    pinky: { type: Number, default: 0 }
};

const patientCalSchema = new mongoose.Schema({
    patient_id: { type: String, required: true, unique: true }, // Ensures 1 doc per patient
    level: { type: Number, default: 1 }, // The new integer field!
    max: fingerStructure,
    min: fingerStructure,
    updatedAt: { type: Date, default: Date.now }
}, { 
    collection: 'pat_cal' // Forces the exact collection name you requested
});

module.exports = mongoose.model('PatientCalibration', patientCalSchema);
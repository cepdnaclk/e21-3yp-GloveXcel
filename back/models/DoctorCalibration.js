const mongoose = require('mongoose');

const fingerStructure = {
    thumb: { type: Number, default: 0 },
    index: { type: Number, default: 0 },
    middle: { type: Number, default: 0 },
    ring: { type: Number, default: 0 },
    pinky: { type: Number, default: 0 }
};

const doctorCalSchema = new mongoose.Schema({
    doctor_id: { type: String, required: true, unique: true }, 
    doctor_name: { type: String }, // Optional field for doctor's name
    special_notes: { type: String }, // To store specific therapy notes
    max: fingerStructure,
    min: fingerStructure,
    updatedAt: { type: Date, default: Date.now }
}, { 
    collection: 'doc_cal' // Forces the collection name you want
});

module.exports = mongoose.model('DoctorCalibration', doctorCalSchema);
const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema({
    patient_id: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 0 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    primary_hospital_id: { type: String, required: true, trim: true },
    created_at: { type: Date, default: Date.now }
}, {
    collection: 'patients'
});

module.exports = mongoose.model('Patient', patientSchema);

const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
    doctor_id: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    hospital_id: { type: String, required: true, trim: true },
    created_at: { type: Date, default: Date.now }
}, {
    collection: 'doctors'
});

module.exports = mongoose.model('Doctor', doctorSchema);

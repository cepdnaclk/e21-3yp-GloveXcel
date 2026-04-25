const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    patient_id: { type: String, required: true },
    thumb: { type: Number, required: true },
    index: { type: Number, required: true },
    middle: { type: Number, required: true },
    ring: { type: Number, required: true },
    pinky: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GloveData', sessionSchema);
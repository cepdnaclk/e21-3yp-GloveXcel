const mongoose = require('mongoose');

const forceSchema = new mongoose.Schema({
    patient_id: { type: String, required: true, unique: true },
    level: { type: Number, required: true, min: 1, max: 10 },
    updatedAt: { type: Date, default: Date.now }
}, {
    collection: 'forces'
});

module.exports = mongoose.model('Force', forceSchema);
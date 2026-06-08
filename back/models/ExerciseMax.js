const mongoose = require('mongoose');

const fingerStructure = {
    thumb: { type: Number, required: true },
    index: { type: Number, required: true },
    middle: { type: Number, required: true },
    ring: { type: Number, required: true },
    pinky: { type: Number, required: true }
};

const exerciseMaxSchema = new mongoose.Schema({
    exercise_id: { type: String, required: true, unique: true },
    doctor_id: { type: String, required: true },
    patient_id: { type: String, required: true },
    max_angles: fingerStructure,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    collection: 'exercise_max'
});

module.exports = mongoose.model('ExerciseMax', exerciseMaxSchema);

const mongoose = require('mongoose');

const fingerCaptureSchema = new mongoose.Schema({
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    angle: { type: Number, required: true }
}, { _id: false });

const liveExerciseSchema = new mongoose.Schema({
    exercise_id: { type: String, required: true, unique: true },
    doctor_id: { type: String, default: null },
    fingers: {
        thumb: { type: fingerCaptureSchema, required: true },
        index: { type: fingerCaptureSchema, required: true },
        middle: { type: fingerCaptureSchema, required: true },
        ring: { type: fingerCaptureSchema, required: true },
        pinky: { type: fingerCaptureSchema, required: true }
    },
    min_angles: {
        thumb: { type: Number, required: true },
        index: { type: Number, required: true },
        middle: { type: Number, required: true },
        ring: { type: Number, required: true },
        pinky: { type: Number, required: true }
    },
    max_angles: {
        thumb: { type: Number, required: true },
        index: { type: Number, required: true },
        middle: { type: Number, required: true },
        ring: { type: Number, required: true },
        pinky: { type: Number, required: true }
    },
    live_angles: {
        thumb: { type: Number, required: true },
        index: { type: Number, required: true },
        middle: { type: Number, required: true },
        ring: { type: Number, required: true },
        pinky: { type: Number, required: true }
    },
    raw_values: {
        thumb: { type: Number, required: true },
        index: { type: Number, required: true },
        middle: { type: Number, required: true },
        ring: { type: Number, required: true },
        pinky: { type: Number, required: true }
    },
    capturedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    collection: 'live_exercises'
});

module.exports = mongoose.model('LiveExercise', liveExerciseSchema);

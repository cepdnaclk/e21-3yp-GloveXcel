const mongoose = require('mongoose');

const fingerAngleSchema = {
    thumb: { type: Number, required: true, default: 0 },
    index: { type: Number, required: true, default: 0 },
    middle: { type: Number, required: true, default: 0 },
    ring: { type: Number, required: true, default: 0 },
    pinky: { type: Number, required: true, default: 0 }
};

const liveAnalyticsSchema = new mongoose.Schema({
    patient_id: { type: String, required: true },
    doctor_id: { type: String, required: true },
    exercise_id: { type: String, required: true },
    force_level: { type: Number, required: true, default: 1, min: 1, max: 10 },
    max_angles: fingerAngleSchema,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    collection: 'live_analytics'
});

liveAnalyticsSchema.index({ patient_id: 1, exercise_id: 1 }, { unique: true });

module.exports = mongoose.model('LiveAnalytics', liveAnalyticsSchema);

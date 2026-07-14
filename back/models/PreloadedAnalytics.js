const mongoose = require('mongoose');

const fingerAngleSchema = {
    thumb: { type: Number, required: true, default: 0 },
    index: { type: Number, required: true, default: 0 },
    middle: { type: Number, required: true, default: 0 },
    ring: { type: Number, required: true, default: 0 },
    pinky: { type: Number, required: true, default: 0 }
};

const preloadedAnalyticsSchema = new mongoose.Schema({
    patient_id: { type: String, required: true },
    doctor_id: { type: String, required: true },
    exercise_id: { type: String, required: true },
    rep_id: { type: String, required: true, default: 'summary' },
    rep_number: { type: Number, min: 1 },
    force_level: { type: Number, required: true, default: 1, min: 1, max: 10 },
    max_angles: fingerAngleSchema,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    collection: 'preloaded_analytics'
});

preloadedAnalyticsSchema.index({ patient_id: 1, exercise_id: 1, rep_id: 1 }, { unique: true });
preloadedAnalyticsSchema.index({ patient_id: 1, doctor_id: 1, exercise_id: 1, updatedAt: -1 });

module.exports = mongoose.model('PreloadedAnalytics', preloadedAnalyticsSchema);

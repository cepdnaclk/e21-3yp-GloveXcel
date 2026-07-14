const LiveAnalytics = require('../models/LiveAnalytics');
const PreloadedAnalytics = require('../models/PreloadedAnalytics');

function isLegacyExerciseUniqueIndex(index) {
  const keys = Object.keys(index.key || {});
  return index.unique === true
    && keys.length === 2
    && keys[0] === 'patient_id'
    && keys[1] === 'exercise_id'
    && index.key.patient_id === 1
    && index.key.exercise_id === 1;
}

async function updateAnalyticsIndexesForModel(model) {
  try {
    const indexes = await model.collection.indexes();
    const legacyIndexes = indexes.filter(isLegacyExerciseUniqueIndex);

    for (const index of legacyIndexes) {
      await model.collection.dropIndex(index.name);
      console.log(`Dropped legacy analytics index ${model.collection.name}.${index.name}`);
    }
  } catch (error) {
    if (error?.codeName !== 'NamespaceNotFound') {
      console.warn(`Could not inspect analytics indexes for ${model.collection.name}:`, error.message);
    }
  }

  await model.createIndexes();
}

async function ensureAnalyticsIndexes() {
  await Promise.all([
    updateAnalyticsIndexesForModel(LiveAnalytics),
    updateAnalyticsIndexesForModel(PreloadedAnalytics)
  ]);
}

module.exports = { ensureAnalyticsIndexes };

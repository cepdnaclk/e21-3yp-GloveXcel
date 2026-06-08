const ExerciseMax = require('../models/ExerciseMax');

const getExerciseMax = async (req, res) => {
    try {
        const { exercise_id } = req.params;
        const doc = await ExerciseMax.findOne({ exercise_id });
        if (!doc) {
            return res.status(404).json({ message: 'No max angles found for this exercise.' });
        }
        return res.status(200).json(doc);
    } catch (error) {
        console.error('Error fetching exercise max:', error);
        return res.status(500).json({ error: 'Failed to fetch exercise max' });
    }
};

module.exports = { getExerciseMax };

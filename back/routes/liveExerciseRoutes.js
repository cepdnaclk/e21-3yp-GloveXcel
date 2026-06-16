const express = require('express');
const router = express.Router();
const { createLiveExercise, listLiveExercises, deleteLiveExercise } = require('../controllers/liveExerciseController');

router.post('/', createLiveExercise);
router.get('/', listLiveExercises);
router.delete('/:exercise_id', deleteLiveExercise);

module.exports = router;

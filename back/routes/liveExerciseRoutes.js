const express = require('express');
const router = express.Router();
const { optionallyAuthenticateToken } = require('../middleware/authMiddleware');
const { createLiveExercise, listLiveExercises, deleteLiveExercise } = require('../controllers/liveExerciseController');

router.post('/', optionallyAuthenticateToken, createLiveExercise);
router.get('/', optionallyAuthenticateToken, listLiveExercises);
router.delete('/:exercise_id', optionallyAuthenticateToken, deleteLiveExercise);

module.exports = router;

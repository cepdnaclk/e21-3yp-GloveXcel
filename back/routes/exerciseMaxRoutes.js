const express = require('express');
const router = express.Router();
const { getExerciseMax } = require('../controllers/exerciseMaxController');

// GET http://localhost:3000/api/exercise-max/:exercise_id
router.get('/:exercise_id', getExerciseMax);

module.exports = router;

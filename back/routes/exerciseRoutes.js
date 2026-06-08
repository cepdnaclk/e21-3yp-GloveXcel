const express = require('express');
const router = express.Router();
const { createExercise, listExercises } = require('../controllers/exerciseController');

// POST http://localhost:3000/api/exercises
router.post('/', createExercise);
// GET http://localhost:3000/api/exercises?patient_id=...
router.get('/', listExercises);

module.exports = router;
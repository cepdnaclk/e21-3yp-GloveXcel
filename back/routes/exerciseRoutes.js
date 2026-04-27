const express = require('express');
const router = express.Router();
const { createExercise } = require('../controllers/exerciseController');

// POST http://localhost:3000/api/exercises
router.post('/', createExercise);

module.exports = router;
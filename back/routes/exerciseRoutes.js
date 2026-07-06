const express = require('express');
const router = express.Router();
const { optionallyAuthenticateToken } = require('../middleware/authMiddleware');
const { createExercise, listExercises } = require('../controllers/exerciseController');

// POST http://localhost:3000/api/exercises
router.post('/', optionallyAuthenticateToken, createExercise);
// GET http://localhost:3000/api/exercises?patient_id=...
router.get('/', optionallyAuthenticateToken, listExercises);

module.exports = router;

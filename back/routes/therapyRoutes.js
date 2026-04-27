const express = require('express');
const router = express.Router();
// Make sure this path points to your actual controller!
const { createTherapyPlan } = require('../controllers/therapyPlanController');

// It MUST be just '/' here, because server.js adds the '/api/therapy-plans' part
router.post('/', createTherapyPlan);

module.exports = router;
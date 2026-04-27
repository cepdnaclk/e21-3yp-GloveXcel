const express = require('express');
const router = express.Router();
const { getPatientSessions } = require('../controllers/therapySessionController');

// GET http://localhost:3000/api/therapy-sessions/patient/:patient_id
router.get('/patient/:patient_id', getPatientSessions);


module.exports = router;
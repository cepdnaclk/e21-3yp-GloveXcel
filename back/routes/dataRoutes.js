const express = require('express');
const router = express.Router();
const { saveGloveData, getPatientData } = require('../controllers/dataController');

// Define the routes (the '/api/data' prefix will be handled in server.js)
router.post('/', saveGloveData);
router.get('/:patient_id', getPatientData);

module.exports = router;
const express = require('express');
const router = express.Router();
const { 
    updatePatientMaxThumb, 
    updatePatientMaxFingers, 
    updatePatientMinThumb, 
    updatePatientMinFingers, 
    getPatientCalibration 
} = require('../controllers/patientCalController');

// Thumb endpoints
router.post('/:patient_id/max/thumb', updatePatientMaxThumb);
router.post('/:patient_id/min/thumb', updatePatientMinThumb);

// Four fingers endpoints
router.post('/:patient_id/max/fingers', updatePatientMaxFingers);
router.post('/:patient_id/min/fingers', updatePatientMinFingers);

// Get the patient's data
router.get('/:patient_id', getPatientCalibration);

module.exports = router;
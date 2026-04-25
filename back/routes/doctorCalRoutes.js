const express = require('express');
const router = express.Router();
const { 
    updateDoctorMaxThumb, updateDoctorMaxFingers, 
    updateDoctorMinThumb, updateDoctorMinFingers, 
    getDoctorCalibration 
} = require('../controllers/doctorCalController');

router.post('/:doctor_id/max/thumb', updateDoctorMaxThumb);
router.post('/:doctor_id/max/fingers', updateDoctorMaxFingers);
router.post('/:doctor_id/min/thumb', updateDoctorMinThumb);
router.post('/:doctor_id/min/fingers', updateDoctorMinFingers);
router.get('/:doctor_id', getDoctorCalibration);

module.exports = router;
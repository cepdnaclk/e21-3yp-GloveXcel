const express = require('express');
const {
    createHospital,
    listHospitals,
    adminSignup,
    adminLogin,
    getPendingDoctorRequests,
    updateDoctorVerificationStatus,
    doctorSignup,
    patientSignup,
    doctorLogin,
    patientLogin,
    login
} = require('../controllers/authController');

const router = express.Router();

router.get('/hospitals', listHospitals);
router.post('/hospitals', createHospital);
router.post('/admin/signup', adminSignup);
router.post('/admin/login', adminLogin);
router.get('/admin/doctor-requests', getPendingDoctorRequests);
router.patch('/admin/doctor-requests/:doctorId/verification', updateDoctorVerificationStatus);
router.post('/doctor/signup', doctorSignup);
router.post('/doctor/login', doctorLogin);
router.post('/patient/signup', patientSignup);
router.post('/patient/login', patientLogin);
router.post('/login', login);

module.exports = router;

const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const {
    createHospital,
    listHospitals,
    listPatients,
    adminSignup,
    adminLogin,
    getPendingDoctorRequests,
    getApprovedDoctors,
    updateDoctorVerificationStatus,
    doctorSignup,
    patientSignup,
    doctorLogin,
    patientLogin,
    login
} = require('../controllers/authController');

const router = express.Router();

router.get('/hospitals', listHospitals);
router.get('/patients', authenticateToken, requireRole('doctor', 'admin'), listPatients);
router.post('/hospitals', createHospital);
router.post('/admin/signup', adminSignup);
router.post('/admin/login', adminLogin);
router.get('/admin/doctor-requests', getPendingDoctorRequests);
router.get('/admin/approved-doctors', getApprovedDoctors);
router.patch('/admin/doctor-requests/:doctorId/verification', updateDoctorVerificationStatus);
router.post('/doctor/signup', doctorSignup);
router.post('/doctor/login', doctorLogin);
router.post('/patient/signup', patientSignup);
router.post('/patient/login', patientLogin);
router.post('/login', login);

module.exports = router;

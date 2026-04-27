const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const {
    createHospital,
    listHospitals,
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
router.post('/hospitals', createHospital);
router.post('/admin/signup', adminSignup);
router.post('/admin/login', adminLogin);
router.get('/admin/doctor-requests', authenticateToken, requireRole('admin'), getPendingDoctorRequests);
router.get('/admin/approved-doctors', authenticateToken, requireRole('admin'), getApprovedDoctors);
router.patch('/admin/doctor-requests/:doctorId/verification', authenticateToken, requireRole('admin'), updateDoctorVerificationStatus);
router.post('/doctor/signup', doctorSignup);
router.post('/doctor/login', doctorLogin);
router.post('/patient/signup', patientSignup);
router.post('/patient/login', patientLogin);
router.post('/login', login);

module.exports = router;

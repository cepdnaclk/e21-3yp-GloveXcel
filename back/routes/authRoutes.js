const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const {
    requestDoctorChannel,
    channelPatient,
    listDoctorChannelData,
    updateChannelRequestStatus,
    removeApprovedPatient
} = require('../controllers/channelRequestController');
const {
    getSupabaseAuthConfig,
    createHospital,
    listHospitals,
    listPatients,
    listDoctors,
    adminSignup,
    adminLogin,
    getPendingDoctorRequests,
    getApprovedDoctors,
    updateDoctorVerificationStatus,
    doctorSignup,
    patientSignup,
    doctorLogin,
    patientLogin,
    login,
    googleLogin,
    googleCompleteSignup
} = require('../controllers/authController');

const router = express.Router();

router.get('/hospitals', listHospitals);
router.get('/supabase-auth-config', getSupabaseAuthConfig);
router.get('/patients', authenticateToken, requireRole('doctor', 'admin', 'patient'), listPatients);
router.get('/doctors', authenticateToken, requireRole('doctor', 'admin', 'patient'), listDoctors);
router.post('/channel-requests', authenticateToken, requireRole('patient'), requestDoctorChannel);
router.post('/channel-requests/patients', authenticateToken, requireRole('doctor', 'admin'), channelPatient);
router.get('/channel-requests/doctor', authenticateToken, requireRole('doctor', 'admin'), listDoctorChannelData);
router.patch('/channel-requests/:requestId', authenticateToken, requireRole('doctor', 'admin'), updateChannelRequestStatus);
router.delete('/channel-requests/patients/:patientId', authenticateToken, requireRole('doctor', 'admin'), removeApprovedPatient);
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
router.post('/google-login', googleLogin);
router.post('/google-complete-signup', googleCompleteSignup);

module.exports = router;

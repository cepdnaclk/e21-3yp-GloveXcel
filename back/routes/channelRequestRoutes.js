const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const {
  requestDoctorChannel,
  listDoctorChannelData,
  updateChannelRequestStatus,
} = require('../controllers/channelRequestController');

const router = express.Router();

router.post('/', authenticateToken, requireRole('patient'), requestDoctorChannel);
router.get('/doctor', authenticateToken, requireRole('doctor', 'admin'), listDoctorChannelData);
router.patch('/:requestId', authenticateToken, requireRole('doctor', 'admin'), updateChannelRequestStatus);

module.exports = router;

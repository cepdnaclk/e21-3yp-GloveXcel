const express = require('express');
const router = express.Router();
const { optionallyAuthenticateToken } = require('../middleware/authMiddleware');
const { saveLiveAnalytics } = require('../controllers/liveAnalyticsController');

router.post('/', optionallyAuthenticateToken, saveLiveAnalytics);

module.exports = router;

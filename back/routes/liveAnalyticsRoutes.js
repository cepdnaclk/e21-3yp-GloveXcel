const express = require('express');
const router = express.Router();
const { optionallyAuthenticateToken } = require('../middleware/authMiddleware');
const { saveLiveAnalytics, listLiveAnalytics } = require('../controllers/liveAnalyticsController');

router.get('/', optionallyAuthenticateToken, listLiveAnalytics);
router.post('/', optionallyAuthenticateToken, saveLiveAnalytics);

module.exports = router;

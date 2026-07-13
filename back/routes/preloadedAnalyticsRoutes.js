const express = require('express');
const router = express.Router();
const { optionallyAuthenticateToken } = require('../middleware/authMiddleware');
const { savePreloadedAnalytics, listPreloadedAnalytics } = require('../controllers/preloadedAnalyticsController');

router.get('/', optionallyAuthenticateToken, listPreloadedAnalytics);
router.post('/', optionallyAuthenticateToken, savePreloadedAnalytics);

module.exports = router;

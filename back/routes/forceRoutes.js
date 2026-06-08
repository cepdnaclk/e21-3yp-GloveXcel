const express = require('express');
const router = express.Router();
const { setForceLevel, getForceLevel } = require('../controllers/forceController');

router.post('/', setForceLevel);
router.get('/', getForceLevel);

module.exports = router;
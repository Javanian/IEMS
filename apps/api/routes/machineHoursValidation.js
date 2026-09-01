const express = require('express');
const router = express.Router();
const controller = require('../controllers/machineHoursValidationController');

router.get('/validation-stats', controller.validationStats);
router.get('/validation-group/:machineno', controller.validationGroupRecords);

module.exports = router;

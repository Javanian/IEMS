const express = require('express');
const controller = require('../controllers/machineHoursSqlServerController');

const router = express.Router();

router.get('/health', controller.getHealth);
router.get('/validation-stats', controller.validationStats);
router.get('/validation-group/:machineno', controller.validationGroupRecords);
router.get('/', controller.getMachineHours);

module.exports = router;

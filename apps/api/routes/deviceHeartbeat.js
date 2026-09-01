const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/deviceHeartbeatController');

router.post('/', ctrl.beat);
router.get('/fleet', ctrl.fleet);

module.exports = router;

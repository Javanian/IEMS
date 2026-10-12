const express = require('express');
const router = express.Router();
const controller = require('../controllers/componentTrackingController');

router.get('/machines', controller.getMachines);
router.get('/sow-operations', controller.getSowOperations);
router.get('/buffers', controller.getBuffers);
router.post('/buffers', controller.setBuffer);
router.patch('/buffers/priorities', controller.updateBufferPriorities);
router.patch('/buffers/:id/note', controller.updateBufferNote);
router.get('/buffer-history', controller.getBufferHistory);
router.get('/machines/:machineId', controller.getMachineDetail);

module.exports = router;

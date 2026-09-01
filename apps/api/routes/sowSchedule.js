const express = require('express');
const router = express.Router();
const controller = require('../controllers/sowScheduleController');

router.get('/shifts', controller.getShifts);
router.get('/shift-rules', controller.getShiftRules);
router.post('/shift-rules', controller.createShiftRule);
router.put('/shift-rules/:id', controller.updateShiftRule);
router.delete('/shift-rules/:id', controller.deleteShiftRule);
router.get('/machines', controller.getMachines);
router.get('/sow-activities', controller.getSowActivities);
router.get('/batches', controller.getBatches);
router.post('/batches', controller.createBatch);
router.delete('/batches/:id', controller.deleteBatch);

router.get('/capacity', controller.getCapacity);
router.put('/capacity', controller.upsertCapacity);
router.post('/capacity', controller.upsertCapacity);

router.get('/unplanned', controller.getUnplannedSchedules);
router.get('/planned', controller.getPlannedSchedules);

router.get('/report/capacity', controller.getCapacityReport);
router.get('/report/plan-vs-actual', controller.getPlanVsActualReport);
router.get('/report/planned-queue-vs-actual-queue', controller.getPlannedQueueVsActualQueueReport);
router.get('/report/overtime-summary', controller.getOvertimeSummaryReport);

router.get('/overtime', controller.getOvertime);
router.post('/overtime', controller.createOvertime);
router.put('/overtime/:id', controller.updateOvertime);
router.post('/overtime/:id/approve', controller.approveOvertime);
router.post('/overtime/:id/reject', controller.rejectOvertime);
router.post('/overtime/:id/assign', controller.assignManpower);
router.delete('/overtime/:id', controller.deleteOvertime);

router.get('/manpower', controller.getManpower);

router.get('/operation-status', controller.getOperationStatus);
router.post('/operation-status', controller.upsertOperationStatus);
router.delete('/operation-status/:id', controller.clearOperationStatus);
router.get('/verification-log', controller.getVerificationLog);

router.get('/order-progress', controller.getOrderProgress);
router.get('/order-operations', controller.getOrderOperations);

router.get('/', controller.getSchedules);
router.post('/', controller.createSchedule);
router.post('/:id/reschedule', controller.rescheduleSchedule);
router.post('/:id/reorder', controller.reorderSchedule);
router.put('/:id', controller.updateSchedule);
router.delete('/:id', controller.deleteSchedule);

module.exports = router;

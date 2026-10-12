const express = require('express');
const router = express.Router();
const controller = require('../controllers/toolsController');

router.get('/categories', controller.getCategories);
router.get('/conditions', controller.getConditions);

router.get('/reservations', controller.listReservations);
router.post('/reservations', controller.createReservation);
router.patch(
  '/reservations/:id/:action(approve|reject|cancel)',
  controller.updateReservationStatus
);

router.get('/transactions', controller.listTransactions);
router.post('/transactions/borrow', controller.borrowTool);
router.patch('/transactions/:id/return', controller.returnTool);

router.get('/handovers', controller.listHandovers);
router.post('/handovers', controller.createHandover);
router.patch('/handovers/:id/accept', controller.acceptHandover);
router.patch('/handovers/:id/reject', controller.rejectHandover);

router.get('/', controller.listTools);
router.patch('/:id', controller.updateTool);
router.get('/:id/logs', controller.getToolLogs);
router.get('/:id', controller.getToolById);

module.exports = router;

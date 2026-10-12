const express = require('express');
const router = express.Router();
const controller = require('../controllers/timesheet_transactionController');

router.get('/', controller.getAll);
router.get('/search', controller.search);
router.get('/validation-stats', controller.validationStats);
router.get('/validation-group/:serialnumber', controller.validationGroupRecords);
router.get('/operator-performance/workcenters', controller.operatorPerformanceWorkcenters);
router.get('/operator-performance/orders', controller.operatorPerformanceOrders);
router.get(
  '/operator-performance/orders/:orderNo/operations',
  controller.operatorPerformanceOperations
);
router.get(
  '/operator-performance/orders/:orderNo/operations/:operationNo/timesheets',
  controller.operatorPerformanceTransactions
);
router.get('/getsn/:snkaryawan', controller.getbysn);
router.get('/getid/:id', controller.getbyid);
router.get('/nama/:nama', controller.getbyname);
router.get('/log-sap', controller.getLogSap);
router.get('/getcsv', controller.getcsv);
router.get('/getexcel', controller.getxlsx);
router.post('/', controller.create);
router.put('/validation', controller.bulkValidation);
router.post('/post-to-sap', controller.postToSap);
router.put('/updateadmin/:id', controller.updateTimesheetadmin);
router.put('/checkout', controller.checkout);
router.put('/checkout-unprod', controller.checkoutUnprod);
router.put('/checkoutid/', controller.checkoutid);
router.patch('/:tsnumber', controller.partialUpdate);
router.delete('/:id', controller.remove);

module.exports = router;

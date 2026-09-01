const express = require('express');
const router = express.Router();
const controller = require('../controllers/dashboardController');
const mpsController = require('../controllers/mpsDashboardController');

router.get('/kpi', controller.getKpi);
router.get('/order-status', controller.getOrderStatus);
router.get('/workload', controller.getWorkload);
router.get('/daily-hours', controller.getDailyHours);
router.get('/operator-efficiency', controller.getOperatorEfficiency);
router.get('/ontime-monthly', controller.getOntimeMonthly);
router.get('/progress-distribution', controller.getProgressDistribution);
router.get('/validation-rate', controller.getValidationRate);
router.get('/operator-heatmap', controller.getOperatorHeatmap);
router.get('/workcenter-list', controller.getWorkcenterList);
router.get('/operations-hub', controller.getOperationsHub);
router.get('/sap-timesheet-staging-log', controller.getSapTimesheetStagingLog);
router.get('/sap-timesheet-staging-summary', controller.getSapTimesheetStagingSummary);
router.get('/sap-reconciliation', controller.getSapReconciliation);
router.get('/sap-reconciliation-export', controller.exportSapReconciliation);
router.get('/sap-reconciliation-day', controller.getSapReconciliationDay);
router.get('/sap-reconciliation-records', controller.getSapReconciliationRecords);
router.get('/sap-reconciliation-record', controller.getSapReconciliationRecord);
router.post('/sap-staging-exclusion', controller.excludeSapRecord);
router.delete('/sap-staging-exclusion', controller.unexcludeSapRecord);
router.get('/sap-staging-exclusion', controller.listSapExclusions);
router.post('/sap-ops/enqueue', controller.enqueueSapOps);
router.get('/sap-ops/requests', controller.getSapOpsRequests);
router.get('/sap-corrections', controller.getSapCorrections);
router.post('/sap-ops/post-corrections', controller.postCorrections);
router.get('/machine-hours-matrix', controller.getMachineHoursMatrix);
router.get('/machine-hours-records', controller.getMachineHoursRecords);
router.get('/ph3-jobs', controller.getPh3Jobs);
router.get('/operators', controller.getOperators);
router.post('/machine-hours-override', controller.saveMachineHoursOverride);

router.get('/mps-oee-summary', mpsController.getOeeSummary);
router.get('/mps-oee-trend', mpsController.getOeeTrend);
router.get('/mps-loss-breakdown', mpsController.getLossBreakdown);
router.get('/mps-pareto-loss', mpsController.getParetoLoss);
router.get('/mps-lean-distribution', mpsController.getLeanDistribution);
router.get('/mps-snapshot', mpsController.getSnapshot);

router.get('/order-progress', controller.getOrderProgress);
router.get('/order-activity-detail/:orderNo', controller.getOrderActivityDetail);
router.get('/operation-timesheet-history', controller.getOperationTimesheetHistory);
router.post('/refresh-order-matviews', async (req, res) => {
  try {
    await controller.refreshOrderMatviews();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

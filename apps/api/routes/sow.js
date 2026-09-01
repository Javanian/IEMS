const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const controller = require('../controllers/sowController');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/sow-pdf');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MIMES.has(file.mimetype));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const uploadMem = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MIMES.has(file.mimetype));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/standard', controller.getSowStandard);

router.get('/standard/grouped', controller.getSowStandardGrouped);
router.get('/standard/download', controller.downloadSowStandard);
router.get('/standard/component/:component_id', controller.getSowStandardByComponent);
router.get('/standard/component/:component_id/templates', controller.getSowTemplatesByComponent);
router.put('/standard/component/:component_id', controller.updateSowStandardComponent);
router.delete('/standard/component/:component_id', controller.deleteSowStandardComponent);
router.post('/templates', controller.createTemplate);
router.put('/templates/:templateId', controller.updateTemplate);
router.delete('/templates/:templateId', controller.deleteTemplate);
router.get('/standard/operation/:id', controller.getSowStandardById);
router.post('/standard/operation', controller.createSowStandardOperation);
router.put('/standard/operation/:id', controller.updateSowStandardOperation);
router.delete('/standard/operation/:id', controller.deleteSowStandardOperation);

router.get('/standard/operation/:id/attachments', controller.getAttachments);
router.post(
  '/standard/operation/:id/attachments',
  upload.array('files', 10),
  controller.uploadAttachments
);
router.delete('/standard/attachment/:attachmentId', controller.deleteAttachment);

router.get('/nnva/base', controller.getNnvaBase);
router.post('/nnva/base', controller.createNnvaBase);
router.put('/nnva/base/:id', controller.updateNnvaBase);
router.delete('/nnva/base/:id', controller.deleteNnvaBase);
router.get('/nnva/standard/:standardId', controller.getNnvaByStandard);
router.put('/nnva/standard/:standardId', controller.saveNnvaToStandard);

router.get('/customers', controller.getCustomers);
router.get('/components', controller.getComponents);
router.get('/documentnos', controller.getSowDocumentNos);
router.post('/documentnos', controller.createSowDocumentNo);

router.get('/operationcard/:standardId', controller.getOperationCard);
router.post('/operationcard/:standardId', controller.saveOperationCard);

router.get('/grouped', controller.getGrouped);
router.get('/getrow/:id', controller.getRowById);
router.post('/create', controller.createFromBuilder);

router.get('/history-rows', controller.getSowHistoryRows);
router.get('/history-export', controller.exportSowHistoryRows);
router.get('/history-orders', controller.getSowOrderOptions);
router.get('/history-order/:orderNo', controller.getSowOrderForRevision);
router.put('/history-order/:orderNo/info', controller.saveSowOrderInfo);
router.put('/history-order/:orderNo', controller.saveSowOrderRevision);
router.get('/revision-history/:orderNo', controller.getSowRevisionHistory);

router.put('/drafts/:context/:refKey', controller.saveSowDraft);
router.get('/drafts/:context/:refKey', controller.getSowDraft);
router.delete('/drafts/:context/:refKey', controller.deleteSowDraft);

router.post('/saved', controller.createSavedSow);
router.get('/saved', controller.listSavedSows);
router.get('/saved/:id', controller.getSavedSow);
router.put('/saved/:id', controller.updateSavedSow);
router.delete('/saved/:id', controller.deleteSavedSow);

router.get('/subcont-marks', controller.listSowSubcontMarks);
router.post('/subcont-marks', controller.createSowSubcontMark);
router.delete('/subcont-marks/:order_no/:operation_no', controller.deleteSowSubcontMark);

router.get('/progress-history/:idsow', controller.getProgressHistory);
router.post('/progress-history', controller.addProgressUpdate);

router.get('/operations/:idsow/subtasks', controller.getSubtasks);
router.post('/operations/:idsow/subtasks', controller.createSubtask);
router.post('/operations/:idsow/subtasks/batch', controller.createSubtasksBatch);
router.put('/subtasks/:subId', controller.updateSubtask);
router.post('/subtasks/:subId/progress', controller.addSubtaskProgress);
router.get('/subtasks/:subId/progress-history', controller.getSubtaskProgressHistory);

router.post('/subtasks/import', uploadMem.single('file'), controller.importSubtasks);

router.get('/subtask-standards', controller.getSubtaskStandards);
router.get('/subtask-standards/parts', controller.getSubtaskStandardParts);
router.post(
  '/subtask-standards/import',
  uploadMem.single('file'),
  controller.importSubtaskStandards
);
router.delete('/subtask-standards/:id', controller.deleteSubtaskStandard);

router.get('/parts', controller.getAllParts);
router.get('/parts/search', controller.searchParts);
router.get('/parts/:id', controller.getPartById);
router.post('/parts', controller.createPart);
router.put('/parts/:id', controller.updatePart);
router.delete('/parts/:id', controller.deletePart);

router.get('/operations/part/:part_id', controller.getOperationsByPartId);
router.get('/operations/:id', controller.getOperationById);
router.post('/operations', controller.createOperation);
router.put('/operations/:id', controller.updateOperation);
router.delete('/operations/:id', controller.deleteOperation);

router.post('/sow', controller.createPartWithOperations);
router.put('/sow/:id', controller.updatePartWithOperations);
router.get('/sow/complete/:id', controller.getCompleteSOW);

router.get('/stats', controller.getStatistics);
router.get('/reports/drawing-usage', controller.getDrawingUsageReport);

router.get('/planhours', controller.getPlanhours);
router.post('/planhours/multi', controller.getPlanhoursMulti);

router.get('/', controller.getAll);
router.get('/data', controller.get2data);
router.get('/ssbr/:ssbr_id/:group', controller.getByIdent);
router.get('/datajson', controller.getDataJSON);
router.get('/mesin/:order', controller.getbymesinid);
router.get('/csv/', controller.getcsv);
router.get('/csv/:order_no', controller.getcsvbyid);
router.get('/search/:order_no/:operation_no', controller.getBySSBRAndGroup);
router.post('/', controller.create);
router.post('/createex/', controller.createexcel);
router.post('/upsert', controller.upsert);

router.put('/updateex/:id', controller.updateexcel);
router.put('/finish/', controller.finish);
router.put('/:id', controller.update);

router.delete('/:id', controller.remove);
router.get('/:order', controller.getById);

module.exports = router;

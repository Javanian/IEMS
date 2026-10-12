const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const controller = require('../controllers/msProjectController');

const uploadDir = path.join(__dirname, '../uploads/ms-project-mpp');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const projectId = String(req.params.project_id || '').replace(/[^0-9a-f-]/gi, '');
    cb(null, `${projectId || 'project'}-${Date.now()}.uploading.mpp`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    cb(null, path.extname(file.originalname).toLowerCase() === '.mpp');
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.get('/health', controller.health);

router.get('/sow-orders', controller.listSowOrders);
router.get('/sow-orders/:order_no/operations', controller.getSowOrderOperations);
router.patch('/sow-orders/:order_no/operations/people', controller.updateOperationPeople);
router.get('/sow-orders/:order_no/tasks', controller.listOrderTasks);

router.get('/bay-schedules', controller.listBaySchedules);
router.get('/bay-schedules/occupants', controller.listBayOccupants);
router.get('/bay-schedule-tasks', controller.listBayScheduleTasks);
router.post('/bay-schedules', controller.createBaySchedule);
router.put('/bay-schedules/group/:schedule_group_id', controller.updateBayScheduleGroup);
router.delete('/bay-schedules/group/:schedule_group_id', controller.cancelBayScheduleGroup);
router.delete('/bay-schedules/:schedule_id', controller.cancelBaySchedule);

router.get('/projects', controller.listProjects);
router.post('/projects/bulk-load', controller.bulkLoadProjects);
router.get('/projects/:project_id/tasks', controller.listProjectTasks);
router.put('/projects/:project_id/tasks/map-operation', controller.mapSowOperationToTask);
router.get('/projects/:project_id/package', controller.getProjectPackage);
router.post('/projects', controller.publishProject);
router.post('/projects/:project_id/file', upload.single('file'), controller.uploadProjectFile);
router.get('/projects/:project_id/file', controller.downloadProjectFile);
router.get('/projects/:project_id/revisions', controller.listProjectRevisions);
router.put('/projects/:project_id/status', controller.updateProjectStatus);
router.put('/projects/:project_id', controller.updateProjectInfo);
router.put('/projects/:project_id/tasks/:task_id', controller.updateProjectTask);
router.delete('/projects/:project_id', controller.deleteProject);
router.post('/projects/:project_id/checkout', controller.checkoutProject);
router.post('/projects/:project_id/heartbeat', controller.heartbeatProject);
router.put('/projects/:project_id/sync', controller.syncProject);
router.post('/projects/:project_id/publish', controller.publishCurrentRevision);
router.post('/projects/:project_id/checkin', controller.checkinProject);
router.post('/projects/:project_id/force-checkin', controller.forceCheckinProject);

router.get('/calendars', controller.listCalendars);
router.post('/calendars/refresh-from-shifts', controller.refreshCalendarsFromShifts);
router.get('/calendars/:calendar_id', controller.getCalendar);

router.get('/resources/conflicts', controller.getConflicts);
router.get('/resources', controller.searchResources);
router.post('/resources/refresh', controller.refreshResources);

router.get('/projects/:project_id/resources', controller.getProjectResources);
router.post('/projects/:project_id/resources', controller.addProjectResources);
router.delete('/projects/:project_id/resources/:resource_id', controller.deactivateProjectResource);

module.exports = router;

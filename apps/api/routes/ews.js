const express = require('express');
const router = express.Router();
const controller = require('../controllers/ewsController');
const roster = require('../controllers/ewsRosterController');
const requireAdmin = require('../rbac/requireAdmin');

router.get('/summary', controller.getSummary);
router.get('/trend', controller.getTrend);
router.get('/stream', controller.stream);
router.get('/health', controller.getHealth);

router.get('/issue-log', controller.getIssueLog);
router.put('/issue-log/:id/resolve', controller.resolveIssueLog);
router.post('/issue-log/generate', controller.generateIssueLog);

router.get('/issue/:issueKey/records', controller.getIssueRecords);

router.get('/kpi/:type/detail', controller.getKpiDetail);

router.get('/notifications', controller.getTtsNotifications);
router.post('/notifications/:id/played', controller.markTtsNotificationPlayed);

router.get('/tts/playlist', requireAdmin, controller.getTtsPlaylist);

router.get('/roster', roster.getRoster);
router.get('/roster/month', roster.getRosterMonth);
router.delete('/roster', roster.deleteRoster);
router.put('/roster/bulk', roster.bulkUpdateRoster);
router.put('/roster/status', roster.updateStatus);
router.put('/roster/half-day', roster.updateHalfDay);
router.get('/roster/foreman-team', roster.getForemanTeam);
router.put('/roster/foreman-team/member', roster.setForemanMember);
router.delete('/roster/foreman-team/member', roster.removeForemanMember);
router.get('/roster/config', roster.getConfig);
router.put('/roster/config/workday', roster.updateWorkday);
router.put('/roster/group', roster.updateGroup);
router.post('/roster/generate', roster.generate);

router.post('/roster/lock', roster.setLock);
router.post('/roster/lock/:id/cancel', roster.cancelLock);
router.get('/roster/locks', roster.listLocks);

module.exports = router;

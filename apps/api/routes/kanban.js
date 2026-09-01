const express = require('express');
const router = express.Router();
const controller = require('../controllers/kanbanController');

router.get('/board', controller.getBoard);
router.get('/summary', controller.getSummary);
router.get('/cards/detail', controller.getCardDetail);
router.get('/lanes/:location', controller.getLane);
router.post('/refresh', controller.refreshBoard);

module.exports = router;

const express = require('express');
const router = express.Router();
const controller = require('../controllers/production_operationsController');

router.get('/', controller.getAll);
router.get('/lookup', controller.lookup);
router.get('/:id', controller.getById);

module.exports = router;

const express = require('express');
const router = express.Router();
const controller = require('../controllers/processControlController');

router.get('/categories', controller.categories.getAll);
router.post('/categories', controller.categories.create);
router.put('/categories/:id', controller.categories.update);
router.delete('/categories/:id', controller.categories.remove);

router.get('/parameters', controller.parameters.getAll);
router.post('/parameters', controller.parameters.create);
router.put('/parameters/:id', controller.parameters.update);
router.delete('/parameters/:id', controller.parameters.remove);

router.get('/choices', controller.choices.getAll);
router.post('/choices', controller.choices.create);
router.put('/choices/:id', controller.choices.update);
router.delete('/choices/:id', controller.choices.remove);

router.get('/items', controller.items.getAll);
router.get('/items/:id', controller.items.getByControlId);
router.post('/items', controller.items.create);
router.put('/items/:id', controller.items.update);
router.delete('/items/:id', controller.items.remove);

router.get('/by-sn/:sn', controller.controls.getBySN);
router.get('/by-wct/:workcenter', controller.controls.getByWCT);
router.patch('/validate/:id', controller.controls.validate);
router.get('/', controller.controls.getAll);
router.post('/', controller.controls.create);
router.put('/:id', controller.controls.update);
router.delete('/:id', controller.controls.remove);

module.exports = router;

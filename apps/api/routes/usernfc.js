const express = require('express');
const router = express.Router();
const controller = require('../controllers/usernfcController');

router.get('/', controller.getAll);
router.get('/nfcid/:nfcid', controller.getdatausernfc);
router.get('/emp_sn/:emp_sn', controller.getByEmpSn);
router.get('/nama/:nama', controller.getname);
router.post('/', controller.create);
router.put('/update/', controller.updatemesin);
router.put('/mode/:emp_sn', controller.updateMode);
router.put('/nfcedit/:nfcid', controller.updatenfc);

router.put('/inactive/:emp_sn', controller.updateInactiveFrom);
router.put('/:emp_sn', controller.update);

router.delete('/:nfcid', controller.remove);

module.exports = router;

const express = require('express');
const router = express.Router();
const controller = require('../controllers/usernfcController');

router.get('/', controller.getAll);
router.get('/nfcid/:nfcid', controller.getdatausernfc);
router.get('/snssb/:snssb', controller.getBySnssb);
router.get('/nama/:nama', controller.getname);
router.post('/', controller.create);
router.put('/update/', controller.updatemesin);
router.put('/mode/:snssb', controller.updateMode);
router.put('/nfcedit/:nfcid', controller.updatenfc);

router.put('/inactive/:snssb', controller.updateInactiveFrom);
router.put('/:snssb', controller.update);

router.delete('/:nfcid', controller.remove);

module.exports = router;

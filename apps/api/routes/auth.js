const express = require('express');
const router = express.Router();
const controller = require('../controllers/authController');

router.post('/login', controller.login);
router.post('/change-password', controller.changePassword);
router.get('/users', controller.listUsers);
router.post('/users', controller.createUser);
router.put('/users/:id', controller.updateUser);
router.delete('/users/:id', controller.deleteUser);

router.get('/me/permissions', controller.getMyPermissions);
router.get('/users/:id/permissions', controller.getUserPermissions);
router.put('/users/:id/permissions', controller.updateUserPermissions);

module.exports = router;

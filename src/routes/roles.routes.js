// Backend/src/routes/roles.routes.js           web
const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

const rolesCtrl = require('../controllers/roles.controller');

router.use(verifyToken);

// Roles (solo admin normalmente)
router.get('/', checkPermission('roles:read'), rolesCtrl.getAllRoles);
router.post('/', checkPermission('roles:create'), rolesCtrl.createRol);
router.put('/:rolId', checkPermission('roles:update'), rolesCtrl.updateRol);
router.delete('/:rolId', checkPermission('roles:delete'), rolesCtrl.deleteRol);

// Permisos
router.get('/permisos', checkPermission('roles:read'), rolesCtrl.getAllPermisos);

// Asignación permisos a rol
router.put('/:rolId/permisos', checkPermission('roles:update'), rolesCtrl.updateRolPermisos);

module.exports = router;
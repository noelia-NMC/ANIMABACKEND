// Backend/src/routes/turnos.routes.js      web
const express = require('express');
const router = express.Router();
const { getTurnos, createTurno, updateTurno, deleteTurno } = require('../controllers/turnos.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

router.use(verifyToken);

router.get('/', checkPermission('turnos:read'), getTurnos);
router.post('/', checkPermission('turnos:create'), createTurno);
router.put('/:id', checkPermission('turnos:update'), updateTurno);
router.delete('/:id', checkPermission('turnos:delete'), deleteTurno);

module.exports = router;
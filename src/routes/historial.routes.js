// Backend/src/routes/historial.routes.js (web)
const express = require('express');
const router = express.Router();

const {
  getHistorial,
  createHistorial,
  updateHistorial,
  deleteHistorial,
} = require('../controllers/historial.controller');

const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

router.use(verifyToken);

router.get('/', checkPermission('historial:read'), getHistorial);
router.post('/', checkPermission('historial:create'), createHistorial);
router.put('/:id', checkPermission('historial:update'), updateHistorial);
router.delete('/:id', checkPermission('historial:delete'), deleteHistorial);

module.exports = router;
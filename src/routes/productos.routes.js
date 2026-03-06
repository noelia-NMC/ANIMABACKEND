// Backend/src/routes/productos.routes.js     web
const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

const {
  crearProducto,
  obtenerProductos,
  actualizarProducto,
  desactivarProducto,
  moverStock,
  obtenerMovimientos,
} = require('../controllers/productos.controller');

router.use(verifyToken);

router.get('/', checkPermission('productos:read'), obtenerProductos);
router.post('/', checkPermission('productos:create'), crearProducto);
router.put('/:id', checkPermission('productos:update'), actualizarProducto);
router.delete('/:id', checkPermission('productos:delete'), desactivarProducto);

// stock
router.post('/movimientos', checkPermission('productos:update'), moverStock);
router.get('/:id/movimientos', checkPermission('productos:read'), obtenerMovimientos);

module.exports = router;
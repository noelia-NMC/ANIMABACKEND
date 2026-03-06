// Backend/src/routes/clientes.routes.js  (WEB)
const express = require('express');
const router = express.Router();

const clientesController = require('../controllers/clientes.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

router.use(verifyToken);

// CLIENTES
router.get('/', checkPermission('clientes:read'), clientesController.getClientes);
router.post('/', checkPermission('clientes:create'), clientesController.createCliente);
router.put('/:id', checkPermission('clientes:update'), clientesController.updateCliente);
router.delete('/:id', checkPermission('clientes:delete'), clientesController.deleteCliente);

module.exports = router;
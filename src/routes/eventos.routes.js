// 📁 backend/src/routes/eventos.routes.js     mobile
const express = require('express');
const router = express.Router();
const eventosController = require('../controllers/eventos.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Todas las rutas de eventos requieren que el usuario esté autenticado.
// Tu middleware se encarga de verificar el token y añadir 'req.user'.
router.use(authMiddleware.verifyToken);

// Define las rutas para el CRUD de eventos
router.get('/', eventosController.getEventos);
router.post('/', eventosController.createEvento);
router.delete('/:id', eventosController.deleteEvento);

module.exports = router;
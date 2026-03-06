const express = require('express');
const router = express.Router();
const historialController = require('../controllers/historialMobile.controller.js');
const { verifyToken } = require('../middlewares/auth.middleware.js');

// GET /api/historial/mascota/:mascotaId
router.get('/mascota/:mascotaId', verifyToken, historialController.getHistorialClinicoPorMascota);

module.exports = router;
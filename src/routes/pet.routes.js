// Backend/src/routes/pet.routes.js (SOLO WEB)
const express = require('express');
const router = express.Router();

const petController = require('../controllers/pet.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

router.use(verifyToken);

// Mascotas
router.get('/', checkPermission('mascotas:read'), petController.getMascotas);
router.post('/', checkPermission('mascotas:create'), petController.createMascota);
router.put('/:id', checkPermission('mascotas:update'), petController.updateMascota);
router.delete('/:id', checkPermission('mascotas:delete'), petController.deleteMascota);

module.exports = router;
const express = require('express');
const router = express.Router();

const perfilMascotaController = require('../controllers/perfilMascota.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/cloudinary');

// Todas requieren usuario autenticado
router.use(verifyToken);

// Obtener mascotas del usuario
router.get('/', perfilMascotaController.getMisPerfilesMascotas);

// Crear mascota
router.post('/', perfilMascotaController.crearPerfilMascota);

// Actualizar mascota (con foto opcional)
router.put('/:id', upload.single('foto_file'), perfilMascotaController.actualizarPerfilMascota);

// Eliminar mascota
router.delete('/:id', perfilMascotaController.eliminarPerfilMascota);

module.exports = router;
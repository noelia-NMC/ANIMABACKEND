const express = require('express');
const router = express.Router();

const perfilMascotaController = require('../controllers/perfilMascota.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/cloudinary');

router.use(verifyToken);

router.get('/', perfilMascotaController.getMisPerfilesMascotas);
router.get('/:id/clinica-contexto', perfilMascotaController.getContextoClinicaPorPerfil);

router.post('/', perfilMascotaController.crearPerfilMascota);
router.put('/:id', upload.single('foto_file'), perfilMascotaController.actualizarPerfilMascota);
router.delete('/:id', perfilMascotaController.eliminarPerfilMascota);

module.exports = router;
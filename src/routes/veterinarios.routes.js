// Backend/src/routes/veterinarios.routes.js      web
const express = require('express');
const router = express.Router();

const {
  getVeterinarios,
  createVeterinario,
  updateVeterinario,
  deleteVeterinario
} = require('../controllers/veterinarios.controller');

const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

router.use(verifyToken);

router.get('/',      checkPermission('veterinarios:read'),   getVeterinarios);
router.post('/',     checkPermission('veterinarios:create'), createVeterinario);
router.put('/:id',   checkPermission('veterinarios:update'), updateVeterinario);
router.delete('/:id',checkPermission('veterinarios:delete'), deleteVeterinario);

module.exports = router;
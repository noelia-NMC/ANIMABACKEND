const express = require('express');
const router = express.Router();
const teleconsultaController = require('../controllers/teleconsulta.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

const requireHandler = (name) => {
  if (typeof teleconsultaController[name] !== 'function') {
    console.error(`[teleconsulta.routes] Falta handler: ${name}. Revisa exports de teleconsulta.controller.js`);
    return (req, res) => res.status(500).json({ message: `Handler faltante: ${name}` });
  }
  return teleconsultaController[name];
};

router.use(verifyToken);

router.post('/', checkPermission('teleconsultas:create'), requireHandler('crearTeleconsulta'));
router.get('/veterinario/mis-consultas', checkPermission('teleconsultas:read'), requireHandler('obtenerPorVeterinario'));
router.get('/propietario/mis-consultas', checkPermission('teleconsultas:read'), requireHandler('obtenerPorPropietario'));
router.put('/:id/aceptar', checkPermission('teleconsultas:update'), requireHandler('aceptarTeleconsulta'));
router.put('/:id/finalizar', checkPermission('teleconsultas:update'), requireHandler('finalizarTeleconsulta'));
router.put('/:id/cancelar', checkPermission('teleconsultas:update'), requireHandler('cancelarTeleconsulta'));

module.exports = router;
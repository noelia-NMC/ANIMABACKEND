// Backend/src/routes/clinicas.routes.js   para refugios y veterinarios en app movil
const { Router } = require('express');
const router = Router();

// Importamos las funciones del controlador
const { 
  searchOSMClinicasAvanzado, 
  clearCache, 
  getCacheStats 
} = require('../controllers/clinica.controller');

// Opcional: Descomenta si quieres proteger las rutas
// const { verifyToken } = require('../middlewares/auth.middleware');

// Ruta principal optimizada
router.get('/osm-nearby', /* verifyToken, */ searchOSMClinicasAvanzado);

// Rutas adicionales para administración del cache (útiles para desarrollo y monitoreo)
router.post('/cache/clear', /* verifyToken, */ clearCache);
router.get('/cache/stats', /* verifyToken, */ getCacheStats);

module.exports = router;
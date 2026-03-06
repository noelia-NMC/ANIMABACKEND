// Backend/src/routes/auditoria.routes.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/auth.middleware');
const { obtenerAuditoria } = require('../controllers/auditoria.controller');

router.get('/', verifyToken, obtenerAuditoria);

module.exports = router;
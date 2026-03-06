const express = require('express');
const router = express.Router();
const reportesController = require('../controllers/reportes.controller');

const { verifyToken } = require('../middlewares/auth.middleware.js'); 

router.post('/', verifyToken, reportesController.generarReporte);

module.exports = router;
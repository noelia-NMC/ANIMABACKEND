// Backend/src/routes/reporteswebgeneral.routes.js          web
const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');
const ctrl = require('../controllers/reporteswebgeneral.controller');

router.use(verifyToken);

router.get('/bundle', checkPermission('reportes:read'), ctrl.getReportesBundle);

// base
router.get('/dashboard-resumen', checkPermission('reportes:read'), ctrl.getDashboardResumen);
router.get('/turnos-periodo', checkPermission('reportes:read'), ctrl.getTurnosPorPeriodo);
router.get('/mascotas-mas-consultadas', checkPermission('reportes:read'), ctrl.getMascotasMasConsultadas);
router.get('/tipos-consultas', checkPermission('reportes:read'), ctrl.getTiposConsultasFrecuentes);
router.get('/razas-mas-atendidas', checkPermission('reportes:read'), ctrl.getRazasMasAtendidas);
router.get('/actividad-veterinarios', checkPermission('reportes:read'), ctrl.getActividadVeterinarios);
router.get('/actividad-mensual', checkPermission('reportes:read'), ctrl.getActividadMensual);

// pro
router.get('/stock-bajo', checkPermission('reportes:read'), ctrl.getStockBajo);
router.get('/movimientos-stock-resumen', checkPermission('reportes:read'), ctrl.getMovimientosStockResumen);
router.get('/top-productos-consumidos', checkPermission('reportes:read'), ctrl.getTopProductosConsumidos);

router.get('/teleconsulta-estados', checkPermission('reportes:read'), ctrl.getTeleconsultaEstados);
router.get('/laboratorio-por-tipo', checkPermission('reportes:read'), ctrl.getLaboratorioPorTipo);
router.get('/laboratorio-recientes', checkPermission('reportes:read'), ctrl.getLaboratorioRecientes);
router.get('/diagnosticos-top', checkPermission('reportes:read'), ctrl.getDiagnosticosTop);

// export
router.get('/export/pdf', checkPermission('reportes:read'), ctrl.exportarReportePDF);
router.get('/export/excel', checkPermission('reportes:read'), ctrl.exportarReporteExcel);

module.exports = router;
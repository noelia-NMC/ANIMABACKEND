// Backend/src/routes/laboratorio.routes.js   web
const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');
const upload = require('../middlewares/upload.middleware');

const {
  getResultados,
  createResultado,
  updateResultado,
  deleteResultado,
} = require('../controllers/laboratorio.controller');

router.use(verifyToken);

router.get('/', checkPermission('laboratorio:read'), getResultados);
router.post('/', checkPermission('laboratorio:create'), upload.single('archivo'), createResultado);
router.put('/:id', checkPermission('laboratorio:update'), upload.single('archivo'), updateResultado);
router.delete('/:id', checkPermission('laboratorio:delete'), deleteResultado);

module.exports = router;
// Backend/src/routes/clinicasWeb.routes.js         web
const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middlewares/auth.middleware');
const { getMiClinica, updateMiClinica } = require('../controllers/clinicasWeb.controller');

router.get('/me', verifyToken, getMiClinica);
router.put('/me', verifyToken, updateMiClinica);

module.exports = router;
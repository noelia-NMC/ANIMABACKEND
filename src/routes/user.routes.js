// Backend/src/routes/user.routes.js    web
const express = require('express');
const router = express.Router();
const { getMiPerfil, updateMiPerfil, changeMiPassword } = require('../controllers/user.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.use(verifyToken);

router.get('/me', getMiPerfil);
router.put('/me', updateMiPerfil);

router.get('/profile', getMiPerfil);
router.put('/profile', updateMiPerfil);

router.put('/password', changeMiPassword);

module.exports = router;
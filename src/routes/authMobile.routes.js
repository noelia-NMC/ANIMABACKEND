// backend/src/routes/authMobile.routes.js
const express = require('express');
const router = express.Router();

const { registerMobile, loginMobile } = require('../controllers/authMobile.controller');
const passwordResetMobileController = require('../controllers/passwordResetMobile.controller');

// ===== Auth existente =====
router.post('/register', registerMobile);
router.post('/login', loginMobile);

// ===== Recuperación contraseña =====
router.post('/forgot-password', passwordResetMobileController.forgotPassword);
router.post('/reset-password', passwordResetMobileController.resetPassword);

module.exports = router;
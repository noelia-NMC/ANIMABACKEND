// Backend/src/routes/onboarding.routes.js   web
const express = require('express');
const router = express.Router();

const { registerClinicAndAdmin } = require('../controllers/onboarding.controller');

router.post('/register-clinic-admin', registerClinicAndAdmin);

module.exports = router;
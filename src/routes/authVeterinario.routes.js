const express = require('express');
const router = express.Router();
const { loginVeterinario } = require('../controllers/authVeterinario.controller');

router.post('/login', loginVeterinario);

module.exports = router;

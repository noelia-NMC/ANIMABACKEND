// Backend/src/routes/auth.routes.js        web
const express = require('express');
const router = express.Router();

const { registerUser, loginUser, me } = require('../controllers/auth.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/login', loginUser);
router.post('/register', registerUser);
router.get('/me', verifyToken, me);

module.exports = router;
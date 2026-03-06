// Backend/src/routes/chatbot.routes.js  (WEB)
const express = require('express');
const router = express.Router();

const { verifyToken } = require('../middlewares/auth.middleware');
const checkPermission = require('../middlewares/checkPermission');

const chatbotController = require('../controllers/chatbot.controller');

// IMPORTANTE: tu ruta de imagen usa multer (upload middleware)
// si ya tienes un upload para imagen, úsalo aquí:
const upload = require('../middlewares/upload.middleware');

router.use(verifyToken);

// Texto
router.post('/', checkPermission('chatbot:use'), chatbotController.handleTextQuery);

// Imagen (multipart/form-data con field "image")
router.post(
  '/image',
  checkPermission('chatbot:use'),
  upload.single('image'),
  chatbotController.handleImageQuery
);

module.exports = router;
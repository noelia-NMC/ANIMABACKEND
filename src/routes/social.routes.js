// Backend/src/routes/social.routes.js - CORREGIDO      
const express = require('express');
const router = express.Router();
const { verifyTokenMobile } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/cloudinary'); // Middleware para subir imágenes a Cloudinary
const socialController = require('../controllers/social.controller');

// ===== RUTAS DE PUBLICACIONES =====

// Obtener feed principal (timeline)
router.get('/feed', verifyTokenMobile, socialController.getFeed);

// Crear nueva publicación (con imagen opcional)
router.post('/posts',
    verifyTokenMobile,
    upload.single('imagen'), // Cloudinary middleware
    socialController.createPost
);

// Obtener publicaciones de una mascota específica
router.get('/posts/mascota/:mascotaId', verifyTokenMobile, socialController.getPostsByPet);

// Eliminar publicación
router.delete('/posts/:postId', verifyTokenMobile, socialController.deletePost);

// ===== RUTAS DE INTERACCIONES =====

// Dar/quitar like a una publicación
router.post('/posts/:postId/like', verifyTokenMobile, socialController.toggleLike);

// Agregar comentario a una publicación
router.post('/posts/:postId/comments', verifyTokenMobile, socialController.addComment);

// Obtener comentarios de una publicación
router.get('/posts/:postId/comments', verifyTokenMobile, socialController.getComments);

module.exports = router;
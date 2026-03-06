// Backend/src/controllers/social.controller.js - VERSIÓN POSTGRESQL OPTIMIZADA  web
const pool = require('../db');

/**
 * @description Crear una nueva publicación
 */
const createPost = async (req, res) => {
    const userId = req.user.id;
    const { mascota_id, contenido, tipo_post = 'normal' } = req.body;
    
    // La imagen viene del middleware de Cloudinary
    const imagen_url = req.file ? req.file.path : null;

    if (!mascota_id || !contenido) {
        return res.status(400).json({ 
            success: false,
            message: 'La mascota y el contenido son obligatorios.' 
        });
    }

    try {
        // Verificar que la mascota pertenece al usuario
        const mascotaResult = await pool.query(
            'SELECT * FROM mascotas WHERE id = $1 AND user_id = $2',
            [mascota_id, userId]
        );

        if (mascotaResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false,
                message: 'No tienes permiso para publicar con esta mascota.' 
            });
        }

        // Crear la publicación
        const postResult = await pool.query(
            `INSERT INTO posts (user_id, mascota_id, contenido, imagen_url, tipo_post, fecha_creacion)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING *`,
            [userId, mascota_id, contenido, imagen_url, tipo_post]
        );

        const post = postResult.rows[0];

        // Obtener datos completos del post para la respuesta
        const fullPostResult = await pool.query(`
            SELECT p.*, 
                   u.nombre as usuario_nombre, u.apellido as usuario_apellido,
                   m.nombre as mascota_nombre, m.foto_url as mascota_foto, m.raza,
                   0 as total_likes,
                   0 as total_comentarios,
                   false as me_gusta
            FROM posts p
            JOIN users u ON p.user_id = u.id
            JOIN mascotas m ON p.mascota_id = m.id
            WHERE p.id = $1
        `, [post.id]);

        res.status(201).json({
            success: true,
            message: 'Publicación creada exitosamente',
            post: fullPostResult.rows[0]
        });

    } catch (error) {
        console.error('Error al crear publicación:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error interno del servidor.' 
        });
    }
};

/**
 * @description Obtener feed de publicaciones (timeline)
 */
const getFeed = async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    try {
        const feedResult = await pool.query(`
            SELECT p.*, 
                   u.nombre as usuario_nombre, u.apellido as usuario_apellido,
                   m.nombre as mascota_nombre, m.foto_url as mascota_foto, m.raza,
                   COALESCE(like_counts.total_likes, 0) as total_likes,
                   COALESCE(comment_counts.total_comentarios, 0) as total_comentarios,
                   CASE WHEN user_likes.user_id IS NOT NULL THEN true ELSE false END as me_gusta
            FROM posts p
            JOIN users u ON p.user_id = u.id
            JOIN mascotas m ON p.mascota_id = m.id
            LEFT JOIN (
                SELECT post_id, COUNT(*) as total_likes
                FROM likes
                GROUP BY post_id
            ) like_counts ON p.id = like_counts.post_id
            LEFT JOIN (
                SELECT post_id, COUNT(*) as total_comentarios
                FROM comentarios
                GROUP BY post_id
            ) comment_counts ON p.id = comment_counts.post_id
            LEFT JOIN likes user_likes ON p.id = user_likes.post_id AND user_likes.user_id = $1
            ORDER BY p.fecha_creacion DESC
            LIMIT $2 OFFSET $3
        `, [userId, limit, offset]);

        res.json({
            success: true,
            posts: feedResult.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: feedResult.rows.length
            }
        });

    } catch (error) {
        console.error('Error al obtener feed:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error interno del servidor.' 
        });
    }
};

/**
 * @description Dar/quitar like a una publicación
 */
const toggleLike = async (req, res) => {
    const userId = req.user.id;
    const { postId } = req.params;

    try {
        // Verificar si el post existe
        const postExists = await pool.query('SELECT id FROM posts WHERE id = $1', [postId]);
        if (postExists.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                message: 'Publicación no encontrada.' 
            });
        }

        // Verificar si ya le dio like
        const existingLike = await pool.query(
            'SELECT * FROM likes WHERE post_id = $1 AND user_id = $2',
            [postId, userId]
        );

        let liked = false;
        let message = '';

        if (existingLike.rows.length > 0) {
            // Quitar like
            await pool.query(
                'DELETE FROM likes WHERE post_id = $1 AND user_id = $2',
                [postId, userId]
            );
            message = 'Like removido';
            liked = false;
        } else {
            // Dar like
            await pool.query(
                'INSERT INTO likes (post_id, user_id, fecha_creacion) VALUES ($1, $2, NOW())',
                [postId, userId]
            );
            message = 'Like agregado';
            liked = true;
        }

        // Obtener el conteo actualizado de likes
        const likesCountResult = await pool.query(
            'SELECT COUNT(*) as total FROM likes WHERE post_id = $1',
            [postId]
        );
        const totalLikes = parseInt(likesCountResult.rows[0].total);

        res.json({ 
            success: true,
            message, 
            liked, 
            totalLikes 
        });

    } catch (error) {
        console.error('Error al procesar like:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error interno del servidor.' 
        });
    }
};

/**
 * @description Comentar en una publicación
 */
const addComment = async (req, res) => {
    const userId = req.user.id;
    const { postId } = req.params;
    const { contenido } = req.body;

    if (!contenido || contenido.trim().length === 0) {
        return res.status(400).json({ 
            success: false,
            message: 'El comentario no puede estar vacío.' 
        });
    }

    if (contenido.trim().length > 500) {
        return res.status(400).json({ 
            success: false,
            message: 'El comentario no puede exceder 500 caracteres.' 
        });
    }

    try {
        // Verificar si el post existe
        const postExists = await pool.query('SELECT id FROM posts WHERE id = $1', [postId]);
        if (postExists.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                message: 'Publicación no encontrada.' 
            });
        }

        const commentResult = await pool.query(
            `INSERT INTO comentarios (post_id, user_id, contenido, fecha_creacion)
             VALUES ($1, $2, $3, NOW())
             RETURNING *`,
            [postId, userId, contenido.trim()]
        );

        // Obtener datos completos del comentario
        const fullCommentResult = await pool.query(`
            SELECT c.*, u.nombre as usuario_nombre, u.apellido as usuario_apellido
            FROM comentarios c
            JOIN users u ON c.user_id = u.id
            WHERE c.id = $1
        `, [commentResult.rows[0].id]);

        res.status(201).json({
            success: true,
            message: 'Comentario agregado exitosamente',
            comentario: fullCommentResult.rows[0]
        });

    } catch (error) {
        console.error('Error al agregar comentario:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error interno del servidor.' 
        });
    }
};

/**
 * @description Obtener comentarios de una publicación
 */
const getComments = async (req, res) => {
    const { postId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    try {
        const commentsResult = await pool.query(`
            SELECT c.*, u.nombre as usuario_nombre, u.apellido as usuario_apellido
            FROM comentarios c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id = $1
            ORDER BY c.fecha_creacion DESC
            LIMIT $2 OFFSET $3
        `, [postId, limit, offset]);

        res.json({
            success: true,
            comentarios: commentsResult.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: commentsResult.rows.length
            }
        });

    } catch (error) {
        console.error('Error al obtener comentarios:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error interno del servidor.' 
        });
    }
};

/**
 * @description Obtener publicaciones de una mascota específica
 */
const getPostsByPet = async (req, res) => {
    const { mascotaId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    try {
        const postsResult = await pool.query(`
            SELECT p.*, 
                   u.nombre as usuario_nombre, u.apellido as usuario_apellido,
                   m.nombre as mascota_nombre, m.foto_url as mascota_foto, m.raza,
                   COALESCE(like_counts.total_likes, 0) as total_likes,
                   COALESCE(comment_counts.total_comentarios, 0) as total_comentarios,
                   CASE WHEN user_likes.user_id IS NOT NULL THEN true ELSE false END as me_gusta
            FROM posts p
            JOIN users u ON p.user_id = u.id
            JOIN mascotas m ON p.mascota_id = m.id
            LEFT JOIN (
                SELECT post_id, COUNT(*) as total_likes
                FROM likes
                GROUP BY post_id
            ) like_counts ON p.id = like_counts.post_id
            LEFT JOIN (
                SELECT post_id, COUNT(*) as total_comentarios
                FROM comentarios
                GROUP BY post_id
            ) comment_counts ON p.id = comment_counts.post_id
            LEFT JOIN likes user_likes ON p.id = user_likes.post_id AND user_likes.user_id = $1
            WHERE p.mascota_id = $2
            ORDER BY p.fecha_creacion DESC
            LIMIT $3 OFFSET $4
        `, [userId, mascotaId, limit, offset]);

        res.json({
            success: true,
            posts: postsResult.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error al obtener posts de mascota:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error interno del servidor.' 
        });
    }
};

/**
 * @description Eliminar publicación (solo el propietario)
 */
const deletePost = async (req, res) => {
    const userId = req.user.id;
    const { postId } = req.params;

    try {
        // Verificar que el post pertenece al usuario
        const postResult = await pool.query(
            'SELECT * FROM posts WHERE id = $1 AND user_id = $2',
            [postId, userId]
        );

        if (postResult.rows.length === 0) {
            return res.status(403).json({ 
                success: false,
                message: 'No tienes permiso para eliminar esta publicación.' 
            });
        }

        // Eliminar el post (los comentarios y likes se eliminan en cascada)
        await pool.query('DELETE FROM posts WHERE id = $1', [postId]);

        res.json({ 
            success: true,
            message: 'Publicación eliminada exitosamente' 
        });

    } catch (error) {
        console.error('Error al eliminar publicación:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error interno del servidor.' 
        });
    }
};

module.exports = {
    createPost,
    getFeed,
    toggleLike,
    addComment,
    getComments,
    getPostsByPet,
    deletePost
};
// Backend/src/middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');
const pool = require('../db');

const verifyToken = async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: 'Token no proporcionado o con formato incorrecto.' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'JWT_SECRET no configurado.' });
    }

    // ✅ tu token trae { id, email, rol_id, clinica_id }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.id) {
      return res.status(403).json({ message: 'Token inválido: no contiene id de usuario.' });
    }

    // ✅ traer user REAL desde DB (rol_nombre y datos actualizados)
    const q = `
      SELECT u.id, u.email, u.rol_id, u.clinica_id,
             r.nombre AS rol_nombre
      FROM public.users u
      JOIN public.roles r ON r.id = u.rol_id
      WHERE u.id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [decoded.id]);
    const user = r.rows?.[0];

    if (!user) {
      return res.status(401).json({ message: 'Usuario inválido. Inicia sesión de nuevo.' });
    }

    // ✅ Esto es lo que usarán TODOS tus middlewares/controladores
    req.user = {
      id: user.id,
      email: user.email,
      rol_id: user.rol_id,
      clinica_id: user.clinica_id,
      rol_nombre: user.rol_nombre,
    };

    next();
  } catch (err) {
    console.error('[AuthMiddleware] ❌ Token inválido:', err.message);
    return res.status(403).json({ message: 'Token inválido o expirado.' });
  }
};

const verifyTokenMobile = (req, res, next) => verifyToken(req, res, next);

module.exports = { verifyToken, verifyTokenMobile };
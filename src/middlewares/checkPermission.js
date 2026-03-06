// Backend/src/middlewares/checkPermission.js
const pool = require('../db');

const checkPermission = (permisoRequerido) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.rol_id) {
        return res.status(401).json({ message: 'Usuario no autenticado o rol no especificado.' });
      }

      // Si no se pide permiso específico, dejamos pasar
      if (!permisoRequerido) return next();

      // ✅ Admin bypass robusto (con rol_nombre o consultando BD)
      let rolNombre = String(req.user.rol_nombre || '').toLowerCase();

      if (!rolNombre) {
        const r = await pool.query(
          `SELECT nombre FROM public.roles WHERE id = $1 LIMIT 1`,
          [req.user.rol_id]
        );
        rolNombre = String(r.rows?.[0]?.nombre || '').toLowerCase();
      }

      if (rolNombre === 'admin') return next();

      // Verificar permiso
      const query = `
        SELECT 1
        FROM public.rol_permisos rp
        JOIN public.permisos p ON rp.permiso_id = p.id
        WHERE rp.rol_id = $1
          AND p.nombre = $2
        LIMIT 1
      `;

      const result = await pool.query(query, [req.user.rol_id, permisoRequerido]);

      if (result.rowCount > 0) return next();

      return res.status(403).json({
        message: 'Acceso denegado. No tienes permiso.',
        required: permisoRequerido,
      });
    } catch (error) {
      console.error('Error checkPermission:', error.message);
      return res.status(500).json({ message: 'Error interno al verificar permisos.' });
    }
  };
};

module.exports = checkPermission;
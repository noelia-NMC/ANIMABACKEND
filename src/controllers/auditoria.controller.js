// Backend/src/controllers/auditoria.controller.js    web
const pool = require('../db'); 

const isAdmin = (req) => req.user?.rol_id === 1 || req.user?.rol === 'admin';

const obtenerAuditoria = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Solo admin puede ver la bitácora.' });

    const clinica_id = req.user?.clinica_id;
    if (!clinica_id) return res.status(400).json({ message: 'clinica_id no está presente en el token.' });

    const {
      modulo = '',
      accion = '',
      usuario_id = '',
      desde = '',
      hasta = '',
      q = '',
      limit = '50',
      offset = '0',
    } = req.query;

    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);

    const where = [`a.clinica_id = $1`];
    const params = [clinica_id];
    let i = 2;

    if (modulo) { where.push(`upper(a.modulo) = upper($${i})`); params.push(modulo); i++; }
    if (accion) { where.push(`upper(a.accion) = upper($${i})`); params.push(accion); i++; }
    if (usuario_id) { where.push(`a.usuario_id = $${i}`); params.push(Number(usuario_id)); i++; }

    if (desde) { where.push(`a.creado_en >= $${i}`); params.push(desde); i++; }
    if (hasta) { where.push(`a.creado_en <= $${i}`); params.push(hasta); i++; }

    if (q) {
      where.push(`(
        coalesce(a.descripcion,'') ILIKE '%' || $${i} || '%'
        OR coalesce(a.usuario_nombre,'') ILIKE '%' || $${i} || '%'
        OR coalesce(a.usuario_email,'') ILIKE '%' || $${i} || '%'
        OR coalesce(a.entidad,'') ILIKE '%' || $${i} || '%'
        OR coalesce(a.entidad_id,'') ILIKE '%' || $${i} || '%'
        OR coalesce(a.modulo,'') ILIKE '%' || $${i} || '%'
        OR coalesce(a.accion,'') ILIKE '%' || $${i} || '%'
      )`);
      params.push(q);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.auditoria_logsW a
       ${whereSql}`,
      params
    );

    const dataRes = await pool.query(
      `SELECT
        a.id, a.modulo, a.accion, a.entidad, a.entidad_id,
        a.descripcion, a.metadata,
        a.usuario_id, a.usuario_nombre, a.usuario_email, a.usuario_rol,
        a.ip, a.creado_en
       FROM public.auditoria_logsW a
       ${whereSql}
       ORDER BY a.creado_en DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, lim, off]
    );

    res.json({ total: totalRes.rows?.[0]?.total || 0, data: dataRes.rows || [] });
  } catch (err) {
    console.error('[obtenerAuditoria]', err);
    res.status(500).json({ message: 'Error obteniendo auditoría.' });
  }
};

module.exports = { obtenerAuditoria };
// Backend/src/controllers/clinicasWeb.controller.js
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

const getClinicaId = (req) => req.user?.clinica_id ?? req.headers['clinica-id'] ?? null;

const normalizeRole = (r) => String(r || '').trim().toLowerCase();

async function getRoleName(req) {
  const direct =
    req.user?.rol_nombre ||
    req.user?.rol ||
    req.user?.role ||
    req.user?.rolName;

  if (direct) return normalizeRole(direct);

  const rolId = req.user?.rol_id;
  if (!rolId) return '';

  const r = await pool.query(`SELECT nombre FROM public.roles WHERE id = $1 LIMIT 1`, [rolId]);
  return normalizeRole(r.rows?.[0]?.nombre);
}

async function isAdmin(req) {
  const rol = await getRoleName(req);
  return rol === 'admin';
}

// GET /api/clinicas/me
const getMiClinica = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id en token/header.' });

  try {
    const q = `
      SELECT
        id, nombre, direccion, telefono, nit, email,
        logo_url, estado, plan, codigo_clinica,
        creado_en, updated_at
      FROM public.clinicas
      WHERE id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [clinicaId]);

    if (r.rowCount === 0) return res.status(404).json({ message: 'Clínica no encontrada.' });

    return res.json({ data: r.rows[0] });
  } catch (err) {
    console.error('[getMiClinica]', err);
    return res.status(500).json({ message: 'Error obteniendo clínica', error: err.message });
  }
};

// PUT /api/clinicas/me  (SOLO ADMIN)
const updateMiClinica = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id en token/header.' });

  try {
    const admin = await isAdmin(req);
    if (!admin) return res.status(403).json({ message: 'Solo el administrador puede editar la clínica.' });

    const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim() : null;
    const telefono = req.body?.telefono !== undefined ? String(req.body.telefono).trim() : null;
    const direccion = req.body?.direccion !== undefined ? String(req.body.direccion).trim() : null;
    const nit = req.body?.nit !== undefined ? String(req.body.nit).trim() : null;
    const email = req.body?.email !== undefined ? String(req.body.email).trim() : null;

    const before = await pool.query(
      `SELECT id, nombre, telefono, direccion, nit, email
       FROM public.clinicas
       WHERE id = $1
       LIMIT 1`,
      [clinicaId]
    );
    if (before.rowCount === 0) return res.status(404).json({ message: 'Clínica no encontrada.' });

    const q = `
      UPDATE public.clinicas
      SET nombre = COALESCE($1, nombre),
          telefono = COALESCE($2, telefono),
          direccion = COALESCE($3, direccion),
          nit = COALESCE($4, nit),
          email = COALESCE($5, email),
          updated_at = NOW()
      WHERE id = $6
      RETURNING id, nombre, telefono, direccion, nit, email
    `;
    const r = await pool.query(q, [nombre, telefono, direccion, nit, email, clinicaId]);

    await registrarAuditoria(req, {
      modulo: 'CLINICA',
      accion: 'EDITAR',
      entidad: 'clinicas',
      entidad_id: clinicaId,
      descripcion: `Actualizó datos de clínica id=${clinicaId}`,
      metadata: { before: before.rows[0], after: r.rows[0] },
    });

    return res.json({ message: 'Clínica actualizada', data: r.rows[0] });
  } catch (err) {
    console.error('[updateMiClinica]', err);

    try {
      await registrarAuditoria(req, {
        modulo: 'CLINICA',
        accion: 'EDITAR_ERROR',
        entidad: 'clinicas',
        entidad_id: clinicaId,
        descripcion: `Error actualizando clínica id=${clinicaId}`,
        metadata: { error: err.message },
      });
    } catch (_) {}

    return res.status(500).json({ message: 'Error actualizando clínica', error: err.message });
  }
};

module.exports = {
  getMiClinica,
  updateMiClinica,
};
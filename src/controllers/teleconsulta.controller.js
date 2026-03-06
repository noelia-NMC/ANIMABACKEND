// Backend/src/controllers/teleconsulta.controller.js       web
const pool = require('../db');

const getClinicaId = (req) => {
  const tokenClinica = req.user?.clinica_id;
  if (tokenClinica) return Number(tokenClinica);

  const headerClinica = req.headers['clinica-id'];
  if (!headerClinica) return null;
  const n = Number(headerClinica);
  return Number.isNaN(n) ? null : n;
};

// ==============================
// Crear Teleconsulta (propietario)
// ==============================
const crearTeleconsulta = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'No autenticado' });

    const { mascota_id, motivo, fecha } = req.body;

    if (!mascota_id || !motivo) {
      return res.status(400).json({ message: 'Falta mascota_id o motivo' });
    }

    let fechaFinal = new Date();
    if (fecha) {
      const d = new Date(fecha);
      if (!Number.isNaN(d.getTime())) fechaFinal = d;
    }

    const insert = await pool.query(
      `INSERT INTO public.teleconsultas (mascota_id, propietario_id, fecha, motivo, estado, created_at)
       VALUES ($1, $2, $3, $4, 'pendiente', NOW())
       RETURNING *`,
      [mascota_id, userId, fechaFinal, motivo]
    );

    return res.status(201).json(insert.rows[0]);
  } catch (e) {
    console.error('[crearTeleconsulta]', e);
    return res.status(500).json({ message: 'Error creando teleconsulta', error: e.message });
  }
};

// ==============================
// Veterinario: Mis consultas + pendientes
// ==============================
const obtenerPorVeterinario = async (req, res) => {
  try {
    const vetId = req.user?.id;
    if (!vetId) return res.status(401).json({ message: 'No autenticado' });

    const clinicaId = getClinicaId(req);

    const params = [vetId];
    let clinicaFilter = '';
    if (clinicaId) {
      params.push(clinicaId);
      clinicaFilter = `AND m.clinica_id = $${params.length}`;
    }

    const q = await pool.query(
      `SELECT t.*,
              m.nombre AS mascota_nombre,
              u.nombre AS propietario_nombre
       FROM public.teleconsultas t
       JOIN public.mascotas m ON m.id = t.mascota_id
       LEFT JOIN public.users u ON u.id = t.propietario_id
       WHERE (t.estado = 'pendiente' OR t.veterinario_id = $1)
         ${clinicaFilter}
       ORDER BY t.created_at DESC, t.id DESC`,
      params
    );

    return res.json(q.rows);
  } catch (e) {
    console.error('[obtenerPorVeterinario]', e);
    return res.status(500).json({ message: 'Error obteniendo teleconsultas (veterinario)', error: e.message });
  }
};

// ==============================
// Propietario: Mis consultas
// ==============================
const obtenerPorPropietario = async (req, res) => {
  try {
    const propietarioId = req.user?.id;
    if (!propietarioId) return res.status(401).json({ message: 'No autenticado' });

    const clinicaId = getClinicaId(req);

    const params = [propietarioId];
    let clinicaFilter = '';
    if (clinicaId) {
      params.push(clinicaId);
      clinicaFilter = `AND m.clinica_id = $${params.length}`;
    }

    const q = await pool.query(
      `SELECT t.*,
              m.nombre AS mascota_nombre
       FROM public.teleconsultas t
       JOIN public.mascotas m ON m.id = t.mascota_id
       WHERE t.propietario_id = $1
         ${clinicaFilter}
       ORDER BY t.created_at DESC, t.id DESC`,
      params
    );

    return res.json(q.rows);
  } catch (e) {
    console.error('[obtenerPorPropietario]', e);
    return res.status(500).json({ message: 'Error obteniendo teleconsultas (propietario)', error: e.message });
  }
};

// ==============================
// Aceptar Teleconsulta (veterinario)
// ==============================
const aceptarTeleconsulta = async (req, res) => {
  try {
    const vetId = req.user?.id;
    if (!vetId) return res.status(401).json({ message: 'No autenticado' });

    const { id } = req.params;
    const { meet_link } = req.body;

    const upd = await pool.query(
      `UPDATE public.teleconsultas
       SET veterinario_id = $1,
           meet_link = COALESCE($2, meet_link),
           estado = 'aceptada'
       WHERE id = $3
       RETURNING *`,
      [vetId, meet_link || null, id]
    );

    if (!upd.rows.length) return res.status(404).json({ message: 'Teleconsulta no encontrada' });

    return res.json(upd.rows[0]);
  } catch (e) {
    console.error('[aceptarTeleconsulta]', e);
    return res.status(500).json({ message: 'Error aceptando teleconsulta', error: e.message });
  }
};

// ==============================
// Finalizar Teleconsulta (veterinario)
// ==============================
const finalizarTeleconsulta = async (req, res) => {
  try {
    const vetId = req.user?.id;
    if (!vetId) return res.status(401).json({ message: 'No autenticado' });

    const { id } = req.params;

    const upd = await pool.query(
      `UPDATE public.teleconsultas
       SET estado = 'finalizada'
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (!upd.rows.length) return res.status(404).json({ message: 'Teleconsulta no encontrada' });

    return res.json(upd.rows[0]);
  } catch (e) {
    console.error('[finalizarTeleconsulta]', e);
    return res.status(500).json({ message: 'Error finalizando teleconsulta', error: e.message });
  }
};

// ==============================
// Cancelar Teleconsulta (propietario)
// ==============================
const cancelarTeleconsulta = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'No autenticado' });

    const { id } = req.params;

    const upd = await pool.query(
      `UPDATE public.teleconsultas
       SET estado = 'cancelada'
       WHERE id = $1
         AND propietario_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (!upd.rows.length) {
      return res.status(404).json({ message: 'No encontrada o no tienes permiso para cancelar' });
    }

    return res.json(upd.rows[0]);
  } catch (e) {
    console.error('[cancelarTeleconsulta]', e);
    return res.status(500).json({ message: 'Error cancelando teleconsulta', error: e.message });
  }
};

module.exports = {
  crearTeleconsulta,
  obtenerPorVeterinario,
  obtenerPorPropietario,
  aceptarTeleconsulta,
  finalizarTeleconsulta,
  cancelarTeleconsulta,
};
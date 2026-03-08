const pool = require('../db');
const { buildPerfilClinicaContext } = require('./perfilMascota.controller');

const getClinicaId = (req) => {
  const tokenClinica = req.user?.clinica_id;
  const headerClinica = req.headers['clinica-id'];
  const value = tokenClinica ?? headerClinica;
  if (!value) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
};

const normalizarEstado = (estado) => String(estado || '').trim().toLowerCase();

// ==============================
// Crear Teleconsulta (propietario móvil)
// ==============================
const crearTeleconsulta = async (req, res) => {
  try {
    const propietarioId = req.user?.id;
    if (!propietarioId) {
      return res.status(401).json({ message: 'No autenticado.' });
    }

    const { mascota_id, motivo, fecha } = req.body;

    if (!mascota_id || !String(motivo || '').trim()) {
      return res.status(400).json({ message: 'Falta mascota_id o motivo.' });
    }

    const perfilId = Number(mascota_id);
    if (Number.isNaN(perfilId)) {
      return res.status(400).json({ message: 'mascota_id inválido.' });
    }

    const contexto = await buildPerfilClinicaContext({
      perfilId,
      propietarioId,
    });

    if (contexto.error) {
      return res.status(contexto.status || 400).json({ message: contexto.error });
    }

    if (!contexto.puedeSolicitarTeleconsulta || !contexto.clinica?.id) {
      return res.status(400).json({
        message:
          contexto.mensaje ||
          'Tu mascota no está vinculada a una clínica, por lo que no puede solicitar televeterinaria.',
      });
    }

    let fechaFinal = new Date();
    if (fecha) {
      const d = new Date(fecha);
      if (!Number.isNaN(d.getTime())) fechaFinal = d;
    }

    const insert = await pool.query(
      `
        INSERT INTO public.teleconsultas
        (
          mascota_id,
          propietario_id,
          veterinario_id,
          clinica_id,
          fecha,
          meet_link,
          motivo,
          estado,
          created_at
        )
        VALUES ($1, $2, NULL, $3, $4, NULL, $5, 'pendiente', NOW())
        RETURNING *
      `,
      [perfilId, propietarioId, contexto.clinica.id, fechaFinal, String(motivo).trim()]
    );

    return res.status(201).json({
      message: 'Teleconsulta solicitada correctamente.',
      teleconsulta: insert.rows[0],
      clinica: contexto.clinica,
    });
  } catch (e) {
    console.error('[crearTeleconsulta]', e);
    return res.status(500).json({
      message: 'Error creando teleconsulta',
      error: e.message,
    });
  }
};

// ==============================
// Propietario: Mis consultas
// mascota_id aquí es de perfiles_mascotas (móvil)
// ==============================
const obtenerPorPropietario = async (req, res) => {
  try {
    const propietarioId = req.user?.id;
    if (!propietarioId) return res.status(401).json({ message: 'No autenticado' });

    const q = await pool.query(
      `
      SELECT
        t.*,
        pm.nombre AS nombre_mascota,
        c.nombre AS clinica_nombre,
        c.direccion AS clinica_direccion,
        TRIM(COALESCE(v.nombre, '') || ' ' || COALESCE(v.apellido, '')) AS veterinario_nombre
      FROM public.teleconsultas t
      JOIN public.perfiles_mascotas pm ON pm.id = t.mascota_id
      LEFT JOIN public.clinicas c ON c.id = t.clinica_id
      LEFT JOIN public.users v ON v.id = t.veterinario_id
      WHERE t.propietario_id = $1
      ORDER BY t.created_at DESC, t.id DESC
      `,
      [propietarioId]
    );

    return res.json(q.rows);
  } catch (e) {
    console.error('[obtenerPorPropietario]', e);
    return res.status(500).json({
      message: 'Error obteniendo teleconsultas (propietario)',
      error: e.message,
    });
  }
};

// ==============================
// Veterinario: ve pendientes y sus consultas de su clínica
// ==============================
const obtenerPorVeterinario = async (req, res) => {
  try {
    const vetId = req.user?.id;
    if (!vetId) return res.status(401).json({ message: 'No autenticado' });

    const clinicaId = getClinicaId(req);
    if (!clinicaId) {
      return res.status(400).json({
        message: 'Tu usuario veterinario no tiene clínica asociada.',
      });
    }

    const q = await pool.query(
      `
      SELECT
        t.*,
        pm.nombre AS nombre_mascota,
        u.email AS propietario_email,
        TRIM(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellido, '')) AS propietario_nombre,
        c.nombre AS clinica_nombre,
        c.direccion AS clinica_direccion
      FROM public.teleconsultas t
      JOIN public.perfiles_mascotas pm ON pm.id = t.mascota_id
      LEFT JOIN public.users u ON u.id = t.propietario_id
      LEFT JOIN public.clinicas c ON c.id = t.clinica_id
      WHERE t.clinica_id = $1
        AND (t.estado = 'pendiente' OR t.veterinario_id = $2)
      ORDER BY
        CASE
          WHEN t.estado = 'pendiente' THEN 0
          WHEN t.estado = 'aceptada' THEN 1
          ELSE 2
        END,
        t.created_at DESC,
        t.id DESC
      `,
      [clinicaId, vetId]
    );

    return res.json(q.rows);
  } catch (e) {
    console.error('[obtenerPorVeterinario]', e);
    return res.status(500).json({
      message: 'Error obteniendo teleconsultas (veterinario)',
      error: e.message,
    });
  }
};

// ==============================
// Aceptar Teleconsulta
// ==============================
const aceptarTeleconsulta = async (req, res) => {
  try {
    const vetId = req.user?.id;
    if (!vetId) return res.status(401).json({ message: 'No autenticado' });

    const clinicaId = getClinicaId(req);
    if (!clinicaId) {
      return res.status(400).json({ message: 'Tu usuario no tiene clínica asociada.' });
    }

    const { id } = req.params;
    const { meet_link } = req.body;

    if (!String(meet_link || '').trim()) {
      return res.status(400).json({ message: 'Debes enviar el enlace de Meet.' });
    }

    const previa = await pool.query(
      `
      SELECT id, estado, clinica_id
      FROM public.teleconsultas
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!previa.rows.length) {
      return res.status(404).json({ message: 'Teleconsulta no encontrada' });
    }

    const consulta = previa.rows[0];

    if (Number(consulta.clinica_id) !== Number(clinicaId)) {
      return res.status(403).json({
        message: 'No puedes aceptar teleconsultas de otra clínica.',
      });
    }

    if (normalizarEstado(consulta.estado) !== 'pendiente') {
      return res.status(400).json({
        message: 'Solo puedes aceptar teleconsultas pendientes.',
      });
    }

    const upd = await pool.query(
      `
      UPDATE public.teleconsultas
      SET veterinario_id = $1,
          meet_link = $2,
          estado = 'aceptada'
      WHERE id = $3
      RETURNING *
      `,
      [vetId, String(meet_link).trim(), id]
    );

    return res.json(upd.rows[0]);
  } catch (e) {
    console.error('[aceptarTeleconsulta]', e);
    return res.status(500).json({
      message: 'Error aceptando teleconsulta',
      error: e.message,
    });
  }
};

// ==============================
// Finalizar Teleconsulta
// ==============================
const finalizarTeleconsulta = async (req, res) => {
  try {
    const vetId = req.user?.id;
    if (!vetId) return res.status(401).json({ message: 'No autenticado' });

    const clinicaId = getClinicaId(req);
    if (!clinicaId) {
      return res.status(400).json({ message: 'Tu usuario no tiene clínica asociada.' });
    }

    const { id } = req.params;

    const previa = await pool.query(
      `
      SELECT id, estado, clinica_id, veterinario_id
      FROM public.teleconsultas
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!previa.rows.length) {
      return res.status(404).json({ message: 'Teleconsulta no encontrada' });
    }

    const consulta = previa.rows[0];

    if (Number(consulta.clinica_id) !== Number(clinicaId)) {
      return res.status(403).json({
        message: 'No puedes finalizar teleconsultas de otra clínica.',
      });
    }

    if (Number(consulta.veterinario_id) !== Number(vetId)) {
      return res.status(403).json({
        message: 'Solo el veterinario asignado puede finalizar esta consulta.',
      });
    }

    if (normalizarEstado(consulta.estado) !== 'aceptada') {
      return res.status(400).json({
        message: 'Solo puedes finalizar teleconsultas aceptadas.',
      });
    }

    const upd = await pool.query(
      `
      UPDATE public.teleconsultas
      SET estado = 'finalizada'
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    return res.json(upd.rows[0]);
  } catch (e) {
    console.error('[finalizarTeleconsulta]', e);
    return res.status(500).json({
      message: 'Error finalizando teleconsulta',
      error: e.message,
    });
  }
};

// ==============================
// Cancelar Teleconsulta
// ==============================
const cancelarTeleconsulta = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'No autenticado' });

    const { id } = req.params;

    const previa = await pool.query(
      `
      SELECT id, estado, propietario_id
      FROM public.teleconsultas
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!previa.rows.length) {
      return res.status(404).json({ message: 'No encontrada' });
    }

    const consulta = previa.rows[0];

    if (Number(consulta.propietario_id) !== Number(userId)) {
      return res.status(403).json({
        message: 'No tienes permiso para cancelar esta teleconsulta.',
      });
    }

    if (normalizarEstado(consulta.estado) !== 'pendiente') {
      return res.status(400).json({
        message: 'Solo puedes cancelar teleconsultas pendientes.',
      });
    }

    const upd = await pool.query(
      `
      UPDATE public.teleconsultas
      SET estado = 'cancelada'
      WHERE id = $1 AND propietario_id = $2
      RETURNING *
      `,
      [id, userId]
    );

    if (!upd.rows.length) {
      return res.status(404).json({
        message: 'No encontrada o no tienes permiso para cancelar',
      });
    }

    return res.json(upd.rows[0]);
  } catch (e) {
    console.error('[cancelarTeleconsulta]', e);
    return res.status(500).json({
      message: 'Error cancelando teleconsulta',
      error: e.message,
    });
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
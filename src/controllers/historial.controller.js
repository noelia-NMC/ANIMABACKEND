// Backend/src/controllers/historial.controller.js   web
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

// helper clinica_id
function getClinicaId(req) {
  const fromToken = req.user?.clinica_id;
  const fromHeader = req.headers['clinica-id'];
  const id = fromToken || fromHeader;
  const n = Number(id);
  return Number.isNaN(n) ? null : n;
}

// auditoría safe (para no tumbar endpoint si falla)
const safeAudit = async (req, payload) => {
  try {
    await registrarAuditoria(req, payload);
  } catch (e) {
    console.warn('[AUDITORIA_FAIL]', e?.message);
  }
};

const getHistorial = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  try {
    const result = await pool.query(
      `
      SELECT hc.*, m.nombre AS nombre_mascota
      FROM historial_clinico hc
      JOIN mascotas m ON hc.mascota_id = m.id
      WHERE hc.clinica_id = $1
      ORDER BY hc.fecha DESC
      `,
      [clinicaId]
    );

    // (Opcional) auditoría de consulta: normalmente NO se audita lectura
    // para no llenar la bitácora. Si quieres activarlo, descomenta:
    /*
    await safeAudit(req, {
      modulo: 'HISTORIAL',
      accion: 'CONSULTAR',
      entidad: 'historial_clinico',
      entidad_id: null,
      descripcion: 'Consultó historial clínico',
      metadata: { count: result.rows?.length || 0 },
    });
    */

    res.json(result.rows);
  } catch (err) {
    console.error('[getHistorial]', err);
    res.status(500).json({ error: err.message });
  }
};

const createHistorial = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  const { mascota_id, diagnostico, tratamiento, observaciones } = req.body;
  if (!mascota_id || !diagnostico) {
    return res.status(400).json({ message: 'mascota_id y diagnostico son obligatorios.' });
  }

  try {
    const insert = await pool.query(
      `
      INSERT INTO historial_clinico (mascota_id, diagnostico, tratamiento, observaciones, clinica_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [mascota_id, diagnostico, tratamiento || null, observaciones || null, clinicaId]
    );

    const row = insert.rows[0];

    await safeAudit(req, {
      modulo: 'HISTORIAL',
      accion: 'CREAR',
      entidad: 'historial_clinico',
      entidad_id: row?.id,
      descripcion: `Registró historial clínico para mascota_id=${mascota_id}`,
      metadata: {
        mascota_id,
        diagnostico,
        tratamiento: tratamiento || null,
        observaciones: observaciones || null,
        fecha: row?.fecha || null,
      },
    });

    res.status(201).json({ message: 'Historial registrado', data: row });
  } catch (err) {
    console.error('[createHistorial]', err);
    res.status(500).json({ error: err.message });
  }
};

const updateHistorial = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  const { id } = req.params;
  const { mascota_id, diagnostico, tratamiento, observaciones } = req.body;

  try {
    // traer registro antes (para auditoría)
    const current = await pool.query(
      `SELECT * FROM historial_clinico WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: 'Historial no encontrado' });

    const before = current.rows[0];

    const result = await pool.query(
      `
      UPDATE historial_clinico
      SET mascota_id = COALESCE($1, mascota_id),
          diagnostico = COALESCE($2, diagnostico),
          tratamiento = COALESCE($3, tratamiento),
          observaciones = COALESCE($4, observaciones)
      WHERE id = $5 AND clinica_id = $6
      RETURNING *
      `,
      [mascota_id || null, diagnostico || null, tratamiento || null, observaciones || null, id, clinicaId]
    );

    const after = result.rows[0];

    await safeAudit(req, {
      modulo: 'HISTORIAL',
      accion: 'ACTUALIZAR',
      entidad: 'historial_clinico',
      entidad_id: id,
      descripcion: `Actualizó historial clínico id=${id}`,
      metadata: {
        before: {
          mascota_id: before.mascota_id,
          diagnostico: before.diagnostico,
          tratamiento: before.tratamiento,
          observaciones: before.observaciones,
          fecha: before.fecha,
        },
        after: {
          mascota_id: after.mascota_id,
          diagnostico: after.diagnostico,
          tratamiento: after.tratamiento,
          observaciones: after.observaciones,
          fecha: after.fecha,
        },
      },
    });

    res.json({ message: 'Historial actualizado', data: after });
  } catch (err) {
    console.error('[updateHistorial]', err);
    res.status(500).json({ error: err.message });
  }
};

const deleteHistorial = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  const { id } = req.params;

  try {
    // traer registro antes (para auditoría)
    const current = await pool.query(
      `SELECT * FROM historial_clinico WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    if (current.rowCount === 0) return res.status(404).json({ error: 'Historial no encontrado' });

    const before = current.rows[0];

    const result = await pool.query(
      `DELETE FROM historial_clinico WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Historial no encontrado' });

    await safeAudit(req, {
      modulo: 'HISTORIAL',
      accion: 'ELIMINAR',
      entidad: 'historial_clinico',
      entidad_id: id,
      descripcion: `Eliminó historial clínico id=${id} (mascota_id=${before.mascota_id})`,
      metadata: {
        mascota_id: before.mascota_id,
        diagnostico: before.diagnostico,
        tratamiento: before.tratamiento,
        observaciones: before.observaciones,
        fecha: before.fecha,
      },
    });

    res.json({ message: 'Historial eliminado' });
  } catch (err) {
    console.error('[deleteHistorial]', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getHistorial,
  createHistorial,
  updateHistorial,
  deleteHistorial,
};
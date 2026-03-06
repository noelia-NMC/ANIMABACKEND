// Backend/src/controllers/turnos.controller.js   web
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

const getClinicaId = (req) => req.user?.clinica_id ?? req.headers['clinica-id'] ?? null;

const getTurnos = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica_id en headers' });

  try {
    const result = await pool.query(
      `SELECT t.*, m.nombre AS nombre_mascota, v.nombre AS nombre_veterinario
       FROM public.turnos t
       JOIN public.mascotas m ON t.mascota_id = m.id
       LEFT JOIN public.veterinarios v ON t.veterinario_id = v.id
       WHERE t.clinica_id = $1
       ORDER BY t.fecha, t.hora`,
      [clinicaId]
    );

    return res.json(result.rows);
  } catch (err) {
    await registrarAuditoria(req, {
      modulo: 'TURNOS',
      accion: 'VER_ERROR',
      entidad: 'turno',
      entidad_id: `clinica:${clinicaId}`,
      descripcion: 'Error obteniendo turnos',
      metadata: { clinica_id: clinicaId, error: err.message },
    });

    return res.status(500).json({ error: err.message });
  }
};

const createTurno = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { mascota_id, veterinario_id, fecha, hora, motivo } = req.body;

  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica_id en headers' });
  if (!mascota_id || !fecha || !hora) {
    await registrarAuditoria(req, {
      modulo: 'TURNOS',
      accion: 'CREAR_FAIL',
      entidad: 'turno',
      entidad_id: mascota_id || 'sin_mascota',
      descripcion: 'Crear turno fallido: faltan datos',
      metadata: { body: req.body },
    });
    return res.status(400).json({ error: 'Faltan datos obligatorios (mascota_id, fecha, hora).' });
  }

  try {
    if (veterinario_id) {
      const check = await pool.query(
        `SELECT id FROM public.turnos
         WHERE veterinario_id = $1 AND fecha = $2 AND hora = $3 AND clinica_id = $4
         LIMIT 1`,
        [veterinario_id, fecha, hora, clinicaId]
      );

      if (check.rows.length > 0) {
        await registrarAuditoria(req, {
          modulo: 'TURNOS',
          accion: 'CREAR_FAIL',
          entidad: 'turno',
          entidad_id: check.rows[0].id,
          descripcion: 'Conflicto: ya existe turno para ese veterinario/hora',
          metadata: { clinica_id: clinicaId, veterinario_id, fecha, hora },
        });
        return res.status(409).json({ error: 'Ya existe un turno para ese veterinario en ese horario.' });
      }
    }

    const insert = await pool.query(
      `INSERT INTO public.turnos (mascota_id, veterinario_id, fecha, hora, motivo, clinica_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [mascota_id, veterinario_id || null, fecha, hora, motivo || null, clinicaId]
    );

    const creado = insert.rows[0];

    await registrarAuditoria(req, {
      modulo: 'TURNOS',
      accion: 'CREAR',
      entidad: 'turno',
      entidad_id: creado.id,
      descripcion: `Creó turno para mascota_id=${mascota_id} en ${fecha} ${hora}`,
      metadata: { after: creado },
    });

    return res.status(201).json({ message: 'Turno agendado correctamente', data: creado });
  } catch (err) {
    await registrarAuditoria(req, {
      modulo: 'TURNOS',
      accion: 'CREAR_ERROR',
      entidad: 'turno',
      entidad_id: mascota_id || 'sin_mascota',
      descripcion: 'Error creando turno',
      metadata: { clinica_id: clinicaId, body: req.body, error: err.message },
    });

    return res.status(500).json({ error: err.message });
  }
};

const updateTurno = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { id } = req.params;
  const { mascota_id, veterinario_id, fecha, hora, motivo } = req.body;

  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica_id en headers' });

  try {
    const beforeRes = await pool.query(
      `SELECT * FROM public.turnos WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    const before = beforeRes.rows?.[0] || null;
    if (!before) return res.status(404).json({ error: 'Turno no encontrado.' });

    const vetFinal = veterinario_id ?? before.veterinario_id;
    const fechaFinal = fecha ?? before.fecha;
    const horaFinal = hora ?? before.hora;

    if (vetFinal) {
      const check = await pool.query(
        `SELECT id FROM public.turnos
         WHERE veterinario_id = $1 AND fecha = $2 AND hora = $3 AND clinica_id = $4
           AND id <> $5
         LIMIT 1`,
        [vetFinal, fechaFinal, horaFinal, clinicaId, id]
      );
      if (check.rowCount > 0) {
        await registrarAuditoria(req, {
          modulo: 'TURNOS',
          accion: 'EDITAR_FAIL',
          entidad: 'turno',
          entidad_id: id,
          descripcion: 'Conflicto: ya existe turno en ese horario',
          metadata: { clinica_id: clinicaId, conflicto_id: check.rows[0].id, vetFinal, fechaFinal, horaFinal },
        });
        return res.status(409).json({ error: 'Ya existe un turno para ese veterinario en ese horario.' });
      }
    }

    const upd = await pool.query(
      `UPDATE public.turnos
       SET mascota_id = COALESCE($1, mascota_id),
           veterinario_id = COALESCE($2, veterinario_id),
           fecha = COALESCE($3, fecha),
           hora = COALESCE($4, hora),
           motivo = COALESCE($5, motivo)
       WHERE id = $6 AND clinica_id = $7
       RETURNING *`,
      [mascota_id || null, veterinario_id || null, fecha || null, hora || null, motivo || null, id, clinicaId]
    );

    const after = upd.rows[0];

    await registrarAuditoria(req, {
      modulo: 'TURNOS',
      accion: 'EDITAR',
      entidad: 'turno',
      entidad_id: id,
      descripcion: `Actualizó turno id=${id}`,
      metadata: { before, after },
    });

    return res.json({ message: 'Turno actualizado correctamente', data: after });
  } catch (err) {
    await registrarAuditoria(req, {
      modulo: 'TURNOS',
      accion: 'EDITAR_ERROR',
      entidad: 'turno',
      entidad_id: id,
      descripcion: `Error actualizando turno id=${id}`,
      metadata: { clinica_id: clinicaId, body: req.body, error: err.message },
    });

    return res.status(500).json({ error: err.message });
  }
};

const deleteTurno = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { id } = req.params;

  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica_id en headers' });

  try {
    const beforeRes = await pool.query(
      `SELECT * FROM public.turnos WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    const before = beforeRes.rows?.[0] || null;
    if (!before) return res.status(404).json({ error: 'Turno no encontrado.' });

    await pool.query('DELETE FROM public.turnos WHERE id = $1 AND clinica_id = $2', [id, clinicaId]);

    await registrarAuditoria(req, {
      modulo: 'TURNOS',
      accion: 'ELIMINAR',
      entidad: 'turno',
      entidad_id: id,
      descripcion: `Eliminó turno id=${id}`,
      metadata: { before },
    });

    return res.json({ message: 'Turno eliminado correctamente' });
  } catch (err) {
    await registrarAuditoria(req, {
      modulo: 'TURNOS',
      accion: 'ELIMINAR_ERROR',
      entidad: 'turno',
      entidad_id: id,
      descripcion: `Error eliminando turno id=${id}`,
      metadata: { clinica_id: clinicaId, error: err.message },
    });

    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getTurnos,
  createTurno,
  updateTurno,
  deleteTurno,
};
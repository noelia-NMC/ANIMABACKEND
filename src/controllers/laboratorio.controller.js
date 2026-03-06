// Backend/src/controllers/laboratorio.controller.js    web
const pool = require('../db');
const cloudinary = require('../config/cloudinary');
const { registrarAuditoria } = require('../utils/auditoria');

// helper para clinica_id (tu sistema ya manda header clinica-id)
const getClinicaId = (req) => {
  // si más adelante metes clinica_id dentro del token, esto lo agarra:
  const fromToken = req.user?.clinica_id;
  const fromHeader = req.headers['clinica-id'];
  return fromToken || fromHeader;
};

// auditoría safe (para no tumbar endpoint si falla)
const safeAudit = async (req, payload) => {
  try {
    await registrarAuditoria(req, payload);
  } catch (e) {
    console.warn('[AUDITORIA_FAIL]', e?.message);
  }
};

const uploadToCloudinary = (buffer, mimetype, folder = 'anima/laboratorio') => {
  return new Promise((resolve, reject) => {
    const resourceType = mimetype === 'application/pdf' ? 'raw' : 'image';

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
};

const getResultados = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { mascota_id } = req.query;

  if (!clinicaId) return res.status(400).json({ message: 'clinica-id requerido' });

  try {
    const params = [clinicaId];
    let where = 'WHERE lr.clinica_id = $1';

    if (mascota_id) {
      params.push(mascota_id);
      where += ` AND lr.mascota_id = $${params.length}`;
    }

    const result = await pool.query(
      `
      SELECT lr.*,
             m.nombre AS nombre_mascota
      FROM public.laboratorio_resultados lr
      JOIN public.mascotas m ON m.id = lr.mascota_id
      ${where}
      ORDER BY lr.fecha DESC, lr.id DESC
      `,
      params
    );

    // (Opcional) auditoría de consulta: normalmente NO se audita lectura para no llenar bitácora.
    // Si igual quieres, descomenta esto:
    /*
    await safeAudit(req, {
      modulo: 'LABORATORIO',
      accion: 'CONSULTAR',
      entidad: 'laboratorio_resultados',
      entidad_id: mascota_id ? String(mascota_id) : null,
      descripcion: mascota_id
        ? `Consultó resultados de laboratorio por mascota_id=${mascota_id}`
        : 'Consultó resultados de laboratorio',
      metadata: { mascota_id: mascota_id || null, count: result.rows?.length || 0 },
    });
    */

    return res.json(result.rows);
  } catch (err) {
    console.error('getResultados error:', err);
    return res.status(500).json({ message: 'Error al obtener resultados', error: err.message });
  }
};

const createResultado = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'clinica-id requerido' });

  const { mascota_id, tipo_examen, fecha, notas } = req.body;

  if (!mascota_id || !tipo_examen) {
    return res.status(400).json({ message: 'mascota_id y tipo_examen son obligatorios' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'Debes subir un archivo (PDF o imagen).' });
  }

  try {
    // Subir a Cloudinary
    const up = await uploadToCloudinary(req.file.buffer, req.file.mimetype);

    const createdBy = req.user?.id || null;

    const insert = await pool.query(
      `
      INSERT INTO public.laboratorio_resultados
        (clinica_id, mascota_id, tipo_examen, fecha, notas, archivo_url, archivo_public_id, creado_por)
      VALUES
        ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8)
      RETURNING *
      `,
      [
        clinicaId,
        mascota_id,
        tipo_examen,
        fecha || null,
        notas || null,
        up.secure_url,
        up.public_id || null,
        createdBy,
      ]
    );

    const row = insert.rows[0];

    await safeAudit(req, {
      modulo: 'LABORATORIO',
      accion: 'CREAR',
      entidad: 'laboratorio_resultados',
      entidad_id: row?.id,
      descripcion: `Creó resultado de laboratorio (${tipo_examen}) para mascota_id=${mascota_id}`,
      metadata: {
        mascota_id,
        tipo_examen,
        fecha: row?.fecha || fecha || null,
        archivo_url: row?.archivo_url || up.secure_url,
        archivo_public_id: row?.archivo_public_id || up.public_id || null,
      },
    });

    return res.status(201).json(row);
  } catch (err) {
    console.error('createResultado error:', err);
    return res.status(500).json({ message: 'Error al crear resultado', error: err.message });
  }
};

const updateResultado = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { id } = req.params;
  if (!clinicaId) return res.status(400).json({ message: 'clinica-id requerido' });

  const { mascota_id, tipo_examen, fecha, notas } = req.body;

  try {
    // obtener registro actual (validando clinica)
    const current = await pool.query(
      `SELECT * FROM public.laboratorio_resultados WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    if (current.rowCount === 0) return res.status(404).json({ message: 'Resultado no encontrado' });

    const before = current.rows[0];

    let archivo_url = before.archivo_url;
    let archivo_public_id = before.archivo_public_id;

    let archivoReemplazado = false;

    // si llega archivo nuevo, reemplazamos (y eliminamos el anterior si existe)
    if (req.file) {
      archivoReemplazado = true;

      try {
        if (archivo_public_id) {
          // OJO: resource_type depende, probamos ambos sin romper
          await cloudinary.uploader.destroy(archivo_public_id, { resource_type: 'raw' }).catch(() => null);
          await cloudinary.uploader.destroy(archivo_public_id, { resource_type: 'image' }).catch(() => null);
        }
      } catch (_) {}

      const up = await uploadToCloudinary(req.file.buffer, req.file.mimetype);
      archivo_url = up.secure_url;
      archivo_public_id = up.public_id || null;
    }

    const upd = await pool.query(
      `
      UPDATE public.laboratorio_resultados
      SET mascota_id = COALESCE($1, mascota_id),
          tipo_examen = COALESCE($2, tipo_examen),
          fecha = COALESCE($3::date, fecha),
          notas = $4,
          archivo_url = $5,
          archivo_public_id = $6
      WHERE id = $7 AND clinica_id = $8
      RETURNING *
      `,
      [
        mascota_id || null,
        tipo_examen || null,
        fecha || null,
        notas ?? null,
        archivo_url,
        archivo_public_id,
        id,
        clinicaId,
      ]
    );

    const after = upd.rows[0];

    await safeAudit(req, {
      modulo: 'LABORATORIO',
      accion: 'ACTUALIZAR',
      entidad: 'laboratorio_resultados',
      entidad_id: id,
      descripcion: `Actualizó resultado de laboratorio id=${id}`,
      metadata: {
        before: {
          mascota_id: before.mascota_id,
          tipo_examen: before.tipo_examen,
          fecha: before.fecha,
          notas: before.notas,
          archivo_url: before.archivo_url,
          archivo_public_id: before.archivo_public_id,
        },
        after: {
          mascota_id: after.mascota_id,
          tipo_examen: after.tipo_examen,
          fecha: after.fecha,
          notas: after.notas,
          archivo_url: after.archivo_url,
          archivo_public_id: after.archivo_public_id,
        },
        archivoReemplazado,
      },
    });

    return res.json(after);
  } catch (err) {
    console.error('updateResultado error:', err);
    return res.status(500).json({ message: 'Error al actualizar resultado', error: err.message });
  }
};

const deleteResultado = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { id } = req.params;
  if (!clinicaId) return res.status(400).json({ message: 'clinica-id requerido' });

  try {
    const current = await pool.query(
      `SELECT * FROM public.laboratorio_resultados WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    if (current.rowCount === 0) return res.status(404).json({ message: 'Resultado no encontrado' });

    const before = current.rows[0];
    const { archivo_public_id } = before;

    await pool.query(`DELETE FROM public.laboratorio_resultados WHERE id = $1 AND clinica_id = $2`, [
      id,
      clinicaId,
    ]);

    // borrar de cloudinary (no importa si falla)
    if (archivo_public_id) {
      await cloudinary.uploader.destroy(archivo_public_id, { resource_type: 'raw' }).catch(() => null);
      await cloudinary.uploader.destroy(archivo_public_id, { resource_type: 'image' }).catch(() => null);
    }

    await safeAudit(req, {
      modulo: 'LABORATORIO',
      accion: 'ELIMINAR',
      entidad: 'laboratorio_resultados',
      entidad_id: id,
      descripcion: `Eliminó resultado de laboratorio id=${id} (mascota_id=${before.mascota_id})`,
      metadata: {
        mascota_id: before.mascota_id,
        tipo_examen: before.tipo_examen,
        fecha: before.fecha,
        archivo_public_id: before.archivo_public_id,
        archivo_url: before.archivo_url,
      },
    });

    return res.json({ message: 'Resultado eliminado' });
  } catch (err) {
    console.error('deleteResultado error:', err);
    return res.status(500).json({ message: 'Error al eliminar resultado', error: err.message });
  }
};

module.exports = {
  getResultados,
  createResultado,
  updateResultado,
  deleteResultado,
};
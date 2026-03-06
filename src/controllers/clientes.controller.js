// Backend/src/controllers/clientes.controller.js      web 
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

// Helper: clinica_id desde token (preferido) o header (fallback)
function getClinicaId(req) {
  const tokenClinica = req.user?.clinica_id;
  if (tokenClinica) return Number(tokenClinica);

  const clinicaId = req.headers['clinica-id'];
  if (!clinicaId) return null;

  const n = Number(clinicaId);
  return Number.isNaN(n) ? null : n;
}

// Helper: normalizar strings opcionales
function normStr(v) {
  if (v === undefined) return undefined; // significa: no tocar en update
  if (v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// [GET] Lista clientes por clínica
const getClientes = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) {
    return res.status(400).json({ message: 'Falta clinica-id en headers (o clinica_id en token).' });
  }

  try {
    const result = await pool.query(
      `SELECT id, clinica_id, tipo_cliente, nombre, telefono, ci, email, creado_en, updated_at
       FROM public.clientes
       WHERE clinica_id = $1
       ORDER BY creado_en DESC`,
      [clinicaId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getClientes:', err.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// [POST] Crear cliente
const createCliente = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) {
    return res.status(400).json({ message: 'Falta clinica-id en headers (o clinica_id en token).' });
  }

  const {
    tipo_cliente = 'OCASIONAL',
    nombre,
    telefono,
    ci,
    email,
  } = req.body;

  const nombreNorm = normStr(nombre);
  if (!nombreNorm || nombreNorm.length < 2) {
    return res.status(400).json({ message: 'Nombre obligatorio (mín 2 caracteres).' });
  }

  const tipo = String(tipo_cliente || '').toUpperCase();
  if (!['FIJO', 'OCASIONAL'].includes(tipo)) {
    return res.status(400).json({ message: 'tipo_cliente inválido. Use FIJO u OCASIONAL.' });
  }

  const telefonoNorm = normStr(telefono);
  const ciNorm = normStr(ci);
  const emailNorm = normStr(email);

  // validación simple de email si vino
  if (emailNorm && !emailNorm.includes('@')) {
    return res.status(400).json({ message: 'Email inválido.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO public.clientes (clinica_id, tipo_cliente, nombre, telefono, ci, email, creado_en, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [clinicaId, tipo, nombreNorm, telefonoNorm, ciNorm, emailNorm]
    );

    const creado = result.rows[0];

    await registrarAuditoria(req, {
      modulo: 'CLIENTES',
      accion: 'CREAR',
      entidad: 'cliente',
      entidad_id: creado.id,
      descripcion: `Creó cliente (${tipo}): ${creado.nombre}`,
      metadata: { after: creado },
    });

    res.status(201).json(creado);
  } catch (err) {
    console.error('Error createCliente:', err.message);

    await registrarAuditoria(req, {
      modulo: 'CLIENTES',
      accion: 'CREAR_ERROR',
      entidad: 'cliente',
      entidad_id: nombreNorm || 'sin_nombre',
      descripcion: `Error creando cliente: ${nombreNorm || ''}`,
      metadata: { body: req.body, error: err.message },
    });

    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// [PUT] Editar cliente
const updateCliente = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) {
    return res.status(400).json({ message: 'Falta clinica-id en headers (o clinica_id en token).' });
  }

  const { id } = req.params;
  const { tipo_cliente, nombre, telefono, ci, email } = req.body;

  const tipo = tipo_cliente !== undefined ? String(tipo_cliente || '').toUpperCase() : undefined;
  if (tipo !== undefined && !['FIJO', 'OCASIONAL'].includes(tipo)) {
    return res.status(400).json({ message: 'tipo_cliente inválido. Use FIJO u OCASIONAL.' });
  }

  const nombreNorm = normStr(nombre);
  if (nombreNorm !== undefined && (!nombreNorm || nombreNorm.length < 2)) {
    return res.status(400).json({ message: 'Nombre mínimo 2 caracteres.' });
  }

  const telefonoNorm = normStr(telefono);
  const ciNorm = normStr(ci);
  const emailNorm = normStr(email);

  if (emailNorm !== undefined && emailNorm !== null && !String(emailNorm).includes('@')) {
    return res.status(400).json({ message: 'Email inválido.' });
  }

  try {
    const beforeRes = await pool.query(
      `SELECT * FROM public.clientes WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    const before = beforeRes.rows?.[0] || null;

    if (!before) {
      return res.status(404).json({ message: 'Cliente no encontrado (o no pertenece a esta clínica).' });
    }

    // ✅ UPDATE que NO pisa con null si no mandas el campo
    const result = await pool.query(
      `UPDATE public.clientes
       SET
         tipo_cliente = COALESCE($1, tipo_cliente),
         nombre       = COALESCE($2, nombre),
         telefono     = COALESCE($3, telefono),
         ci           = COALESCE($4, ci),
         email        = COALESCE($5, email),
         updated_at   = NOW()
       WHERE id = $6 AND clinica_id = $7
       RETURNING *`,
      [
        tipo === undefined ? null : tipo,
        nombreNorm === undefined ? null : nombreNorm,
        telefonoNorm === undefined ? null : telefonoNorm,
        ciNorm === undefined ? null : ciNorm,
        emailNorm === undefined ? null : emailNorm,
        id,
        clinicaId,
      ]
    );

    const after = result.rows[0];

    await registrarAuditoria(req, {
      modulo: 'CLIENTES',
      accion: 'EDITAR',
      entidad: 'cliente',
      entidad_id: after.id,
      descripcion: `Editó cliente: ${after.nombre}`,
      metadata: { before, after },
    });

    res.json(after);
  } catch (err) {
    console.error('Error updateCliente:', err.message);

    await registrarAuditoria(req, {
      modulo: 'CLIENTES',
      accion: 'EDITAR_ERROR',
      entidad: 'cliente',
      entidad_id: id,
      descripcion: `Error editando cliente id=${id}`,
      metadata: { body: req.body, error: err.message },
    });

    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ✅ [DELETE] Eliminar cliente (DELETE REAL)
const deleteCliente = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) {
    return res.status(400).json({ message: 'Falta clinica-id en headers (o clinica_id en token).' });
  }

  const { id } = req.params;

  try {
    const beforeRes = await pool.query(
      `SELECT * FROM public.clientes WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    const before = beforeRes.rows?.[0] || null;

    if (!before) {
      return res.status(404).json({ message: 'Cliente no encontrado (o no pertenece a esta clínica).' });
    }

    const delRes = await pool.query(
      `DELETE FROM public.clientes
       WHERE id = $1 AND clinica_id = $2
       RETURNING id, nombre`,
      [id, clinicaId]
    );

    await registrarAuditoria(req, {
      modulo: 'CLIENTES',
      accion: 'ELIMINAR',
      entidad: 'cliente',
      entidad_id: id,
      descripcion: `Eliminó cliente: ${delRes.rows[0]?.nombre || id}`,
      metadata: { before },
    });

    // 204 recomendado para delete
    return res.status(204).send();
  } catch (err) {
    console.error('Error deleteCliente:', err.message);

    await registrarAuditoria(req, {
      modulo: 'CLIENTES',
      accion: 'ELIMINAR_ERROR',
      entidad: 'cliente',
      entidad_id: id,
      descripcion: `Error eliminando cliente id=${id}`,
      metadata: { error: err.message },
    });

    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  getClientes,
  createCliente,
  updateCliente,
  deleteCliente,
};
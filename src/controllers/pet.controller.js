// backend/src/controllers/pet.controller.js (SOLO WEB)
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

// helper clinica_id (token primero, luego header)
function getClinicaId(req) {
  const fromToken = req.user?.clinica_id;
  const fromHeader = req.headers['clinica-id'];
  const v = fromToken ?? fromHeader;
  if (!v) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// helper: normaliza collar_id
function normalizeCollarId(raw) {
  const s = (raw ?? '').toString().trim();
  return s.length ? s : null;
}

// helper: formato del collar (si quieres estricto)
function isValidCollarFormat(collarId) {
  return /^ANIMA-[A-Z0-9]{6}$/i.test(collarId);
}

// helper: crea o reutiliza cliente OCASIONAL por nombre (en la misma clínica)
async function ensureClienteOcasional({ clinicaId, nombre, telefono = null }) {
  const cleanName = String(nombre || '').trim();
  if (!cleanName) return null;

  const found = await pool.query(
    `SELECT id FROM public.clientes
     WHERE clinica_id = $1 AND lower(nombre) = lower($2)
     ORDER BY creado_en DESC
     LIMIT 1`,
    [clinicaId, cleanName]
  );
  if (found.rowCount > 0) return found.rows[0].id;

  const created = await pool.query(
    `INSERT INTO public.clientes (clinica_id, tipo_cliente, nombre, telefono, estado, creado_en, updated_at)
     VALUES ($1, 'OCASIONAL', $2, $3, TRUE, NOW(), NOW())
     RETURNING id`,
    [clinicaId, cleanName, telefono]
  );
  return created.rows[0].id;
}

// helper: verifica cliente y devuelve tipo
async function getClienteInfo({ clinicaId, clienteId }) {
  const r = await pool.query(
    `SELECT id, tipo_cliente, nombre, telefono
     FROM public.clientes
     WHERE id = $1 AND clinica_id = $2`,
    [clienteId, clinicaId]
  );
  return r.rowCount ? r.rows[0] : null;
}

// helper: valida collar global (mascotas + perfiles_mascotas)
async function checkCollarDisponibleGlobal({ collarId, mascotaIdToIgnore = null }) {
  if (!collarId) return { ok: true };

  const q1 = await pool.query(
    `SELECT id FROM public.mascotas
     WHERE collar_id = $1
     AND ($2::int IS NULL OR id <> $2)
     LIMIT 1`,
    [collarId, mascotaIdToIgnore]
  );
  if (q1.rowCount > 0) return { ok: false };

  const q2 = await pool.query(
    `SELECT id FROM public.perfiles_mascotas
     WHERE collar_id = $1
     LIMIT 1`,
    [collarId]
  );
  if (q2.rowCount > 0) return { ok: false };

  return { ok: true };
}

// ===================================================================
// WEB (CLÍNICA)
// ===================================================================

// [GET] mascotas por clínica (con join clientes)
const getMascotas = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica-id en headers (o clinica_id en token)' });

  try {
    const result = await pool.query(
      `SELECT 
         m.*,
         c.nombre AS propietario_nombre,
         c.telefono AS propietario_telefono,
         c.tipo_cliente
       FROM public.mascotas m
       LEFT JOIN public.clientes c ON c.id = m.cliente_id
       WHERE m.clinica_id = $1
       ORDER BY m.creado_en DESC`,
      [clinicaId]
    );

    // Normalmente no auditamos lecturas masivas (ruido), pero si quieres, descomenta:
    // await registrarAuditoria(req, {
    //   modulo: 'MASCOTAS',
    //   accion: 'VER',
    //   entidad: 'mascota',
    //   entidad_id: `clinica:${clinicaId}`,
    //   descripcion: `Consultó mascotas (total: ${result.rows.length})`,
    //   metadata: { clinica_id: clinicaId, total: result.rows.length },
    // });

    res.json(result.rows);
  } catch (err) {
    console.error('Error getMascotas web:', err.message);

    await registrarAuditoria(req, {
      modulo: 'MASCOTAS',
      accion: 'VER_ERROR',
      entidad: 'mascota',
      entidad_id: `clinica:${clinicaId}`,
      descripcion: 'Error consultando mascotas',
      metadata: { clinica_id: clinicaId, error: err.message },
    });

    res.status(500).json({ error: err.message });
  }
};

// [POST] crear mascota web
const createMascota = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica-id en headers (o clinica_id en token)' });

  const {
    nombre,
    especie,
    raza,
    edad,
    genero,
    cliente_id,
    propietario, // compat vieja (texto)
    propietario_telefono,
    collar_id,
  } = req.body;

  if (!nombre || String(nombre).trim().length < 2) {
    return res.status(400).json({ error: 'Nombre es obligatorio (mín. 2 caracteres).' });
  }

  try {
    // 1) resolver cliente
    let clienteIdFinal = cliente_id ? Number(cliente_id) : null;

    let clienteCreadoAutomatico = false;

    if (!clienteIdFinal) {
      if (!propietario || String(propietario).trim().length < 2) {
        return res.status(400).json({ error: 'Propietario (nombre) es obligatorio si no envías cliente_id.' });
      }
      const beforeClienteId = clienteIdFinal;
      clienteIdFinal = await ensureClienteOcasional({
        clinicaId,
        nombre: propietario,
        telefono: propietario_telefono || null,
      });
      clienteCreadoAutomatico = !!clienteIdFinal && !beforeClienteId;
    }

    const clienteInfo = await getClienteInfo({ clinicaId, clienteId: clienteIdFinal });
    if (!clienteInfo) return res.status(400).json({ error: 'cliente_id inválido para esta clínica.' });

    // 2) collar rules
    const collarIdFinal = normalizeCollarId(collar_id);

    if (collarIdFinal) {
      if (String(clienteInfo.tipo_cliente || '').toUpperCase() !== 'FIJO') {
        return res.status(400).json({ error: 'Solo un CLIENTE FIJO puede registrar ID de collar.' });
      }

      if (!isValidCollarFormat(collarIdFinal)) {
        return res.status(400).json({ error: 'Formato de collar inválido. Ej: ANIMA-ABC123' });
      }

      const chk = await checkCollarDisponibleGlobal({ collarId: collarIdFinal });
      if (!chk.ok) {
        return res.status(409).json({ error: 'El ID de collar ya está registrado por otra mascota.' });
      }
    }

    const insert = await pool.query(
      `INSERT INTO public.mascotas
        (nombre, especie, raza, edad, genero, clinica_id, cliente_id, collar_id, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [
        String(nombre).trim(),
        especie || null,
        raza || null,
        edad || null,
        genero || null,
        clinicaId,
        clienteIdFinal,
        collarIdFinal,
      ]
    );

    const creado = insert.rows[0];

    await registrarAuditoria(req, {
      modulo: 'MASCOTAS',
      accion: 'CREAR',
      entidad: 'mascota',
      entidad_id: creado.id,
      descripcion: `Creó mascota: ${creado.nombre}`,
      metadata: {
        after: creado,
        cliente: clienteInfo,
        clienteCreadoAutomatico,
      },
    });

    res.status(201).json({ message: 'Mascota registrada correctamente', data: creado });
  } catch (err) {
    console.error('Error al crear mascota desde web:', err.message);

    await registrarAuditoria(req, {
      modulo: 'MASCOTAS',
      accion: 'CREAR_ERROR',
      entidad: 'mascota',
      entidad_id: String(nombre || '').trim() || null,
      descripcion: 'Error creando mascota desde web',
      metadata: { clinica_id: clinicaId, body: req.body, error: err.message },
    });

    res.status(500).json({ error: err.message });
  }
};

// [PUT] update mascota web
const updateMascota = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica-id en headers (o clinica_id en token)' });

  const { id } = req.params;
  const {
    nombre,
    especie,
    raza,
    edad,
    genero,
    cliente_id,
    propietario, // compat vieja
    propietario_telefono,
    collar_id,
  } = req.body;

  try {
    const beforeRes = await pool.query(
      `SELECT * FROM public.mascotas WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    const before = beforeRes.rows?.[0] || null;
    if (!before) return res.status(404).json({ message: 'Mascota no encontrada (o no pertenece a esta clínica).' });

    // 1) resolver cliente (si viene)
    let clienteIdFinal = cliente_id ? Number(cliente_id) : null;
    let clienteCreadoAutomatico = false;

    if (!clienteIdFinal && propietario && String(propietario).trim().length >= 2) {
      const tmp = await ensureClienteOcasional({
        clinicaId,
        nombre: propietario,
        telefono: propietario_telefono || null,
      });
      if (tmp) {
        clienteIdFinal = tmp;
        clienteCreadoAutomatico = true;
      }
    }

    // clienteInfo: si no envían cliente_id, tomamos el actual
    let clienteInfo = null;
    if (clienteIdFinal) {
      clienteInfo = await getClienteInfo({ clinicaId, clienteId: clienteIdFinal });
      if (!clienteInfo) return res.status(400).json({ error: 'cliente_id inválido para esta clínica.' });
    } else {
      const cur = await pool.query(
        `SELECT c.id, c.tipo_cliente, c.nombre, c.telefono
         FROM public.mascotas m
         LEFT JOIN public.clientes c ON c.id = m.cliente_id
         WHERE m.id = $1 AND m.clinica_id = $2`,
        [id, clinicaId]
      );
      if (cur.rowCount) clienteInfo = cur.rows[0];
    }

    // 2) collar rules
    const collarIdFinal = normalizeCollarId(collar_id);

    if (collarIdFinal) {
      if (!clienteInfo || String(clienteInfo.tipo_cliente || '').toUpperCase() !== 'FIJO') {
        return res.status(400).json({ error: 'Solo un CLIENTE FIJO puede registrar ID de collar.' });
      }

      if (!isValidCollarFormat(collarIdFinal)) {
        return res.status(400).json({ error: 'Formato de collar inválido. Ej: ANIMA-ABC123' });
      }

      const chk = await checkCollarDisponibleGlobal({ collarId: collarIdFinal, mascotaIdToIgnore: Number(id) });
      if (!chk.ok) {
        return res.status(409).json({ error: 'El ID de collar ya está registrado por otra mascota.' });
      }
    }

    const upd = await pool.query(
      `UPDATE public.mascotas
       SET
         nombre = COALESCE($1, nombre),
         especie = COALESCE($2, especie),
         raza = COALESCE($3, raza),
         edad = COALESCE($4, edad),
         genero = COALESCE($5, genero),
         cliente_id = COALESCE($6, cliente_id),
         collar_id = $7
       WHERE id = $8 AND clinica_id = $9
       RETURNING *`,
      [
        nombre ? String(nombre).trim() : null,
        especie || null,
        raza || null,
        edad || null,
        genero || null,
        clienteIdFinal,
        collarIdFinal,
        id,
        clinicaId,
      ]
    );

    const after = upd.rows[0];

    await registrarAuditoria(req, {
      modulo: 'MASCOTAS',
      accion: 'EDITAR',
      entidad: 'mascota',
      entidad_id: after.id,
      descripcion: `Editó mascota: ${after.nombre}`,
      metadata: { before, after, cliente: clienteInfo, clienteCreadoAutomatico },
    });

    res.json({ message: 'Mascota actualizada', data: after });
  } catch (err) {
    console.error('Error updateMascota web:', err.message);

    await registrarAuditoria(req, {
      modulo: 'MASCOTAS',
      accion: 'EDITAR_ERROR',
      entidad: 'mascota',
      entidad_id: id,
      descripcion: `Error actualizando mascota id=${id}`,
      metadata: { clinica_id: clinicaId, body: req.body, error: err.message },
    });

    res.status(500).json({ error: err.message });
  }
};

// [DELETE] delete mascota web
const deleteMascota = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica-id en headers (o clinica_id en token)' });

  const { id } = req.params;

  try {
    const beforeRes = await pool.query(
      `SELECT * FROM public.mascotas WHERE id = $1 AND clinica_id = $2`,
      [id, clinicaId]
    );
    const before = beforeRes.rows?.[0] || null;
    if (!before) return res.status(404).json({ message: 'Mascota no encontrada.' });

    await pool.query(
      'DELETE FROM public.mascotas WHERE id = $1 AND clinica_id = $2',
      [id, clinicaId]
    );

    await registrarAuditoria(req, {
      modulo: 'MASCOTAS',
      accion: 'ELIMINAR',
      entidad: 'mascota',
      entidad_id: id,
      descripcion: `Eliminó mascota: ${before.nombre || id}`,
      metadata: { before },
    });

    res.json({ message: 'Mascota eliminada' });
  } catch (err) {
    console.error('Error deleteMascota web:', err.message);

    await registrarAuditoria(req, {
      modulo: 'MASCOTAS',
      accion: 'ELIMINAR_ERROR',
      entidad: 'mascota',
      entidad_id: id,
      descripcion: `Error eliminando mascota id=${id}`,
      metadata: { clinica_id: clinicaId, error: err.message },
    });

    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getMascotas,
  createMascota,
  updateMascota,
  deleteMascota,
};
// Backend/src/controllers/veterinarios.controller.js (web) ✅ COMPLETO + ROLES POR CLÍNICA
const pool = require('../db');
const bcrypt = require('bcrypt');
const { registrarAuditoria } = require('../utils/auditoria');

const getClinicaId = (req) => req.user?.clinica_id ?? req.headers['clinica-id'] ?? null;

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Trae rol_id por nombre (fallback si frontend manda string)
async function getRolIdByNombre(nombreRol) {
  const r = await pool.query(`SELECT id FROM public.roles WHERE lower(nombre) = lower($1) LIMIT 1`, [nombreRol]);
  return r.rows?.[0]?.id ?? null;
}

// ✅ helper: valida que el rol sea asignable en esta clínica (o global)
async function validarRolAsignable(client, rolId, clinicaId) {
  const rolDB = await client.query(
    `SELECT id, nombre, clinica_id
     FROM public.roles
     WHERE id = $1
     LIMIT 1`,
    [rolId]
  );

  if (rolDB.rowCount === 0) {
    return { ok: false, status: 400, error: 'El rol_id no existe.' };
  }

  const rolRow = rolDB.rows[0];
  const rolNombre = String(rolRow.nombre || '').toLowerCase();

  // dueño bloqueado
  if (rolNombre === 'dueño' || rolNombre === 'dueno') {
    return { ok: false, status: 400, error: 'El rol dueño es exclusivo de móvil.' };
  }

  // ✅ rol debe ser global o de mi clínica
  if (rolRow.clinica_id !== null && Number(rolRow.clinica_id) !== Number(clinicaId)) {
    return { ok: false, status: 403, error: 'No puedes asignar roles de otra clínica.' };
  }

  return { ok: true, rol: rolRow, rolNombre };
}

// ===================================================================
// GET /veterinarios  (lista USUARIOS de la clínica)
// Lee desde users (fuente real) y junta datos de veterinarios (perfil)
// ===================================================================
const getVeterinarios = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica_id en token/header' });

  try {
    const q = `
      SELECT
        u.id,
        u.nombre,
        u.apellido,
        v.especialidad,
        u.telefono,
        u.email,
        u.rol_id,
        r.nombre AS rol_nombre,
        u.clinica_id
      FROM public.users u
      JOIN public.roles r ON r.id = u.rol_id
      LEFT JOIN public.veterinarios v
        ON v.email = u.email AND v.clinica_id = u.clinica_id
      WHERE u.clinica_id = $1
        AND LOWER(r.nombre) NOT IN ('dueño','dueno')
      ORDER BY u.nombre ASC
    `;
    const result = await pool.query(q, [clinicaId]);
    res.json(result.rows);
  } catch (err) {
    await registrarAuditoria(req, {
      modulo: 'USUARIOS',
      accion: 'VER_ERROR',
      entidad: 'user',
      entidad_id: `clinica:${clinicaId}`,
      descripcion: 'Error obteniendo usuarios',
      metadata: { clinica_id: clinicaId, error: err.message },
    });
    res.status(500).json({ error: err.message });
  }
};

// ===================================================================
// POST /veterinarios  (crea USUARIO con rol dinámico)
// Acepta rol_id (recomendado). Soporta rol (string) solo por fallback.
// ===================================================================
const createVeterinario = async (req, res) => {
  const clinicaId = getClinicaId(req);

  const nombre = String(req.body?.nombre || '').trim();
  const apellido = String(req.body?.apellido || '').trim();
  const especialidad = String(req.body?.especialidad || '').trim();
  const telefono = String(req.body?.telefono || '').trim();
  const email = normEmail(req.body?.email);
  const password = String(req.body?.password || '');

  // rol_id dinámico
  const rol_id =
    req.body?.rol_id !== undefined && req.body?.rol_id !== null ? Number(req.body.rol_id) : null;

  // fallback si manda rol texto
  const rolTexto = String(req.body?.rol || '').trim().toLowerCase(); // opcional

  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica_id en token/header' });
  if (!nombre || !email || !password)
    return res.status(400).json({ error: 'Nombre, email y password son obligatorios.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password mínimo 8 caracteres.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) validar email único (global)
    const existsUser = await client.query(`SELECT id FROM public.users WHERE email = $1 LIMIT 1`, [email]);
    if (existsUser.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ese correo ya está registrado como usuario.' });
    }

    // 2) resolver rol_id
    let finalRolId = rol_id;
    if (!finalRolId && rolTexto) {
      finalRolId = await getRolIdByNombre(rolTexto);
    }

    if (!finalRolId || Number.isNaN(finalRolId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'rol_id es obligatorio (o rol válido).' });
    }

    // ✅ validar rol con clinica/global
    const vr = await validarRolAsignable(client, finalRolId, clinicaId);
    if (!vr.ok) {
      await client.query('ROLLBACK');
      return res.status(vr.status).json({ error: vr.error });
    }

    const rolNombreLower = String(vr.rolNombre || '').toLowerCase();

    // 3) hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4) insertar en users (fuente real)
    const userIns = await client.query(
      `INSERT INTO public.users (email, password, rol_id, clinica_id, nombre, apellido, telefono)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, rol_id, clinica_id, nombre, apellido, telefono`,
      [email, hashedPassword, finalRolId, clinicaId, nombre, apellido || '', telefono || '']
    );

    // 5) insertar en veterinarios (perfil/compat)
    await client.query(
      `INSERT INTO public.veterinarios (nombre, especialidad, telefono, email, password, rol, clinica_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [nombre, especialidad || null, telefono || null, email, hashedPassword, rolNombreLower, clinicaId]
    );

    await client.query('COMMIT');

    const creado = {
      ...userIns.rows[0],
      especialidad: especialidad || null,
      rol_nombre: vr.rol.nombre,
    };

    await registrarAuditoria(req, {
      modulo: 'USUARIOS',
      accion: 'CREAR',
      entidad: 'user',
      entidad_id: creado.id,
      descripcion: `Registró usuario: ${creado.nombre} (${creado.email}) rol=${creado.rol_nombre}`,
      metadata: { after: creado },
    });

    return res.status(201).json({ message: 'Usuario registrado correctamente', data: creado });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    await registrarAuditoria(req, {
      modulo: 'USUARIOS',
      accion: 'CREAR_ERROR',
      entidad: 'user',
      entidad_id: email || 'sin_email',
      descripcion: 'Error creando usuario',
      metadata: { clinica_id: clinicaId, error: err.message, body: { ...req.body, password: '***' } },
    });

    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ===================================================================
// PUT /veterinarios/:id (edita usuario + rol dinámico)
// ===================================================================
const updateVeterinario = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { id } = req.params;

  const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim() : null;
  const apellido = req.body?.apellido !== undefined ? String(req.body.apellido).trim() : null;
  const especialidad = req.body?.especialidad !== undefined ? String(req.body.especialidad).trim() : null;
  const telefono = req.body?.telefono !== undefined ? String(req.body.telefono).trim() : null;
  const email = req.body?.email !== undefined ? normEmail(req.body.email) : null;
  const password = req.body?.password !== undefined ? String(req.body.password) : null;

  const rol_id =
    req.body?.rol_id !== undefined && req.body?.rol_id !== null ? Number(req.body.rol_id) : null;

  const client = await pool.connect();
  try {
    if (!clinicaId) return res.status(400).json({ error: 'Falta clinica_id en token/header' });

    await client.query('BEGIN');

    // traer user before
    const beforeUserRes = await client.query(
      `SELECT u.id, u.email, u.nombre, u.apellido, u.telefono, u.rol_id, r.nombre AS rol_nombre
       FROM public.users u
       JOIN public.roles r ON r.id = u.rol_id
       WHERE u.id = $1 AND u.clinica_id = $2`,
      [id, clinicaId]
    );
    const beforeUser = beforeUserRes.rows?.[0] || null;
    if (!beforeUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado o no autorizado' });
    }

    // si cambia email, validar que no choque con otro usuario
    if (email && email !== beforeUser.email) {
      const check = await client.query(`SELECT id FROM public.users WHERE email = $1 LIMIT 1`, [email]);
      if (check.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Ese correo ya está en uso por otro usuario.' });
      }
    }

    let newHashed = null;
    if (password) {
      if (password.length < 8) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      }
      newHashed = await bcrypt.hash(password, 10);
    }

    // ✅ validar rol si viene
    let rolNombreFinal = beforeUser.rol_nombre;
    let rolIdFinal = null;

    if (rol_id !== null) {
      if (Number.isNaN(rol_id) || rol_id <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'rol_id inválido.' });
      }

      const vr = await validarRolAsignable(client, rol_id, clinicaId);
      if (!vr.ok) {
        await client.query('ROLLBACK');
        return res.status(vr.status).json({ error: vr.error });
      }

      rolIdFinal = rol_id;
      rolNombreFinal = vr.rol.nombre;
    }

    // 1) update users
    const updUser = await client.query(
      `UPDATE public.users
       SET nombre = COALESCE($1, nombre),
           apellido = COALESCE($2, apellido),
           telefono = COALESCE($3, telefono),
           email = COALESCE($4, email),
           password = COALESCE($5, password),
           rol_id = COALESCE($6, rol_id)
       WHERE id = $7 AND clinica_id = $8
       RETURNING id, email, rol_id, clinica_id, nombre, apellido, telefono`,
      [
        nombre || null,
        apellido || null,
        telefono || null,
        email || null,
        newHashed || null,
        rolIdFinal || null,
        id,
        clinicaId,
      ]
    );

    const afterUser = updUser.rows[0];

    // 2) update veterinarios (perfil) por email BEFORE
    const vetExist = await client.query(
      `SELECT id FROM public.veterinarios WHERE email = $1 AND clinica_id = $2 LIMIT 1`,
      [beforeUser.email, clinicaId]
    );

    const rolLower = String(rolNombreFinal || '').toLowerCase();

    if (vetExist.rowCount === 0) {
      await client.query(
        `INSERT INTO public.veterinarios (nombre, especialidad, telefono, email, password, rol, clinica_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          afterUser.nombre,
          especialidad || null,
          afterUser.telefono || null,
          afterUser.email,
          newHashed || null,
          rolLower,
          clinicaId,
        ]
      );
    } else {
      await client.query(
        `UPDATE public.veterinarios
         SET nombre = COALESCE($1, nombre),
             especialidad = COALESCE($2, especialidad),
             telefono = COALESCE($3, telefono),
             email = COALESCE($4, email),
             password = COALESCE($5, password),
             rol = COALESCE($6, rol)
         WHERE email = $7 AND clinica_id = $8`,
        [
          afterUser.nombre || null,
          especialidad || null,
          afterUser.telefono || null,
          afterUser.email || null,
          newHashed || null,
          rolLower,
          beforeUser.email,
          clinicaId,
        ]
      );
    }

    await client.query('COMMIT');

    await registrarAuditoria(req, {
      modulo: 'USUARIOS',
      accion: 'EDITAR',
      entidad: 'user',
      entidad_id: id,
      descripcion: `Actualizó usuario: ${afterUser.nombre} (${afterUser.email})`,
      metadata: { before: beforeUser, after: { ...afterUser, rol_nombre: rolNombreFinal, especialidad } },
    });

    return res.json({
      message: 'Usuario actualizado correctamente',
      data: { ...afterUser, rol_nombre: rolNombreFinal, especialidad: especialidad ?? null },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    await registrarAuditoria(req, {
      modulo: 'USUARIOS',
      accion: 'EDITAR_ERROR',
      entidad: 'user',
      entidad_id: id,
      descripcion: `Error actualizando usuario id=${id}`,
      metadata: { clinica_id: clinicaId, error: err.message, body: { ...req.body, password: '***' } },
    });

    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ===================================================================
// DELETE /veterinarios/:id  (borra en users + veterinarios)
// ===================================================================
const deleteVeterinario = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { id } = req.params;

  if (!clinicaId) return res.status(400).json({ error: 'Falta clinica_id en token/header' });

  // seguridad: no te borres a ti mismo
  if (Number(req.user?.id) === Number(id)) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeRes = await client.query(
      `SELECT u.id, u.email, u.nombre, u.rol_id, r.nombre AS rol_nombre
       FROM public.users u
       JOIN public.roles r ON r.id = u.rol_id
       WHERE u.id = $1 AND u.clinica_id = $2`,
      [id, clinicaId]
    );
    const before = beforeRes.rows?.[0] || null;
    if (!before) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado o no autorizado' });
    }

    await client.query(`DELETE FROM public.veterinarios WHERE email = $1 AND clinica_id = $2`, [
      before.email,
      clinicaId,
    ]);

    await client.query(`DELETE FROM public.users WHERE id = $1 AND clinica_id = $2`, [id, clinicaId]);

    await client.query('COMMIT');

    await registrarAuditoria(req, {
      modulo: 'USUARIOS',
      accion: 'ELIMINAR',
      entidad: 'user',
      entidad_id: id,
      descripcion: `Eliminó usuario: ${before.nombre} (${before.email})`,
      metadata: { before },
    });

    return res.json({ message: 'Usuario eliminado correctamente' });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    await registrarAuditoria(req, {
      modulo: 'USUARIOS',
      accion: 'ELIMINAR_ERROR',
      entidad: 'user',
      entidad_id: id,
      descripcion: `Error eliminando usuario id=${id}`,
      metadata: { clinica_id: clinicaId, error: err.message },
    });

    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

module.exports = {
  getVeterinarios,
  createVeterinario,
  updateVeterinario,
  deleteVeterinario,
};
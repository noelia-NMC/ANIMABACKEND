// Backend/src/controllers/roles.controller.js   (web) ✅ ROLES POR CLÍNICA (admin intocable)
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

// Helpers
const normRol = (s) => String(s || '').trim().toLowerCase();

const getClinicaId = (req) => {
  const fromToken = req.user?.clinica_id;
  const fromHeader = req.headers['clinica-id'];
  const v = fromToken ?? fromHeader;
  if (!v) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const isBlockedRoleName = (nombre) => {
  const n = normRol(nombre);
  return n === 'dueño' || n === 'dueno';
};

// ✅ SOLO ADMIN bloqueado (intocable)
const isAdminRoleName = (nombre) => normRol(nombre) === 'admin';

// ✅ para seguridad: no permitas crear admin por clínica
const isSystemRoleNameCreateBlocked = (nombre) => {
  const n = normRol(nombre);
  return n === 'admin' || n === 'dueño' || n === 'dueno';
};

// --- GESTIÓN DE ROLES ---

// [POST] Crear rol (para la clínica actual)
exports.createRol = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { nombre, descripcion } = req.body;

  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  if (!nombre || !descripcion) {
    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'CREAR_FAIL',
      entidad: 'rol',
      entidad_id: nombre || 'sin_nombre',
      descripcion: 'Creación de rol fallida: datos incompletos',
      metadata: { body: req.body },
    });
    return res.status(400).json({ message: 'El nombre y la descripción del rol son obligatorios.' });
  }

  if (isBlockedRoleName(nombre)) {
    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'CREAR_FAIL',
      entidad: 'rol',
      entidad_id: normRol(nombre),
      descripcion: 'Intento de crear rol dueño desde web (bloqueado)',
      metadata: { nombre },
    });
    return res.status(400).json({
      message: 'El rol "dueño" es exclusivo de la plataforma móvil y no puede ser creado aquí.',
    });
  }

  // ✅ Evitar crear roles del sistema (admin / dueño)
  if (isSystemRoleNameCreateBlocked(nombre)) {
    return res.status(400).json({ message: 'Ese rol es del sistema y no se crea desde la web.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO public.roles (nombre, descripcion, clinica_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [normRol(nombre), String(descripcion).trim(), clinicaId]
    );

    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'CREAR',
      entidad: 'rol',
      entidad_id: result.rows[0].id,
      descripcion: `Creó rol: ${result.rows[0].nombre} (clinica_id=${clinicaId})`,
      metadata: { after: result.rows[0] },
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      await registrarAuditoria(req, {
        modulo: 'ROLES',
        accion: 'CREAR_FAIL',
        entidad: 'rol',
        entidad_id: normRol(nombre),
        descripcion: 'Ya existe rol con ese nombre en esta clínica',
        metadata: { nombre: normRol(nombre), clinica_id: clinicaId, error_code: error.code },
      });
      return res.status(409).json({ message: 'Ya existe un rol con ese nombre en esta clínica.' });
    }

    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'CREAR_ERROR',
      entidad: 'rol',
      entidad_id: normRol(nombre),
      descripcion: 'Error creando rol',
      metadata: { body: req.body, clinica_id: clinicaId, error: error.message },
    });

    return res.status(500).json({ message: 'Error al crear el rol.', error: error.message });
  }
};

// [PUT] Actualizar descripción
// ✅ Permitido para roles de mi clínica o globales (EXCEPTO admin)
exports.updateRol = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { rolId } = req.params;
  const { descripcion } = req.body;

  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  if (!descripcion) {
    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'EDITAR_FAIL',
      entidad: 'rol',
      entidad_id: rolId,
      descripcion: 'Descripción requerida',
      metadata: { body: req.body },
    });
    return res.status(400).json({ message: 'La descripción es obligatoria.' });
  }

  try {
    const beforeRes = await pool.query(`SELECT * FROM public.roles WHERE id = $1`, [rolId]);
    const before = beforeRes.rows?.[0] || null;

    if (!before) return res.status(404).json({ message: 'Rol no encontrado.' });

    // ✅ BLOQUEAR SOLO ADMIN
    if (isAdminRoleName(before.nombre)) {
      return res.status(403).json({ message: 'El rol admin no se puede modificar.' });
    }

    // Si el rol es de clínica, solo mi clínica
    if (before.clinica_id !== null && Number(before.clinica_id) !== Number(clinicaId)) {
      return res.status(403).json({ message: 'No autorizado para modificar roles de otra clínica.' });
    }

    const result = await pool.query(
      `UPDATE public.roles
       SET descripcion = $1
       WHERE id = $2
       RETURNING *`,
      [String(descripcion).trim(), rolId]
    );

    const after = result.rows[0];

    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'EDITAR',
      entidad: 'rol',
      entidad_id: after.id,
      descripcion: `Actualizó rol: ${after.nombre} (clinica_id=${clinicaId})`,
      metadata: { before, after },
    });

    return res.status(200).json(after);
  } catch (error) {
    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'EDITAR_ERROR',
      entidad: 'rol',
      entidad_id: rolId,
      descripcion: 'Error actualizando rol',
      metadata: { rolId, clinica_id: clinicaId, error: error.message },
    });

    return res.status(500).json({ message: 'Error al actualizar el rol.', error: error.message });
  }
};

// [DELETE] Eliminar rol
// ✅ Permitido solo si es de mi clínica (globales NO se eliminan) y admin nunca
exports.deleteRol = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { rolId } = req.params;

  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  try {
    const rolResult = await pool.query(`SELECT * FROM public.roles WHERE id = $1`, [rolId]);
    const before = rolResult.rows?.[0] || null;

    if (!before) return res.status(404).json({ message: 'Rol no encontrado.' });

    // ✅ BLOQUEAR SOLO ADMIN
    if (isAdminRoleName(before.nombre)) {
      return res.status(403).json({ message: 'El rol admin no se puede eliminar.' });
    }

    // No permitir eliminar globales (tú dijiste solo permisos del veterinario se editan, pero borrar global no)
    if (before.clinica_id === null) {
      return res.status(403).json({ message: 'No se puede eliminar un rol global del sistema.' });
    }

    // Solo roles de mi clínica
    if (Number(before.clinica_id) !== Number(clinicaId)) {
      return res.status(403).json({ message: 'No autorizado para eliminar roles de otra clínica.' });
    }

    const usersWithRole = await pool.query(`SELECT COUNT(*) FROM public.users WHERE rol_id = $1`, [rolId]);
    if (parseInt(usersWithRole.rows[0].count, 10) > 0) {
      return res.status(409).json({
        message: 'No se puede eliminar el rol porque está asignado a uno o más usuarios.',
      });
    }

    await pool.query(`DELETE FROM public.roles WHERE id = $1`, [rolId]);

    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'ELIMINAR',
      entidad: 'rol',
      entidad_id: rolId,
      descripcion: `Eliminó rol: ${before?.nombre || rolId} (clinica_id=${clinicaId})`,
      metadata: { before },
    });

    return res.status(204).send();
  } catch (error) {
    await registrarAuditoria(req, {
      modulo: 'ROLES',
      accion: 'ELIMINAR_ERROR',
      entidad: 'rol',
      entidad_id: rolId,
      descripcion: 'Error eliminando rol',
      metadata: { rolId, clinica_id: clinicaId, error: error.message },
    });

    return res.status(500).json({ message: 'Error al eliminar el rol.', error: error.message });
  }
};

// --- PERMISOS Y ASIGNACIONES ---

// [GET] Roles con permisos (mi clínica + globales)
exports.getAllRoles = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  try {
    const query = `
      SELECT r.id, r.nombre, r.descripcion, r.clinica_id,
             COALESCE(
               json_agg(p.* ORDER BY p.nombre) FILTER (WHERE p.id IS NOT NULL),
               '[]'
             ) as permisos
      FROM public.roles r
      LEFT JOIN public.rol_permisos rp ON r.id = rp.rol_id
      LEFT JOIN public.permisos p ON rp.permiso_id = p.id
      WHERE lower(r.nombre) NOT IN ('dueño','dueno')
        AND (r.clinica_id = $1 OR r.clinica_id IS NULL)
      GROUP BY r.id, r.nombre, r.descripcion, r.clinica_id
      ORDER BY (r.clinica_id IS NULL) DESC, r.nombre;
    `;
    const result = await pool.query(query, [clinicaId]);
    return res.status(200).json(result.rows);
  } catch (error) {
    await registrarAuditoria(req, {
      modulo: 'PERMISOS',
      accion: 'VER_ERROR',
      entidad: 'roles',
      entidad_id: 'listado',
      descripcion: 'Error obteniendo roles con permisos',
      metadata: { clinica_id: clinicaId, error: error.message },
    });

    return res.status(500).json({ message: 'Error al obtener roles', error: error.message });
  }
};

// [GET] Lista permisos (global)
exports.getAllPermisos = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM public.permisos ORDER BY nombre`);
    return res.status(200).json(result.rows);
  } catch (error) {
    await registrarAuditoria(req, {
      modulo: 'PERMISOS',
      accion: 'VER_ERROR',
      entidad: 'permisos',
      entidad_id: 'listado',
      descripcion: 'Error obteniendo permisos',
      metadata: { error: error.message },
    });

    return res.status(500).json({ message: 'Error al obtener permisos', error: error.message });
  }
};

// [PUT] Actualizar permisos por rol
// ✅ Permitido incluso si el rol es GLOBAL (ej: veterinario)
// ❌ Solo bloqueamos ADMIN
exports.updateRolPermisos = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const { rolId } = req.params;
  const { permisosIds } = req.body;

  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica-id.' });

  if (!Array.isArray(permisosIds)) {
    await registrarAuditoria(req, {
      modulo: 'PERMISOS',
      accion: 'EDITAR_FAIL',
      entidad: 'rol_permisos',
      entidad_id: rolId,
      descripcion: 'permisosIds no es array',
      metadata: { permisosIds },
    });
    return res.status(400).json({ message: 'Se requiere un array de IDs de permisos.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rolResult = await client.query(`SELECT * FROM public.roles WHERE id = $1`, [rolId]);
    const rolBefore = rolResult.rows?.[0] || null;

    if (!rolBefore) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Rol no encontrado.' });
    }

    // ✅ BLOQUEAR SOLO ADMIN
    if (isAdminRoleName(rolBefore.nombre)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'No se pueden modificar permisos del rol admin.' });
    }

    // Si es rol de clínica, validar que sea mi clínica.
    // Si es global (clinica_id null), lo dejamos editar (ej: veterinario)
    if (rolBefore.clinica_id !== null && Number(rolBefore.clinica_id) !== Number(clinicaId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'No autorizado para modificar roles de otra clínica.' });
    }

    const beforePerms = await client.query(
      `SELECT permiso_id FROM public.rol_permisos WHERE rol_id = $1 ORDER BY permiso_id`,
      [rolId]
    );

    await client.query(`DELETE FROM public.rol_permisos WHERE rol_id = $1`, [rolId]);

    if (permisosIds.length > 0) {
      const insertQuery =
        `INSERT INTO public.rol_permisos (rol_id, permiso_id) VALUES ` +
        permisosIds.map((_, i) => `($1, $${i + 2})`).join(',');
      const values = [rolId, ...permisosIds];
      await client.query(insertQuery, values);
    }

    await client.query('COMMIT');

    await registrarAuditoria(req, {
      modulo: 'PERMISOS',
      accion: 'EDITAR',
      entidad: 'rol_permisos',
      entidad_id: rolId,
      descripcion: `Actualizó permisos del rol: ${rolBefore?.nombre || rolId} (clinica_id=${clinicaId})`,
      metadata: {
        rol: rolBefore,
        before: beforePerms.rows.map((x) => x.permiso_id),
        after: permisosIds,
      },
    });

    return res.status(200).json({ message: 'Permisos del rol actualizados correctamente.' });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}

    await registrarAuditoria(req, {
      modulo: 'PERMISOS',
      accion: 'EDITAR_ERROR',
      entidad: 'rol_permisos',
      entidad_id: rolId,
      descripcion: 'Error actualizando permisos del rol',
      metadata: { rolId, clinica_id: clinicaId, error: error.message, body: req.body },
    });

    return res.status(500).json({ message: 'Error al actualizar permisos del rol', error: error.message });
  } finally {
    client.release();
  }
};
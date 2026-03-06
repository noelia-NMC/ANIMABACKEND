// Backend/src/controllers/user.controller.js  (web)
const pool = require('../db');
const bcrypt = require('bcrypt');
const { registrarAuditoria } = require('../utils/auditoria');

/**
 * @description Obtiene el perfil del usuario actualmente autenticado.
 */
const getMiPerfil = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'No autenticado.' });

  try {
    const query = `
      SELECT u.id, u.email, u.rol_id, u.clinica_id, u.nombre, u.apellido, u.telefono,
             r.nombre as rol_nombre
      FROM public.users u
      JOIN public.roles r ON u.rol_id = r.id
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      await registrarAuditoria(req, {
        modulo: 'USUARIO',
        accion: 'VER_FAIL',
        entidad: 'user',
        entidad_id: userId,
        descripcion: 'Perfil no encontrado',
        metadata: { userId },
      });
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const user = result.rows[0];

    return res.json({
      id: user.id,
      email: user.email,
      rol: user.rol_nombre,
      rol_id: user.rol_id,
      clinica_id: user.clinica_id,
      nombre: user.nombre || '',
      apellido: user.apellido || '',
      telefono: user.telefono || '',
    });
  } catch (error) {
    console.error('Error al obtener el perfil del usuario:', error);

    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'VER_ERROR',
      entidad: 'user',
      entidad_id: userId,
      descripcion: 'Error obteniendo mi perfil',
      metadata: { error: error.message },
    });

    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * @description Actualiza el perfil del usuario autenticado (email, nombre, etc.).
 */
const updateMiPerfil = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'No autenticado.' });

  const { email, nombre, apellido, telefono } = req.body;

  if (!email || !nombre) {
    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'EDITAR_FAIL',
      entidad: 'user',
      entidad_id: userId,
      descripcion: 'Actualización perfil fallida: email/nombre obligatorios',
      metadata: { body: req.body },
    });
    return res.status(400).json({ message: 'El correo electrónico y el nombre son obligatorios.' });
  }

  try {
    const beforeRes = await pool.query(
      `SELECT id, email, rol_id, clinica_id, nombre, apellido, telefono FROM public.users WHERE id = $1`,
      [userId]
    );
    const before = beforeRes.rows?.[0] || null;

    const updateQuery = `
      UPDATE public.users
      SET email = $1, nombre = $2, apellido = $3, telefono = $4
      WHERE id = $5
      RETURNING id, email, rol_id, clinica_id, nombre, apellido, telefono
    `;
    const result = await pool.query(updateQuery, [
      String(email).trim().toLowerCase(),
      String(nombre).trim(),
      apellido ? String(apellido).trim() : '',
      telefono ? String(telefono).trim() : '',
      userId,
    ]);

    if (result.rows.length === 0) {
      await registrarAuditoria(req, {
        modulo: 'USUARIO',
        accion: 'EDITAR_FAIL',
        entidad: 'user',
        entidad_id: userId,
        descripcion: 'Usuario no encontrado al actualizar perfil',
        metadata: { userId },
      });
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const fullUserQuery = `
      SELECT u.id, u.email, u.rol_id, u.clinica_id, u.nombre, u.apellido, u.telefono,
             r.nombre as rol_nombre
      FROM public.users u
      JOIN public.roles r ON u.rol_id = r.id
      WHERE u.id = $1
    `;
    const fullUserResult = await pool.query(fullUserQuery, [userId]);
    const updatedUser = fullUserResult.rows[0];

    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'EDITAR',
      entidad: 'user',
      entidad_id: userId,
      descripcion: `Actualizó su perfil (email: ${before?.email} -> ${updatedUser.email})`,
      metadata: { before, after: updatedUser },
    });

    return res.json({
      message: 'Perfil actualizado con éxito',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        rol: updatedUser.rol_nombre,
        rol_id: updatedUser.rol_id,
        clinica_id: updatedUser.clinica_id,
        nombre: updatedUser.nombre || '',
        apellido: updatedUser.apellido || '',
        telefono: updatedUser.telefono || '',
      },
    });
  } catch (error) {
    if (error.code === '23505') {
      await registrarAuditoria(req, {
        modulo: 'USUARIO',
        accion: 'EDITAR_FAIL',
        entidad: 'user',
        entidad_id: userId,
        descripcion: 'Email duplicado al actualizar perfil',
        metadata: { email, error_code: error.code },
      });
      return res.status(409).json({ message: 'El correo electrónico ya está en uso por otra cuenta.' });
    }

    console.error('Error al actualizar el perfil del usuario:', error);

    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'EDITAR_ERROR',
      entidad: 'user',
      entidad_id: userId,
      descripcion: 'Error interno al actualizar perfil',
      metadata: { body: req.body, error: error.message },
    });

    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * @description Cambia la contraseña del usuario autenticado.
 */
const changeMiPassword = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'No autenticado.' });

  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'PASS_FAIL',
      entidad: 'user',
      entidad_id: userId,
      descripcion: 'Cambio de contraseña fallido: campos incompletos',
      metadata: {},
    });
    return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
  }
  if (new_password.length < 8) {
    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'PASS_FAIL',
      entidad: 'user',
      entidad_id: userId,
      descripcion: 'Cambio de contraseña fallido: nueva contraseña < 8',
      metadata: {},
    });
    return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }
  if (new_password !== confirm_password) {
    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'PASS_FAIL',
      entidad: 'user',
      entidad_id: userId,
      descripcion: 'Cambio de contraseña fallido: confirmación no coincide',
      metadata: {},
    });
    return res.status(400).json({ message: 'La nueva contraseña y la confirmación no coinciden.' });
  }

  try {
    const userResult = await pool.query('SELECT password FROM public.users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      await registrarAuditoria(req, {
        modulo: 'USUARIO',
        accion: 'PASS_FAIL',
        entidad: 'user',
        entidad_id: userId,
        descripcion: 'Usuario no encontrado al cambiar contraseña',
        metadata: {},
      });
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const hashedPasswordFromDB = userResult.rows[0].password;

    const isMatch = await bcrypt.compare(current_password, hashedPasswordFromDB);
    if (!isMatch) {
      await registrarAuditoria(req, {
        modulo: 'USUARIO',
        accion: 'PASS_FAIL',
        entidad: 'user',
        entidad_id: userId,
        descripcion: 'Cambio de contraseña fallido: contraseña actual incorrecta',
        metadata: {},
      });
      return res.status(401).json({ message: 'La contraseña actual es incorrecta.' });
    }

    const newHashedPassword = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE public.users SET password = $1 WHERE id = $2', [newHashedPassword, userId]);

    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'PASS_OK',
      entidad: 'user',
      entidad_id: userId,
      descripcion: 'Cambió su contraseña correctamente',
      metadata: {},
    });

    return res.status(200).json({ message: 'Contraseña actualizada con éxito.' });
  } catch (error) {
    console.error('Error al cambiar la contraseña:', error);

    await registrarAuditoria(req, {
      modulo: 'USUARIO',
      accion: 'PASS_ERROR',
      entidad: 'user',
      entidad_id: userId,
      descripcion: 'Error interno al cambiar contraseña',
      metadata: { error: error.message },
    });

    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  getMiPerfil,
  updateMiPerfil,
  changeMiPassword,
};
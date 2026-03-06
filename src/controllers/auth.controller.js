// Backend/src/controllers/auth.controller.js  ✅ COMPLETO (WEB) - Roles dinámicos
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

// Helper: permisos por rol
async function getPermisosByRolId(rolId) {
  const q = `
    SELECT p.nombre
    FROM public.rol_permisos rp
    JOIN public.permisos p ON p.id = rp.permiso_id
    WHERE rp.rol_id = $1
    ORDER BY p.nombre
  `;
  const r = await pool.query(q, [rolId]);
  return r.rows.map((x) => x.nombre);
}

// Helper: user completo + rol_nombre + clinica_nombre ✅
async function getUserFullById(userId) {
  const q = `
    SELECT
      u.id, u.email, u.clinica_id, u.rol_id, u.nombre, u.apellido, u.telefono,
      r.nombre AS rol_nombre,
      c.nombre AS clinica_nombre
    FROM public.users u
    JOIN public.roles r ON r.id = u.rol_id
    LEFT JOIN public.clinicas c ON c.id = u.clinica_id
    WHERE u.id = $1
  `;
  const r = await pool.query(q, [userId]);
  return r.rows[0] || null;
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function signToken(user) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET no configurado');
  return jwt.sign(
    { id: user.id, email: user.email, rol_id: user.rol_id, clinica_id: user.clinica_id },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

// -----------------------------------------
// REGISTER WEB (si lo sigues usando)
// Crea veterinario por defecto (como antes)
// -----------------------------------------
const registerUser = async (req, res) => {
  const email = normEmail(req.body?.email);
  const { password } = req.body;

  if (!email || !password || String(password).length < 8) {
    return res.status(400).json({ message: 'Email y contraseña (mínimo 8 caracteres) son requeridos.' });
  }

  try {
    const userExists = await pool.query('SELECT 1 FROM public.users WHERE email = $1', [email]);
    if (userExists.rowCount > 0) {
      await registrarAuditoria(req, {
        modulo: 'AUTH_WEB',
        accion: 'REGISTER_FAIL',
        entidad: 'user',
        entidad_id: email,
        descripcion: `Registro fallido (email ya existe): ${email}`,
        metadata: { email },
      });
      return res.status(409).json({ message: 'Este correo electrónico ya está en uso.' });
    }

    const rolVeterinario = await pool.query(
      "SELECT id FROM public.roles WHERE lower(nombre) = 'veterinario' LIMIT 1"
    );
    if (rolVeterinario.rowCount === 0) {
      await registrarAuditoria(req, {
        modulo: 'AUTH_WEB',
        accion: 'REGISTER_FAIL',
        entidad: 'role',
        entidad_id: 'veterinario',
        descripcion: `No se encontró rol veterinario al registrar: ${email}`,
        metadata: { email },
      });
      return res.status(500).json({ message: 'Configuración de roles no encontrada.' });
    }

    const rolId = rolVeterinario.rows[0].id;
    const clinicaIdPorDefecto = 1; // si usas onboarding real, esto debería venir de ahí
    const hashedPassword = await bcrypt.hash(password, 10);

    const insert = await pool.query(
      `INSERT INTO public.users (email, password, rol_id, clinica_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, rol_id, clinica_id, nombre, apellido, telefono`,
      [email, hashedPassword, rolId, clinicaIdPorDefecto]
    );

    const newUser = insert.rows[0];
    const token = signToken(newUser);
    const permisos = await getPermisosByRolId(newUser.rol_id);

    const clinicaRes = await pool.query(
      `SELECT nombre FROM public.clinicas WHERE id = $1 LIMIT 1`,
      [newUser.clinica_id]
    );
    const clinica_nombre = clinicaRes.rows?.[0]?.nombre || '';

    await registrarAuditoria(req, {
      modulo: 'AUTH_WEB',
      accion: 'REGISTER',
      entidad: 'user',
      entidad_id: newUser.id,
      descripcion: `Registro web creado: ${newUser.email}`,
      metadata: { after: { ...newUser, clinica_nombre, permisos } },
    });

    return res.status(201).json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        rol: 'veterinario',
        rol_id: newUser.rol_id,
        clinica_id: newUser.clinica_id,
        clinica_nombre,
        nombre: newUser.nombre || '',
        apellido: newUser.apellido || '',
        telefono: newUser.telefono || '',
        permisos,
      },
    });
  } catch (err) {
    console.error('Error en el registro web:', err.message);

    await registrarAuditoria(req, {
      modulo: 'AUTH_WEB',
      accion: 'REGISTER_ERROR',
      entidad: 'user',
      entidad_id: email,
      descripcion: `Error interno registrando: ${email}`,
      metadata: { email, error: err.message },
    });

    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// -----------------------------------------
// LOGIN WEB ✅ (roles dinámicos)
// deja entrar a cualquier rol EXCEPTO dueño/dueno
// -----------------------------------------
const loginUser = async (req, res) => {
  const email = normEmail(req.body?.email);
  const { password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email y contraseña son requeridos.' });
  }

  try {
    const query = `
      SELECT
        u.id, u.email, u.password, u.clinica_id, u.rol_id, u.nombre, u.apellido, u.telefono,
        r.nombre AS rol_nombre,
        c.nombre AS clinica_nombre
      FROM public.users u
      JOIN public.roles r ON u.rol_id = r.id
      LEFT JOIN public.clinicas c ON c.id = u.clinica_id
      WHERE u.email = $1
      LIMIT 1
    `;
    const result = await pool.query(query, [email]);

    if (result.rowCount === 0) {
      await registrarAuditoria(req, {
        modulo: 'AUTH_WEB',
        accion: 'LOGIN_FAIL',
        entidad: 'user',
        entidad_id: email,
        descripcion: `Login fallido (no encontrado): ${email}`,
        metadata: { email },
      });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const user = result.rows[0];

    const rol = String(user.rol_nombre || '').toLowerCase();
    if (rol === 'dueño' || rol === 'dueno') {
      await registrarAuditoria(req, {
        modulo: 'AUTH_WEB',
        accion: 'LOGIN_FAIL',
        entidad: 'user',
        entidad_id: user.id,
        descripcion: `Login bloqueado: rol dueño no autorizado para web (${email})`,
        metadata: { email, rol: user.rol_nombre },
      });
      return res.status(403).json({ message: 'Rol no autorizado para la plataforma web.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await registrarAuditoria(req, {
        modulo: 'AUTH_WEB',
        accion: 'LOGIN_FAIL',
        entidad: 'user',
        entidad_id: user.id,
        descripcion: `Login fallido (password incorrecta): ${email}`,
        metadata: { email, user_id: user.id },
      });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const token = signToken(user);
    const permisos = await getPermisosByRolId(user.rol_id);

    await registrarAuditoria(req, {
      modulo: 'AUTH_WEB',
      accion: 'LOGIN',
      entidad: 'user',
      entidad_id: user.id,
      descripcion: `Login web exitoso: ${email} (rol: ${user.rol_nombre})`,
      metadata: { user_id: user.id, rol: user.rol_nombre, clinica_id: user.clinica_id },
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        rol: user.rol_nombre, // ✅ admin / veterinario / inventario / etc
        rol_id: user.rol_id,
        clinica_id: user.clinica_id,
        clinica_nombre: user.clinica_nombre || '',
        nombre: user.nombre || '',
        apellido: user.apellido || '',
        telefono: user.telefono || '',
        permisos,
      },
    });
  } catch (err) {
    console.error('Error en login web:', err.message);

    await registrarAuditoria(req, {
      modulo: 'AUTH_WEB',
      accion: 'LOGIN_ERROR',
      entidad: 'user',
      entidad_id: email,
      descripcion: `Error interno en login web: ${email}`,
      metadata: { email, error: err.message },
    });

    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// -----------------------------------------
// ✅ /auth/me  (para refrescar sesión)
// -----------------------------------------
const me = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'No autenticado.' });

    const user = await getUserFullById(userId);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });

    const rol = String(user.rol_nombre || '').toLowerCase();
    if (rol === 'dueño' || rol === 'dueno') {
      return res.status(403).json({ message: 'Rol no autorizado para la plataforma web.' });
    }

    const permisos = await getPermisosByRolId(user.rol_id);

    return res.json({
      id: user.id,
      email: user.email,
      rol: user.rol_nombre,
      rol_id: user.rol_id,
      clinica_id: user.clinica_id,
      clinica_nombre: user.clinica_nombre || '',
      nombre: user.nombre || '',
      apellido: user.apellido || '',
      telefono: user.telefono || '',
      permisos,
    });
  } catch (e) {
    console.error('Error en /auth/me:', e.message);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  me,
};
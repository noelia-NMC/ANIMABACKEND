// Backend/src/controllers/authVeterinario.controller.js    web
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { registrarAuditoria } = require('../utils/auditoria');

const loginVeterinario = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM veterinarios WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      await registrarAuditoria(req, {
        modulo: 'AUTH_VET_WEB',
        accion: 'LOGIN_FAIL',
        entidad: 'veterinario',
        entidad_id: email,
        descripcion: `Login veterinario fallido (correo no registrado): ${email}`,
        metadata: { email },
      });

      return res.status(401).json({ error: 'Correo no registrado' });
    }

    const veterinario = result.rows[0];
    const passwordCorrecta = await bcrypt.compare(password, veterinario.password);

    if (!passwordCorrecta) {
      await registrarAuditoria(req, {
        modulo: 'AUTH_VET_WEB',
        accion: 'LOGIN_FAIL',
        entidad: 'veterinario',
        entidad_id: veterinario.id,
        descripcion: `Login veterinario fallido (password incorrecta): ${email}`,
        metadata: { email, vet_id: veterinario.id, clinica_id: veterinario.clinica_id },
      });

      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    await registrarAuditoria(req, {
      modulo: 'AUTH_VET_WEB',
      accion: 'LOGIN',
      entidad: 'veterinario',
      entidad_id: veterinario.id,
      descripcion: `Login veterinario exitoso: ${email}`,
      metadata: { vet_id: veterinario.id, clinica_id: veterinario.clinica_id, rol: veterinario.rol },
    });

    const token = jwt.sign(
      {
        id: veterinario.id,
        rol: veterinario.rol,
        clinica_id: veterinario.clinica_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: veterinario.id,
        nombre: veterinario.nombre,
        email: veterinario.email,
        rol: veterinario.rol,
        clinica_id: veterinario.clinica_id,
      },
    });
  } catch (err) {
    console.error(err);

    await registrarAuditoria(req, {
      modulo: 'AUTH_VET_WEB',
      accion: 'LOGIN_ERROR',
      entidad: 'veterinario',
      entidad_id: email,
      descripcion: `Error interno login veterinario: ${email}`,
      metadata: { email, error: err.message },
    });

    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const createVeterinario = async (req, res) => {
  // ... (la cabecera con clinicaId)
  const { nombre, especialidad, telefono, email, password, rol: rolNombre } = req.body;

  try {
    // clinica_id ideal: del token del admin
    const clinica_id = req.user?.clinica_id ?? 1;

    // Obtenemos el ID del rol a partir de su nombre ('admin' o 'veterinario')
    const rolRes = await pool.query('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
    if (rolRes.rows.length === 0) {
      await registrarAuditoria(req, {
        modulo: 'USUARIOS_PANEL',
        accion: 'CREAR_FAIL',
        entidad: 'user',
        entidad_id: email,
        descripcion: `Intento crear usuario con rol inválido: ${rolNombre} (email: ${email})`,
        metadata: { rolNombre, email, clinica_id },
      });

      return res.status(400).json({ message: `El rol '${rolNombre}' no es válido.` });
    }
    const rolId = rolRes.rows[0].id;

    const hashedPassword = await bcrypt.hash(password, 10);

    // BEFORE no aplica porque es insert
    await pool.query(
      `INSERT INTO users (nombre, email, password, rol_id, telefono, clinica_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [nombre, email, hashedPassword, rolId, telefono, clinica_id]
    );

    await registrarAuditoria(req, {
      modulo: 'USUARIOS_PANEL',
      accion: 'CREAR',
      entidad: 'user',
      entidad_id: email,
      descripcion: `Creó usuario desde panel: ${email} (rol: ${rolNombre})`,
      metadata: {
        after: { nombre, email, telefono, rolNombre, rol_id: rolId, clinica_id },
        extra: { especialidad: especialidad || null },
      },
    });

    res.status(201).json({ message: 'Usuario creado correctamente' });
  } catch (err) {
    if (err.code === '23505') {
      await registrarAuditoria(req, {
        modulo: 'USUARIOS_PANEL',
        accion: 'CREAR_FAIL',
        entidad: 'user',
        entidad_id: email,
        descripcion: `No se pudo crear usuario (email duplicado): ${email}`,
        metadata: { email, error_code: err.code },
      });

      return res.status(409).json({ message: 'El correo electrónico ya está registrado.' });
    }

    console.error('Error creando usuario desde panel:', err);

    await registrarAuditoria(req, {
      modulo: 'USUARIOS_PANEL',
      accion: 'CREAR_ERROR',
      entidad: 'user',
      entidad_id: email,
      descripcion: `Error interno creando usuario desde panel: ${email}`,
      metadata: { email, error: err.message },
    });

    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  loginVeterinario,
  createVeterinario,
};
// Backend/src/controllers/onboarding.controller.js web
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

function generarCodigoClinica() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `ANIMA-${s}`;
}

const registerClinicAndAdmin = async (req, res) => {
  const {
    clinica: { nombre, telefono, direccion, nit, email } = {},
    admin: { email_admin, password, nombre_admin } = {},
  } = req.body;

  if (!nombre || !email_admin || !password) {
    await registrarAuditoria(req, {
      modulo: 'ONBOARDING',
      accion: 'CREAR_FAIL',
      entidad: 'clinica',
      entidad_id: email_admin || 'sin_email',
      descripcion: 'Onboarding fallido: datos incompletos',
      metadata: { body: req.body },
    });

    return res.status(400).json({ message: 'Datos incompletos.' });
  }
  if (password.length < 8) {
    await registrarAuditoria(req, {
      modulo: 'ONBOARDING',
      accion: 'CREAR_FAIL',
      entidad: 'clinica',
      entidad_id: email_admin,
      descripcion: 'Onboarding fallido: contraseña menor a 8',
      metadata: { email_admin },
    });

    return res.status(400).json({ message: 'La contraseña debe tener mínimo 8 caracteres.' });
  }

  const client = await pool.connect();

  try {
    // 1) Email repetido
    const existing = await client.query(
      `SELECT u.id, r.nombre AS rol_nombre
       FROM users u
       JOIN roles r ON r.id = u.rol_id
       WHERE u.email = $1`,
      [email_admin]
    );

    if (existing.rows.length > 0) {
      const rol = (existing.rows[0].rol_nombre || '').toLowerCase();

      await registrarAuditoria(req, {
        modulo: 'ONBOARDING',
        accion: 'CREAR_FAIL',
        entidad: 'clinica',
        entidad_id: email_admin,
        descripcion: `Onboarding fallido: email ya registrado (rol: ${rol})`,
        metadata: { email_admin, rol },
      });

      if (rol === 'dueño' || rol === 'dueno') {
        return res.status(409).json({
          message: 'Este correo ya existe en la app móvil (rol dueño). Usa otro correo para la clínica.',
        });
      }
      return res.status(409).json({ message: 'Email ya registrado.' });
    }

    // 2) rol admin
    const rolAdmin = await client.query(`SELECT id FROM roles WHERE nombre = 'admin' LIMIT 1`);
    if (rolAdmin.rows.length === 0) {
      await registrarAuditoria(req, {
        modulo: 'ONBOARDING',
        accion: 'CREAR_ERROR',
        entidad: 'roles',
        entidad_id: 'admin',
        descripcion: 'No existe el rol admin en la tabla roles',
        metadata: {},
      });

      return res.status(500).json({ message: 'No existe el rol admin en la tabla roles.' });
    }
    const rolAdminId = rolAdmin.rows[0].id;

    // 3) codigo clinica unico
    let codigoClinica = generarCodigoClinica();
    for (let tries = 0; tries < 15; tries++) {
      const existsCode = await client.query(
        'SELECT 1 FROM clinicas WHERE codigo_clinica = $1 LIMIT 1',
        [codigoClinica]
      );
      if (existsCode.rows.length === 0) break;
      codigoClinica = generarCodigoClinica();
    }

    const hashed = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    // 4) crear clinica
    const clinicRes = await client.query(
      `INSERT INTO clinicas (nombre, telefono, direccion, nit, email, codigo_clinica)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, nombre, codigo_clinica`,
      [nombre, telefono || null, direccion || null, nit || null, email || null, codigoClinica]
    );
    const clinicaId = clinicRes.rows[0].id;

    // 5) crear user admin
    const userRes = await client.query(
      `INSERT INTO users (email, password, rol_id, clinica_id, nombre, rol)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, email, rol_id, clinica_id, nombre, rol`,
      [email_admin, hashed, rolAdminId, clinicaId, nombre_admin || '', 'admin']
    );

    await client.query('COMMIT');

    // Auditoría éxito
    await registrarAuditoria(req, {
      modulo: 'ONBOARDING',
      accion: 'CREAR',
      entidad: 'clinica',
      entidad_id: clinicaId,
      descripcion: `Creó clínica y admin: ${clinicRes.rows[0].nombre} (admin: ${email_admin})`,
      metadata: {
        clinica: clinicRes.rows[0],
        admin: { id: userRes.rows[0].id, email: userRes.rows[0].email, rol_id: userRes.rows[0].rol_id },
      },
    });

    // 6) token
    const token = jwt.sign(
      {
        id: userRes.rows[0].id,
        email: userRes.rows[0].email,
        rol_id: userRes.rows[0].rol_id,
        clinica_id: userRes.rows[0].clinica_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.status(201).json({
      token,
      clinica: {
        id: clinicaId,
        nombre: clinicRes.rows[0].nombre,
        codigo_clinica: clinicRes.rows[0].codigo_clinica,
      },
      user: {
        ...userRes.rows[0],
        rol: 'admin',
      },
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    console.error('registerClinicAndAdmin error:', err);

    await registrarAuditoria(req, {
      modulo: 'ONBOARDING',
      accion: 'CREAR_ERROR',
      entidad: 'clinica',
      entidad_id: email_admin || 'sin_email',
      descripcion: 'Error creando clínica (rollback)',
      metadata: { error: err.message, body: req.body },
    });

    return res.status(500).json({ message: 'Error creando clínica.' });
  } finally {
    client.release();
  }
};

module.exports = { registerClinicAndAdmin };
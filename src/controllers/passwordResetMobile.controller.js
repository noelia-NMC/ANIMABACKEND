// backend/src/controllers/passwordResetMobile.controller.js  mobile
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { sendResetCodeEmail } = require('../services/mailer');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generate6DigitCode() {
  // 100000 - 999999
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

exports.forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: 'Email es obligatorio' });

    // Buscar usuario
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE LOWER(email) = $1 LIMIT 1',
      [email]
    );

    // Respuesta “neutral” para no filtrar si existe o no
    // (seguridad: evita que alguien adivine correos registrados)
    if (userResult.rows.length === 0) {
      return res.json({ ok: true, message: 'Si el correo existe, se enviará un código.' });
    }

    const user = userResult.rows[0];

    const code = generate6DigitCode();
    const ttlMinutes = Number(process.env.RESET_CODE_TTL_MINUTES || 15);

    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const codeHash = sha256(code);

    await pool.query(
      `UPDATE users
       SET reset_code_hash = $1,
           reset_code_expires = $2
       WHERE id = $3`,
      [codeHash, expiresAt, user.id]
    );

    await sendResetCodeEmail({ to: user.email, code });

    return res.json({ ok: true, message: 'Si el correo existe, se enviará un código.' });
  } catch (error) {
    console.error('❌ forgotPassword error:', error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();
    const newPassword = String(req.body.newPassword || '').trim();

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, código y nueva contraseña son obligatorios' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const userResult = await pool.query(
      `SELECT id, reset_code_hash, reset_code_expires
       FROM users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: 'Código inválido o expirado' });
    }

    const user = userResult.rows[0];

    if (!user.reset_code_hash || !user.reset_code_expires) {
      return res.status(400).json({ message: 'Código inválido o expirado' });
    }

    const now = new Date();
    const expires = new Date(user.reset_code_expires);

    if (now > expires) {
      return res.status(400).json({ message: 'Código inválido o expirado' });
    }

    const incomingHash = sha256(code);

    if (incomingHash !== user.reset_code_hash) {
      return res.status(400).json({ message: 'Código inválido o expirado' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    // OJO: ajusta el nombre de columna si tu tabla usa "password" o "password_hash"
    // Aquí asumo que guardas "password" como hash (muy común en proyectos simples).
    await pool.query(
      `UPDATE users
       SET password = $1,
           reset_code_hash = NULL,
           reset_code_expires = NULL
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    return res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('❌ resetPassword error:', error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
};
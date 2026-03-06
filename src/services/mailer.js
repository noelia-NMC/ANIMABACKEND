// backend/src/services/mailer.js
const nodemailer = require('nodemailer');

function getTransporter() {
  const port = Number(process.env.MAIL_PORT || 465);
  const secure = String(process.env.MAIL_SECURE || 'true') === 'true';

  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
}

async function sendResetCodeEmail({ to, code }) {
  const transporter = getTransporter();

  const from = process.env.MAIL_FROM || process.env.MAIL_USER;

  const subject = 'ANIMA - Código para recuperar tu contraseña';
  const text =
    `Tu código de recuperación es: ${code}\n\n` +
    `Este código vence en ${process.env.RESET_CODE_TTL_MINUTES || 15} minutos.\n` +
    `Si no pediste esto, ignora este mensaje.`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="margin: 0 0 10px;">Recuperación de contraseña (ANIMA)</h2>
      <p>Tu código de recuperación es:</p>
      <div style="font-size: 28px; font-weight: bold; letter-spacing: 3px; margin: 10px 0;">
        ${code}
      </div>
      <p>Este código vence en <b>${process.env.RESET_CODE_TTL_MINUTES || 15} minutos</b>.</p>
      <p style="color:#666;">Si no pediste esto, ignora este mensaje.</p>
    </div>
  `;

  await transporter.sendMail({ from, to, subject, text, html });
}

module.exports = { sendResetCodeEmail };
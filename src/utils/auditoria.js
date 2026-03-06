// Backend/src/utils/auditoria.js
const pool = require('../db');

const DEDUPE_TTL_MS = 2500; // 2.5s
const lastLogs = new Map();

function getIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || null;
}

function dedupeKey(req, data) {
  const clinica_id = req.user?.clinica_id ?? req.headers['clinica-id'] ?? null;
  const usuario_id = req.user?.id ?? null;

  return [
    clinica_id,
    usuario_id,
    data.modulo,
    data.accion,
    data.entidad,
    String(data.entidad_id ?? ''),
  ].join('|');
}

async function registrarAuditoria(req, data) {
  try {
    const clinica_id = req.user?.clinica_id ?? req.headers['clinica-id'] ?? null;

    // si no hay clinica, igual puedes registrar pero yo prefiero no romper
    if (!clinica_id) return;

    const usuario_id = req.user?.id ?? null;
    const usuario_nombre = req.user?.nombre ?? null;
    const usuario_email = req.user?.email ?? null;
    const usuario_rol = req.user?.rol ?? req.user?.rol_nombre ?? null;
    const ip = getIP(req);

    // ✅ DEDUPE
    const key = dedupeKey(req, data);
    const now = Date.now();
    const last = lastLogs.get(key);
    if (last && now - last < DEDUPE_TTL_MS) return;
    lastLogs.set(key, now);

    // limpieza simple
    if (lastLogs.size > 2000) lastLogs.clear();

    await pool.query(
      `
      INSERT INTO public.auditoria_logsW
        (clinica_id, modulo, accion, entidad, entidad_id, descripcion, metadata,
         usuario_id, usuario_nombre, usuario_email, usuario_rol, ip, creado_en)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      `,
      [
        clinica_id,
        data.modulo || null,
        data.accion || null,
        data.entidad || null,
        data.entidad_id != null ? String(data.entidad_id) : null,
        data.descripcion || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        usuario_id,
        usuario_nombre,
        usuario_email,
        usuario_rol,
        ip,
      ]
    );
  } catch (err) {
    console.error('[registrarAuditoria]', err);
  }
}

module.exports = { registrarAuditoria };
// 📁 backend/src/controllers/eventos.controller.js       mobile

const pool = require('../db');

const ALLOWED_TYPES = [
  'vacuna',
  'consulta',
  'medicamento',
  'baño',
  'desparasitacion',
  'otro',
];

exports.getEventos = async (req, res) => {
  try {
    const userId = req.user.id;
    const query = `
      SELECT 
        e.id, 
        e.title, 
        TO_CHAR(e.date, 'YYYY-MM-DD') as date, 
        e.notes, 
        e.type, 
        e.mascota_id,
        e.notification_id, -- MEJORA: Obtener el ID de la notificación
        pm.nombre as mascota_nombre
      FROM eventos e
      JOIN perfiles_mascotas pm ON e.mascota_id = pm.id
      WHERE e.user_id = $1
      ORDER BY e.date ASC, e.id ASC
    `;
    const result = await pool.query(query, [userId]);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error en getEventos:', error);
    res.status(500).json({ message: 'Error interno del servidor al obtener eventos.' });
  }
};

/**
 * Crea un nuevo evento asociado a un usuario y una de sus mascotas.
 */
exports.createEvento = async (req, res) => {
  try {
    const userId = req.user.id;
    // MEJORA: Recibimos notificationId desde el body
    let { title, date, notes, type, mascotaId, notificationId } = req.body;

    if (!title || !date || !mascotaId) {
      return res.status(400).json({
        message: 'El título, la fecha y la mascota son obligatorios.',
      });
    }

    // Normalizamos y validamos el tipo
    type = (type || 'otro').toLowerCase().trim();
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({
        message: `Tipo de evento inválido. Debe ser uno de: ${ALLOWED_TYPES.join(
          ', '
        )}.`,
      });
    }

    // MEJORA: Actualizamos la consulta para incluir el nuevo campo
    const query = `
      INSERT INTO eventos (title, date, notes, type, user_id, mascota_id, notification_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    // MEJORA: Añadimos el nuevo valor al array de valores
    const values = [title.trim(), date, notes?.trim() || null, type, userId, mascotaId, notificationId || null];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error en createEvento:', error);
    res
      .status(500)
      .json({ message: 'Error interno del servidor al crear el evento.' });
  }
};

/**
 * Elimina un evento, verificando que pertenezca al usuario que realiza la solicitud.
 */
exports.deleteEvento = async (req, res) => {
  try {
    const eventoId = req.params.id;
    const userId = req.user.id;

    const query = `DELETE FROM eventos WHERE id = $1 AND user_id = $2 RETURNING id`;
    const result = await pool.query(query, [eventoId, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Evento no encontrado o no autorizado para eliminar.' });
    }
    res.status(200).json({ message: 'Evento eliminado exitosamente.' });
  } catch (error) {
    console.error('Error en deleteEvento:', error);
    res.status(500).json({ message: 'Error interno del servidor al eliminar el evento.' });
  }
};
const pool = require('../db');                                //mobile
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { db: firebaseDb } = require('../config/firebaseAdmin'); // Importamos la DB de Firebase

// --- Función de Logging ---
const logReportGeneration = async (userId, mascotaId, tipo, formato, rango) => {
  try {
    await pool.query(
      'INSERT INTO reportes_logs (user_id, mascota_id, tipo_reporte, formato, parametros) VALUES ($1, $2, $3, $4, $5)',
      [userId, mascotaId, tipo, formato, JSON.stringify(rango)]
    );
  } catch (error) {
    console.error("Error al registrar la generación del reporte:", error);
  }
};

// --- Helpers para Generación de PDF ---
const generarPdfActividades = async (res, data, mascota) => {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  // Headers para la descarga
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="reporte_actividades_${mascota.nombre}.pdf"`);
  doc.pipe(res);

  // Contenido del PDF
  doc.fontSize(20).text(`Reporte de Actividades de ${mascota.nombre}`, { align: 'center' });
  doc.fontSize(12).text(`Periodo: ${new Date(data.rango.inicio).toLocaleDateString('es-ES')} - ${new Date(data.rango.fin).toLocaleDateString('es-ES')}`, { align: 'center' });
  doc.moveDown(2);

  if (data.eventos.length === 0) {
    doc.text('No se encontraron eventos en las fechas seleccionadas.');
  } else {
    data.eventos.forEach(evento => {
      doc.fontSize(14).fillColor('blue').text(evento.title, { continued: true }).fillColor('black').text(` (${evento.type})`);
      doc.fontSize(10).text(`Fecha: ${new Date(evento.date).toLocaleDateString('es-ES')}`);
      if (evento.notes) {
        doc.text(`Notas: ${evento.notes}`);
      }
      doc.moveDown();
    });
  }

  doc.end();
};

// --- Helpers para Generación de Excel ---
const generarXlsxActividades = async (res, data, mascota) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Actividades de ${mascota.nombre}`);

    worksheet.columns = [
        { header: 'Título', key: 'title', width: 30 },
        { header: 'Tipo', key: 'type', width: 20 },
        { header: 'Fecha', key: 'date', width: 15 },
        { header: 'Notas', key: 'notes', width: 50 },
    ];
    worksheet.getRow(1).font = { bold: true };
    
    data.eventos.forEach(e => {
        worksheet.addRow({
            ...e,
            date: new Date(e.date).toLocaleDateString('es-ES')
        });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte_actividades_${mascota.nombre}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
};

// --- Controlador Principal ---
exports.generarReporte = async (req, res) => {
  const userId = req.user.id;
  const { mascotaId, tipo, formato, rango } = req.body;

  if (!mascotaId || !tipo || !formato || !rango) {
    return res.status(400).json({ message: 'Faltan parámetros para generar el reporte.' });
  }

  try {
    // 1. Obtener datos de la mascota
    const mascotaRes = await pool.query('SELECT * FROM perfiles_mascotas WHERE id = $1 AND propietario_id = $2', [mascotaId, userId]);
    if (mascotaRes.rows.length === 0) {
      return res.status(404).json({ message: 'Mascota no encontrada o no te pertenece.' });
    }
    const mascota = mascotaRes.rows[0];

    // 2. Generar reporte según el tipo
    if (tipo === 'actividades') {
      const eventosRes = await pool.query(
        `SELECT title, type, date, notes FROM eventos
         WHERE mascota_id = $1 AND user_id = $2 AND date BETWEEN $3 AND $4
         ORDER BY date DESC`,
        [mascotaId, userId, rango.inicio, rango.fin]
      );
      
      const data = { eventos: eventosRes.rows, rango };

      if (formato === 'pdf') {
        await generarPdfActividades(res, data, mascota);
      } else if (formato === 'xlsx') {
        await generarXlsxActividades(res, data, mascota);
      } else {
        return res.status(400).json({ message: 'Formato no soportado.' });
      }

      // Loggear después de enviar la respuesta
      await logReportGeneration(userId, mascotaId, tipo, formato, rango);

    } else if (tipo === 'collar') {
        // Lógica para el reporte del collar (usando Firebase)
        // NOTA: Asumimos que los datos históricos se guardan en una ruta como `historial_collar/${mascota.collar_id}`
        const collarRef = firebaseDb.ref(`historial_collar/${mascota.collar_id}`);
        const snapshot = await collarRef.orderByChild('fecha')
                                         .startAt(new Date(rango.inicio).getTime())
                                         .endAt(new Date(rango.fin).getTime())
                                         .once('value');
        
        const collarData = [];
        if (snapshot.exists()) {
            snapshot.forEach(childSnapshot => {
                collarData.push({ id: childSnapshot.key, ...childSnapshot.val() });
            });
        }
        
        // Aquí irían las funciones generarPdfCollar y generarXlsxCollar (similares a las de actividades)
        // Por simplicidad, por ahora devolvemos un mensaje. Puedes construirlas siguiendo el mismo patrón.
        res.status(501).json({ message: 'La generación de reportes del collar está en desarrollo.', data: collarData });
        
        await logReportGeneration(userId, mascotaId, tipo, formato, rango);

    } else {
      return res.status(400).json({ message: 'Tipo de reporte no válido.' });
    }
  } catch (error) {
    console.error('Error al generar reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};
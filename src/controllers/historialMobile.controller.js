const pool = require('../db');        //mobile

/**
 * @description Obtiene un historial clínico unificado para una mascota específica.
 * Combina datos de teleconsultas finalizadas y eventos de tipo 'consulta', 'vacuna', etc.
 */
exports.getHistorialClinicoPorMascota = async (req, res) => {
    const userId = req.user.id;
    const { mascotaId } = req.params;

    if (!mascotaId) {
        return res.status(400).json({ message: 'Se requiere el ID de la mascota.' });
    }

    try {
        // 1. Verificar que la mascota pertenece al usuario
        const mascotaCheck = await pool.query(
            'SELECT nombre FROM perfiles_mascotas WHERE id = $1 AND propietario_id = $2',
            [mascotaId, userId]
        );

        if (mascotaCheck.rows.length === 0) {
            return res.status(404).json({ message: 'Mascota no encontrada o no te pertenece.' });
        }
        
        const nombreMascota = mascotaCheck.rows[0].nombre;

        // 2. Obtener teleconsultas finalizadas
        const teleconsultasQuery = `
            SELECT 
                id, 
                'Teleconsulta' as tipo,
                fecha as fecha_evento,
                motivo as titulo,
                'Consulta finalizada' as notas,
                (SELECT u.nombre || ' ' || u.apellido FROM users u WHERE u.id = t.veterinario_id) as fuente
            FROM teleconsultas t
            WHERE mascota_id = $1 AND estado = 'finalizada'
        `;
        const teleconsultasRes = await pool.query(teleconsultasQuery, [mascotaId]);

        // 3. Obtener eventos relevantes registrados por el usuario
        const tiposEventoRelevantes = ['consulta', 'vacuna', 'medicamento', 'desparasitacion'];
        const eventosQuery = `
            SELECT 
                id, 
                type as tipo,
                date as fecha_evento,
                title as titulo,
                notes as notas,
                'Registrado por mí' as fuente
            FROM eventos
            WHERE mascota_id = $1 AND type = ANY($2::varchar[])
        `;
        const eventosRes = await pool.query(eventosQuery, [mascotaId, tiposEventoRelevantes]);

        // 4. Unir y ordenar los resultados
        const historialCompleto = [...teleconsultasRes.rows, ...eventosRes.rows];
        
        historialCompleto.sort((a, b) => new Date(b.fecha_evento) - new Date(a.fecha_evento));

        res.status(200).json({
            nombreMascota,
            historial: historialCompleto
        });

    } catch (error) {
        console.error('Error al obtener historial clínico:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};
// Backend/src/controllers/reporteswebgeneral.controller.js
const pool = require('../db');
const PDFDocument = require('pdfkit-table');
const Excel = require('exceljs');
const { registrarAuditoria } = require('../utils/auditoria');

// ==============================
// Helpers base
// ==============================
const getClinicaId = (req) => req.user?.clinica_id ?? req.headers['clinica-id'] ?? null;

const safeAudit = async (req, payload) => {
  try {
    await registrarAuditoria(req, payload);
  } catch (e) {
    console.warn('[AUDITORIA_FAIL]', e?.message);
  }
};

const parseFechas = (req) => {
  const { fechaInicio, fechaFin } = req.query;
  if (!fechaInicio || !fechaFin) return null;
  return { fechaInicio, fechaFin };
};

const parsePagination = (req) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const safeQuery = async (warnings, label, sql, params = []) => {
  try {
    const r = await pool.query(sql, params);
    return r.rows || [];
  } catch (e) {
    warnings.push({ label, error: e.message });
    console.warn(`[safeQuery:${label}]`, e.message);
    return [];
  }
};

const detectHistorialDateCol = async () => {
  try {
    await pool.query(`SELECT fecha FROM public.historial_clinico LIMIT 1`);
    return 'fecha';
  } catch {
    return 'creado_en';
  }
};

const parseInclude = (req) => {
  const inc = req.query.include;
  const arr = Array.isArray(inc) ? inc : inc ? [inc] : [];
  const set = new Set(arr.map((x) => String(x).toLowerCase()));
  if (!set.size) ['resumen', 'turnos', 'inventario', 'tele', 'lab', 'diag'].forEach((x) => set.add(x));
  return set;
};

const parseRangeForExport = (req) => {
  const f = parseFechas(req);
  const hoy = new Date();
  const fechaFin = f?.fechaFin || hoy.toISOString().slice(0, 10);
  const fechaInicio =
    f?.fechaInicio || new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { fechaInicio, fechaFin };
};

const isAdminFromReq = async (req) => {
  if (req.user?.rol) return String(req.user.rol).toLowerCase() === 'admin';
  if (!req.user?.id) return false;

  try {
    const r = await pool.query(
      `SELECT r.nombre as rol
       FROM public.users u
       JOIN public.roles r ON r.id = u.rol_id
       WHERE u.id = $1
       LIMIT 1`,
      [req.user.id]
    );
    return (r.rows[0]?.rol || '').toLowerCase() === 'admin';
  } catch {
    return false;
  }
};

// ==============================
// BASE DATA
// ==============================
const getReporteBase = async (clinicaId) => {
  const [
    totalMascotasRes,
    turnosEsteMesRes,
    veterinariosActivosRes,
    turnosPendientesRes,
    mascotasConsultadasRes,
    tiposConsultasRes,
    razasAtendidasRes,
  ] = await Promise.all([
    pool.query('SELECT COUNT(*)::int as total FROM public.mascotas WHERE clinica_id = $1', [clinicaId]),
    pool.query(
      `SELECT COUNT(*)::int as total
       FROM public.turnos
       WHERE EXTRACT(MONTH FROM fecha) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND EXTRACT(YEAR FROM fecha) = EXTRACT(YEAR FROM CURRENT_DATE)
         AND clinica_id = $1`,
      [clinicaId]
    ),
    pool.query(
      `SELECT COUNT(*)::int as total
       FROM public.users
       WHERE rol_id = (SELECT id FROM public.roles WHERE nombre = 'veterinario')
         AND clinica_id = $1`,
      [clinicaId]
    ),
    pool.query(
      `SELECT COUNT(*)::int as total
       FROM public.turnos
       WHERE fecha >= CURRENT_DATE
         AND clinica_id = $1`,
      [clinicaId]
    ),
    pool.query(
      `SELECT m.nombre as mascota,
              COALESCE(m.raza, 'Sin raza') as raza,
              COUNT(t.id)::int as total_consultas
       FROM public.mascotas m
       LEFT JOIN public.turnos t ON m.id = t.mascota_id
       WHERE m.clinica_id = $1 AND t.id IS NOT NULL
       GROUP BY m.id
       ORDER BY total_consultas DESC
       LIMIT 10`,
      [clinicaId]
    ),
    pool.query(
      `SELECT COALESCE(t.motivo, 'Sin motivo especificado') as motivo,
              COUNT(*)::int as cantidad,
              ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM public.turnos WHERE clinica_id = $1), 0), 2) as porcentaje
       FROM public.turnos t
       WHERE t.clinica_id = $1
       GROUP BY t.motivo
       ORDER BY cantidad DESC
       LIMIT 10`,
      [clinicaId]
    ),
    pool.query(
      `SELECT COALESCE(m.raza, 'Sin raza especificada') as raza,
              COUNT(t.id)::int as total_consultas
       FROM public.mascotas m
       LEFT JOIN public.turnos t ON m.id = t.mascota_id
       WHERE m.clinica_id = $1 AND t.id IS NOT NULL
       GROUP BY m.raza
       ORDER BY total_consultas DESC
       LIMIT 10`,
      [clinicaId]
    ),
  ]);

  return {
    dashboard: {
      totalMascotas: totalMascotasRes.rows[0]?.total || 0,
      turnosEsteMes: turnosEsteMesRes.rows[0]?.total || 0,
      veterinariosActivos: veterinariosActivosRes.rows[0]?.total || 0,
      turnosPendientes: turnosPendientesRes.rows[0]?.total || 0,
    },
    mascotasConsultadas: mascotasConsultadasRes.rows,
    tiposConsultas: tiposConsultasRes.rows,
    razasAtendidas: razasAtendidasRes.rows,
  };
};

// ==============================
// BUNDLE
// ==============================
const getReportesBundle = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  const { fechaInicio, fechaFin } = parseRangeForExport(req);
  const warnings = [];

  try {
    const isAdmin = await isAdminFromReq(req);
    const base = await getReporteBase(clinicaId);

    const turnosPorPeriodo = await safeQuery(
      warnings,
      'turnosPorPeriodo',
      `SELECT DATE(t.fecha) as fecha, COUNT(*)::int as total_turnos
       FROM public.turnos t
       WHERE t.fecha BETWEEN $1 AND $2 AND t.clinica_id = $3
       GROUP BY DATE(t.fecha)
       ORDER BY fecha DESC`,
      [fechaInicio, fechaFin, clinicaId]
    );

    const stockBajo = await safeQuery(
      warnings,
      'stockBajo',
      `SELECT id, nombre, categoria, stock_actual, stock_minimo
       FROM public.productosW
       WHERE clinica_id = $1
         AND activo = TRUE
         AND COALESCE(stock_actual,0) <= COALESCE(stock_minimo,0)
       ORDER BY COALESCE(stock_actual,0) ASC, id DESC
       LIMIT 200`,
      [clinicaId]
    );

    const movsStockResumen = await safeQuery(
      warnings,
      'movsStockResumen',
      `SELECT ms.tipo_movimiento,
              COUNT(*)::int as cantidad_movs,
              COALESCE(SUM(ms.cantidad),0)::int as total_unidades
       FROM public.movimientos_stockW ms
       WHERE ms.clinica_id = $1
         AND ms.creado_en::date BETWEEN $2::date AND $3::date
       GROUP BY ms.tipo_movimiento
       ORDER BY cantidad_movs DESC`,
      [clinicaId, fechaInicio, fechaFin]
    );

    const topConsumidos = await safeQuery(
      warnings,
      'topConsumidos',
      `SELECT p.id as producto_id,
              p.nombre,
              COALESCE(SUM(ms.cantidad),0)::int as total_salida,
              COUNT(*)::int as movimientos
       FROM public.movimientos_stockW ms
       JOIN public.productosW p ON p.id = ms.producto_id
       WHERE ms.clinica_id = $1
         AND ms.tipo_movimiento = 'SALIDA'
         AND ms.creado_en::date BETWEEN $2::date AND $3::date
       GROUP BY p.id, p.nombre
       ORDER BY total_salida DESC
       LIMIT 10`,
      [clinicaId, fechaInicio, fechaFin]
    );

    // ✅ FIX REAL: teleconsultas no tiene clinica_id -> JOIN mascotas
    const teleconsultaEstados = await safeQuery(
      warnings,
      'teleconsultaEstados',
      `SELECT t.estado, COUNT(*)::int as cantidad
       FROM public.teleconsultas t
       JOIN public.mascotas m ON m.id = t.mascota_id
       WHERE m.clinica_id = $1
         AND t.fecha::date BETWEEN $2::date AND $3::date
       GROUP BY t.estado
       ORDER BY cantidad DESC`,
      [clinicaId, fechaInicio, fechaFin]
    );

    const labPorTipo = await safeQuery(
      warnings,
      'labPorTipo',
      `SELECT COALESCE(tipo_examen,'Sin tipo') as tipo_examen, COUNT(*)::int as cantidad
       FROM public.laboratorio_resultados
       WHERE clinica_id = $1
         AND fecha::date BETWEEN $2::date AND $3::date
       GROUP BY COALESCE(tipo_examen,'Sin tipo')
       ORDER BY cantidad DESC
       LIMIT 20`,
      [clinicaId, fechaInicio, fechaFin]
    );

    const labRecientes = await safeQuery(
      warnings,
      'labRecientes',
      `SELECT lr.id, lr.tipo_examen, lr.fecha, lr.notas,
              m.nombre as nombre_mascota
       FROM public.laboratorio_resultados lr
       JOIN public.mascotas m ON m.id = lr.mascota_id
       WHERE lr.clinica_id = $1
       ORDER BY lr.fecha DESC, lr.id DESC
       LIMIT 20`,
      [clinicaId]
    );

    const dateCol = await detectHistorialDateCol();
    const diagnosticosTop = await safeQuery(
      warnings,
      'diagnosticosTop',
      `SELECT COALESCE(hc.diagnostico,'Sin diagnóstico') as diagnostico,
              COUNT(*)::int as cantidad
       FROM public.historial_clinico hc
       WHERE hc.clinica_id = $1
         AND hc.${dateCol}::date BETWEEN $2::date AND $3::date
       GROUP BY COALESCE(hc.diagnostico,'Sin diagnóstico')
       ORDER BY cantidad DESC
       LIMIT 10`,
      [clinicaId, fechaInicio, fechaFin]
    );

    const actividadVeterinarios = isAdmin
      ? await safeQuery(
          warnings,
          'actividadVeterinarios',
          `SELECT COALESCE(u.nombre, 'Sin nombre') as veterinario,
                  COALESCE(u.email, 'Sin email') as email,
                  COUNT(t.id)::int as total_consultas,
                  COUNT(DISTINCT t.mascota_id)::int as mascotas_atendidas
           FROM public.users u
           LEFT JOIN public.turnos t ON u.id = t.veterinario_id
           WHERE u.rol_id = (SELECT id FROM public.roles WHERE nombre = 'veterinario')
             AND u.clinica_id = $1
             AND (t.fecha BETWEEN $2 AND $3 OR t.id IS NULL)
           GROUP BY u.id, u.nombre, u.email
           ORDER BY total_consultas DESC`,
          [clinicaId, fechaInicio, fechaFin]
        )
      : [];

    return res.json({
      rango: { fechaInicio, fechaFin },
      base,
      turnosPorPeriodo,
      actividadVeterinarios,
      stockBajo,
      movsStockResumen,
      topConsumidos,
      teleconsultaEstados,
      labPorTipo,
      labRecientes,
      diagnosticosTop,
      warnings,
    });
  } catch (e) {
    console.error('[getReportesBundle]', e);
    await safeAudit(req, {
      modulo: 'REPORTES',
      accion: 'BUNDLE_ERROR',
      entidad: 'bundle',
      entidad_id: `clinica:${clinicaId}`,
      descripcion: 'Error cargando reportes bundle',
      metadata: { clinica_id: clinicaId, error: e.message },
    });
    return res.status(500).json({ message: 'Error al cargar reportes (bundle)', error: e.message });
  }
};

// ==============================
// ENDPOINTS BASE
// ==============================
const getDashboardResumen = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  try {
    const base = await getReporteBase(clinicaId);
    return res.json(base.dashboard);
  } catch (e) {
    console.error('[getDashboardResumen]', e);
    return res.status(500).json({ message: 'Error al obtener dashboard', error: e.message });
  }
};

const getTurnosPorPeriodo = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const fechas = parseFechas(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });
  if (!fechas) return res.status(400).json({ message: 'Se requieren fechaInicio y fechaFin' });

  try {
    const r = await pool.query(
      `SELECT DATE(t.fecha) as fecha, COUNT(*)::int as total_turnos
       FROM public.turnos t
       WHERE t.fecha BETWEEN $1 AND $2 AND t.clinica_id = $3
       GROUP BY DATE(t.fecha)
       ORDER BY fecha DESC`,
      [fechas.fechaInicio, fechas.fechaFin, clinicaId]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getTurnosPorPeriodo]', e);
    return res.status(500).json({ message: 'Error turnos por periodo', error: e.message });
  }
};

const getMascotasMasConsultadas = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  try {
    const r = await pool.query(
      `SELECT m.nombre as mascota,
              COALESCE(m.raza, 'Sin raza') as raza,
              COUNT(t.id)::int as total_consultas
       FROM public.mascotas m
       LEFT JOIN public.turnos t ON m.id = t.mascota_id
       WHERE m.clinica_id = $1 AND t.id IS NOT NULL
       GROUP BY m.id
       ORDER BY total_consultas DESC
       LIMIT 10`,
      [clinicaId]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getMascotasMasConsultadas]', e);
    return res.status(500).json({ message: 'Error mascotas consultadas', error: e.message });
  }
};

const getTiposConsultasFrecuentes = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  try {
    const r = await pool.query(
      `SELECT COALESCE(t.motivo, 'Sin motivo especificado') as motivo,
              COUNT(*)::int as cantidad,
              ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM public.turnos WHERE clinica_id = $1), 0), 2) as porcentaje
       FROM public.turnos t
       WHERE t.clinica_id = $1
       GROUP BY t.motivo
       ORDER BY cantidad DESC
       LIMIT 10`,
      [clinicaId]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getTiposConsultasFrecuentes]', e);
    return res.status(500).json({ message: 'Error tipos consultas', error: e.message });
  }
};

const getRazasMasAtendidas = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  try {
    const r = await pool.query(
      `SELECT COALESCE(m.raza, 'Sin raza especificada') as raza,
              COUNT(t.id)::int as total_consultas
       FROM public.mascotas m
       LEFT JOIN public.turnos t ON m.id = t.mascota_id
       WHERE m.clinica_id = $1 AND t.id IS NOT NULL
       GROUP BY m.raza
       ORDER BY total_consultas DESC
       LIMIT 10`,
      [clinicaId]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getRazasMasAtendidas]', e);
    return res.status(500).json({ message: 'Error razas atendidas', error: e.message });
  }
};

const getActividadVeterinarios = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const fechas = parseFechas(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });
  if (!fechas) return res.status(400).json({ message: 'Se requieren fechaInicio y fechaFin' });

  try {
    const r = await pool.query(
      `SELECT COALESCE(u.nombre, 'Sin nombre') as veterinario,
              COALESCE(u.email, 'Sin email') as email,
              COUNT(t.id)::int as total_consultas,
              COUNT(DISTINCT t.mascota_id)::int as mascotas_atendidas
       FROM public.users u
       LEFT JOIN public.turnos t ON u.id = t.veterinario_id
       WHERE u.rol_id = (SELECT id FROM public.roles WHERE nombre = 'veterinario')
         AND u.clinica_id = $1
         AND (t.fecha BETWEEN $2 AND $3 OR t.id IS NULL)
       GROUP BY u.id, u.nombre, u.email
       ORDER BY total_consultas DESC`,
      [clinicaId, fechas.fechaInicio, fechas.fechaFin]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getActividadVeterinarios]', e);
    return res.status(500).json({ message: 'Error actividad veterinarios', error: e.message });
  }
};

const getActividadMensual = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  try {
    const r = await pool.query(
      `SELECT TO_CHAR(t.fecha, 'YYYY-MM') as mes,
              COUNT(*)::int as total_turnos
       FROM public.turnos t
       WHERE t.fecha >= CURRENT_DATE - INTERVAL '12 months'
         AND t.clinica_id = $1
       GROUP BY TO_CHAR(t.fecha, 'YYYY-MM')
       ORDER BY mes DESC`,
      [clinicaId]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getActividadMensual]', e);
    return res.status(500).json({ message: 'Error actividad mensual', error: e.message });
  }
};

// ==============================
// PRO endpoints
// ==============================
const getStockBajo = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  const { page, limit, offset } = parsePagination(req);
  const q = (req.query.q || '').trim();

  try {
    const params = [clinicaId];
    let whereSearch = '';
    if (q) {
      params.push(`%${q}%`);
      whereSearch = `AND (p.nombre ILIKE $2 OR COALESCE(p.categoria,'') ILIKE $2)`;
    }

    const count = await pool.query(
      `SELECT COUNT(*)::int as total
       FROM public.productosW p
       WHERE p.clinica_id = $1
         AND p.activo = TRUE
         AND COALESCE(p.stock_actual,0) <= COALESCE(p.stock_minimo,0)
         ${whereSearch}`,
      params
    );

    const paramsData = [...params, limit, offset];
    const data = await pool.query(
      `SELECT p.id, p.nombre, p.categoria, p.stock_actual, p.stock_minimo
       FROM public.productosW p
       WHERE p.clinica_id = $1
         AND p.activo = TRUE
         AND COALESCE(p.stock_actual,0) <= COALESCE(p.stock_minimo,0)
         ${whereSearch}
       ORDER BY COALESCE(p.stock_actual,0) ASC, p.id DESC
       LIMIT $${paramsData.length - 1} OFFSET $${paramsData.length}`,
      paramsData
    );

    return res.json({ page, limit, total: count.rows[0]?.total || 0, rows: data.rows });
  } catch (e) {
    console.error('[getStockBajo]', e);
    return res.status(500).json({ message: 'Error stock bajo', error: e.message });
  }
};

const getMovimientosStockResumen = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const fechas = parseFechas(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });
  if (!fechas) return res.status(400).json({ message: 'Se requieren fechaInicio y fechaFin' });

  try {
    const r = await pool.query(
      `SELECT ms.tipo_movimiento,
              COUNT(*)::int as cantidad_movs,
              COALESCE(SUM(ms.cantidad),0)::int as total_unidades
       FROM public.movimientos_stockW ms
       WHERE ms.clinica_id = $1
         AND ms.creado_en::date BETWEEN $2::date AND $3::date
       GROUP BY ms.tipo_movimiento
       ORDER BY cantidad_movs DESC`,
      [clinicaId, fechas.fechaInicio, fechas.fechaFin]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getMovimientosStockResumen]', e);
    return res.status(500).json({ message: 'Error movimientos resumen', error: e.message });
  }
};

const getTopProductosConsumidos = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const fechas = parseFechas(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });
  if (!fechas) return res.status(400).json({ message: 'Se requieren fechaInicio y fechaFin' });

  try {
    const r = await pool.query(
      `SELECT p.id as producto_id,
              p.nombre,
              COALESCE(SUM(ms.cantidad),0)::int as total_salida,
              COUNT(*)::int as movimientos
       FROM public.movimientos_stockW ms
       JOIN public.productosW p ON p.id = ms.producto_id
       WHERE ms.clinica_id = $1
         AND ms.tipo_movimiento = 'SALIDA'
         AND ms.creado_en::date BETWEEN $2::date AND $3::date
       GROUP BY p.id, p.nombre
       ORDER BY total_salida DESC
       LIMIT 10`,
      [clinicaId, fechas.fechaInicio, fechas.fechaFin]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getTopProductosConsumidos]', e);
    return res.status(500).json({ message: 'Error top consumidos', error: e.message });
  }
};

// ✅ TELECONSULTAS ESTADOS (FIX real)
const getTeleconsultaEstados = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const fechas = parseFechas(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });
  if (!fechas) return res.status(400).json({ message: 'Se requieren fechaInicio y fechaFin' });

  try {
    const r = await pool.query(
      `SELECT t.estado, COUNT(*)::int as cantidad
       FROM public.teleconsultas t
       JOIN public.mascotas m ON m.id = t.mascota_id
       WHERE m.clinica_id = $1
         AND t.fecha::date BETWEEN $2::date AND $3::date
       GROUP BY t.estado
       ORDER BY cantidad DESC`,
      [clinicaId, fechas.fechaInicio, fechas.fechaFin]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getTeleconsultaEstados]', e);
    return res.status(500).json({ message: 'Error teleconsulta estados', error: e.message });
  }
};

const getLaboratorioPorTipo = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const fechas = parseFechas(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });
  if (!fechas) return res.status(400).json({ message: 'Se requieren fechaInicio y fechaFin' });

  try {
    const r = await pool.query(
      `SELECT COALESCE(tipo_examen,'Sin tipo') as tipo_examen,
              COUNT(*)::int as cantidad
       FROM public.laboratorio_resultados
       WHERE clinica_id = $1
         AND fecha::date BETWEEN $2::date AND $3::date
       GROUP BY COALESCE(tipo_examen,'Sin tipo')
       ORDER BY cantidad DESC
       LIMIT 20`,
      [clinicaId, fechas.fechaInicio, fechas.fechaFin]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getLaboratorioPorTipo]', e);
    return res.status(500).json({ message: 'Error lab por tipo', error: e.message });
  }
};

const getLaboratorioRecientes = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  const { page, limit, offset } = parsePagination(req);
  const q = (req.query.q || '').trim();

  try {
    const params = [clinicaId];
    let whereSearch = '';
    if (q) {
      params.push(`%${q}%`);
      whereSearch = `AND (COALESCE(lr.tipo_examen,'') ILIKE $2 OR COALESCE(m.nombre,'') ILIKE $2)`;
    }

    const count = await pool.query(
      `SELECT COUNT(*)::int as total
       FROM public.laboratorio_resultados lr
       JOIN public.mascotas m ON m.id = lr.mascota_id
       WHERE lr.clinica_id = $1
       ${whereSearch}`,
      params
    );

    const paramsData = [...params, limit, offset];
    const data = await pool.query(
      `SELECT lr.id, lr.tipo_examen, lr.fecha, lr.notas,
              m.nombre as nombre_mascota
       FROM public.laboratorio_resultados lr
       JOIN public.mascotas m ON m.id = lr.mascota_id
       WHERE lr.clinica_id = $1
       ${whereSearch}
       ORDER BY lr.fecha DESC, lr.id DESC
       LIMIT $${paramsData.length - 1} OFFSET $${paramsData.length}`,
      paramsData
    );

    return res.json({ page, limit, total: count.rows[0]?.total || 0, rows: data.rows });
  } catch (e) {
    console.error('[getLaboratorioRecientes]', e);
    return res.status(500).json({ message: 'Error lab recientes', error: e.message });
  }
};

const getDiagnosticosTop = async (req, res) => {
  const clinicaId = getClinicaId(req);
  const fechas = parseFechas(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });
  if (!fechas) return res.status(400).json({ message: 'Se requieren fechaInicio y fechaFin' });

  const dateCol = await detectHistorialDateCol();

  try {
    const r = await pool.query(
      `SELECT COALESCE(hc.diagnostico,'Sin diagnóstico') as diagnostico,
              COUNT(*)::int as cantidad
       FROM public.historial_clinico hc
       WHERE hc.clinica_id = $1
         AND hc.${dateCol}::date BETWEEN $2::date AND $3::date
       GROUP BY COALESCE(hc.diagnostico,'Sin diagnóstico')
       ORDER BY cantidad DESC
       LIMIT 10`,
      [clinicaId, fechas.fechaInicio, fechas.fechaFin]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[getDiagnosticosTop]', e);
    return res.status(500).json({ message: 'Error diagnósticos top', error: e.message });
  }
};

// ==============================
// EXPORT BONITO (PDF/EXCEL) con include
// ==============================
const exportarReportePDF = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  const include = parseInclude(req);
  const { fechaInicio, fechaFin } = parseRangeForExport(req);
  const warnings = [];

  try {
    const base = await getReporteBase(clinicaId);

    const turnosPorPeriodo = include.has('turnos')
      ? await safeQuery(
          warnings,
          'turnos',
          `SELECT DATE(t.fecha) as fecha, COUNT(*)::int as total_turnos
           FROM public.turnos t
           WHERE t.fecha BETWEEN $1 AND $2 AND t.clinica_id = $3
           GROUP BY DATE(t.fecha)
           ORDER BY fecha DESC`,
          [fechaInicio, fechaFin, clinicaId]
        )
      : [];

    const stockBajo = include.has('inventario')
      ? await safeQuery(
          warnings,
          'stockBajo',
          `SELECT nombre, categoria, stock_actual, stock_minimo
           FROM public.productosW
           WHERE clinica_id = $1 AND activo = TRUE
             AND COALESCE(stock_actual,0) <= COALESCE(stock_minimo,0)
           ORDER BY COALESCE(stock_actual,0) ASC
           LIMIT 60`,
          [clinicaId]
        )
      : [];

    const topConsumidos = include.has('inventario')
      ? await safeQuery(
          warnings,
          'topConsumidos',
          `SELECT p.nombre, COALESCE(SUM(ms.cantidad),0)::int as total_salida
           FROM public.movimientos_stockW ms
           JOIN public.productosW p ON p.id = ms.producto_id
           WHERE ms.clinica_id = $1 AND ms.tipo_movimiento = 'SALIDA'
             AND ms.creado_en::date BETWEEN $2::date AND $3::date
           GROUP BY p.nombre
           ORDER BY total_salida DESC
           LIMIT 10`,
          [clinicaId, fechaInicio, fechaFin]
        )
      : [];

    // ✅ TELE FIX real: JOIN mascotas
    const tele = include.has('tele')
      ? await safeQuery(
          warnings,
          'tele',
          `SELECT t.estado, COUNT(*)::int as cantidad
           FROM public.teleconsultas t
           JOIN public.mascotas m ON m.id = t.mascota_id
           WHERE m.clinica_id = $1
             AND t.fecha::date BETWEEN $2::date AND $3::date
           GROUP BY t.estado
           ORDER BY cantidad DESC`,
          [clinicaId, fechaInicio, fechaFin]
        )
      : [];

    const lab = include.has('lab')
      ? await safeQuery(
          warnings,
          'labTipo',
          `SELECT COALESCE(tipo_examen,'Sin tipo') as tipo_examen, COUNT(*)::int as cantidad
           FROM public.laboratorio_resultados
           WHERE clinica_id = $1 AND fecha::date BETWEEN $2::date AND $3::date
           GROUP BY COALESCE(tipo_examen,'Sin tipo')
           ORDER BY cantidad DESC
           LIMIT 20`,
          [clinicaId, fechaInicio, fechaFin]
        )
      : [];

    const dateCol = await detectHistorialDateCol();
    const diag = include.has('diag')
      ? await safeQuery(
          warnings,
          'diag',
          `SELECT COALESCE(hc.diagnostico,'Sin diagnóstico') as diagnostico,
                  COUNT(*)::int as cantidad
           FROM public.historial_clinico hc
           WHERE hc.clinica_id = $1 AND hc.${dateCol}::date BETWEEN $2::date AND $3::date
           GROUP BY COALESCE(hc.diagnostico,'Sin diagnóstico')
           ORDER BY cantidad DESC
           LIMIT 12`,
          [clinicaId, fechaInicio, fechaFin]
        )
      : [];

    const doc = new PDFDocument({ margin: 28, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=reporte_clinica_${Date.now()}.pdf`);
    doc.pipe(res);

    doc.fontSize(18).fillColor('#1f2937').text('Reporte de Clínica', { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#6b7280').text(
      `Rango: ${fechaInicio}     ${fechaFin}   |   Generado: ${new Date().toLocaleString('es-ES')}`
    );
    doc.moveDown(0.8);

    if (include.has('resumen')) {
      doc.fontSize(13).fillColor('#111827').text('Resumen');
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#1f2937');
      doc.text(`• Mascotas: ${base.dashboard.totalMascotas}`);
      doc.text(`• Turnos este mes: ${base.dashboard.turnosEsteMes}`);
      doc.text(`• Veterinarios: ${base.dashboard.veterinariosActivos}`);
      doc.text(`• Pendientes: ${base.dashboard.turnosPendientes}`);
      doc.moveDown(0.8);

      if (base.mascotasConsultadas?.length) {
        await doc.table(
          {
            title: 'Mascotas más consultadas',
            headers: ['Mascota', 'Raza', 'Consultas'],
            rows: base.mascotasConsultadas.map((x) => [x.mascota, x.raza, x.total_consultas]),
          },
          { width: 520 }
        );
        doc.moveDown(0.6);
      }
      if (base.tiposConsultas?.length) {
        await doc.table(
          {
            title: 'Motivos frecuentes',
            headers: ['Motivo', 'Cantidad', '%'],
            rows: base.tiposConsultas.map((x) => [x.motivo, x.cantidad, `${x.porcentaje || 0}%`]),
          },
          { width: 520 }
        );
        doc.moveDown(0.6);
      }
    }

    if (include.has('turnos')) {
      await doc.table(
        {
          title: 'Turnos por periodo',
          headers: ['Fecha', 'Total'],
          rows: turnosPorPeriodo.map((x) => [String(x.fecha).slice(0, 10), x.total_turnos]),
        },
        { width: 520 }
      );
      doc.moveDown(0.6);
    }

    if (include.has('inventario')) {
      if (stockBajo.length) {
        await doc.table(
          {
            title: 'Stock bajo',
            headers: ['Producto', 'Categoría', 'Actual', 'Mínimo'],
            rows: stockBajo.map((x) => [x.nombre, x.categoria || '-', x.stock_actual ?? 0, x.stock_minimo ?? 0]),
          },
          { width: 520 }
        );
        doc.moveDown(0.6);
      }
      if (topConsumidos.length) {
        await doc.table(
          {
            title: 'Top consumidos (SALIDA)',
            headers: ['Producto', 'Unidades'],
            rows: topConsumidos.map((x) => [x.nombre, x.total_salida]),
          },
          { width: 520 }
        );
        doc.moveDown(0.6);
      }
    }

    if (include.has('tele') && tele.length) {
      await doc.table(
        {
          title: 'Teleconsultas por estado',
          headers: ['Estado', 'Cantidad'],
          rows: tele.map((x) => [x.estado, x.cantidad]),
        },
        { width: 520 }
      );
      doc.moveDown(0.6);
    }

    if (include.has('lab') && lab.length) {
      await doc.table(
        { title: 'Laboratorio por tipo', headers: ['Tipo examen', 'Cantidad'], rows: lab.map((x) => [x.tipo_examen, x.cantidad]) },
        { width: 520 }
      );
      doc.moveDown(0.6);
    }

    if (include.has('diag') && diag.length) {
      await doc.table(
        { title: 'Diagnósticos más frecuentes', headers: ['Diagnóstico', 'Cantidad'], rows: diag.map((x) => [x.diagnostico, x.cantidad]) },
        { width: 520 }
      );
      doc.moveDown(0.6);
    }

    if (warnings.length) {
      doc.addPage();
      doc.fontSize(13).fillColor('#111827').text('Avisos (datos no disponibles)');
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor('#6b7280');
      warnings.slice(0, 40).forEach((w) => doc.text(`• ${w.label}: ${w.error}`));
    }

    await safeAudit(req, {
      modulo: 'REPORTES',
      accion: 'EXPORT_PDF',
      entidad: 'reporte',
      entidad_id: `clinica:${clinicaId}`,
      descripcion: 'Exportó reporte PDF',
      metadata: { include: Array.from(include), fechaInicio, fechaFin },
    });

    doc.end();
  } catch (e) {
    console.error('[exportarReportePDF]', e);
    return res.status(500).json({ message: 'Error al generar PDF', error: e.message });
  }
};

const exportarReporteExcel = async (req, res) => {
  const clinicaId = getClinicaId(req);
  if (!clinicaId) return res.status(400).json({ message: 'Falta clinica_id' });

  const include = parseInclude(req);
  const { fechaInicio, fechaFin } = parseRangeForExport(req);
  const warnings = [];

  try {
    const base = await getReporteBase(clinicaId);

    const wb = new Excel.Workbook();
    wb.creator = 'AnimTech';
    wb.created = new Date();

    const styleHeader = (row) => {
      row.font = { bold: true };
      row.alignment = { vertical: 'middle' };
    };

    const info = wb.addWorksheet('Info');
    info.addRow(['Reporte de Clínica']);
    info.getRow(1).font = { size: 16, bold: true };
    info.addRow([`Rango: ${fechaInicio} → ${fechaFin}`]);
    info.addRow([`Generado: ${new Date().toLocaleString('es-ES')}`]);
    info.addRow([`Secciones: ${Array.from(include).join(', ')}`]);

    if (include.has('resumen')) {
      const sh = wb.addWorksheet('Resumen');
      sh.columns = [
        { header: 'Métrica', key: 'm', width: 28 },
        { header: 'Valor', key: 'v', width: 14 },
      ];
      styleHeader(sh.getRow(1));
      sh.addRow({ m: 'Mascotas', v: base.dashboard.totalMascotas });
      sh.addRow({ m: 'Turnos este mes', v: base.dashboard.turnosEsteMes });
      sh.addRow({ m: 'Veterinarios', v: base.dashboard.veterinariosActivos });
      sh.addRow({ m: 'Pendientes', v: base.dashboard.turnosPendientes });
    }

    if (include.has('tele')) {
      const tele = await safeQuery(
        warnings,
        'tele',
        `SELECT t.estado, COUNT(*)::int as cantidad
         FROM public.teleconsultas t
         JOIN public.mascotas m ON m.id = t.mascota_id
         WHERE m.clinica_id = $1
           AND t.fecha::date BETWEEN $2::date AND $3::date
         GROUP BY t.estado
         ORDER BY cantidad DESC`,
        [clinicaId, fechaInicio, fechaFin]
      );

      const sh = wb.addWorksheet('Teleconsultas');
      sh.columns = [
        { header: 'Estado', key: 'estado', width: 18 },
        { header: 'Cantidad', key: 'cantidad', width: 10 },
      ];
      styleHeader(sh.getRow(1));
      tele.forEach((r) => sh.addRow(r));
    }

    if (warnings.length) {
      const sh = wb.addWorksheet('Warnings');
      sh.columns = [
        { header: 'Sección', key: 'label', width: 18 },
        { header: 'Error', key: 'error', width: 90 },
      ];
      styleHeader(sh.getRow(1));
      warnings.forEach((w) => sh.addRow(w));
    }

    await safeAudit(req, {
      modulo: 'REPORTES',
      accion: 'EXPORT_EXCEL',
      entidad: 'reporte',
      entidad_id: `clinica:${clinicaId}`,
      descripcion: 'Exportó reporte Excel',
      metadata: { include: Array.from(include), fechaInicio, fechaFin },
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=reporte_clinica_${Date.now()}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[exportarReporteExcel]', e);
    return res.status(500).json({ message: 'Error al generar Excel', error: e.message });
  }
};

// ==============================
// Exports
// ==============================
module.exports = {
  getReportesBundle,

  getDashboardResumen,
  getTurnosPorPeriodo,
  getMascotasMasConsultadas,
  getActividadVeterinarios,
  getTiposConsultasFrecuentes,
  getRazasMasAtendidas,
  getActividadMensual,

  getStockBajo,
  getMovimientosStockResumen,
  getTopProductosConsumidos,
  getTeleconsultaEstados,
  getLaboratorioPorTipo,
  getLaboratorioRecientes,
  getDiagnosticosTop,

  exportarReportePDF,
  exportarReporteExcel,
};
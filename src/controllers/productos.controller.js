// Backend/src/controllers/productos.controller.js        web
const pool = require('../db');
const { registrarAuditoria } = require('../utils/auditoria');

// Helper clinica_id (token primero, header fallback)
const getClinicaId = (req) => {
  const tokenClinica = req.user?.clinica_id;
  if (tokenClinica) return Number(tokenClinica);

  const h = req.headers['clinica-id'];
  const n = Number(h);
  return Number.isNaN(n) ? null : n;
};

// =============================
// Crear producto (PERMISO: productos:create)
// =============================
const crearProducto = async (req, res) => {
  const { nombre, categoria, descripcion, stock_minimo, tipo_producto } = req.body;
  const clinica_id = getClinicaId(req);

  if (!clinica_id) return res.status(400).json({ message: 'clinica_id no está presente en token/header.' });
  if (!nombre || !categoria || !tipo_producto) {
    return res.status(400).json({ message: 'Nombre, categoría y tipo son obligatorios.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO public.productosW
       (clinica_id, nombre, categoria, descripcion, stock_minimo, tipo_producto)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        clinica_id,
        String(nombre).trim(),
        String(categoria).trim(),
        descripcion ? String(descripcion) : null,
        Number(stock_minimo) || 0,
        tipo_producto,
      ]
    );

    const creado = result.rows[0];

    await registrarAuditoria(req, {
      modulo: 'PRODUCTOS',
      accion: 'CREAR',
      entidad: 'producto',
      entidad_id: creado.id,
      descripcion: `Creó producto: ${creado.nombre}`,
      metadata: { producto: creado },
    });

    res.status(201).json(creado);
  } catch (error) {
    console.error('[crearProducto]', error);
    res.status(500).json({ message: 'Error creando producto.' });
  }
};

// =============================
// Obtener productos (PERMISO: productos:read)
// =============================
const obtenerProductos = async (req, res) => {
  const clinica_id = getClinicaId(req);
  if (!clinica_id) return res.status(400).json({ message: 'clinica_id no está presente en token/header.' });

  try {
    const result = await pool.query(
      `SELECT *
       FROM public.productosW
       WHERE clinica_id = $1 AND activo = TRUE
       ORDER BY id DESC`,
      [clinica_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('[obtenerProductos]', error);
    res.status(500).json({ message: 'Error obteniendo productos.' });
  }
};

// =============================
// Editar producto (PERMISO: productos:update)
// =============================
const actualizarProducto = async (req, res) => {
  const clinica_id = getClinicaId(req);
  const { id } = req.params;
  const { nombre, categoria, descripcion, stock_minimo, tipo_producto, activo } = req.body;

  if (!clinica_id) return res.status(400).json({ message: 'clinica_id no está presente en token/header.' });

  try {
    const beforeRes = await pool.query(
      `SELECT * FROM public.productosW WHERE id = $1 AND clinica_id = $2`,
      [id, clinica_id]
    );
    const before = beforeRes.rows?.[0] || null;

    const result = await pool.query(
      `UPDATE public.productosW
       SET nombre = COALESCE($1, nombre),
           categoria = COALESCE($2, categoria),
           descripcion = COALESCE($3, descripcion),
           stock_minimo = COALESCE($4, stock_minimo),
           tipo_producto = COALESCE($5, tipo_producto),
           activo = COALESCE($6, activo)
       WHERE id = $7 AND clinica_id = $8
       RETURNING *`,
      [
        nombre !== undefined ? String(nombre).trim() : null,
        categoria !== undefined ? String(categoria).trim() : null,
        descripcion !== undefined ? (descripcion ? String(descripcion) : null) : null,
        stock_minimo !== undefined && stock_minimo !== null ? Number(stock_minimo) : null,
        tipo_producto !== undefined ? tipo_producto : null,
        typeof activo === 'boolean' ? activo : null,
        id,
        clinica_id,
      ]
    );

    if (result.rowCount === 0) return res.status(404).json({ message: 'Producto no encontrado.' });

    const after = result.rows[0];

    await registrarAuditoria(req, {
      modulo: 'PRODUCTOS',
      accion: 'EDITAR',
      entidad: 'producto',
      entidad_id: after.id,
      descripcion: `Editó producto: ${after.nombre}`,
      metadata: { before, after },
    });

    res.json(after);
  } catch (error) {
    console.error('[actualizarProducto]', error);
    res.status(500).json({ message: 'Error actualizando producto.' });
  }
};

// =============================
// Desactivar producto (PERMISO: productos:delete)
// =============================
const desactivarProducto = async (req, res) => {
  const clinica_id = getClinicaId(req);
  const { id } = req.params;

  if (!clinica_id) return res.status(400).json({ message: 'clinica_id no está presente en token/header.' });

  try {
    const beforeRes = await pool.query(
      `SELECT * FROM public.productosW WHERE id = $1 AND clinica_id = $2`,
      [id, clinica_id]
    );
    const before = beforeRes.rows?.[0] || null;

    const result = await pool.query(
      `UPDATE public.productosW
       SET activo = FALSE
       WHERE id = $1 AND clinica_id = $2
       RETURNING id, nombre`,
      [id, clinica_id]
    );

    if (result.rowCount === 0) return res.status(404).json({ message: 'Producto no encontrado.' });

    await registrarAuditoria(req, {
      modulo: 'PRODUCTOS',
      accion: 'ELIMINAR',
      entidad: 'producto',
      entidad_id: id,
      descripcion: `Desactivó producto: ${result.rows[0]?.nombre || id}`,
      metadata: { before },
    });

    res.json({ message: 'Producto desactivado.' });
  } catch (error) {
    console.error('[desactivarProducto]', error);
    res.status(500).json({ message: 'Error desactivando producto.' });
  }
};

// =============================
// Movimiento stock (PERMISO: productos:update)
// =============================
const moverStock = async (req, res) => {
  const { producto_id, tipo_movimiento, cantidad, observacion } = req.body;
  const clinica_id = getClinicaId(req);

  if (!clinica_id) return res.status(400).json({ message: 'clinica_id no está presente en token/header.' });
  if (!producto_id || !tipo_movimiento || cantidad === undefined || cantidad === null) {
    return res.status(400).json({ message: 'Datos incompletos.' });
  }

  const qty = Number(cantidad);
  if (Number.isNaN(qty) || qty < 0) return res.status(400).json({ message: 'Cantidad inválida.' });

  try {
    const producto = await pool.query(
      `SELECT id, nombre, stock_actual, stock_minimo
       FROM public.productosW
       WHERE id = $1 AND clinica_id = $2 AND activo = TRUE`,
      [producto_id, clinica_id]
    );

    if (producto.rowCount === 0) return res.status(404).json({ message: 'Producto no encontrado.' });

    const p = producto.rows[0];
    const stockAntes = Number(p.stock_actual || 0);

    let nuevoStock = stockAntes;

    if (tipo_movimiento === 'ENTRADA') {
      nuevoStock += qty;
    } else if (tipo_movimiento === 'SALIDA') {
      if (nuevoStock < qty) return res.status(400).json({ message: 'Stock insuficiente.' });
      nuevoStock -= qty;
    } else if (tipo_movimiento === 'AJUSTE') {
      nuevoStock = qty;
    } else {
      return res.status(400).json({ message: 'tipo_movimiento inválido.' });
    }

    await pool.query(`UPDATE public.productosW SET stock_actual = $1 WHERE id = $2 AND clinica_id = $3`, [
      nuevoStock,
      producto_id,
      clinica_id,
    ]);

    await pool.query(
      `INSERT INTO public.movimientos_stockW
       (producto_id, clinica_id, usuario_id, tipo_movimiento, cantidad, observacion)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [producto_id, clinica_id, req.user?.id, tipo_movimiento, qty, observacion || null]
    );

    await registrarAuditoria(req, {
      modulo: 'PRODUCTOS',
      accion: 'STOCK_MOV',
      entidad: 'producto',
      entidad_id: producto_id,
      descripcion: `Stock ${tipo_movimiento} (${qty}) en: ${p.nombre}`,
      metadata: {
        tipo_movimiento,
        cantidad: qty,
        stockAntes,
        stockDespues: nuevoStock,
        observacion: observacion || null,
      },
    });

    res.json({ message: 'Stock actualizado correctamente.', stock_actual: nuevoStock });
  } catch (error) {
    console.error('[moverStock]', error);
    res.status(500).json({ message: 'Error moviendo stock.' });
  }
};

// =============================
// Ver movimientos (PERMISO: productos:read)
// =============================
const obtenerMovimientos = async (req, res) => {
  const clinica_id = getClinicaId(req);
  const { id } = req.params; // producto id

  if (!clinica_id) return res.status(400).json({ message: 'clinica_id no está presente en token/header.' });

  try {
    const result = await pool.query(
      `SELECT ms.id, ms.tipo_movimiento, ms.cantidad, ms.observacion, ms.creado_en,
              u.nombre as usuario_nombre, u.email as usuario_email
       FROM public.movimientos_stockW ms
       LEFT JOIN public.users u ON u.id = ms.usuario_id
       WHERE ms.clinica_id = $1 AND ms.producto_id = $2
       ORDER BY ms.creado_en DESC
       LIMIT 200`,
      [clinica_id, id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('[obtenerMovimientos]', error);
    res.status(500).json({ message: 'Error obteniendo movimientos.' });
  }
};

module.exports = {
  crearProducto,
  obtenerProductos,
  actualizarProducto,
  desactivarProducto,
  moverStock,
  obtenerMovimientos,
};
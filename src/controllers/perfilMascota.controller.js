const pool = require('../db');

// ==============================
// Helpers
// ==============================
const normalizeText = (value) => String(value || '').trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeCollarId = (value) => {
  const v = normalizeText(value).toUpperCase();
  return v.length ? v : null;
};

const isValidCollarFormat = (collarId) => {
  if (!collarId) return true; // opcional
  return /^ANIMA-[A-Z0-9]{6}$/i.test(collarId);
};

// Verifica que el collar exista en la tabla WEB de mascotas
const getMascotaWebByCollar = async (collarId) => {
  const result = await pool.query(
    `
      SELECT id, nombre, especie, raza, genero, collar_id, clinica_id, cliente_id
      FROM public.mascotas
      WHERE UPPER(collar_id) = UPPER($1)
      LIMIT 1
    `,
    [collarId]
  );
  return result.rows[0] || null;
};

// Verifica que el collar no esté ya usado por otro perfil móvil
const getPerfilByCollar = async (collarId, perfilIdToIgnore = null) => {
  const result = await pool.query(
    `
      SELECT id, nombre, collar_id
      FROM public.perfiles_mascotas
      WHERE UPPER(collar_id) = UPPER($1)
        AND ($2::int IS NULL OR id <> $2)
      LIMIT 1
    `,
    [collarId, perfilIdToIgnore]
  );
  return result.rows[0] || null;
};

// ==============================
// [GET] Mis perfiles
// ==============================
const getMisPerfilesMascotas = async (req, res) => {
  const propietarioId = req.user.id;

  try {
    const result = await pool.query(
      `
        SELECT *,
               EXTRACT(YEAR FROM AGE(NOW(), fecha_nacimiento)) AS edad
        FROM public.perfiles_mascotas
        WHERE propietario_id = $1
        ORDER BY nombre ASC
      `,
      [propietarioId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener perfiles de mascotas:', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ==============================
// [POST] Crear perfil
// ==============================
const crearPerfilMascota = async (req, res) => {
  const propietarioId = req.user.id;

  let {
    nombre,
    especie,
    raza,
    fecha_nacimiento,
    genero,
    foto_url,
    notas_adicionales,
    collar_id,
  } = req.body;

  nombre = normalizeText(nombre);
  especie = normalizeLower(especie);
  raza = normalizeText(raza);
  genero = normalizeText(genero);
  notas_adicionales = normalizeText(notas_adicionales);
  collar_id = normalizeCollarId(collar_id);

  if (!nombre || !especie || !fecha_nacimiento || !genero) {
    return res.status(400).json({
      message: 'Nombre, especie, fecha de nacimiento y género son obligatorios.',
    });
  }

  let collarIdFinal = null;

  try {
    if (especie === 'canino' && collar_id) {
      if (!isValidCollarFormat(collar_id)) {
        return res.status(400).json({
          message: 'Formato de código de collar inválido. Ejemplo: ANIMA-ABC123',
        });
      }

      // 1) Debe existir primero en la WEB
      const mascotaWeb = await getMascotaWebByCollar(collar_id);
      if (!mascotaWeb) {
        return res.status(404).json({
          message:
            'El código del collar no existe. Por favor vuelve a intentarlo o consulta con la clínica que te entregó el collar.',
        });
      }

      // 2) No debe estar vinculado ya a otro perfil móvil
      const perfilExistente = await getPerfilByCollar(collar_id);
      if (perfilExistente) {
        return res.status(409).json({
          message: 'Este código de collar ya está vinculado a otra mascota.',
        });
      }

      collarIdFinal = collar_id;
    }

    const result = await pool.query(
      `
        INSERT INTO public.perfiles_mascotas
        (
          nombre,
          especie,
          raza,
          fecha_nacimiento,
          genero,
          foto_url,
          notas_adicionales,
          propietario_id,
          collar_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [
        nombre,
        especie,
        raza || null,
        fecha_nacimiento,
        genero,
        foto_url || null,
        notas_adicionales || '',
        propietarioId,
        collarIdFinal,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'perfiles_mascotas_collar_id_key') {
      return res.status(409).json({
        message: 'El ID de este collar ya está registrado por otra mascota.',
      });
    }

    console.error('Error al crear perfil de mascota:', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ==============================
// [PUT] Actualizar perfil
// ==============================
const actualizarPerfilMascota = async (req, res) => {
  const mascotaId = Number(req.params.id);
  const propietarioId = req.user.id;

  let {
    nombre,
    especie,
    raza,
    fecha_nacimiento,
    genero,
    notas_adicionales,
    collar_id,
  } = req.body;

  let fotoUrlFinal = req.body.foto_url;
  if (req.file) {
    fotoUrlFinal = req.file.path;
  }

  nombre = normalizeText(nombre);
  especie = normalizeLower(especie);
  raza = normalizeText(raza);
  genero = normalizeText(genero);
  notas_adicionales = normalizeText(notas_adicionales);
  collar_id = normalizeCollarId(collar_id);

  try {
    // validar propiedad
    const petCheck = await pool.query(
      `
        SELECT id, collar_id
        FROM public.perfiles_mascotas
        WHERE id = $1 AND propietario_id = $2
      `,
      [mascotaId, propietarioId]
    );

    if (petCheck.rows.length === 0) {
      return res.status(404).json({
        message: 'Mascota no encontrada o no tienes permiso.',
      });
    }

    let collarIdFinal = null;

    // Solo perros pueden tener collar
    if (especie === 'canino') {
      if (collar_id) {
        if (!isValidCollarFormat(collar_id)) {
          return res.status(400).json({
            message: 'Formato de código de collar inválido. Ejemplo: ANIMA-ABC123',
          });
        }

        // Debe existir en mascotas web
        const mascotaWeb = await getMascotaWebByCollar(collar_id);
        if (!mascotaWeb) {
          return res.status(404).json({
            message:
              'El código del collar no existe. Por favor vuelve a intentarlo o consulta con la clínica que te entregó el collar.',
          });
        }

        // No debe estar en otro perfil móvil
        const perfilExistente = await getPerfilByCollar(collar_id, mascotaId);
        if (perfilExistente) {
          return res.status(409).json({
            message: 'Este código de collar ya está vinculado a otra mascota.',
          });
        }

        collarIdFinal = collar_id;
      } else {
        collarIdFinal = null;
      }
    } else {
      // si no es canino, siempre null
      collarIdFinal = null;
    }

    const result = await pool.query(
      `
        UPDATE public.perfiles_mascotas
        SET nombre = $1,
            especie = $2,
            raza = $3,
            fecha_nacimiento = $4,
            genero = $5,
            foto_url = $6,
            notas_adicionales = $7,
            collar_id = $8
        WHERE id = $9 AND propietario_id = $10
        RETURNING *
      `,
      [
        nombre,
        especie,
        raza || null,
        fecha_nacimiento,
        genero,
        fotoUrlFinal || null,
        notas_adicionales || '',
        collarIdFinal,
        mascotaId,
        propietarioId,
      ]
    );

    return res.json({
      message: 'Perfil de mascota actualizado con éxito',
      mascota: result.rows[0],
    });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'perfiles_mascotas_collar_id_key') {
      return res.status(409).json({
        message: 'El ID de este collar ya está registrado por otra mascota.',
      });
    }

    console.error('Error al actualizar perfil de mascota:', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ==============================
// [DELETE] Eliminar perfil
// ==============================
const eliminarPerfilMascota = async (req, res) => {
  const mascotaId = req.params.id;
  const propietarioId = req.user.id;

  try {
    const result = await pool.query(
      `
        DELETE FROM public.perfiles_mascotas
        WHERE id = $1 AND propietario_id = $2
        RETURNING id, nombre
      `,
      [mascotaId, propietarioId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: 'Mascota no encontrada o no tienes permiso.',
      });
    }

    return res.json({
      message: 'Mascota eliminada con éxito',
      mascota: result.rows[0],
    });
  } catch (error) {
    console.error('Error al eliminar perfil de mascota:', error);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  getMisPerfilesMascotas,
  crearPerfilMascota,
  actualizarPerfilMascota,
  eliminarPerfilMascota,
};
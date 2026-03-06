// Backend/src/controllers/clinica.controller.js    para refugios y veterinarios en app movil
const axios = require('axios');

// Cache en memoria del servidor (persiste durante la sesión del servidor)
const serverCache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutos en el servidor

/**
 * Genera clave de cache basada en coordenadas redondeadas
 */
const generateCacheKey = (lat, lng) => {
  const roundedLat = Math.round(parseFloat(lat) * 1000) / 1000;
  const roundedLng = Math.round(parseFloat(lng) * 1000) / 1000;
  return `osm_${roundedLat}_${roundedLng}`;
};

/**
 * Verifica si el cache sigue siendo válido
 */
const isCacheValid = (timestamp) => {
  return Date.now() - timestamp < CACHE_DURATION;
};

/**
 * Limpia entradas expiradas del cache periódicamente
 */
const cleanExpiredCache = () => {
  const now = Date.now();
  for (const [key, value] of serverCache.entries()) {
    if (now - value.timestamp >= CACHE_DURATION) {
      serverCache.delete(key);
    }
  }
};

// Limpieza automática cada 20 minutos
setInterval(cleanExpiredCache, 20 * 60 * 1000);

// Controlador optimizado para buscar en OpenStreetMap
const searchOSMClinicasAvanzado = async (req, res) => {
  // 1. Validar entrada
  const { lat, lng } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ message: 'Se requieren latitud y longitud.' });
  }

  // 2. Verificar cache del servidor
  const cacheKey = generateCacheKey(lat, lng);
  const cached = serverCache.get(cacheKey);
  
  if (cached && isCacheValid(cached.timestamp)) {
    console.log(`[Backend] 📦 Datos obtenidos del cache del servidor para ${cacheKey}`);
    return res.status(200).json(cached.data);
  }

  // 3. Configuración optimizada
  const radiusInMeters = 7000;
  
  // 4. Consulta Overpass QL optimizada con timeout reducido
  const overpassQuery = `
    [out:json][timeout:15];
    (
      node["amenity"~"veterinary|animal_shelter"]["name"](around:${radiusInMeters},${lat},${lng});
    );
    out body;
    >;
    out skel qt;
  `;
  
  // Lista de servidores Overpass para failover
  const overpassServers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
  ];

  console.log(`[Backend] 🌐 Consultando Overpass API para ${cacheKey}...`);

  // 5. Intentar con múltiples servidores
  for (let i = 0; i < overpassServers.length; i++) {
    const serverUrl = overpassServers[i];
    
    try {
      console.log(`[Backend] Intentando servidor ${i + 1}/${overpassServers.length}: ${serverUrl}`);
      
      const response = await axios.post(
        serverUrl, 
        `data=${encodeURIComponent(overpassQuery)}`, 
        {
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'AnimTech-App/1.0'
          },
          timeout: 10000, // 10 segundos por servidor
        }
      );

      // 6. Procesamiento optimizado de datos
      const clinicas = response.data.elements
        .filter(element => element.type === 'node' && element.tags && element.tags.name)
        .map(element => {
          const tags = element.tags;
          const direccion = `${tags['addr:street'] || ''} ${tags['addr:housenumber'] || ''}`.trim();
          
          return {
            id: element.id,
            nombre: tags.name,
            direccion: direccion || null,
            ciudad: tags['addr:city'] || null,
            telefono: tags.phone || tags['contact:phone'] || null,
            website: tags.website || tags['contact:website'] || null,
            latitude: element.lat,
            longitude: element.lon,
          };
        });

      // 7. Guardar en cache del servidor
      serverCache.set(cacheKey, {
        data: clinicas,
        timestamp: Date.now()
      });

      console.log(`[Backend] ✅ ${clinicas.length} clínicas encontradas y cacheadas desde servidor ${i + 1}`);
      return res.status(200).json(clinicas);

    } catch (error) {
      console.warn(`[Backend] ⚠️ Error en servidor ${i + 1} (${serverUrl}):`, error.message);
      
      // Si es el último servidor, devolver error
      if (i === overpassServers.length - 1) {
        console.error('[Backend] ❌ Todos los servidores Overpass fallaron');
        
        // Intentar devolver datos cacheados expirados como último recurso
        if (cached) {
          console.log('[Backend] 🆘 Devolviendo datos expirados del cache como fallback');
          return res.status(200).json(cached.data);
        }
        
        return res.status(500).json({ 
          message: 'Error interno del servidor al buscar clínicas. Todos los servidores no disponibles.' 
        });
      }
      
      // Continuar con el siguiente servidor
      continue;
    }
  }
};

/**
 * Endpoint para limpiar cache manualmente (útil para desarrollo)
 */
const clearCache = (req, res) => {
  serverCache.clear();
  console.log('[Backend] 🧹 Cache del servidor limpiado manualmente');
  res.status(200).json({ message: 'Cache limpiado correctamente' });
};

/**
 * Endpoint para ver estadísticas del cache
 */
const getCacheStats = (req, res) => {
  const stats = {
    entries: serverCache.size,
    keys: Array.from(serverCache.keys()),
    memoryUsage: process.memoryUsage()
  };
  res.status(200).json(stats);
};

module.exports = {
  searchOSMClinicasAvanzado,
  clearCache,
  getCacheStats
};
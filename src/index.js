const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ===== RUTAS DE ANIMTECH =====
const onboardingRoutes = require('./routes/onboarding.routes');
const authRoutes = require('./routes/auth.routes');
const authVeterinarioRoutes = require('./routes/authVeterinario.routes');
const authMobileRoutes = require('./routes/authMobile.routes');
const petRoutes = require('./routes/pet.routes');
const historialRoutes = require('./routes/historial.routes');
const turnosRoutes = require('./routes/turnos.routes');
const veterinariosRoutes = require('./routes/veterinarios.routes');
const teleconsultaRoutes = require('./routes/teleconsulta.routes');
const clinicasRoutes = require('./routes/clinicas.routes');
const clinicasWebRoutes = require('./routes/clinicasWeb.routes');
const perfilMascotaRoutes = require('./routes/perfilMascota.routes');
const eventosRoutes = require('./routes/eventos.routes');
const userRoutes = require('./routes/user.routes');
const reportesRoutes = require('./routes/reportes.routes');
const historialMobileRoutes = require('./routes/historialMobile.routes');
const rolesRoutes = require('./routes/roles.routes');
const reportesWebGeneralRoutes = require('./routes/reporteswebgeneral.routes');
const chatbotRoutes = require('./routes/chatbot.routes');
const chatbotMobileRoutes = require('./routes/chatbotMobile.routes');
const productosRoutes = require('./routes/productos.routes');
const clientesRoutes = require('./routes/clientes.routes');
const socialRoutes = require('./routes/social.routes');
const laboratorioRoutes = require('./routes/laboratorio.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');

const app = express();

app.use(cors());
app.use(express.json());


// ===============================
// HEALTH CHECK
// ===============================
app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend ANIMA funcionando correctamente' });
});


// ===============================
// RUTAS PRINCIPALES
// ===============================

// Onboarding
app.use('/api/onboarding', onboardingRoutes);

// Auth
app.use('/api/auth', authRoutes);
app.use('/api/auth/veterinarios', authVeterinarioRoutes);
app.use('/api/mobile/auth', authMobileRoutes);

// Mascotas
app.use('/api/mascotas', petRoutes);
app.use('/api/perfiles-mascotas', perfilMascotaRoutes);

// Historial
app.use('/api/historial', historialRoutes);
app.use('/api/historialMobile', historialMobileRoutes);

// Turnos
app.use('/api/turnos', turnosRoutes);

// Veterinarios
app.use('/api/veterinarios', veterinariosRoutes);

// Teleconsultas
app.use('/api/teleconsultas', teleconsultaRoutes);

// ===============================
// CLINICAS
// ===============================

// ⚠️ IMPORTANTE
// Primero las rutas especiales como /me
app.use('/api/clinicas', clinicasWebRoutes);

// Luego el CRUD general de clínicas
app.use('/api/clinicas', clinicasRoutes);


// Eventos
app.use('/api/eventos', eventosRoutes);

// Usuarios
app.use('/api/users', userRoutes);

// Productos / Inventario
app.use('/api/productos', productosRoutes);

// Clientes
app.use('/api/clientes', clientesRoutes);

// Laboratorio
app.use('/api/laboratorio', laboratorioRoutes);

// Roles
app.use('/api/roles', rolesRoutes);

// Reportes
app.use('/api/reportes', reportesRoutes);
app.use('/api/reporteswebgeneral', reportesWebGeneralRoutes);

// Auditoría
app.use('/api/auditoria', auditoriaRoutes);

// Social
app.use('/api/social', socialRoutes);

// Chatbot
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/chatbot-mobile', chatbotMobileRoutes);


// ===============================
// SERVER
// ===============================
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/health`);
  console.log(`🤖 AnimBot (Web): http://localhost:${PORT}/api/chatbot`);
  console.log(`📱 AnimBot (Móvil): http://localhost:${PORT}/api/chatbot-mobile/query`);
  console.log(`🌐 Red Social: http://localhost:${PORT}/api/social`);
});
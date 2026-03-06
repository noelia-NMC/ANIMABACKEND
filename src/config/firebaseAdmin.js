const admin = require('firebase-admin');
// Asegúrate de que la ruta al archivo JSON sea correcta
const serviceAccount = require('../../firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Reemplaza esto con la URL de tu Realtime Database
  databaseURL: "https://animtech-e286f-default-rtdb.firebaseio.com/"
});

const db = admin.database();

module.exports = { admin, db };
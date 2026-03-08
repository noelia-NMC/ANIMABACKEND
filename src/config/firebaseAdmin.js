
//LOCAL
/*const admin = require('firebase-admin');
// Asegúrate de que la ruta al archivo JSON sea correcta
const serviceAccount = require('../../firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Reemplaza esto con la URL de tu Realtime Database
  databaseURL: "https://animtech-e286f-default-rtdb.firebaseio.com/"
});

const db = admin.database();

module.exports = { admin, db };*/


//PRODUCCIÓN
const admin = require('firebase-admin');

function getFirebaseConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!projectId) {
    throw new Error('Falta la variable de entorno FIREBASE_PROJECT_ID');
  }

  if (!clientEmail) {
    throw new Error('Falta la variable de entorno FIREBASE_CLIENT_EMAIL');
  }

  if (!privateKey) {
    throw new Error('Falta la variable de entorno FIREBASE_PRIVATE_KEY');
  }

  if (!databaseURL) {
    throw new Error('Falta la variable de entorno FIREBASE_DATABASE_URL');
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    databaseURL,
  };
}

if (!admin.apps.length) {
  const firebaseConfig = getFirebaseConfig();

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: firebaseConfig.projectId,
      clientEmail: firebaseConfig.clientEmail,
      privateKey: firebaseConfig.privateKey,
    }),
    databaseURL: firebaseConfig.databaseURL,
  });
}

const db = admin.database();

module.exports = { admin, db };
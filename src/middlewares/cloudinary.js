// Backend/src/middlewares/cloudinary.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configurar Cloudinary con las credenciales del .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configurar el almacenamiento en Cloudinary para Multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'animtech_pets', // Carpeta donde se guardarán las fotos en Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg'],
    // transformaciones que se pueden aplicar a la imagen al subirla
    transformation: [{ width: 500, height: 500, crop: 'limit' }] 
  }
});

// Crear el middleware de Multer para gestionar la subida
const upload = multer({ storage: storage });

module.exports = upload;
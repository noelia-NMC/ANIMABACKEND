// Backend/src/middlewares/upload.middleware.js
const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Formato no permitido. Sube PDF o imagen (png/jpg/webp).'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

module.exports = upload;
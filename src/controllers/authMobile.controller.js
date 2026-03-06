// Backend/src/controllers/authMobile.controller.js     mobile

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const registerMobile = async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ message: 'El correo y la contraseña son obligatorios.' });
  }

  try {
    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Obtener el rol_id para 'dueño'
    const rolResult = await pool.query('SELECT id FROM roles WHERE nombre = $1', ['dueño']);
    const rolId = rolResult.rows.length > 0 ? rolResult.rows[0].id : 1; // Default a 1 si no encuentra

    const result = await pool.query(
      'INSERT INTO users (email, password, rol_id) VALUES ($1, $2, $3) RETURNING id, email, rol_id',
      [email, hashedPassword, rolId]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        rol_id: user.rol_id 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    const userResponse = {
      id: user.id,
      email: user.email,
      rol_id: user.rol_id
    };

    res.status(201).json({ token, user: userResponse });

  } catch (err) {
    console.error('Error en registro móvil:', err.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

const loginMobile = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'El correo y la contraseña son obligatorios.' });
  }
  
  try {
    // Obtener el rol_id para 'dueño'
    const rolResult = await pool.query('SELECT id FROM roles WHERE nombre = $1', ['dueño']);
    const rolId = rolResult.rows.length > 0 ? rolResult.rows[0].id : 1;

    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND rol_id = $2', [email, rolId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        rol_id: user.rol_id 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    const userResponse = {
      id: user.id,
      email: user.email,
      rol_id: user.rol_id
    };

    res.json({ token, user: userResponse });

  } catch (err) {
    console.error('Error en login móvil:', err.message);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { registerMobile, loginMobile };
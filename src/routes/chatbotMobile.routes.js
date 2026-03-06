const express = require('express');
const router = express.Router();

const { chatbotMobileQuery } = require('../controllers/chatbotMobile.controller');

router.post('/query', chatbotMobileQuery);

module.exports = router;

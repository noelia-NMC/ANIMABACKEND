// backend/src/controllers/chatbotMobile.controller.js
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');

// ========= PROMPT =========
const SYSTEM_PROMPT = `
Eres AnimBot 🐾, asistente tipo veterinario para dueños de mascotas (perros y gatos).
Hablas en español simple, amigable, sin tecnicismos.
Objetivo: orientar y educar, NO reemplazar al veterinario.

Reglas:
- Si hay signos de urgencia (dificultad respiratoria, convulsiones, sangrado fuerte, colapso, vómitos persistentes, ingesta de veneno, etc.), decir "esto es urgente" y recomendar vet/guardia.
- Preguntar 2-4 datos clave si falta info: especie, edad, peso aprox, síntomas, desde cuándo, come/bebe, vacunas.
- Dar pasos concretos en bullets: qué observar, qué hacer en casa y qué NO hacer.
- Evitar diagnósticos definitivos. Hablar en probabilidades.
- Si el usuario pregunta algo peligroso (medicar con humanos, dosis), no dar dosis exactas. Recomendar vet.
- Respuestas claras, cortas, con empatía.
`;

// ========= HELPERS =========
function buildInput(query, history) {
  const safeHistory = Array.isArray(history) ? history : [];
  const transcript = safeHistory
    .slice(-10)
    .map((m) => {
      const who = m.role === 'user' ? 'Usuario' : 'AnimBot';
      const text = m?.parts?.[0]?.text ?? '';
      return `${who}: ${text}`;
    })
    .join('\n');

  return `Conversación previa:\n${transcript}\n\nUsuario: ${query}\nAnimBot:`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ========= CLIENTS =========
// OpenAI (oficial)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Groq (OpenAI-compatible)
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// Gemini (Google GenAI SDK)
const genai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// ========= PROVIDERS =========
async function askOpenAI(input) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY');
  const resp = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: input },
    ],
    temperature: 0.6,
  });
  return resp?.choices?.[0]?.message?.content?.trim() || '';
}

async function askGemini(input) {
  if (!genai) throw new Error('Falta GEMINI_API_KEY');
  // Gemini: generateContent (texto)
  // Ejemplo oficial: generateContent y uso de GEMINI_API_KEY como env :contentReference[oaicite:2]{index=2}
  const result = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [{ text: `${SYSTEM_PROMPT}\n\n${input}` }],
      },
    ],
  });

  const text = result?.text?.trim?.() || '';
  return text;
}

async function askGroq(input) {
  if (!process.env.GROQ_API_KEY) throw new Error('Falta GROQ_API_KEY');
  // Groq: endpoint OpenAI-compatible chat.completions :contentReference[oaicite:3]{index=3}
  const resp = await groq.chat.completions.create({
    model: 'llama-3.1-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: input },
    ],
    temperature: 0.6,
  });
  return resp?.choices?.[0]?.message?.content?.trim() || '';
}

// ========= MAIN CONTROLLER =========
const chatbotMobileQuery = async (req, res) => {
  try {
    const { query, history } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: "Falta 'query'." });
    }

    let parsedHistory = [];
    try {
      parsedHistory = history ? JSON.parse(history) : [];
    } catch {
      parsedHistory = [];
    }

    const input = buildInput(query, parsedHistory);

    const providers = [
      { name: 'openai', fn: askOpenAI },
      { name: 'gemini', fn: askGemini },
      { name: 'groq', fn: askGroq },
    ];

    let lastErr = null;

    for (const p of providers) {
      // reintento pequeño por proveedor
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const text = await p.fn(input);
          if (text) return res.json({ reply: text });

          throw new Error(`Respuesta vacía de ${p.name}`);
        } catch (err) {
          lastErr = err;
          await sleep(250 * attempt);
        }
      }
    }

    console.error('Chatbot error (all providers failed):', lastErr?.message || lastErr);

    // Mensaje amigable al usuario
    return res.status(503).json({
      error: 'AnimBot está teniendo problemas con sus proveedores de IA. Intenta otra vez en unos segundos 🙏',
    });
  } catch (err) {
    console.error('Fatal error:', err?.message || err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

module.exports = { chatbotMobileQuery };

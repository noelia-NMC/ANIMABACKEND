// ARCHIVO COMPLETO Y DEFINITIVO: Backend/src/controllers/chatbot.controller.js
// (Con prompt ultra-enfocado en veterinaria y AnimTech)    WEEEB 

const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");
const OpenAI = require("openai");
const fs = require('fs').promises;

// --- INICIALIZACIÓN DE LOS TRES CLIENTES DE IA ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- EL NUEVO CEREBRO DE DR. ANIMBOT (VERSIÓN SÚPER ENFOCADA) ---
const expertVetPrompt = `
Eres Dr. AnimBot 🐕‍⚕️, una IA experta **exclusivamente en medicina veterinaria** y en la plataforma **AnimTech**. Tu única misión es asistir a profesionales veterinarios. Eres su colega digital.

### 🌟 Tu personalidad
- **Colega experto:** Amigable, profesional y siempre enfocado en casos clínicos. Usas emojis 🐾🩺🔬.
- **Contextualmente inteligente:** Sabes que estás en la plataforma web de AnimTech y te diriges a un veterinario.

### 🩺 Tu conocimiento veterinario (absoluto y único)
Tu conocimiento es **única y exclusivamente** sobre medicina veterinaria. Cubres todas las especialidades: medicina interna, farmacología, cirugía, emergencias, toxicología, nutrición y comportamiento en todas las especies. **IGNORAS Y RECHAZAS CUALQUIER OTRO TEMA.**

### 🚀 Tu conocimiento sobre el ecosistema AnimTech
Conoces la plataforma a la perfección, desde la perspectiva de un veterinario.

**Si te preguntan "¿qué es AnimTech?" o similar:**
"¡Claro! Te explico nuestro ecosistema. AnimTech es una solución integral para el cuidado animal que conecta a dueños y veterinarios. Se divide en tres partes:\n\n1.  **Nuestra plataforma web (donde estamos ahora):** Este es nuestro centro de operaciones clínico. Desde aquí gestionamos pacientes (mascotas), agendamos turnos, documentamos historiales clínicos y atendemos las teleconsultas que nos llegan desde la app móvil.\n2.  **La aplicación móvil:** Es la herramienta para los dueños de mascotas. Les permite ver los datos de salud de sus animales, agendar citas contigo y solicitar teleconsultas. También incluye una función de rescate comunitario para animales en la calle.\n3.  **El collar inteligente:** Es un dispositivo para perros grandes que se sincroniza con la app móvil del dueño, monitoreando su ubicación, temperatura y actividad. Es una gran herramienta de prevención que nos puede dar datos valiosos en una consulta."

### ⚠️ REGLAS DE INTERACCIÓN (¡LA MÁS IMPORTANTE!)
-   **ENFOQUE TOTAL:** Si la pregunta o la imagen **NO es claramente sobre medicina veterinaria o la plataforma AnimTech** (por ejemplo: matemáticas, código, política, arte, etc.), DEBES rechazarla amablemente y reenfocar la conversación.
    -   **Ejemplo de rechazo:** "¡Hola colega! 😊 He analizado la imagen, pero no parece estar relacionada con un caso clínico o un animal. Mi especialidad es 100% la medicina veterinaria. ¿Hay alguna radiografía, lesión, o caso de un paciente en el que pueda ayudarte? 🐾"
-   **NO CONFUNDIR PLATAFORMAS:** Nunca sugieras al veterinario usar funciones de la app móvil. Explícalas como herramientas que usan los dueños.
-   **ASISTENCIA, NO REEMPLAZO:** Finaliza consultas complejas con: "Recuerda, esto es una guía. Tu evaluación directa del paciente es fundamental."
-   **SEGURIDAD FARMACOLÓGICA:** Al dar dosis: "⚠️ Dosis de referencia. Siempre confirma con la literatura actual y ajusta al paciente."

¡Estás listo para ser el mejor y más enfocado colega digital para los veterinarios de AnimTech! 🐾"
`;

// --- (El resto de las funciones se mantienen igual, pero las incluyo para que sea completo) ---

const handleTextQuery = async (req, res) => {
    const { query, history: historyJSON } = req.body;
    let history = [];
    try { if (historyJSON) history = JSON.parse(historyJSON); } catch (e) { console.warn("Historial de chat inválido."); }
    const chatHistory = (history || []).slice(-8).map(msg => ({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.parts[0].text }));
    const messages = [{ role: "system", content: expertVetPrompt }, ...chatHistory, { role: "user", content: query }];
    const strategies = [
        { name: 'groq', fn: () => groq.chat.completions.create({ messages, model: "llama3-8b-8192" }) },
        { name: 'openai', fn: () => openai.chat.completions.create({ messages, model: "gpt-3.5-turbo" }) },
        { name: 'gemini', fn: () => queryGeminiTextOnly(query, history) }
    ];
    for (const strategy of strategies) {
        try {
            const response = await strategy.fn();
            const reply = response.choices ? response.choices[0]?.message?.content : response;
            if (reply?.trim()) {
                console.log(`✅ AnimBot (Texto) respondió con ${strategy.name.toUpperCase()}`);
                return res.json({ reply: reply.trim(), model: strategy.name });
            }
        } catch (error) { console.warn(`❌ Error de texto con ${strategy.name}:`, error.message); }
    }
    res.status(503).json({ error: "Mis sistemas están un poco ocupados 🩺. ¿Podrías reformular tu consulta veterinaria?" });
};

const handleImageQuery = async (req, res) => {
    const { query, history: historyJSON } = req.body;
    if (!req.file) return res.status(400).json({ error: "No se ha proporcionado ninguna imagen." });
    let history = [];
    try { if (historyJSON) history = JSON.parse(historyJSON); } catch (e) { console.warn("Historial de chat inválido."); }
    try {
        const imageBuffer = await fs.readFile(req.file.path);
        const imageData = { inlineData: { data: imageBuffer.toString('base64'), mimeType: req.file.mimetype } };
        await fs.unlink(req.file.path);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const promptForImage = `Contexto de la conversación:\n${history.map(h => `${h.role === 'user' ? 'Veterinario' : 'Dr. AnimBot'}: ${h.parts[0].text}`).join('\n')}\n\nConsulta del veterinario sobre la imagen: "${query}"\n\nTu tarea: Como Dr. AnimBot (definido por el prompt del sistema), analiza la imagen y responde.`;
        const result = await model.generateContent([expertVetPrompt, promptForImage, imageData]);
        const reply = result.response.text();
        if (reply?.trim()) {
            console.log("✅ AnimBot (Imagen) respondió con Gemini");
            return res.json({ reply: reply.trim(), model: 'gemini' });
        } else { throw new Error("Gemini devolvió una respuesta vacía para la imagen."); }
    } catch (error) {
        console.error("❌ Error fatal al procesar la imagen con Gemini:", error.message);
        res.status(500).json({ error: "Lo siento, tuve un problema analizando la imagen 🔬. ¿Podrías intentarlo de nuevo?" });
    }
};

async function queryGeminiTextOnly(query, history) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const geminiHistory = [{ role: "user", parts: [{ text: expertVetPrompt }] }, { role: "model", parts: [{ text: "¡Hola! Soy Dr. AnimBot." }] }, ...(history || []).slice(-8)];
    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(query);
    return result.response.text();
}

module.exports = { 
    handleTextQuery,
    handleImageQuery 
};
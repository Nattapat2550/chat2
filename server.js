// server.mjs
import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { Channel, Image, Message } from './models.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Set MONGODB_URI in .env');
  process.exit(1);
}
await mongoose.connect(MONGODB_URI, {});

// Init Gemini client (it will read GEMINI_API_KEY from env)
const ai = new GoogleGenAI({});

// multer memory storage for image buffers
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// cookie-based user identification (cookie only)
app.use((req, res, next) => {
  let id = req.cookies?.chatUserId;
  if (!id) {
    id = uuidv4();
    res.cookie('chatUserId', id, { httpOnly: true, maxAge: 365*24*60*60*1000 });
  }
  req.chatUserId = id;
  next();
});

/* ------------------- Channels ------------------- */
// list
app.get('/api/channels', async (req, res) => {
  const channels = await Channel.find({ userId: req.chatUserId }).sort({ createdAt: 1 }).lean();
  res.json({ ok: true, channels });
});

// create
app.post('/api/channels', async (req, res) => {
  const name = req.body.name || 'New Channel';
  const c = new Channel({ userId: req.chatUserId, name });
  await c.save();
  res.json({ ok: true, channel: c });
});

// rename or delete
app.patch('/api/channels/:id', async (req, res) => {
  const id = req.params.id;
  const { op, name } = req.body;
  if (op === 'rename') {
    const channel = await Channel.findOneAndUpdate({ _id: id, userId: req.chatUserId }, { name }, { new: true });
    return res.json({ ok: !!channel, channel });
  } else if (op === 'delete') {
    const channel = await Channel.findOneAndDelete({ _id: id, userId: req.chatUserId });
    if (!channel) return res.json({ ok: false });
    // delete messages and images tied to those messages
    const messages = await Message.find({ channelId: id }).select('imageId').lean();
    const imgIds = messages.map(m => m.imageId).filter(Boolean);
    await Message.deleteMany({ channelId: id });
    if (imgIds.length) await Image.deleteMany({ _id: { $in: imgIds }});
    return res.json({ ok: true });
  }
  res.json({ ok:false, error:'unknown-op' });
});

/* ------------------- Images ------------------- */
// upload (memory -> MongoDB)
app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no-file' });
  const img = new Image({
    userId: req.chatUserId,
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    data: req.file.buffer
  });
  await img.save();
  res.json({ ok: true, imageId: img._id, filename: img.filename });
});

// delete uploaded image
app.delete('/api/upload/:id', async (req, res) => {
  const id = req.params.id;
  const img = await Image.findOneAndDelete({ _id: id, userId: req.chatUserId });
  res.json({ ok: !!img });
});

// serve image for display
app.get('/api/images/:id', async (req, res) => {
  const id = req.params.id;
  const img = await Image.findById(id);
  if (!img) return res.status(404).send('not found');
  res.set('Content-Type', img.contentType);
  res.send(img.data);
});

/* ------------------- Messages ------------------- */
// get messages for a channel (ascending)
app.get('/api/messages', async (req, res) => {
  const channelId = req.query.channelId;
  if (!channelId) return res.status(400).json({ ok:false, error:'missing channelId' });
  const messages = await Message.find({ channelId }).sort({ createdAt: 1 }).lean();
  res.json({ ok: true, messages });
});

/*
  send message:
  - store user message
  - create assistant placeholder (pending: true) and return both to client immediately
  - AFTER responding, call Gemini in background and update assistant message when done
*/
app.post('/api/send', async (req, res) => {
  try {
    const { channelId, text, imageId } = req.body;
    if (!channelId) return res.status(400).json({ ok:false, error:'missing channelId' });

    // Save user message
    const userMsg = new Message({
      channelId,
      userId: req.chatUserId,
      role: 'user',
      text: text || '',
      imageId: imageId || null,
      pending: false
    });
    await userMsg.save();

    // create assistant placeholder
    const assistantMsg = new Message({
      channelId,
      userId: req.chatUserId,
      role: 'assistant',
      text: '',
      pending: true
    });
    await assistantMsg.save();

    // respond immediately so client can show "typing" / pending message
    res.json({ ok: true, user: userMsg, assistant: assistantMsg });

    // Background AI call (do not await here)
    (async () => {
      try {
        // Build prompt from latest messages (short context)
        const last = await Message.find({ channelId }).sort({ createdAt: -1 }).limit(10).lean();
        const convo = last.reverse().map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text || (m.imageId ? '[image]' : '')}`).join('\n');
        let prompt = convo + '\nAssistant:';

        if (imageId) {
          const host = req.get('origin') || `${req.protocol}://${req.get('host')}`;
          prompt += `\nUser attached image: ${host}/api/images/${imageId}`;
        }

        // call Gemini via @google/genai
        const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const aiResp = await ai.models.generateContent({
          model,
          contents: prompt,
          // disable "thinking" to reduce time/cost if you want; comment this block to let thinking be used
          config: {
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        });

        // parse text (library returns .text in the quickstart)
        let aiText = aiResp?.text ?? (aiResp?.candidates && aiResp.candidates[0]?.content) ?? JSON.stringify(aiResp).slice(0, 4000);

        // minor beautify (do NOT HTML-escape here; escape in client)
        function sanitizeServerText(s) {
          if (!s) return '';
          return s
            .replace(/\r\n/g, '\n')
            .replace(/\t/g, '    ')
            .replace(/\.{3}/g, '…')
            .replace(/--/g, '—')
            .trim();
        }
        const safeText = sanitizeServerText(aiText);

        assistantMsg.text = safeText;
        assistantMsg.pending = false;
        await assistantMsg.save();
      } catch (err) {
        console.error('AI background error:', err);
        assistantMsg.text = '⚠️ (AI failed) — please try again later.';
        assistantMsg.pending = false;
        await assistantMsg.save();
      }
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

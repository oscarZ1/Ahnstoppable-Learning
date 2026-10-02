// src/index.js
// Entry point – wires together Express, Socket.IO, and all route handlers.

// MUST stay the first import – db/pool.js reads DATABASE_URL at module scope,
// and ESM evaluates imported modules in source order.
import 'dotenv/config';

import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import classRoutes from './routes/classes.js';
import postRoutes from './routes/posts.js';
import commentRoutes from './routes/comments.js';
import classroomRoutes from './routes/classroom.js';
import questionRoutes from './routes/questions.js';
import pollRoutes from './routes/polls.js';
import rosterRoutes from './routes/roster.js';
import registerSockets from './socket/index.js';

// ── Boot-time config checks ──────────────────────────────────────────────────
// Fail loudly here rather than falling back to '*' CORS or an undefined JWT secret.
for (const key of ['JWT_SECRET', 'CORS_ORIGIN']) {
  if (!process.env[key]) {
    throw new Error(`${key} is not set. See backend/.env.example.`);
  }
}
const origins = process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
const server = http.createServer(app);

// ── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: origins, methods: ['GET', 'POST'] },
});

app.set('io', io); // make io accessible inside route handlers via req.app.get('io')
registerSockets(io);

// ── Express middleware ────────────────────────────────────────────────────────
app.use(cors({ origin: origins }));
app.use(express.json());
// Express 5 leaves req.body undefined when no JSON body was sent; normalise so
// handlers can destructure it safely.
app.use((req, _res, next) => { req.body ??= {}; next(); });

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',                              authRoutes);
app.use('/api/classes',                           classRoutes);
app.use('/api/classes/:classId/posts',            postRoutes);
app.use('/api/posts/:postId/comments',            commentRoutes);
app.use('/api/classes/:classId/questions',        questionRoutes);
app.use('/api/classes/:classId/polls',            pollRoutes);
app.use('/api/classes/:classId/roster',           rosterRoutes);
app.use('/api/classes/:classId',                  classroomRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// ── Error handler (must be last) ──────────────────────────────────────────────
// Without this, Express's default handler returns a stack trace to the client.
// body-parser errors (malformed JSON) carry err.status = 400 and stay 4xx.
app.use((err, _req, res, _next) => {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error.' : (err.message || 'Bad request.') });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

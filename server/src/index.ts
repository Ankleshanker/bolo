import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT   = parseInt(process.env.PORT   ?? '3000', 10);
const ORIGIN = process.env.CORS_ORIGIN     ?? 'https://ankleshanker.github.io';

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: {
    origin: ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', players: io.engine.clientsCount });
});

// ─── Socket events ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected  (total: ${io.engine.clientsCount})`);

  // Let the client know its assigned ID
  socket.emit('welcome', { id: socket.id });

  // Latency probe — client sends ping, server acks immediately
  socket.on('ping', (cb: () => void) => {
    if (typeof cb === 'function') cb();
  });

  socket.on('disconnect', (reason) => {
    console.log(`[-] ${socket.id} disconnected: ${reason}  (total: ${io.engine.clientsCount})`);
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Bolo server listening on :${PORT}  (CORS origin: ${ORIGIN})`);
});

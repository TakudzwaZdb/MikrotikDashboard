import { Server } from 'socket.io'; import jwt from 'jsonwebtoken';
import { config } from '../config/index.js'; import { live } from '../jobs/poller.js';
export function initSocket(server) {
  const io = new Server(server, { cors: { origin: config.corsOrigin } });
  io.use((s, next) => { try { jwt.verify(s.handshake.auth?.token, config.jwtSecret); next(); } catch { next(new Error('unauthorized')); } });
  io.on('connection', s => s.emit('update', live));
  return io;
}

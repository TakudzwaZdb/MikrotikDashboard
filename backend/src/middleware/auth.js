import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
export function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  try { req.user = jwt.verify(t, config.jwtSecret); next(); } catch { res.status(401).json({ error: 'Unauthorized' }); }
}
const rank = { viewer: 1, operator: 2, admin: 3 };
export const requireRole = min => (req, res, next) =>
  (rank[req.user?.role] || 0) >= rank[min] ? next() : res.status(403).json({ error: 'Forbidden' });

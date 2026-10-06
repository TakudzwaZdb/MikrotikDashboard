import bcrypt from 'bcryptjs'; import { pool } from '../db.js';
const u = process.env.ADMIN_USER || 'admin', p = process.env.ADMIN_PASSWORD;
if (!p || p.length < 10) throw new Error('Set ADMIN_PASSWORD (10+ chars) in .env');
await pool.query(`INSERT INTO admins(username,password_hash,role_id) VALUES($1,$2,(SELECT id FROM roles WHERE name='admin'))
  ${process.env.ADMIN_RESET === 'true' ? 'ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash' : 'ON CONFLICT (username) DO NOTHING'}`, [u, await bcrypt.hash(p, 12)]);
console.log('admin ready:', u, process.env.ADMIN_RESET === 'true' ? '(password reset from .env)' : '(existing password kept)'); await pool.end();

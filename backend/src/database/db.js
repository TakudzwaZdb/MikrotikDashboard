import pg from 'pg';
import { config } from '../config/index.js';
export const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined }); // DATABASE_SSL=true for external hosted DBs (Neon, Supabase, Render external URL)
export const q = (text, params) => pool.query(text, params);

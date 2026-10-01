import pg from 'pg';
import { config } from '../config/index.js';
export const pool = new pg.Pool({ connectionString: config.databaseUrl });
export const q = (text, params) => pool.query(text, params);

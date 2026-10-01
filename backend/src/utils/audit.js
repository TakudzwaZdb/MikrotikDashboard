import { q } from '../database/db.js';
export const audit = (admin, action, { voucher, mac, ip, reason, result = 'OK' } = {}) =>
  q('INSERT INTO audit_logs(admin,action,voucher,mac_address,ip_address,reason,result) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [admin || 'system', action, voucher || null, mac || null, ip || null, reason || null, result]).catch(e => console.error('audit failed', e.message));

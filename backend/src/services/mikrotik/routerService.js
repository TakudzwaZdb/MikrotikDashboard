import { run, parseDuration, bytes } from './mikrotikClient.js';

export const getIdentity = () => run(async w => (await w('/system/identity/print'))[0]?.name);

export const getRouterResources = () => run(async w => {
  const r = (await w('/system/resource/print'))[0] || {};
  const total = bytes(r['total-memory']), free = bytes(r['free-memory']);
  return { version: r.version, board: r['board-name'], uptime: r.uptime, uptimeSeconds: parseDuration(r.uptime),
    cpuLoad: bytes(r['cpu-load']), memTotal: total, memUsed: total - free,
    memPercent: total ? Math.round(((total - free) / total) * 100) : 0,
    cpuModel: r.cpu || null, cpuFreq: bytes(r['cpu-frequency']) || null, cpuCount: bytes(r['cpu-count']) || null,
    hddTotal: bytes(r['total-hdd-space']), hddUsed: bytes(r['total-hdd-space']) - bytes(r['free-hdd-space']),
    hddPercent: bytes(r['total-hdd-space']) ? Math.round(((bytes(r['total-hdd-space']) - bytes(r['free-hdd-space'])) / bytes(r['total-hdd-space'])) * 100) : 0 };
});

/** Uses monitor-traffic with once=; RouterOS 6/7 both support it. */
export const getInterfaceTraffic = iface => run(async w => {
  const r = (await w('/interface/monitor-traffic', `=interface=${iface}`, '=once='))[0] || {};
  return { rxBps: bytes(r['rx-bits-per-second']), txBps: bytes(r['tx-bits-per-second']) };
});

const ip2n = x => x.split('.').reduce((a, o) => a * 256 + +o, 0);
const poolSize = ranges => { let n = 0; for (const r of String(ranges || '').split(',')) { const [a, b] = r.trim().split('-'); if (a) n += b ? ip2n(b) - ip2n(a) + 1 : 1; } return n; };

/** Optional panels (health, packages, admins, pools, leases). Every part is best-effort: boards without sensors simply return nulls. */
export const getSystemDetails = () => run(async w => {
  const safe = async (...c) => { try { return await w(...c); } catch { return []; } };
  const num = v => (v === undefined || v === '' || Number.isNaN(+v) ? null : +v);
  const health = await safe('/system/health/print'), hv = {};
  if (health[0]?.name) health.forEach(h => { hv[h.name] = h.value; }); else Object.assign(hv, health[0] || {}); // ROS7 rows vs ROS6 single row
  const pools = await safe('/ip/pool/print'), used = await safe('/ip/pool/used/print'), addr = await safe('/ip/address/print');
  return {
    temperature: num(hv.temperature ?? hv['cpu-temperature'] ?? hv['board-temperature1']), voltage: num(hv.voltage),
    ipAddress: (addr.find(a => a.disabled !== 'true')?.address || '').split('/')[0] || null,
    packages: (await safe('/system/package/print')).map(p => ({ name: p.name, enabled: p.disabled !== 'true', buildTime: p['build-time'] || '' })),
    admins: (await safe('/user/active/print')).map(u => ({ name: u.name, group: u.group, address: u.address, via: u.via, when: u.when })),
    pools: pools.map(p => { const size = poolSize(p.ranges), u = used.filter(x => x.pool === p.name).length; return { name: p.name, size, used: u, percent: size ? Math.round(u / size * 100) : 0 }; }),
    leases: (await safe('/ip/dhcp-server/lease/print')).slice(0, 500).map(l => ({ host: l['host-name'] || '', comment: l.comment || '', server: l.server, mac: l['mac-address'], address: l.address, active: l['active-address'] || '', status: l.status })),
  };
});

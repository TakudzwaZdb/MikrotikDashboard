import { run } from './mikrotikClient.js';
/** Hosts table: includes hosts that are not yet authenticated. */
export const getHosts = () => run(async w => (await w('/ip/hotspot/host/print')).map(h => ({
  mac: h['mac-address'], ip: h.address, authorized: h.authorized === 'true', bypassed: h.bypassed === 'true' })));

/** MAC / IP -> host name, from DHCP leases (host-name, falling back to the lease comment). Best-effort: returns empty maps on failure. */
export const getHostNames = () => run(async w => {
  let leases = []; try { leases = await w('/ip/dhcp-server/lease/print'); } catch { /* DHCP server may not exist */ }
  const byMac = new Map(), byIp = new Map();
  for (const l of leases) { const n = l['host-name'] || l.comment; if (!n) continue;
    if (l['mac-address']) byMac.set(l['mac-address'].toUpperCase(), n);
    for (const ip of [l.address, l['active-address']]) if (ip) byIp.set(ip, n); }
  return { byMac, byIp };
}).catch(() => ({ byMac: new Map(), byIp: new Map() }));

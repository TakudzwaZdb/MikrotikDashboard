import { run, bytes, parseDuration } from './mikrotikClient.js';

const isDis = v => v === 'true' || v === 'yes';
// In /ip/hotspot/user, bytes-in = received FROM the client (upload); bytes-out = sent TO client (download).
export function mapUser(u) {
  return { mtId: u['.id'], username: u.name, profile: u.profile, disabled: isDis(u.disabled),
    uptime: u.uptime, uptimeSeconds: parseDuration(u.uptime), limitUptimeSeconds: parseDuration(u['limit-uptime']),
    limitBytesTotal: bytes(u['limit-bytes-total']) || null, upload: bytes(u['bytes-in']), download: bytes(u['bytes-out']),
    mac: u['mac-address'] || null, comment: u.comment || '' };
}

export const getHotspotUsers = () => run(async w => (await w('/ip/hotspot/user/print')).filter(u => u.name && u.name !== 'default-trial').map(mapUser));
export const getHotspotUser = name => run(async w => { const r = await w('/ip/hotspot/user/print', `?name=${name}`); return r[0] ? mapUser(r[0]) : null; });
export const getHotspotProfiles = () => run(async w => (await w('/ip/hotspot/user/profile/print')).map(p => ({
  name: p.name, rateLimit: p['rate-limit'] || null, sharedUsers: p['shared-users'], sessionTimeout: p['session-timeout'] || null })));

async function setDisabled(w, name, val) {
  const r = await w('/ip/hotspot/user/print', `?name=${name}`);
  if (!r[0]) throw new Error(`Hotspot user ${name} not found on router`);
  await w('/ip/hotspot/user/set', `=.id=${r[0]['.id']}`, `=disabled=${val}`);
  const v = (await w('/ip/hotspot/user/print', `?name=${name}`))[0]; // verify
  if (isDis(v.disabled) !== (val === 'yes')) throw new Error('Router did not apply change');
}
export const disableHotspotUser = name => run(w => setDisabled(w, name, 'yes'));
export const enableHotspotUser = name => run(w => setDisabled(w, name, 'no'));

/** RESET USAGE: clears the router counters for one user (admin-explicit only). */
export const resetUserCounters = name => run(async w => {
  const r = await w('/ip/hotspot/user/print', `?name=${name}`);
  if (!r[0]) throw new Error('not found'); await w('/ip/hotspot/user/reset-counters', `=.id=${r[0]['.id']}`);
});

/** Device blocking via hotspot ip-binding type=blocked (MAC based; randomized MACs can evade this). */
export const blockMac = (mac, comment) => run(async w => {
  const ex = await w('/ip/hotspot/ip-binding/print', `?mac-address=${mac}`);
  if (ex[0]) await w('/ip/hotspot/ip-binding/set', `=.id=${ex[0]['.id']}`, '=type=blocked', `=comment=${comment}`);
  else await w('/ip/hotspot/ip-binding/add', `=mac-address=${mac}`, '=type=blocked', `=comment=${comment}`);
});
export const unblockMac = mac => run(async w => {
  for (const b of await w('/ip/hotspot/ip-binding/print', `?mac-address=${mac}`))
    if (b.type === 'blocked') await w('/ip/hotspot/ip-binding/remove', `=.id=${b['.id']}`);
});

/** Permanently deletes the hotspot user from the router (used by the data cap). */
export const removeHotspotUser = name => run(async w => {
  const r = await w('/ip/hotspot/user/print', `?name=${name}`);
  if (!r[0]) return; await w('/ip/hotspot/user/remove', `=.id=${r[0]['.id']}`);
  if ((await w('/ip/hotspot/user/print', `?name=${name}`)).length) throw new Error('User still present after removal');
});

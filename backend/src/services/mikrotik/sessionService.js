import { run, bytes, parseDuration } from './mikrotikClient.js';

export function mapActive(a) {
  return { mtId: a['.id'], username: a.user, mac: a['mac-address'], ip: a.address, uptime: a.uptime,
    uptimeSeconds: parseDuration(a.uptime), idleSeconds: parseDuration(a['idle-time']), sessionTimeLeft: a['session-time-left'] || null,
    upload: bytes(a['bytes-in']), download: bytes(a['bytes-out']), loginBy: a['login-by'] };
}
export const getActiveHotspotUsers = () => run(async w => (await w('/ip/hotspot/active/print')).map(mapActive));

/** Removes the REAL session, then verifies it is gone. */
export const disconnectHotspotSession = username => run(async w => {
  const act = await w('/ip/hotspot/active/print', `?user=${username}`);
  if (!act.length) return { disconnected: 0, note: 'no active session on router' };
  for (const a of act) await w('/ip/hotspot/active/remove', `=.id=${a['.id']}`);
  const left = await w('/ip/hotspot/active/print', `?user=${username}`);
  if (left.length) throw new Error('Session still active after removal');
  return { disconnected: act.length };
});

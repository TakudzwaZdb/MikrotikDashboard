import { run, bytes, parseDuration } from './mikrotikClient.js';

export function mapActive(a) {
  return {
    mtId: a['.id'],
    username: a.user,
    mac: a['mac-address'],
    ip: a.address,
    uptime: a.uptime,
    uptimeSeconds: parseDuration(a.uptime),
    idleSeconds: parseDuration(a['idle-time']),
    sessionTimeLeft: a['session-time-left'] || null,
    upload: bytes(a['bytes-in']),
    download: bytes(a['bytes-out']),
    loginBy: a['login-by']
  };
}

export const getActiveHotspotUsers = () =>
  run(async w => {
    const active = await w('/ip/hotspot/active/print');
    return active.map(mapActive);
  });

/**
 * Disconnect an active Hotspot session.
 *
 * We intentionally fetch the active sessions without a RouterOS
 * username filter. We then find the matching user locally and
 * remove the session using its real RouterOS .id.
 */
export const disconnectHotspotSession = username =>
  run(async w => {
    const target = String(username || '').trim();

    if (!target) {
      throw new Error('Username is required');
    }

    console.log(
      `[MikroTik] Looking for active session: ${target}`
    );

    const active =
      await w('/ip/hotspot/active/print');

    const matches = active.filter(
      session =>
        String(session.user || '').trim() === target
    );

    if (!matches.length) {
      return {
        disconnected: 0,
        note: 'No active session found on router'
      };
    }

    let disconnected = 0;

    for (const session of matches) {
      const id = session['.id'];

      if (!id) {
        continue;
      }

      console.log(
        `[MikroTik] Removing active session ${id} for ${target}`
      );

      await w(
        '/ip/hotspot/active/remove',
        `=.id=${id}`
      );

      disconnected++;
    }

    return {
      disconnected,
      username: target
    };
  });
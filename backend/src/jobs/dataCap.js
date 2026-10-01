
import { config } from '../config/index.js';
import { q } from '../database/db.js';
import { disconnectHotspotSession } from '../services/mikrotik/sessionService.js';
import {
  disableHotspotUser,
  removeHotspotUser,
  blockMac
} from '../services/mikrotik/hotspotService.js';
import { audit } from '../utils/audit.js';

const DATA_CAP_EXEMPT_USERS = new Set([
  'admin',
  'admin2',
  'admin4',
  'DONOTDELETEADMIN'
]);

const done = new Set();

export async function enforceCap(vouchers, active) {
  const out = {
    events: [],
    removed: new Set()
  };

  if (!config.capBytes) return out;

  for (const v of vouchers) {
    const username = String(v.username || '').trim();

    // These accounts are completely exempt from the data cap.
    if (DATA_CAP_EXEMPT_USERS.has(username)) {
      done.delete(username);
      continue;
    }

    // User has not reached the configured cap.
    if (v.total < config.capBytes) {
      done.delete(username);
      continue;
    }

    // Already processed during a previous polling cycle.
    if (done.has(username)) continue;

    const mine = active.filter(
      a => a.username === username
    );

    const macs = [
      ...new Set(
        [v.mac, ...mine.map(a => a.mac)].filter(Boolean)
      )
    ];

    const steps = [];

    try {
      // Disconnect active HotSpot session.
      await disconnectHotspotSession(username);
      steps.push('disconnected');

      // Disable the HotSpot voucher.
      await disableHotspotUser(username);
      steps.push('blocked');

      // Block associated devices.
      if (config.capBlockDeviceHours > 0) {
        for (const mac of macs) {
          await blockMac(
            mac,
            `data-cap:${username}`
          );

          await q(
            `INSERT INTO blocked_devices(
              mac_address,
              ip_address,
              voucher_username,
              reason,
              blocked_by,
              expires_at
            )
            SELECT
              $1,
              $2,
              $3,
              'Data cap reached',
              'system',
              $4
            WHERE NOT EXISTS (
              SELECT 1
              FROM blocked_devices
              WHERE mac_address = $1
              AND active
            )`,
            [
              mac,
              mine[0]?.ip || null,
              username,
              new Date(
                Date.now() +
                config.capBlockDeviceHours * 3600000
              )
            ]
          );

          steps.push('device blocked');
        }
      }

      // Save final usage snapshot.
      await q(
        `INSERT INTO voucher_usage(
          username,
          mac_address,
          upload_bytes,
          download_bytes,
          total_bytes,
          session_seconds
        )
        VALUES($1,$2,$3,$4,$5,$6)`,
        [
          username,
          macs[0] || null,
          v.upload,
          v.download,
          v.total,
          v.uptimeSeconds
        ]
      );

      // Mark voucher as blocked in the local cache.
      await q(
        `UPDATE vouchers_cache
         SET blocked = true,
             limit_reached_at = now()
         WHERE username = $1`,
        [username]
      );

      // Remove the voucher if configured.
      if (config.capRemoveUser) {
        await removeHotspotUser(username);
        steps.push('removed');
        out.removed.add(username);
      }

      done.add(username);

      const reason =
        `Cap ${config.capBytes} bytes reached ` +
        `(used ${v.total}); ${steps.join(', ')}`;

      // Audit record.
      await audit(
        'system',
        'Data cap enforced',
        {
          voucher: username,
          mac: macs[0] || null,
          ip: mine[0]?.ip || null,
          reason
        }
      );

      // Security alert.
      await q(
        `INSERT INTO security_alerts(
          username,
          mac_address,
          severity,
          indicators,
          action_taken
        )
        VALUES($1,$2,'MEDIUM',$3,$4)`,
        [
          username,
          macs[0] || null,
          JSON.stringify(['DATA CAP REACHED']),
          steps.join('+')
        ]
      );

      out.events.push({
        username,
        total: v.total,
        steps
      });

    } catch (e) {
      // Retry during the next polling cycle if enforcement fails.
      await audit(
        'system',
        'Data cap enforcement failed',
        {
          voucher: username,
          reason: steps.join(', '),
          result: e.message
        }
      );
    }
  }

  return out;
}

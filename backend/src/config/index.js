import 'dotenv/config';

const b = (v, d) =>
  v === undefined
    ? d
    : String(v).toLowerCase() === 'true';

export const config = {
  port: +process.env.PORT || 8080,

  databaseUrl: process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET,

  corsOrigin:
    process.env.CORS_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:5173',

  pollInterval: Math.max(
    3,
    +process.env.USAGE_POLL_INTERVAL || 10
  ),

  autoDisconnect: b(
    process.env.AUTO_DISCONNECT_SUSPICIOUS,
    false
  ),

  autoBlock: b(
    process.env.AUTO_BLOCK_SUSPICIOUS,
    false
  ),

  capBytes:
    (
      process.env.DATA_CAP_GB === undefined
        ? 2.5
        : +process.env.DATA_CAP_GB
    ) * 1024 ** 3,

  capRemoveUser: b(
    process.env.DATA_CAP_REMOVE_USER,
    true
  ),

  capBlockDeviceHours:
    process.env.DATA_CAP_BLOCK_DEVICE_HOURS === undefined
      ? 24
      : +process.env.DATA_CAP_BLOCK_DEVICE_HOURS,

  connectorMode: b(
    process.env.CONNECTOR_MODE,
    false
  ),

  connectorToken:
    process.env.CONNECTOR_TOKEN || null,

  // optional push alerts (see services/notify.js)
  notify: {
    telegramToken: process.env.NOTIFY_TELEGRAM_TOKEN || '',
    telegramChat: process.env.NOTIFY_TELEGRAM_CHAT || '',
    webhookUrl: process.env.NOTIFY_WEBHOOK_URL || '',
    offlineAfterFails: Math.max(1, +process.env.NOTIFY_OFFLINE_AFTER_FAILS || 3),
  },

  mikrotik: {
    host: process.env.MIKROTIK_HOST,

    port:
      +process.env.MIKROTIK_PORT || 8729,

    user:
      process.env.MIKROTIK_USERNAME,

    password:
      process.env.MIKROTIK_PASSWORD,

    tls:
      b(
        process.env.MIKROTIK_USE_TLS,
        true
      ),
  },
};

/*
 * Only the web server needs JWT_SECRET. The laptop connector
 * (CONNECTOR_PROCESS=1, set by agent.js) only talks to the router
 * and to Render, so it must not demand it.
 */
if (
  !process.env.CONNECTOR_PROCESS &&
  (!config.jwtSecret ||
    config.jwtSecret.length < 24)
) {
  throw new Error(
    'JWT_SECRET must be set (24+ chars)'
  );
}
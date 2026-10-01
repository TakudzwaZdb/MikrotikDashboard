import 'dotenv/config';
const b = (v, d) => (v === undefined ? d : String(v).toLowerCase() === 'true');
export const config = {
  port: +process.env.PORT || 8080,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  pollInterval: Math.max(3, +process.env.USAGE_POLL_INTERVAL || 10),
  autoDisconnect: b(process.env.AUTO_DISCONNECT_SUSPICIOUS, false),
  autoBlock: b(process.env.AUTO_BLOCK_SUSPICIOUS, false),
  capBytes: (process.env.DATA_CAP_GB === undefined ? 2.5 : +process.env.DATA_CAP_GB) * 1024 ** 3, // 0 disables
  capRemoveUser: b(process.env.DATA_CAP_REMOVE_USER, true),
  capBlockDeviceHours: process.env.DATA_CAP_BLOCK_DEVICE_HOURS === undefined ? 24 : +process.env.DATA_CAP_BLOCK_DEVICE_HOURS, // 0 = do not block the device
  mikrotik: {
    host: process.env.MIKROTIK_HOST, port: +process.env.MIKROTIK_PORT || 8729,
    user: process.env.MIKROTIK_USERNAME, password: process.env.MIKROTIK_PASSWORD,
    tls: b(process.env.MIKROTIK_USE_TLS, true),
  },
};
if (!config.jwtSecret || config.jwtSecret.length < 24) throw new Error('JWT_SECRET must be set (24+ chars)');

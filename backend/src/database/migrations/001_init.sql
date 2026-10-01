CREATE TABLE IF NOT EXISTS roles (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
INSERT INTO roles(name) VALUES ('admin'),('operator'),('viewer') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role_id INT NOT NULL REFERENCES roles(id), created_at TIMESTAMPTZ DEFAULT now());
-- cache only: MikroTik is authoritative
CREATE TABLE IF NOT EXISTS vouchers_cache (username TEXT PRIMARY KEY, mt_id TEXT, profile TEXT, disabled BOOLEAN DEFAULT false,
  limit_uptime TEXT, limit_bytes_total BIGINT, comment TEXT, first_login TIMESTAMPTZ, last_login TIMESTAMPTZ,
  usage_offset_bytes BIGINT DEFAULT 0, synced_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS devices (mac_address TEXT PRIMARY KEY, last_ip TEXT, last_voucher TEXT,
  first_seen TIMESTAMPTZ DEFAULT now(), last_seen TIMESTAMPTZ DEFAULT now(), risk_level TEXT DEFAULT 'LOW');
CREATE TABLE IF NOT EXISTS active_sessions (mt_id TEXT PRIMARY KEY, username TEXT, mac_address TEXT, ip_address TEXT,
  login_time TIMESTAMPTZ, bytes_in BIGINT DEFAULT 0, bytes_out BIGINT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS session_history (id BIGSERIAL PRIMARY KEY, mt_id TEXT, username TEXT, mac_address TEXT, ip_address TEXT,
  started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ DEFAULT now(), duration_seconds INT, upload_bytes BIGINT, download_bytes BIGINT);
CREATE TABLE IF NOT EXISTS voucher_usage (id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(), username TEXT NOT NULL,
  mac_address TEXT, ip_address TEXT, upload_bytes BIGINT, download_bytes BIGINT, total_bytes BIGINT, session_seconds INT);
CREATE INDEX IF NOT EXISTS voucher_usage_idx ON voucher_usage(username, ts);
CREATE TABLE IF NOT EXISTS device_usage (id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(), mac_address TEXT NOT NULL,
  ip_address TEXT, username TEXT, upload_bytes BIGINT, download_bytes BIGINT, total_bytes BIGINT, session_seconds INT);
CREATE INDEX IF NOT EXISTS device_usage_idx ON device_usage(mac_address, ts);
CREATE TABLE IF NOT EXISTS blocked_devices (id SERIAL PRIMARY KEY, mac_address TEXT, ip_address TEXT, voucher_username TEXT,
  reason TEXT, blocked_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), expires_at TIMESTAMPTZ, active BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS security_alerts (id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(), username TEXT, mac_address TEXT,
  severity TEXT, indicators JSONB, action_taken TEXT, resolved BOOLEAN DEFAULT false);
CREATE TABLE IF NOT EXISTS audit_logs (id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(), admin TEXT, action TEXT,
  voucher TEXT, mac_address TEXT, ip_address TEXT, reason TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

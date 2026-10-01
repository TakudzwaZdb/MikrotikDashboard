// Only a JWT lives in the browser. MikroTik credentials never reach the frontend.
export const getToken = () => sessionStorage.getItem('jwt');
export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { sessionStorage.removeItem('jwt'); location.reload(); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
export const fmtBytes = n => { n = +n || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return `${n.toFixed(i ? 2 : 0)} ${u[i]}`; };
export const fmtSecs = s => { s = +s || 0; return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`; };
export const fmtRate = b => b > 1e6 ? `${(b / 1e6).toFixed(1)} Mbps` : `${(b / 1e3).toFixed(0)} kbps`;

// Only a JWT lives in the browser. MikroTik credentials never reach the frontend.
export const getToken = () => sessionStorage.getItem('jwt');
// Free hosting sleeps when idle: the first requests after a wake-up/restart can fail with a network error. Retry a few times before giving up.
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Every request has a time limit: a hung request must end in a clear message, never an endless spinner.
const TIMEOUT_MS = 45000;
async function fetchRetry(url, init, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      if (i >= tries - 1) throw new Error(timedOut
        ? `The server did not answer within ${TIMEOUT_MS / 1000} s. It may be waking up (free hosting) - wait a minute and try again.`
        : `Cannot reach the server (${location.origin}). It may be waking up - wait a minute and try again. [${e.message}]`);
      await sleep(2000 * (i + 1));
    }
  }
}
export async function api(path, opts = {}) {
  const r = await fetchRetry('/api' + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { sessionStorage.removeItem('jwt'); location.reload(); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
export const fmtBytes = n => { n = +n || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return `${n.toFixed(i ? 2 : 0)} ${u[i]}`; };
export const fmtSecs = s => { s = +s || 0; return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`; };
export const fmtRate = b => b > 1e6 ? `${(b / 1e6).toFixed(1)} Mbps` : `${(b / 1e3).toFixed(0)} kbps`;

export const since = t => { if (!t) return ''; const s = Math.max(0, Math.round((Date.now() - new Date(t)) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };

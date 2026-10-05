import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Chart as C, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip, Legend } from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { api, getToken, fmtBytes, fmtSecs, fmtRate } from './api.js';
import NetworkOverview from './NetworkOverview.jsx';
C.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip, Legend);

const THEMES = {
  dark: { label: 'Grafana Dark', dark: true, v: { bg: '#111217', panel: '#181b1f', border: '#2c3235', border2: '#3c4045', hover: '#22262b', input: '#0b0c0e', track: '#2a2d33', text: '#ccccdc', strong: '#d8d9da', muted: '#8e8e9c', accent: '#ff9830', primary: '#3871dc', primaryh: '#4a80e8', redtext: '#ff8a97', dangerbg: '#2a1215' }, c: { G: '#73bf69', Y: '#f2cc0c', R: '#f2495c', B: '#5794f2', O: '#ff9830', MUT: '#8e8e9c' } },
  light: { label: 'Light', dark: false, v: { bg: '#f4f5f5', panel: '#ffffff', border: '#d8dade', border2: '#c4c8ce', hover: '#eceef1', input: '#ffffff', track: '#dfe2e6', text: '#2b3139', strong: '#111827', muted: '#6b7280', accent: '#ff780a', primary: '#3871dc', primaryh: '#2a5cbf', redtext: '#b42318', dangerbg: '#fdecec' }, c: { G: '#2e9d3c', Y: '#d29a00', R: '#d1242f', B: '#1f6feb', O: '#e8590c', MUT: '#6b7280' } },
  midnight: { label: 'Midnight Blue', dark: true, v: { bg: '#0a0f1e', panel: '#111a33', border: '#22305a', border2: '#2f417a', hover: '#17224a', input: '#070b16', track: '#1f2a4d', text: '#c9d3f0', strong: '#eaf0ff', muted: '#7d8bb5', accent: '#4cc9f0', primary: '#4361ee', primaryh: '#5b78ff', redtext: '#fda4af', dangerbg: '#2b1220' }, c: { G: '#4ade80', Y: '#facc15', R: '#fb7185', B: '#60a5fa', O: '#fb923c', MUT: '#7d8bb5' } },
  nord: { label: 'Nord', dark: true, v: { bg: '#2e3440', panel: '#3b4252', border: '#4c566a', border2: '#5b667d', hover: '#434c5e', input: '#272c36', track: '#4c566a', text: '#d8dee9', strong: '#eceff4', muted: '#9aa5bd', accent: '#88c0d0', primary: '#5e81ac', primaryh: '#7196c4', redtext: '#e5a0a7', dangerbg: '#3d2b32' }, c: { G: '#a3be8c', Y: '#ebcb8b', R: '#bf616a', B: '#81a1c1', O: '#d08770', MUT: '#9aa5bd' } },
  matrix: { label: 'Terminal Green', dark: true, v: { bg: '#050a07', panel: '#0b140e', border: '#17331f', border2: '#1f4a2c', hover: '#102014', input: '#030604', track: '#14281a', text: '#b7e4c7', strong: '#d9ffe6', muted: '#6fa284', accent: '#22c55e', primary: '#16a34a', primaryh: '#22c55e', redtext: '#ff9b9b', dangerbg: '#2a1010' }, c: { G: '#22c55e', Y: '#eab308', R: '#ef4444', B: '#38bdf8', O: '#f59e0b', MUT: '#6fa284' } },
  contrast: { label: 'High Contrast', dark: true, v: { bg: '#000000', panel: '#0a0a0a', border: '#9ca3af', border2: '#d1d5db', hover: '#1f1f1f', input: '#000000', track: '#3a3a3a', text: '#ffffff', strong: '#ffffff', muted: '#d1d5db', accent: '#ffee00', primary: '#1d4ed8', primaryh: '#3b82f6', redtext: '#ff8080', dangerbg: '#330000' }, c: { G: '#00ff5f', Y: '#ffee00', R: '#ff4d4d', B: '#4da3ff', O: '#ffa500', MUT: '#d1d5db' } },
};
let G, Y, R, B, O, MUT, axis;
const resolveTheme = k => k === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  : k === 'schedule' ? (new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'light' : 'dark') : (THEMES[k] ? k : 'dark');
function applyTheme(key, accent) {
  const t = THEMES[resolveTheme(key)], root = document.documentElement;
  Object.entries(t.v).forEach(([k, v]) => root.style.setProperty('--' + k, v));
  if (accent) root.style.setProperty('--accent', accent);
  ({ G, Y, R, B, O, MUT } = t.c);
  root.style.setProperty('--orange', O); root.style.setProperty('--yellow', Y); root.style.setProperty('--purple', t.dark ? '#b794f6' : '#7c3aed'); root.style.setProperty('--cyan', t.dark ? '#22d3ee' : '#0891b2'); root.style.setProperty('--pink', t.dark ? '#f472b6' : '#db2777'); root.style.setProperty('--green', G); root.style.setProperty('--red', R); root.style.setProperty('--blue', B);
  root.style.colorScheme = t.dark ? 'dark' : 'light';
  axis = { grid: { color: t.v.border }, ticks: { color: t.v.muted, maxTicksLimit: 6 } }; // Chart.js needs real colour values
}
applyTheme(localStorage.getItem('theme') || 'dark', localStorage.getItem('accent'));

const tone = p => (p < 60 ? G : p < 85 ? Y : R);
const bcol = s => ({ ACTIVE: G, ONLINE: G, BLOCKED: R, DISABLED: MUT, HIGH: R, MEDIUM: O, LOW: B, OFFLINE: MUT }[s] || O);
const Badge = ({ s }) => <span className="px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap" style={{ color: bcol(s), background: bcol(s) + '22', border: `1px solid ${bcol(s)}55` }}>{s}</span>;
const KINDS = { disconnect: 'orange', enable: 'green', disable: 'yellow', block: 'red', unblock: 'blue', export: 'purple', test: 'cyan', sync: 'pink', refresh: 'cyan', view: 'blue' };
const Btn = ({ children, onClick, danger, kind, disabled }) => { const c = `var(--${KINDS[kind] || (danger ? 'red' : 'blue')})`;
  return <button disabled={disabled} onClick={onClick} style={{ color: c, borderColor: `color-mix(in srgb, ${c} 55%, transparent)`, background: `color-mix(in srgb, ${c} 14%, transparent)` }}
    className="px-2.5 py-1 rounded text-xs font-semibold border whitespace-nowrap transition hover:brightness-125 hover:shadow-[0_0_0_1px_currentColor] disabled:opacity-40">{children}</button>; };

const Panel = ({ title, right, children, className = '' }) => <section className={`bg-[color:var(--panel)] border border-[color:var(--border)] rounded ${className}`}>
  {title && <header className="flex items-center justify-between px-3 py-2 text-[13px] font-bold text-[color:var(--strong)]"><span>{title}</span>{right}</header>}<div className="px-3 pb-3">{children}</div></section>;
const Stat = ({ title, value, color = G, sub }) => <Panel title={title}><div className="text-3xl font-semibold leading-tight truncate text-center py-1" style={{ color }}>{value ?? '—'}</div>{sub && <div className="text-xs text-[color:var(--muted)] mt-1 text-center">{sub}</div>}</Panel>;
const Led = ({ v, n = 24 }) => { const on = Math.round(Math.min(100, v) / 100 * n);
  return <div className="flex gap-[2px] h-5">{Array.from({ length: n }, (_, i) => <div key={i} className="flex-1 rounded-[1px]" style={{ background: i < on ? (i / n < .6 ? G : i / n < .85 ? Y : R) : 'var(--track)' }} />)}</div>; };

function TS({ title, labels, sets, fmt = v => v, stats }) {
  const st = d => { d = d.filter(x => x != null); return d.length ? { mean: d.reduce((x, y) => x + y, 0) / d.length, max: Math.max(...d), min: Math.min(...d) } : null; };
  return <Panel title={title}><div className="h-44"><Line data={{ labels, datasets: sets.map(s => ({ ...s, borderWidth: 1.5, pointRadius: 0, tension: .3, fill: true, backgroundColor: s.borderColor + '33' })) }}
    options={{ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
      scales: { x: { ...axis, ticks: { ...axis.ticks, maxRotation: 0 } }, y: { ...axis, beginAtZero: true, ticks: { ...axis.ticks, callback: fmt } } } }} /></div>
    {stats ? <table className="w-full text-xs mt-2"><thead><tr className="text-[color:var(--blue)] text-left"><th className="font-bold">Name</th><th className="font-bold">Mean</th><th className="font-bold">Max</th><th className="font-bold">Min</th></tr></thead>
      <tbody>{sets.map(s => { const x = st(s.data); return <tr key={s.label}><td><span className="inline-block w-3 h-[3px] mr-2 align-middle" style={{ background: s.borderColor }} />{s.label}</td>
        {x ? [x.mean, x.max, x.min].map((v, i) => <td key={i}>{fmt(Math.round(v * 10) / 10)}</td>) : <td colSpan={3}>—</td>}</tr>; })}</tbody></table>
      : sets.length > 1 && <div className="flex gap-4 text-xs mt-2 text-[color:var(--muted)]">{sets.map(s => <span key={s.label}><span className="inline-block w-3 h-[3px] mr-1 align-middle" style={{ background: s.borderColor }} />{s.label}</span>)}</div>}</Panel>;
}

function Table({ cols, rows, empty = 'No data', compact, search, freeze = 0 }) {
  const FW = [130, 170], fz = (i, th) => i < freeze ? { position: 'sticky', left: FW.slice(0, i).reduce((a, b) => a + b, 0), width: FW[i], minWidth: FW[i], maxWidth: FW[i] } : undefined;
  const [q, setQ] = useState(''), [sort, setSort] = useState(null);
  const f = useMemo(() => { let r = rows.filter(x => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));
    if (sort) r = [...r].sort((a, b) => (a[sort.k] > b[sort.k] ? 1 : a[sort.k] < b[sort.k] ? -1 : 0) * sort.d); return r; }, [rows, q, sort]);
  return <div>{(!compact || search) && <input className="bg-[color:var(--input)] border border-[color:var(--border)] rounded px-2 py-1 mb-2 w-full sm:w-72 text-sm" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />}
    <div className={`overflow-auto rounded border border-[color:var(--border)] ${compact ? 'max-h-72' : 'max-h-[calc(100vh-220px)] min-h-[260px]'}`}>
      <table className="w-full text-[13px] border-separate border-spacing-0"><thead><tr>{cols.map((c, i) => <th key={c.h} onClick={() => c.k && setSort({ k: c.k, d: sort?.k === c.k ? -sort.d : 1 })}
        style={fz(i)} className={`sticky top-0 ${i < freeze ? 'z-30' : 'z-20'} ${i === freeze - 1 ? 'border-r border-r-[color:var(--border2)]' : ''} text-left px-3 py-2 font-bold text-[11px] uppercase tracking-wide whitespace-nowrap bg-[color:var(--hover)] text-[color:var(--strong)] border-b border-[color:var(--border2)] ${c.k ? 'cursor-pointer select-none' : ''}`}>
        {c.h}{c.k && sort?.k === c.k ? (sort.d > 0 ? ' ↑' : ' ↓') : ''}</th>)}</tr></thead>
      <tbody>{f.map((r, i) => <tr key={i} className="group even:bg-[color-mix(in_srgb,var(--hover)_40%,transparent)] hover:bg-[color:var(--hover)]">{cols.map((c, ci) => <td key={c.h} style={fz(ci)} className={`px-3 py-2 whitespace-nowrap border-b border-[color:var(--border)] align-middle ${ci < freeze ? `z-10 truncate bg-[color:var(--panel)] group-even:bg-[color-mix(in_srgb,var(--hover)_40%,var(--panel))] group-hover:!bg-[color:var(--hover)] ${ci === freeze - 1 ? 'border-r border-r-[color:var(--border2)]' : ''}` : ''}`}>{c.r ? c.r(r) : (r[c.k] ?? '—')}</td>)}</tr>)}</tbody></table>
      {!f.length && <div className="p-4 text-center text-[color:var(--muted)]">{empty}</div>}</div>
    <div className="mt-1 text-[11px] text-[color:var(--muted)]">{f.length} row{f.length === 1 ? '' : 's'}</div></div>;
}

const effLimit = (v, cap) => Math.min(v.limitBytesTotal || Infinity, cap || Infinity);
function Usage({ v, cap }) {
  const lim = effLimit(v, cap); if (!isFinite(lim)) return <span>{fmtBytes(v.total)}</span>;
  const p = Math.min(100, v.total / lim * 100);
  return <div className="w-44"><div className="h-2 bg-[color:var(--track)] rounded"><div className="h-2 rounded" style={{ width: p + '%', background: tone(p) }} /></div>
    <div className="text-[11px] text-[color:var(--muted)] mt-0.5">{fmtBytes(v.total)} / {fmtBytes(lim)} · left {fmtBytes(Math.max(0, lim - v.total))}</div></div>;
}

const SCENE = (() => { // procedural night-city scene (original artwork, no external image)
  const r = rng(5), stars = Array.from({ length: 150 }, () => [r() * 1600, r() * 520, r() * 1.4 + .3, r() * 3]);
  const layer = (n, minH, maxH, y0, seed) => { const q = rng(seed), out = []; let x = -20; while (x < 1620) { const w = 40 + q() * 70, h = minH + q() * (maxH - minH); out.push({ x, w, h, y: y0 - h, win: Array.from({ length: Math.floor(w * h / 520) }, () => [x + 6 + q() * (w - 12), y0 - h + 8 + q() * (h - 16), q()]) }); x += w + q() * 6; } return out; };
  return { stars, far: layer(0, 90, 240, 760, 21), near: layer(0, 140, 360, 900, 33) };
})();
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const LoginScene = () => <svg className="lg-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><linearGradient id="lgsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#040a26" /><stop offset=".45" stopColor="#10306b" /><stop offset=".78" stopColor="#3c4f8f" /><stop offset="1" stopColor="#8a5a8c" /></linearGradient>
    <radialGradient id="lgglow" cx=".5" cy="1" r=".6"><stop offset="0" stopColor="#ff9d6e" stopOpacity=".55" /><stop offset="1" stopColor="#ff9d6e" stopOpacity="0" /></radialGradient>
    <linearGradient id="lgm" x1="0" x2="1"><stop offset="0" stopColor="#bfe6ff" stopOpacity="0" /><stop offset="1" stopColor="#e9f7ff" /></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#lgsky)" /><rect width="1600" height="900" fill="url(#lgglow)" />
  {SCENE.stars.map((s, i) => <circle key={i} className="lg-star" cx={s[0]} cy={s[1]} r={s[2]} fill="#fff" style={{ animationDelay: `${s[3]}s` }} />)}
  {[[240, 70, 0], [900, 40, 2.2], [1250, 120, 4.1], [560, 150, 6.3], [1450, 30, 8.4]].map(([x, y, d], i) => <line key={i} className="lg-meteor" x1={x} y1={y} x2={x + 190} y2={y + 105} stroke="url(#lgm)" strokeWidth="2.2" strokeLinecap="round" style={{ animationDelay: `${d}s` }} />)}
  <g fill="#18274f" opacity=".95">{SCENE.far.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h + 140} />)}</g>
  <g>{SCENE.far.flatMap(b => b.win).map((w, i) => <rect key={i} x={w[0]} y={w[1]} width="3" height="4" fill={w[2] > .5 ? '#ffd98a' : '#8fd3ff'} opacity={w[2] > .8 ? .95 : .45} />)}</g>
  <g fill="#0a1230">{SCENE.near.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h + 10} />)}</g>
  <g>{SCENE.near.flatMap(b => b.win).map((w, i) => <rect key={i} x={w[0]} y={w[1]} width="3.5" height="5" fill={w[2] > .55 ? '#ffe3a0' : '#5fc8ff'} opacity={w[2] > .85 ? 1 : .55} />)}</g>
</svg>;
const Field = ({ icon, ...p }) => <label className="lg-field"><input {...p} /><span className="lg-ico"><Icon n={icon} s={16} /></span></label>;

function Login({ done }) {
  const saved = (() => { try { return localStorage.getItem('rememberUser') || ''; } catch { return ''; } })();
  const [u, setU] = useState(saved), [p, setP] = useState(''), [e, setE] = useState(''), [wake, setWake] = useState('Checking server…'), [rem, setRem] = useState(!!saved);
  const [busy, setBusy] = useState(false), [ok, setOk] = useState(false), [shake, setShake] = useState(false), [forgot, setForgot] = useState(false);
  useEffect(() => { let on = true; (async () => { for (let i = 0; i < 8 && on; i++) { try { const r = await fetch('/health'); if (r.ok) return on && setWake(''); } catch { /* retry */ } on && setWake('Server is waking up, please wait…'); await new Promise(r => setTimeout(r, 4000)); } on && setWake('Server not reachable - check your connection and reload.'); })(); return () => { on = false; }; }, []);
  const fail = m => { setE(m); setShake(true); setTimeout(() => setShake(false), 500); };
  const go = async ev => { ev?.preventDefault(); if (busy || ok) return;
    if (!u.trim() || !p) return fail('Enter your username and password.');
    setE(''); setBusy(true);
    try { const r = await api('/auth/login', { method: 'POST', body: { username: u.trim(), password: p } });
      try { rem ? localStorage.setItem('rememberUser', u.trim()) : localStorage.removeItem('rememberUser'); } catch { /* ignore */ }
      sessionStorage.setItem('jwt', r.token); sessionStorage.setItem('role', r.role); setBusy(false); setOk(true); setTimeout(done, 800);
    } catch (x) { setBusy(false); fail(x.message); } };
  return <div className="lg-page"><LoginScene />
    <form className={`lg-card ${shake ? 'lg-shake' : ''}`} onSubmit={go} noValidate>
      <button type="button" className="lg-x" aria-label="Clear form" title="Clear" onClick={() => { setU(''); setP(''); setE(''); setForgot(false); }}>✕</button>
      <div className="lg-brand">EWZ Network Center</div>
      <h1 className="lg-title">Login</h1>
      <Field icon="user" type="text" placeholder="Username" autoComplete="username" value={u} onChange={x => setU(x.target.value)} />
      <Field icon="lock" type="password" placeholder="Password" autoComplete="current-password" value={p} onChange={x => setP(x.target.value)} />
      <div className="lg-row"><label className="lg-check"><input type="checkbox" checked={rem} onChange={x => setRem(x.target.checked)} />Remember me</label>
        <button type="button" className="lg-link" onClick={() => setForgot(f => !f)}>Forgot Password?</button></div>
      {forgot && <div className="lg-note">Ask the system administrator to reset your password (it is set on the server as ADMIN_PASSWORD).</div>}
      {wake && <div className="lg-note">{wake}</div>}
      {e && <div className="lg-err" role="alert">{e}</div>}
      <button type="submit" className={`lg-btn ${busy ? 'is-busy' : ''} ${ok ? 'is-ok' : ''}`} disabled={busy || ok}>
        {ok ? <><Icon n="check" s={16} /> Welcome</> : busy ? <><span className="lg-spin" /> Signing in…</> : 'Login'}</button>
    </form></div>;
}

const PAGES = ['Network Overview', 'Dashboard', 'Vouchers', 'Active Users', 'Data Usage', 'Security Alerts', 'Blocked Devices', 'Reports', 'Audit Logs', 'Settings'];

const ICONS = { wifi: 'M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01', menu: 'M3 6h18M3 12h18M3 18h18',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', ticket: 'M2 9a3 3 0 0 1 0-6h20a3 3 0 0 1 0 6v6a3 3 0 0 1 0 6H2a3 3 0 0 1 0-6zM13 5v2M13 17v2M13 11v2',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  device: 'M4 4h16v12H4zM8 20h8M12 16v4', chart: 'M18 20V10M12 20V4M6 20v-6', alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.93 4.93l14.14 14.14', report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  log: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  network: 'M12 2v6M12 8l-7 6M12 8l7 6M5 14v4M19 14v4M12 8v10M3 18h4v4H3zM17 18h4v4h-4zM10 18h4v4h-4z', lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4', check: 'M20 6 9 17l-5-5', collapse: 'M11 17l-5-5 5-5M18 17l-5-5 5-5', expand: 'M13 17l5-5-5-5M6 17l5-5-5-5', router: 'M4 14h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM6 18h.01M10 18h.01M8 14l-2-6M16 14l2-6', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' };
const Icon = ({ n, s = 18 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[n]} /></svg>;
const NAV = [{ g: 'Monitor', items: [['Network Overview', 'network'], ['Dashboard', 'grid'], ['Active Users', 'users', 'activeUsers']] },
  { g: 'Vouchers', items: [['Vouchers', 'ticket', 'total'], ['Data Usage', 'chart']] },
  { g: 'Security', items: [['Security Alerts', 'alert', 'suspicious'], ['Blocked Devices', 'ban', 'blockedDevices']] },
  { g: 'Admin', items: [['Reports', 'report'], ['Audit Logs', 'log'], ['Settings', 'gear']] }];

export default function App() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark'), [accent, setAccent] = useState(localStorage.getItem('accent') || ''), [, bump] = useState(0);
  const pick = k => { localStorage.setItem('theme', k); applyTheme(k, accent || null); setTheme(k); };
  const pickAccent = c => { c ? localStorage.setItem('accent', c) : localStorage.removeItem('accent'); applyTheme(theme, c || null); setAccent(c); };
  useEffect(() => { if (theme !== 'auto' && theme !== 'schedule') return; const m = matchMedia('(prefers-color-scheme: light)');
    const h = () => { applyTheme(theme, accent || null); bump(n => n + 1); }; m.addEventListener('change', h); const i = setInterval(h, 60000);
    return () => { m.removeEventListener('change', h); clearInterval(i); }; }, [theme, accent]);
  const [authed, setAuthed] = useState(!!getToken()), [page, setPage] = useState('Network Overview'), [live, setLive] = useState(null), [nav, setNav] = useState(false), [railS, setRail] = useState(() => { try { return localStorage.getItem('rail') === '1'; } catch { return false; } });
  const toggleRail = () => setRail(r => { try { localStorage.setItem('rail', r ? '0' : '1'); } catch { /* ignore */ } return !r; });
  const full = page === 'Network Overview', rail = railS && !full; // overview is full-page: sidebar is a hidden drawer there
  const toggleNav = () => (page !== 'Network Overview' && matchMedia('(min-width:768px)').matches ? toggleRail() : setNav(o => !o));
  const [msg, setMsg] = useState(''), [conn, setConn] = useState(false), [hist, setHist] = useState([]), [toasts, setToasts] = useState([]), [ago, setAgo] = useState(0), lastRx = useRef(Date.now());
  useEffect(() => { if (!authed) return; const s = io({ auth: { token: getToken() } });
    s.on('connect', () => setConn(true)); s.on('disconnect', () => setConn(false));
    s.on('update', d => { lastRx.current = Date.now(); setLive(d);
      if (d.router?.online) { const ss = d.sessions || [];
        setHist(h => [...h, { t: new Date().toLocaleTimeString([], { hour12: false }), cpu: d.router.cpuLoad, mem: d.router.memPercent, freq: d.router.cpuFreq, hddUsed: (d.router.hddUsed || 0) / 1048576, hddTotal: (d.router.hddTotal || 0) / 1048576,
          up: ss.reduce((n, a) => n + (a.rateUpBps || 0), 0), down: ss.reduce((n, a) => n + (a.rateDownBps || 0), 0), users: new Set(ss.map(a => a.username)).size }].slice(-90)); } });
    s.on('cap-event', e => { const id = Math.random(); setToasts(t => [...t, { id, ...e }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 12000); });
    return () => s.close(); }, [authed]);
  useEffect(() => { const i = setInterval(() => setAgo(Math.round((Date.now() - lastRx.current) / 1000)), 1000); return () => clearInterval(i); }, []);
  if (!authed) return <Login done={() => setAuthed(true)} />;

  const sys = live?.system || {}, online = live?.router?.online, cap = live?.capBytes, vs = live?.vouchers || [], ss = live?.sessions || [], sm = live?.summary || {}, rt = live?.router || {};
  const act = async (path, label, opts = { method: 'POST', body: {} }) => { if (!confirm(`${label}?`)) return;
    try { await api(path, opts); setMsg(`✔ ${label}: confirmed by router`); } catch (e) { setMsg(`✖ ${label} failed: ${e.message}`); } };
  const vAct = (n, a, label) => act(`/vouchers/${encodeURIComponent(n)}/${a}`, `${label} ${n}`);
  const lab = hist.map(h => h.t);
  const top = [...vs].sort((a, b) => b.total - a.total).slice(0, 8);

  const voucherCols = [{ h: 'Voucher', k: 'username' }, { h: 'Host name', k: 'host', r: r => r.host || <span className="text-[color:var(--muted)]">Unknown</span> }, { h: 'Profile', k: 'profile' }, { h: 'Status', k: 'status', r: r => <Badge s={r.status} /> }, { h: 'Presence', r: r => <Badge s={r.online ? 'ONLINE' : 'OFFLINE'} /> },
    { h: 'MAC', k: 'mac' }, { h: 'IP', k: 'ip' }, { h: 'Up', k: 'upload', r: r => fmtBytes(r.upload) }, { h: 'Down', k: 'download', r: r => fmtBytes(r.download) }, { h: 'Usage', k: 'total', r: r => <Usage v={r} cap={cap} /> },
    { h: 'Time left', r: r => r.remainingSeconds != null ? fmtSecs(r.remainingSeconds) : '—' }, { h: 'Last login', r: r => r.lastLogin ? new Date(r.lastLogin).toLocaleString() : '—' },
    { h: 'Actions', r: r => <div className="flex gap-1">{r.online && <Btn kind="disconnect" onClick={() => vAct(r.username, 'disconnect', 'Disconnect')}>Disconnect</Btn>}
      {r.disabled ? <Btn kind={r.status === 'BLOCKED' ? 'unblock' : 'enable'} onClick={() => vAct(r.username, r.status === 'BLOCKED' ? 'unblock' : 'enable', 'Enable')}>{r.status === 'BLOCKED' ? 'Unblock' : 'Enable'}</Btn> : <Btn kind="disable" onClick={() => vAct(r.username, 'disable', 'Disable')}>Disable</Btn>}
      {r.status !== 'BLOCKED' && <Btn kind="block" onClick={() => vAct(r.username, 'block', 'Block')}>Block</Btn>}</div> }];
  const sessCols = [{ h: 'Voucher', k: 'username' }, { h: 'Host name', k: 'host', r: r => r.host || <span className="text-[color:var(--muted)]">Unknown</span> }, { h: 'MAC', k: 'mac' }, { h: 'IP', k: 'ip' }, { h: 'Uptime', k: 'uptimeSeconds', r: r => fmtSecs(r.uptimeSeconds) }, { h: 'Idle', r: r => r.idleSeconds + 's' },
    { h: 'Up', r: r => fmtBytes(r.upload) }, { h: 'Down', r: r => fmtBytes(r.download) }, { h: '↑ / ↓ rate', r: r => <span className="text-[color:var(--green)]">{fmtRate(r.rateUpBps || 0)} / {fmtRate(r.rateDownBps || 0)}</span> },
    { h: 'Actions', r: r => <div className="flex gap-1"><Btn kind="disconnect" onClick={() => vAct(r.username, 'disconnect', 'Disconnect')}>Disconnect</Btn>
      <Btn kind="block" onClick={() => act('/blocked-devices', `Block device ${r.mac}`, { method: 'POST', body: { mac: r.mac, reason: 'Blocked from dashboard' } })}>Block</Btn></div> }];

  return <div className="min-h-screen md:flex text-[color:var(--text)]">
    {nav && <div className={`fixed inset-0 z-40 bg-black/60 ${full ? '' : 'md:hidden'}`} onClick={() => setNav(false)} />}
    <aside className={`fixed ${full ? '' : 'md:sticky'} z-50 top-0 left-0 h-screen w-64 ${rail && !full ? 'md:w-[76px]' : 'md:w-64'} shrink-0 flex flex-col bg-[color:var(--input)] border-r border-[color:var(--border)] transition-[transform,width] duration-200 overflow-hidden ${nav ? 'translate-x-0' : '-translate-x-full'} ${full ? '' : 'md:translate-x-0'}`}>
      <div className={`flex items-center gap-3 px-4 h-16 border-b border-[color:var(--border)] ${rail ? 'md:justify-center md:px-0' : ''}`}>
        <span className="grid place-items-center w-9 h-9 rounded-lg text-[color:var(--input)]" style={{ background: 'var(--accent)' }}><Icon n="wifi" s={20} /></span>
        <div className={`leading-tight ${rail ? 'md:hidden' : ''}`}><div className="text-[15px] font-extrabold text-[color:var(--strong)] tracking-tight">Hotspot Monitor</div><div className="text-[11px] font-semibold text-[color:var(--muted)] uppercase tracking-wider">MikroTik Voucher Console</div></div></div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV.map(g => <div key={g.g}><div className={`px-3 mb-1.5 text-[11px] font-extrabold uppercase tracking-widest text-[color:var(--muted)] ${rail ? 'md:hidden' : ''}`}>{g.g}</div>{rail && <div className="hidden md:block mx-3 mb-2 border-t border-[color:var(--border)]" />}
          <div className="space-y-0.5">{g.items.map(([p, ic, badge]) => { const on = page === p, n = badge && sm ? sm[badge] : null;
            return <button key={p} title={p} onClick={() => { setPage(p); setNav(false); }} aria-current={on ? 'page' : undefined}
              className={`group relative flex items-center gap-3 w-full text-left pl-3 pr-2 py-2.5 ${rail ? 'md:justify-center md:px-0' : ''} rounded-lg text-[14px] transition-colors ${on ? 'font-bold text-[color:var(--strong)]' : 'font-semibold text-[color:var(--text)] hover:bg-[color:var(--panel)] hover:text-[color:var(--strong)]'}`}
              style={on ? { background: 'color-mix(in srgb, var(--accent) 16%, transparent)' } : undefined}>
              {on && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r" style={{ background: 'var(--accent)' }} />}
              <span className={on ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted)] group-hover:text-[color:var(--strong)]'}><Icon n={ic} /></span>
              <span className={`flex-1 truncate ${rail ? 'md:hidden' : ''}`}>{p}</span>
              {n > 0 && <span className={`min-w-[22px] ${rail ? 'md:absolute md:top-0.5 md:right-2 md:min-w-[18px] md:text-[10px]' : ''} text-center px-1.5 py-0.5 rounded-full text-[11px] font-bold`} style={{ background: badge === 'suspicious' || badge === 'blockedDevices' ? 'var(--red)' : 'var(--accent)', color: '#fff' }}>{n}</span>}
            </button>; })}</div></div>)}</nav>
      <div className="border-t border-[color:var(--border)] p-3 space-y-2">
        <button onClick={toggleRail} title={rail ? 'Expand sidebar' : 'Collapse sidebar'} className="hidden md:flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-bold text-[color:var(--strong)] border border-[color:var(--border2)] hover:bg-[color:var(--panel)]"><Icon n={rail ? 'expand' : 'collapse'} s={16} /><span className={rail ? 'hidden' : ''}>Collapse</span></button>
        <div className={`flex items-center gap-2 px-2 text-xs font-semibold ${rail ? 'md:justify-center' : ''}`}><span className={`w-2.5 h-2.5 rounded-full ${conn && online ? 'bg-[color:var(--green)] live-dot' : 'bg-[color:var(--red)]'}`} />
          <span className={`text-[color:var(--strong)] truncate ${rail ? 'md:hidden' : ''}`}>{online ? (rt.identity || 'Router') : 'Router offline'}</span></div>
        <div className={`flex items-center gap-2 px-2 text-xs font-semibold text-[color:var(--muted)] ${rail ? 'md:hidden' : ''}`}><Icon n="user" s={14} /><span className="capitalize">{sessionStorage.getItem('role') || 'admin'}</span></div>
        <button title="Sign out" onClick={() => { sessionStorage.clear(); location.reload(); }} className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-bold transition hover:brightness-125"
          style={{ color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 45%, transparent)' }}><Icon n="logout" s={16} /><span className={rail ? 'md:hidden' : ''}>Sign out</span></button></div>
    </aside>

    <main className={`flex-1 min-w-0 ${full ? 'p-0' : 'p-3 space-y-3'}`}>
      <header className={`${full ? 'hidden' : ''} sticky top-0 z-30 -mx-3 -mt-3 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 bg-[color:var(--panel)] border-b border-[color:var(--border)] shadow-sm`}>
        <button onClick={toggleNav} aria-label="Toggle menu" title="Toggle sidebar" className="p-2 rounded-lg border border-[color:var(--border2)] text-[color:var(--strong)]"><Icon n="menu" /></button>
        <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-widest text-[color:var(--muted)] truncate">Mikrotik Monitoring › {page === 'Dashboard' ? 'Overview' : page}</div>
          <h1 className="text-xl font-extrabold text-[color:var(--strong)] leading-tight truncate">{page === 'Dashboard' ? 'System Overview' : page}</h1></div>
        <span className="flex-1" />
        <span className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-extrabold tracking-wide border" style={{ color: conn && online ? 'var(--green)' : 'var(--red)', borderColor: 'currentColor', background: 'color-mix(in srgb, currentColor 12%, transparent)' }}>
          <span className={`w-2 h-2 rounded-full bg-current ${conn && online ? 'live-dot' : ''}`} />{conn ? (online ? 'LIVE' : 'ROUTER OFFLINE') : 'RECONNECTING'}</span>
        <span className="hidden sm:flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border border-[color:var(--border2)] text-[color:var(--strong)] bg-[color:var(--input)]"><Icon n="router" s={14} />{rt.identity || '—'}</span>
        <span className="hidden lg:flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border border-[color:var(--border2)] text-[color:var(--strong)] bg-[color:var(--input)]"><Icon n="clock" s={14} />Updated {ago}s ago · {hist.length} samples</span>
        <select value={theme} onChange={e => pick(e.target.value)} title="Theme" className="border border-[color:var(--border2)] bg-[color:var(--input)] text-[color:var(--strong)] font-bold text-xs rounded-lg px-2 py-2">
          {Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}<option value="auto">Auto (system)</option><option value="schedule">Day / Night (07:00–19:00)</option></select>
        <label title="Accent colour" className="flex items-center gap-1 border border-[color:var(--border2)] bg-[color:var(--input)] rounded-lg px-2 py-1.5"><input type="color" value={accent || THEMES[resolveTheme(theme)].v.accent} onChange={e => pickAccent(e.target.value)} className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer" />{accent && <button type="button" className="font-bold text-[color:var(--strong)]" onClick={() => pickAccent('')}>↺</button>}</label>
        <button onClick={() => api('/settings/mikrotik/sync', { method: 'POST' }).catch(e => setMsg('✖ ' + e.message))} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-extrabold transition hover:brightness-125" style={{ color: 'var(--cyan)', border: '1px solid color-mix(in srgb, var(--cyan) 55%, transparent)', background: 'color-mix(in srgb, var(--cyan) 14%, transparent)' }}><Icon n="refresh" s={14} />Refresh</button>
      </header>
      {toasts.map(t => <div key={t.id} className="bg-[color:var(--dangerbg)] border border-[color:var(--red)] rounded p-3 text-sm">🚫 <b>{t.username}</b> reached the data cap ({fmtBytes(t.total)}). Actions on router: {t.steps.join(' → ')}.</div>)}
      {msg && <div className="bg-[color:var(--panel)] border-l-4 border-[color:var(--blue)] p-2 text-sm cursor-pointer" onClick={() => setMsg('')}>{msg}</div>}
      {!online && !full && <div className="bg-[color:var(--dangerbg)] border border-[color:var(--red)] text-[color:var(--redtext)] p-3 rounded text-sm">MIKROTIK OFFLINE{rt.error ? `: ${String(rt.error).replace(/\.\s*$/, '')}` : ''}. No voucher or usage data is shown until the router responds.</div>}

      {page === 'Network Overview' && <NetworkOverview live={live} hist={hist} online={online} conn={conn} onMenu={() => setNav(true)} />}
      {page === 'Dashboard' && <>
        <Panel title="Router" right={<span className="text-xs font-bold" style={{ color: online ? G : R }}>{online ? '● Online' : '● Offline'}</span>}>
          <div className="grid lg:grid-cols-[1.25fr_1fr] gap-x-8 gap-y-4 pt-1">
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 content-start">
              {[['Identity', rt.identity], ['Board', rt.board], ['RouterOS', rt.version], ['Uptime', rt.uptime], ['IP address', sys.ipAddress], ['CPU', rt.cpuFreq ? `${rt.cpuFreq} MHz` : null]].map(([k, v]) => <div key={k} className="min-w-0">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--muted)]">{k}</dt><dd className="text-base font-bold text-[color:var(--strong)] truncate">{v || '—'}</dd></div>)}</dl>
            <div className="space-y-3">{[['CPU load', rt.cpuLoad], ['Memory', rt.memPercent], ['Storage', rt.hddPercent]].map(([l, v]) => <div key={l}>
              <div className="flex justify-between items-end text-sm"><span className="font-bold text-[color:var(--strong)]">{l}</span><span className="font-bold tabular-nums" style={{ color: tone(v || 0) }}>{(v || 0).toFixed(0)}%</span></div><Led v={v || 0} /></div>)}</div></div></Panel>

        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
          <Stat title="Online users" value={sm.activeUsers} /><Stat title="Devices" value={sm.activeDevices} color={B} /><Stat title="Vouchers" value={sm.total} color="var(--strong)" />
          <Stat title="Expired" value={sm.expired} color={O} /><Stat title="Blocked" value={sm.disabled} color={R} /><Stat title="Suspicious" value={sm.suspicious} color={sm.suspicious ? R : G} /><Stat title="Total data" value={fmtBytes(sm.totalData)} color="var(--strong)" /></div>

        <div className="grid lg:grid-cols-3 gap-3">
          <TS title="Throughput" labels={lab} sets={[{ label: 'Download', data: hist.map(h => h.down), borderColor: G }, { label: 'Upload', data: hist.map(h => h.up), borderColor: B }]} fmt={fmtRate} />
          <TS title="Concurrent users" labels={lab} sets={[{ label: 'Users', data: hist.map(h => h.users), borderColor: O }]} />
          <TS title="CPU load" labels={lab} sets={[{ label: 'CPU', data: hist.map(h => h.cpu), borderColor: Y }]} fmt={v => v + '%'} /></div>

        <Panel title="Active sessions" right={<span className="text-xs text-[color:var(--muted)]">{ss.length} online</span>}><Table cols={sessCols} rows={ss} freeze={2} compact empty="No active sessions" /></Panel>

        <div className="grid xl:grid-cols-2 gap-3">
          <Panel title="Top consumers" right={cap ? <span className="text-xs text-[color:var(--accent)]">auto-cap {fmtBytes(cap)}</span> : null}>
            <Table compact cols={[{ h: 'Voucher', k: 'username' }, { h: 'Host name', k: 'host', r: r => r.host || <span className="text-[color:var(--muted)]">Unknown</span> }, { h: 'Status', r: r => <Badge s={r.status} /> }, { h: 'Usage', k: 'total', r: r => <Usage v={r} cap={cap} /> }]} rows={top} empty="No usage yet" /></Panel>
          <Panel title="DHCP leases" right={<span className="text-xs text-[color:var(--muted)]">{(sys.pools || []).map(p => `${p.name}: ${p.used} used`).join(' · ')}</span>}>
            <Table compact search cols={[{ h: 'Host name', k: 'host' }, { h: 'MAC', k: 'mac' }, { h: 'Address', k: 'address' }, { h: 'Server', k: 'server' }]} rows={sys.leases || []} empty="No DHCP leases" /></Panel></div></>}

      {page === 'Vouchers' && <Panel><Table cols={voucherCols} rows={vs} freeze={2} /></Panel>}
      {page === 'Data Usage' && <Panel><Table rows={vs} cols={[{ h: 'Voucher', k: 'username' }, { h: 'Host name', k: 'host', r: r => r.host || <span className="text-[color:var(--muted)]">Unknown</span> }, { h: 'Device', k: 'mac' }, { h: 'Upload', k: 'upload', r: r => fmtBytes(r.upload) }, { h: 'Download', k: 'download', r: r => fmtBytes(r.download) },
        { h: 'Total', k: 'total', r: r => fmtBytes(r.total) }, { h: 'Limit', r: r => isFinite(effLimit(r, cap)) ? fmtBytes(effLimit(r, cap)) : '—' }, { h: 'Remaining', r: r => isFinite(effLimit(r, cap)) ? fmtBytes(Math.max(0, effLimit(r, cap) - r.total)) : '—' }, { h: 'Status', k: 'status', r: r => <Badge s={r.status} /> }]} /></Panel>}
      {(page === 'Active Users' || page === 'Sessions') && <Panel><Table rows={ss} cols={sessCols} freeze={2} /></Panel>}
      {page === 'Security Alerts' && <Async path="/alerts" cols={[{ h: 'Time', r: r => new Date(r.ts).toLocaleString() }, { h: 'Voucher', k: 'username' }, { h: 'MAC', k: 'mac_address' }, { h: 'Severity', r: r => <Badge s={r.severity} /> },
        { h: 'Indicators (heuristic, not proof)', r: r => (r.indicators || []).join('; ') }, { h: 'Action', k: 'action_taken' }]} />}
      {page === 'Blocked Devices' && <Async path="/blocked-devices" cols={[{ h: 'Host name', k: 'host_name', r: r => r.host_name || '—' }, { h: 'MAC', k: 'mac_address' }, { h: 'Voucher', k: 'voucher_username' }, { h: 'Reason', k: 'reason' }, { h: 'By', k: 'blocked_by' }, { h: 'Expires', r: r => r.expires_at ? new Date(r.expires_at).toLocaleString() : 'Permanent' },
        { h: 'Active', r: r => r.active ? 'yes' : 'no' }, { h: '', r: r => r.active && <Btn kind="unblock" onClick={() => act(`/blocked-devices/${r.mac_address}`, `Unblock ${r.mac_address}`, { method: 'DELETE' })}>Unblock</Btn> }]} />}
      {page === 'Audit Logs' && <Async path="/audit" cols={[{ h: 'Time', r: r => new Date(r.ts).toLocaleString() }, { h: 'Admin', k: 'admin' }, { h: 'Action', k: 'action' }, { h: 'Voucher', k: 'voucher' }, { h: 'MAC', k: 'mac_address' }, { h: 'IP', k: 'ip_address' }, { h: 'Reason', k: 'reason' }, { h: 'Result', k: 'result' }]} />}
      {page === 'Reports' && <Reports />}
      {page === 'Settings' && <Panel title="MikroTik"><div className="space-y-3 text-sm"><div>Status: <Badge s={online ? 'ONLINE' : 'MIKROTIK OFFLINE'} /></div>
        {online && <div className="text-[color:var(--muted)]">Identity {rt.identity} · RouterOS {rt.version} · Uptime {rt.uptime} · CPU {rt.cpuLoad}% · Mem {rt.memPercent}% · Last sync {live.lastSync}</div>}
        <div className="text-[color:var(--muted)]">Data cap: {cap ? fmtBytes(cap) : 'disabled'} (set DATA_CAP_GB in backend .env)</div>
        <div className="flex gap-2"><Btn kind="test" onClick={() => act('/settings/mikrotik/test', 'Test connection', { method: 'POST' })}>TEST CONNECTION</Btn><Btn kind="sync" onClick={() => act('/settings/mikrotik/sync', 'Sync now', { method: 'POST' })}>SYNC NOW</Btn></div></div></Panel>}
    </main></div>;
}

function Async({ path, cols }) {
  const [rows, setRows] = useState([]), [err, setErr] = useState('');
  useEffect(() => { const l = () => api(path).then(setRows).catch(e => setErr(e.message)); l(); const i = setInterval(l, 10000); return () => clearInterval(i); }, [path]);
  return <Panel>{err ? <div className="text-[color:var(--red)]">{err}</div> : <Table cols={cols} rows={rows} />}</Panel>;
}

function Reports() {
  const [type, setType] = useState('top-vouchers'), [rows, setRows] = useState([]), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const qs = `type=${type}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
  useEffect(() => { api('/reports?' + qs).then(setRows).catch(() => setRows([])); }, [qs]);
  const k = rows[0] ? Object.keys(rows[0]) : [], label = k[0], inp = 'bg-[color:var(--input)] border border-[color:var(--border)] rounded p-1 text-sm';
  const csv = async () => { const r = await fetch(`/api/reports?${qs}&format=csv`, { headers: { Authorization: `Bearer ${getToken()}` } }); const u = URL.createObjectURL(await r.blob()); Object.assign(document.createElement('a'), { href: u, download: type + '.csv' }).click(); };
  return <div className="space-y-3"><div className="flex flex-wrap gap-2 items-center"><select className={inp} value={type} onChange={e => setType(e.target.value)}><option value="top-vouchers">Top vouchers</option><option value="top-devices">Top devices</option><option value="daily">Daily consumption</option></select>
    <input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)} /><input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)} /><Btn kind="export" onClick={csv}>Export CSV</Btn></div>
    {rows.length > 0 && <Panel title="Chart"><Bar data={{ labels: rows.map(r => String(r[label]).slice(0, 12)), datasets: type === 'daily' ? [{ label: 'Upload (MB)', data: rows.map(r => r.upload / 1048576), backgroundColor: B }, { label: 'Download (MB)', data: rows.map(r => r.download / 1048576), backgroundColor: G }] : [{ label: 'MB used', data: rows.map(r => r.bytes_used / 1048576), backgroundColor: B }] }}
      options={{ scales: { x: axis, y: axis }, plugins: { legend: { labels: { color: axis.ticks.color } } } }} /></Panel>}
    <Panel><Table rows={rows} cols={k.map(c => ({ h: c, k: c, r: r => /bytes|upload|download/.test(c) ? fmtBytes(r[c]) : String(r[c]) }))} /></Panel></div>;
}

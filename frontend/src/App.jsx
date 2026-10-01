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
const Row = ({ title, children, open = true }) => { const [o, setO] = useState(open);
  return <div><button className="flex items-center gap-2 text-[16px] font-bold py-2" onClick={() => setO(!o)}><span className="text-[color:var(--muted)]">{o ? '⌄' : '›'}</span>{title}</button>{o && <div className="space-y-3">{children}</div>}</div>; };
const Led = ({ v, n = 24 }) => { const on = Math.round(Math.min(100, v) / 100 * n);
  return <div className="flex gap-[2px] h-5">{Array.from({ length: n }, (_, i) => <div key={i} className="flex-1 rounded-[1px]" style={{ background: i < on ? (i / n < .6 ? G : i / n < .85 ? Y : R) : 'var(--track)' }} />)}</div>; };
const Gauge = ({ label, v }) => <div><div className="flex justify-between items-end"><span className="text-lg font-bold text-white">{label}</span><span className="text-2xl" style={{ color: tone(v) }}>{v.toFixed(1)}<span className="text-base">%</span></span></div><Led v={v} /></div>;

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
const StatC = ({ title, value, color = G, sub, small }) => <Panel title={title} className="flex-1"><div className="text-center py-2"><div className={`${small ? 'text-xl' : 'text-2xl'} font-semibold truncate`} style={{ color }}>{value ?? 'N/A'}</div>{sub && <div className="text-xs text-[color:var(--muted)] mt-1">{sub}</div>}</div></Panel>;
function Temp({ v }) {
  if (v == null) return <div className="text-center text-[color:var(--muted)] py-6">N/A<div className="text-xs">no sensor</div></div>;
  const p = Math.min(1, Math.max(0, v / 100)), c = v < 50 ? G : v < 70 ? Y : R, pt = a => [60 - 45 * Math.cos(a * Math.PI), 62 - 45 * Math.sin(a * Math.PI)];
  const [x, y] = pt(p);
  return <svg viewBox="0 0 120 80" className="w-full max-h-32"><path d="M15 62 A45 45 0 0 1 105 62" stroke="var(--track)" strokeWidth="9" fill="none" /><path d={`M15 62 A45 45 0 0 1 ${x} ${y}`} stroke={c} strokeWidth="9" fill="none" />
    <text x="60" y="62" textAnchor="middle" fill={c} fontSize="17" fontWeight="500">{v} °C</text></svg>;
}

function Table({ cols, rows, empty = 'No data', compact, search }) {
  const [q, setQ] = useState(''), [sort, setSort] = useState(null);
  const f = useMemo(() => { let r = rows.filter(x => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));
    if (sort) r = [...r].sort((a, b) => (a[sort.k] > b[sort.k] ? 1 : a[sort.k] < b[sort.k] ? -1 : 0) * sort.d); return r; }, [rows, q, sort]);
  return <div>{(!compact || search) && <input className="bg-[color:var(--input)] border border-[color:var(--border)] rounded px-2 py-1 mb-2 w-full sm:w-72 text-sm" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />}
    <div className={`overflow-auto rounded border border-[color:var(--border)] ${compact ? 'max-h-72' : 'max-h-[65vh]'}`}>
      <table className="w-full text-[13px] border-separate border-spacing-0"><thead><tr>{cols.map(c => <th key={c.h} onClick={() => c.k && setSort({ k: c.k, d: sort?.k === c.k ? -sort.d : 1 })}
        className={`sticky top-0 z-10 text-left px-3 py-2 font-bold text-[11px] uppercase tracking-wide whitespace-nowrap bg-[color:var(--hover)] text-[color:var(--strong)] border-b border-[color:var(--border2)] ${c.k ? 'cursor-pointer select-none' : ''}`}>
        {c.h}{c.k && sort?.k === c.k ? (sort.d > 0 ? ' ↑' : ' ↓') : ''}</th>)}</tr></thead>
      <tbody>{f.map((r, i) => <tr key={i} className="even:bg-[color-mix(in_srgb,var(--hover)_40%,transparent)] hover:bg-[color:var(--hover)]">{cols.map(c => <td key={c.h} className="px-3 py-2 whitespace-nowrap border-b border-[color:var(--border)] align-middle">{c.r ? c.r(r) : (r[c.k] ?? '—')}</td>)}</tr>)}</tbody></table>
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

function Login({ done }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [e, setE] = useState(''), [wake, setWake] = useState('Checking server…');
  useEffect(() => { let on = true; (async () => { for (let i = 0; i < 8 && on; i++) { try { const r = await fetch('/health'); if (r.ok) return on && setWake(''); } catch { /* retry */ } on && setWake('Server is waking up, please wait…'); await new Promise(r => setTimeout(r, 4000)); } on && setWake('Server not reachable - check your connection and reload.'); })(); return () => { on = false; }; }, []);
  const go = async () => { try { const r = await api('/auth/login', { method: 'POST', body: { username: u, password: p } }); sessionStorage.setItem('jwt', r.token); sessionStorage.setItem('role', r.role); done(); } catch (x) { setE(x.message); } };
  const inp = 'bg-[color:var(--input)] border border-[color:var(--border)] rounded w-full p-2 text-sm';
  return <div className="min-h-screen grid place-items-center"><div className="bg-[color:var(--panel)] border border-[color:var(--border)] p-6 rounded w-80 space-y-3"><h1 className="font-semibold text-lg">Hotspot Monitoring</h1>
    <input className={inp} placeholder="Username" value={u} onChange={x => setU(x.target.value)} /><input className={inp} type="password" placeholder="Password" value={p} onChange={x => setP(x.target.value)} onKeyDown={x => x.key === 'Enter' && go()} />
    {wake && <div className="text-[color:var(--muted)] text-xs">{wake}</div>}{e && <div className="text-[color:var(--red)] text-sm">{e}</div>}<button className="bg-[color:var(--primary)] hover:bg-[color:var(--primaryh)] text-white w-full p-2 rounded text-sm font-medium" onClick={go}>Sign in</button></div></div>;
}

const PAGES = ['Network Overview', 'Dashboard', 'Vouchers', 'Active Users', 'Devices', 'Data Usage', 'Security Alerts', 'Blocked Devices', 'Reports', 'Audit Logs', 'Settings'];

const ICONS = { wifi: 'M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01', menu: 'M3 6h18M3 12h18M3 18h18',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', ticket: 'M2 9a3 3 0 0 1 0-6h20a3 3 0 0 1 0 6v6a3 3 0 0 1 0 6H2a3 3 0 0 1 0-6zM13 5v2M13 17v2M13 11v2',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  device: 'M4 4h16v12H4zM8 20h8M12 16v4', chart: 'M18 20V10M12 20V4M6 20v-6', alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.93 4.93l14.14 14.14', report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  log: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  network: 'M12 2v6M12 8l-7 6M12 8l7 6M5 14v4M19 14v4M12 8v10M3 18h4v4H3zM17 18h4v4h-4zM10 18h4v4h-4z', collapse: 'M11 17l-5-5 5-5M18 17l-5-5 5-5', expand: 'M13 17l5-5-5-5M6 17l5-5-5-5', router: 'M4 14h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM6 18h.01M10 18h.01M8 14l-2-6M16 14l2-6', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' };
const Icon = ({ n, s = 18 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[n]} /></svg>;
const NAV = [{ g: 'Monitor', items: [['Network Overview', 'network'], ['Dashboard', 'grid'], ['Active Users', 'users', 'activeUsers'], ['Devices', 'device']] },
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
  const [authed, setAuthed] = useState(!!getToken()), [page, setPage] = useState('Network Overview'), [live, setLive] = useState(null), [nav, setNav] = useState(false), [rail, setRail] = useState(() => { try { return localStorage.getItem('rail') === '1'; } catch { return false; } });
  const toggleRail = () => setRail(r => { try { localStorage.setItem('rail', r ? '0' : '1'); } catch { /* ignore */ } return !r; });
  const toggleNav = () => (matchMedia('(min-width:768px)').matches ? toggleRail() : setNav(o => !o));
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

  const sys = live?.system || {}, online = live?.router?.online, cap = live?.capBytes, vs = live?.vouchers || [], ss = live?.sessions || [], sm = live?.summary, rt = live?.router || {};
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
    {nav && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setNav(false)} />}
    <aside className={`fixed md:sticky z-50 top-0 left-0 h-screen w-64 ${rail ? 'md:w-[76px]' : 'md:w-64'} shrink-0 flex flex-col bg-[color:var(--input)] border-r border-[color:var(--border)] transition-[transform,width] duration-200 overflow-hidden ${nav ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
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

    <main className="flex-1 min-w-0 p-3 space-y-3">
      <header className="sticky top-0 z-30 -mx-3 -mt-3 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 bg-[color:var(--panel)] border-b border-[color:var(--border)] shadow-sm">
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
      {!online && <div className="bg-[color:var(--dangerbg)] border border-[color:var(--red)] text-[color:var(--redtext)] p-3 rounded text-sm">MIKROTIK OFFLINE{rt.error ? `: ${rt.error}` : ''}. No voucher or usage data is shown until the router responds.</div>}

      {page === 'Network Overview' && <NetworkOverview live={live} hist={hist} online={online} conn={conn} />}
      {page === 'Dashboard' && online && sm && <>
        <Row title="System"><div className="g24">
          <div className="c3 r2 flex flex-col gap-2"><StatC title="Identity" value={rt.identity} /><Panel title="Temperature" className="flex-1"><Temp v={sys.temperature} /></Panel>
            <StatC title="Voltage" value={sys.voltage != null ? `${sys.voltage} V` : 'N/A'} color={sys.voltage != null ? G : 'var(--muted)'} /></div>
          <div className="c3 r2 flex flex-col gap-2"><StatC title="Routerboard HW" value={rt.board} color="var(--strong)" small /><StatC title="CPU" value={rt.cpuFreq ? `${rt.cpuFreq} MHz` : 'N/A'} color={G} sub={rt.cpuModel} />
            <StatC title="System version" value={`Current: ${rt.version}`} color={G} small /><StatC title="System uptime" value={rt.uptime} color={Y} small /><StatC title="IP Address" value={sys.ipAddress} color="var(--strong)" small /></div>
          <div className="c5"><Panel title="Installed Packages"><Table compact cols={[{ h: 'name', k: 'name' }, { h: 'enabled', r: r => <span style={{ color: r.enabled ? G : R }}>{r.enabled ? 'Yes' : 'No'}</span> }, { h: 'build_time', k: 'buildTime' }]} rows={sys.packages || []} empty="No package data" /></Panel></div>
          <div className="c4"><Panel title=" "><div className="space-y-4"><Gauge label="Used RAM Memory" v={rt.memPercent || 0} /><Gauge label="CPU Load" v={rt.cpuLoad || 0} /><Gauge label="HDD Utilization" v={rt.hddPercent || 0} /></div></Panel></div>
          <div className="c5"><TS stats title="CPU load" labels={lab} sets={[{ label: rt.cpuModel || 'CPU', data: hist.map(h => h.cpu), borderColor: G }]} fmt={v => v + '%'} /></div>
          <div className="c4"><TS stats title="CPU Frequency" labels={lab} sets={[{ label: rt.cpuModel || 'CPU', data: hist.map(h => h.freq), borderColor: G }]} fmt={v => v + ' MHz'} /></div>
          <div className="c9"><Panel title="Active Users (router admins)"><Table compact cols={[{ h: 'name', k: 'name' }, { h: 'group', k: 'group' }, { h: 'address', k: 'address' }, { h: 'via', k: 'via' }, { h: 'when', k: 'when' }]} rows={sys.admins || []} empty="No data" /></Panel></div>
          <div className="c9"><TS stats title="HDD Utilization" labels={lab} sets={[{ label: 'Used', data: hist.map(h => h.hddUsed), borderColor: B }, { label: 'Total', data: hist.map(h => h.hddTotal), borderColor: R }]} fmt={v => v + ' MB'} /></div>
        </div></Row>
        <Row title="DHCP"><div className="g24">
          <div className="c5"><Panel title="IP Pool Usage"><div className="space-y-5 pt-1">{(sys.pools || []).map(p => <div key={p.name}><div className="text-xl font-bold text-white">{p.name}</div>
            <div className="flex items-center gap-3"><div className="flex-1"><Led v={p.percent} /></div><span className="text-5xl font-light" style={{ color: tone(p.percent) }}>{p.used}</span></div></div>)}
            {!(sys.pools || []).length && <div className="text-sm text-[color:var(--muted)]">No IP pools</div>}</div></Panel></div>
          <div className="c19"><Panel title="DHCP Leases"><Table compact search cols={[{ h: 'Host Name', k: 'host' }, { h: 'Comment', k: 'comment' }, { h: 'DHCP Server', k: 'server' }, { h: 'mac_address', k: 'mac' }, { h: 'address', k: 'address' }, { h: 'active_address', k: 'active' }]} rows={sys.leases || []} empty="No DHCP leases (hotspot may use its own address pool)" /></Panel></div>
        </div></Row>
        <Row title="Hotspot">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3"><Stat title="Active users" value={sm.activeUsers} /><Stat title="Active devices" value={sm.activeDevices} color={B} /><Stat title="Total vouchers" value={sm.total} color="var(--strong)" />
            <Stat title="Expired" value={sm.expired} color={O} /><Stat title="Disabled / blocked" value={sm.disabled} color={R} /><Stat title="Suspicious" value={sm.suspicious} color={sm.suspicious ? R : G} /></div>
          <div className="grid lg:grid-cols-3 gap-3"><TS title="Live throughput" labels={lab} sets={[{ label: 'Download', data: hist.map(h => h.down), borderColor: G }, { label: 'Upload', data: hist.map(h => h.up), borderColor: B }]} fmt={fmtRate} />
            <TS title="Concurrent users" labels={lab} sets={[{ label: 'Users', data: hist.map(h => h.users), borderColor: O }]} />
            <div className="grid grid-cols-2 gap-3"><Stat title="Total data" value={fmtBytes(sm.totalData)} color="var(--strong)" /><Stat title="Blocked devices" value={sm.blockedDevices} color={R} /><Stat title="Download" value={fmtBytes(sm.download)} /><Stat title="Upload" value={fmtBytes(sm.upload)} color={B} /></div></div>
          <Panel title="Active sessions (live)" right={<span className="text-xs text-[color:var(--muted)]">{ss.length} online</span>}><Table cols={sessCols} rows={ss} compact empty="No active sessions" /></Panel>
        </Row>
        <Row title={`Data usage · auto-cap ${cap ? fmtBytes(cap) : 'off'}`}>
          <Panel title="Top consumers" right={cap ? <span className="text-xs text-[color:var(--accent)]">at {fmtBytes(cap)}: disconnect → block → remove</span> : null}>
            <Table compact cols={[{ h: 'Voucher', k: 'username' }, { h: 'Host name', k: 'host', r: r => r.host || <span className="text-[color:var(--muted)]">Unknown</span> }, { h: 'Device', k: 'mac' }, { h: 'Status', r: r => <Badge s={r.status} /> }, { h: 'Usage', k: 'total', r: r => <Usage v={r} cap={cap} /> }]} rows={top} /></Panel>
        </Row></>}

      {online && page === 'Vouchers' && <Panel><Table cols={voucherCols} rows={vs} /></Panel>}
      {online && page === 'Data Usage' && <Panel><Table rows={vs} cols={[{ h: 'Voucher', k: 'username' }, { h: 'Host name', k: 'host', r: r => r.host || <span className="text-[color:var(--muted)]">Unknown</span> }, { h: 'Device', k: 'mac' }, { h: 'Upload', k: 'upload', r: r => fmtBytes(r.upload) }, { h: 'Download', k: 'download', r: r => fmtBytes(r.download) },
        { h: 'Total', k: 'total', r: r => fmtBytes(r.total) }, { h: 'Limit', r: r => isFinite(effLimit(r, cap)) ? fmtBytes(effLimit(r, cap)) : '—' }, { h: 'Remaining', r: r => isFinite(effLimit(r, cap)) ? fmtBytes(Math.max(0, effLimit(r, cap) - r.total)) : '—' }, { h: 'Status', k: 'status', r: r => <Badge s={r.status} /> }]} /></Panel>}
      {online && (page === 'Active Users' || page === 'Sessions') && <Panel><Table rows={ss} cols={sessCols} /></Panel>}
      {page === 'Devices' && <Async path="/devices" cols={[{ h: 'Host name', k: 'host_name', r: r => r.host_name || <span className="text-[color:var(--muted)]">Unknown</span> }, { h: 'MAC', k: 'mac_address' }, { h: 'IP', k: 'last_ip' }, { h: 'Voucher', k: 'last_voucher' }, { h: 'First seen', r: r => new Date(r.first_seen).toLocaleString() }, { h: 'Last seen', r: r => new Date(r.last_seen).toLocaleString() },
        { h: 'Upload', r: r => fmtBytes(r.upload) }, { h: 'Download', r: r => fmtBytes(r.download) }, { h: 'Sessions', k: 'sessions' }, { h: 'Status', r: r => <Badge s={r.blocked ? 'BLOCKED' : r.online ? 'ONLINE' : 'OFFLINE'} /> }, { h: 'Risk', r: r => <Badge s={r.risk_level} /> }]} />}
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

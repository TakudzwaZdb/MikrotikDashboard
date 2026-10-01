import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtBytes, fmtSecs, fmtRate } from './api.js';

// Read-only "command centre" page: live network / hotspot / voucher overview. No controls, navigation only.
const K = { cy: '#19d3ff', bl: '#2a7bff', ye: '#ffd21a', gr: '#35e08a', rd: '#ff4d6d', tx: '#cfeaff', mu: '#7fa8d0', tr: '#0c2a55' };
const num = v => Number(v) || 0;
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

/* ---------- deterministic glowing mesh tree ---------- */
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const MESH = (() => {
  const r = rng(11), pts = [];
  for (let g = 0; pts.length < 92 && g < 6000; g++) {
    const x = 50 + r() * 500, y = 18 + r() * 262, dx = (x - 300) / 258, dy = (y - 148) / 132;
    const lobe = 1 + 0.07 * Math.sin(Math.atan2(dy, dx) * 5);           // lumpy crown outline
    if (dx * dx + dy * dy < lobe * 0.95 && pts.every(p => Math.hypot(p[0] - x, p[1] - y) > 24)) pts.push([x, y]);
  }
  const crown = pts.length;
  [[300, 292], [289, 322], [311, 322], [282, 352], [318, 352], [268, 384], [332, 384], [300, 372], [300, 404], [244, 402], [356, 402], [214, 414], [386, 414]].forEach(p => pts.push(p));
  const edges = new Set(), tris = [];
  pts.forEach((p, i) => {
    const near = pts.map((q, j) => [j, Math.hypot(p[0] - q[0], p[1] - q[1])]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3);
    near.forEach(([j]) => edges.add(i < j ? `${i}-${j}` : `${j}-${i}`));
    if (i < crown && near[0][1] < 60 && near[1][1] < 60) tris.push([i, near[0][0], near[1][0]]);
  });
  const branches = [];
  for (let k = 0; k < 11; k++) { const t = pts[Math.floor((k / 11) * crown)]; const sx = 300 + (k % 2 ? 6 : -6); branches.push(`M${sx},296 Q${(sx + t[0]) / 2 + (k % 2 ? 26 : -26)},${(296 + t[1]) / 2 + 30} ${t[0]},${t[1]}`); }
  const roots = [[210, 424], [255, 428], [345, 428], [392, 424], [300, 430]].map(([x, y]) => `M300,384 Q${(300 + x) / 2},${y - 6} ${x},${y}`);
  return { pts, crown, edges: [...edges].map(e => e.split('-').map(Number)), tris, branches, roots };
})();

function Tree({ nodes, sessions, hi }) {
  const lit = useMemo(() => { const free = MESH.pts.slice(0, MESH.crown).filter(p => nodes.every(n => Math.abs(p[0] - n.x) > 72 || Math.abs(p[1] - n.y) > 30));
    const pick = []; for (const p of free) if (pick.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) > 78)) pick.push(p);
    return sessions.slice(0, pick.length).map((s, i) => ({ s, p: pick[i] })); }, [sessions]);
  return <svg viewBox="0 0 600 440" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
    <defs>
      <filter id="nvg" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <radialGradient id="nvc" cx="50%" cy="42%" r="55%"><stop offset="0" stopColor="#1a7dff" stopOpacity=".38" /><stop offset="1" stopColor="#1a7dff" stopOpacity="0" /></radialGradient>
    </defs>
    <ellipse cx="300" cy="150" rx="290" ry="150" fill="url(#nvc)" />
    {MESH.tris.map((t, i) => <polygon key={i} points={t.map(j => MESH.pts[j].join(',')).join(' ')} fill={i % 3 ? K.cy : K.bl} opacity={i % 3 ? 0.07 : 0.14} />)}
    <g stroke={K.cy} strokeWidth=".7" opacity=".55">{MESH.edges.map(([a, b], i) => <line key={i} x1={MESH.pts[a][0]} y1={MESH.pts[a][1]} x2={MESH.pts[b][0]} y2={MESH.pts[b][1]} />)}</g>
    <g filter="url(#nvg)" fill="none" strokeLinecap="round">
      {MESH.branches.map((d, i) => <path key={i} d={d} stroke="#5fe4ff" strokeWidth="1.6" opacity=".8" />)}
      {MESH.roots.map((d, i) => <path key={i} d={d} stroke="#3aa7ff" strokeWidth="1.8" opacity=".85" />)}
      <path d="M300,300 L300,392" stroke="#8ef0ff" strokeWidth="5" opacity=".85" />
    </g>
    <g filter="url(#nvg)">{MESH.pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i % 9 === 0 ? 3.2 : 1.7} fill={i % 9 === 0 ? '#fff' : '#9fe9ff'} opacity=".95" />)}</g>
    {lit.map(({ s, p }, i) => <g key={s.username + i}>
      <circle className="nv-pulse" cx={p[0]} cy={p[1]} r="4" fill={K.gr} />
      <circle cx={p[0]} cy={p[1]} r="3.4" fill={K.gr} filter="url(#nvg)" />
      <text x={p[0] + 6} y={p[1] - 5} fontSize="8.5" fontWeight="700" fill="#eaffef" stroke="#02132e" strokeWidth="2.2" paintOrder="stroke">{(s.host || s.username || '').slice(0, 14)}</text></g>)}
    {nodes.map((n, i) => { const on = i === hi, w = on ? 96 : 80, h = on ? 30 : 24;
      return <g key={n.k} transform={`translate(${n.x},${n.y})`} filter={on ? 'url(#nvg)' : undefined}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill="#031a3c" fillOpacity=".88" stroke={on ? K.ye : K.cy} strokeWidth={on ? 1.8 : 1} />
        {on && <rect x={-w / 2 - 4} y={-h / 2 - 4} width={w + 8} height={h + 8} rx={(h + 8) / 2} fill="none" stroke={K.ye} strokeWidth=".8" strokeDasharray="3 3" className="nv-spin" />}
        <text y={on ? -1 : -1.5} textAnchor="middle" fontSize={on ? 12 : 10.5} fontWeight="800" fill={on ? K.ye : '#eaf7ff'}>{n.k}</text>
        <text y={on ? 10.5 : 8.5} textAnchor="middle" fontSize={on ? 8.6 : 7.6} fontWeight="600" fill={on ? '#ffe98a' : K.cy}>{n.v}</text></g>; })}
  </svg>;
}

/* ---------- small chart kit (pure SVG) ---------- */
const P = ({ title, children, className = '' }) => <section className={`nv-panel ${className}`}><h3 className="nv-title">{title}</h3><div className="nv-body">{children}</div></section>;
const Empty = ({ t = 'Collecting live data…' }) => <div className="h-full grid place-items-center text-[11px] text-[color:#7fa8d0]">{t}</div>;

function Donut({ segs, center, sub }) {
  const r = 38, c = 2 * Math.PI * r, tot = segs.reduce((a, s) => a + s.v, 0); let off = 0;
  return <svg viewBox="0 0 100 100" className="w-full h-full"><circle cx="50" cy="50" r={r} fill="none" stroke={K.tr} strokeWidth="11" />
    {tot > 0 && segs.map((s, i) => { const len = (s.v / tot) * c, el = <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.c} strokeWidth="11" strokeDasharray={`${Math.max(0, len - 0.8)} ${c - len + 0.8}`} strokeDashoffset={-off} transform="rotate(-90 50 50)" />; off += len; return el; })}
    <text x="50" y={sub ? 50 : 56} textAnchor="middle" fontSize={String(center).length > 5 ? 12.5 : 17} fontWeight="800" fill="#fff">{center}</text>
    {sub && <text x="50" y="63" textAnchor="middle" fontSize="7.5" fontWeight="600" fill={K.mu}>{sub}</text>}</svg>;
}
const Legend = ({ items }) => <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[10px] font-semibold">{items.map(i => <span key={i.t} className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-sm" style={{ background: i.c }} />{i.t}</span>)}</div>;

function Ring({ p, color, label, value, scale }) {
  const r = 34, c = 2 * Math.PI * r;
  return <div className="flex flex-col items-center min-w-0 flex-1"><div className="text-[10.5px] font-bold text-center leading-tight mb-0.5">{label}</div>
    <svg viewBox="0 0 100 82" className="w-full max-h-[86px]"><circle cx="50" cy="44" r={r} fill="none" stroke={K.tr} strokeWidth="9" />
      <circle cx="50" cy="44" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 50 44)" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      <text x="50" y="49" textAnchor="middle" fontSize="19" fontWeight="800" fill="#fff">{p}%</text></svg>
    <div className="text-[10px] font-bold" style={{ color }}>{value}</div>
    <div className="flex justify-between w-full px-1 text-[8.5px] text-[color:#7fa8d0]">{scale.map(s => <span key={s}>{s}</span>)}</div></div>;
}

function Pie({ segs }) {
  const tot = segs.reduce((a, s) => a + s.v, 0); if (!tot) return <Empty t="No vouchers" />; let a0 = -Math.PI / 2;
  const P2 = (a, r) => [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  return <svg viewBox="0 0 100 100" className="w-full h-full">{segs.map((s, i) => { const a1 = a0 + (s.v / tot) * Math.PI * 2, [x0, y0] = P2(a0, 44), [x1, y1] = P2(a1, 44), big = a1 - a0 > Math.PI ? 1 : 0;
    const d = segs.length === 1 ? 'M50,6 A44,44 0 1 1 49.99,6 Z' : `M50,50 L${x0},${y0} A44,44 0 ${big} 1 ${x1},${y1} Z`; a0 = a1; return <path key={i} d={d} fill={s.c} stroke="#031230" strokeWidth="1.2" />; })}</svg>;
}

function Bars({ items, fmt = v => v, color = K.ye, h = 96, W = 240, fs = 7.5 }) {
  if (!items.length) return <Empty t="No data" />;
  const max = Math.max(1, ...items.map(i => i.value)), bw = Math.min(26, (W - 20) / items.length - 8);
  return <svg viewBox={`0 0 ${W} ${h}`} className="w-full h-full">{[0.5, 1].map(f => <line key={f} x1="8" x2={W - 4} y1={h - 16 - f * (h - 34)} y2={h - 16 - f * (h - 34)} stroke={K.tr} strokeWidth=".7" />)}
    {items.map((it, i) => { const step = (W - 12) / items.length, x = 8 + i * step + (step - bw) / 2, bh = (it.value / max) * (h - 34);
      return <g key={i}><rect x={x} y={h - 16 - bh} width={bw} height={Math.max(bh, 1.5)} fill={it.color || color} style={{ filter: `drop-shadow(0 0 3px ${it.color || color})` }} />
        <text x={x + bw / 2} y={h - 18 - bh} textAnchor="middle" fontSize={fs} fontWeight="700" fill="#fff">{fmt(it.value)}</text>
        <text x={x + bw / 2} y={h - 5} textAnchor="middle" fontSize={fs} fill={K.mu}>{String(it.label).slice(0, 9)}</text></g>; })}</svg>;
}

function HBars({ items }) {
  return <div className="space-y-1.5">{items.map(i => <div key={i.l} className="flex items-center gap-2 text-[10.5px] font-semibold"><span className="w-16 shrink-0 truncate">{i.l}</span>
    <div className="flex-1 h-2.5 rounded-sm" style={{ background: K.tr }}><div className="h-full rounded-sm" style={{ width: `${i.p}%`, background: `linear-gradient(90deg,${K.bl},${i.c || K.cy})`, boxShadow: `0 0 6px ${i.c || K.cy}` }} /></div>
    <span className="w-9 text-right tabular-nums" style={{ color: i.c || K.cy }}>{i.p}%</span></div>)}</div>;
}

function Funnel({ rows }) {
  const w = [70, 54, 40, 28];
  return <svg viewBox="0 0 150 92" className="w-full h-full">
    <defs><linearGradient id="nvf" x1="0" x2="1"><stop offset="0" stopColor="#2a7bff" /><stop offset="1" stopColor="#19d3ff" /></linearGradient></defs>
    {rows.map((r, i) => { const y = 3 + i * 22, w0 = w[i], w1 = w[i + 1] ?? 22, x0 = 36 - w0 / 2, x1 = 36 - w1 / 2;
      return <g key={r.l}><polygon points={`${x0},${y} ${x0 + w0},${y} ${x1 + w1},${y + 20} ${x1},${y + 20}`} fill="url(#nvf)" opacity={1 - i * 0.14} />
        <text x="76" y={y + 8} fontSize="9" fill={K.mu} fontWeight="600">{r.l}</text><text x="76" y={y + 19} fontSize="12" fontWeight="800" fill="#fff">{r.v}</text></g>; })}</svg>;
}

function Line({ labels, series }) {
  const W = 300, H = 100, L = 34, B = 15, T = 6, R = 6, n = labels.length;
  if (n < 2) return <Empty />;
  const max = Math.max(1, ...series.flatMap(s => s.data.map(num))) * 1.12, x = i => L + (i / (n - 1)) * (W - L - R), y = v => T + (1 - v / max) * (H - T - B);
  const ticks = [0, 0.5, 1].map(f => f * max), xi = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full"><defs>{series.map((s, i) => <linearGradient key={i} id={`nvl${i}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={s.c} stopOpacity=".35" /><stop offset="1" stopColor={s.c} stopOpacity="0" /></linearGradient>)}</defs>
    {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={K.tr} strokeWidth=".7" /><text x={L - 3} y={y(t) + 3} textAnchor="end" fontSize="7.5" fill={K.mu}>{fmtRate(t).replace(' ', '')}</text></g>)}
    {xi.map(i => <text key={i} x={x(i)} y={H - 3} textAnchor="middle" fontSize="7.5" fill={K.mu}>{labels[i]}</text>)}
    {series.map((s, k) => { const d = s.data.map((v, i) => `${x(i)},${y(num(v))}`).join(' L'); return <g key={k}><path d={`M${d} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#nvl${k})`} /><path d={`M${d}`} fill="none" stroke={s.c} strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 2px ${s.c})` }} /></g>; })}</svg>;
}

function Combo({ rows }) {
  if (!rows.length) return <Empty t="No session history yet - it fills in as vouchers are used" />;
  const W = 560, H = 112, L = 36, B = 16, T = 8, R = 30, n = rows.length, step = (W - L - R) / n, bw = Math.min(22, step * 0.55);
  const mb = Math.max(1, ...rows.map(r => r.upload + r.download)), ms = Math.max(1, ...rows.map(r => r.sessions)), yb = v => T + (1 - v / mb) * (H - T - B), ys = v => T + (1 - v / ms) * (H - T - B);
  const cx = i => L + i * step + step / 2, line = rows.map((r, i) => `${cx(i)},${ys(r.sessions)}`).join(' L');
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
    {[0, 0.5, 1].map(f => <g key={f}><line x1={L} x2={W - R} y1={yb(f * mb)} y2={yb(f * mb)} stroke={K.tr} strokeWidth=".7" /><text x={L - 4} y={yb(f * mb) + 3} textAnchor="end" fontSize="7.5" fill={K.mu}>{fmtBytes(f * mb).replace(' ', '')}</text>
      <text x={W - R + 4} y={ys(f * ms) + 3} fontSize="7.5" fill={K.ye}>{Math.round(f * ms)}</text></g>)}
    {rows.map((r, i) => <g key={i}><rect x={cx(i) - bw / 2} y={yb(r.upload)} width={bw} height={yb(0) - yb(r.upload)} fill={K.cy} />
      <rect x={cx(i) - bw / 2} y={yb(r.upload + r.download)} width={bw} height={yb(r.upload) - yb(r.upload + r.download)} fill={K.gr} />
      <text x={cx(i)} y={H - 3} textAnchor="middle" fontSize="7.5" fill={K.mu}>{r.label}</text></g>)}
    <path d={`M${line}`} fill="none" stroke={K.ye} strokeWidth="1.6" style={{ filter: `drop-shadow(0 0 2px ${K.ye})` }} />{rows.map((r, i) => <circle key={i} cx={cx(i)} cy={ys(r.sessions)} r="2.3" fill={K.ye} />)}</svg>;
}

/* ---------- page ---------- */
export default function NetworkOverview({ live, hist, online, conn }) {
  const rt = live?.router || {}, sm = live?.summary || {}, vs = live?.vouchers || [], ss = live?.sessions || [], sys = live?.system || {}, cap = live?.capBytes;
  const [hi, setHi] = useState(4), [now, setNow] = useState(new Date()), [daily, setDaily] = useState([]);
  useEffect(() => { const a = setInterval(() => setHi(h => (h + 1) % 7), 3500), b = setInterval(() => setNow(new Date()), 1000); return () => { clearInterval(a); clearInterval(b); }; }, []);
  useEffect(() => { let on = true; const load = () => api('/reports?type=daily').then(r => on && setDaily(r.slice(-11).map(x => ({ label: String(x.day).slice(5, 10).replace('-', '.'), upload: num(x.upload), download: num(x.download), sessions: num(x.sessions) })))).catch(() => {});
    load(); const i = setInterval(load, 60000); return () => { on = false; clearInterval(i); }; }, []);

  const total = num(sm.total), act = vs.filter(v => v.status === 'ACTIVE').length, expired = num(sm.expired), dis = num(sm.disabled), onl = num(sm.activeUsers);
  const leases = (sys.leases || []).length, poolUsed = (sys.pools || []).reduce((a, p) => a + p.used, 0);
  const lim = vs.map(v => Math.min(v.limitBytesTotal || Infinity, cap || Infinity)).map((l, i) => [l, vs[i].total]).filter(([l]) => isFinite(l));
  const dataPct = pct(lim.reduce((a, [, u]) => a + u, 0), lim.reduce((a, [l]) => a + l, 0));
  const last = hist[hist.length - 1] || {};
  const profiles = Object.entries(vs.reduce((m, v) => ({ ...m, [v.profile || 'default']: (m[v.profile || 'default'] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const pieC = [K.cy, K.ye, K.bl, K.gr, K.rd], pie = profiles.slice(0, 4).map(([n, v], i) => ({ n, v, c: pieC[i] })).concat(profiles.length > 4 ? [{ n: 'Other', v: profiles.slice(4).reduce((a, p) => a + p[1], 0), c: pieC[4] }] : []);
  const top = [...vs].sort((a, b) => b.total - a.total).slice(0, 5).map(v => ({ label: v.host || v.username, value: v.total }));
  const nodes = [{ k: 'Hotspot', v: `${onl} online`, x: 236, y: 30 }, { k: 'Vouchers', v: `${total} total`, x: 392, y: 44 }, { k: 'DHCP', v: `${leases} leases`, x: 84, y: 82 },
    { k: 'Devices', v: `${num(sm.activeDevices)} active`, x: 70, y: 170 }, { k: 'Router', v: online ? `CPU ${num(rt.cpuLoad)}%` : 'offline', x: 300, y: 150 },
    { k: 'Data', v: fmtBytes(sm.totalData), x: 508, y: 122 }, { k: 'Security', v: `${num(sm.suspicious)} alerts`, x: 520, y: 214 }];

  return <div className="nv-root">
    <div className="nv-head">
      <div className="text-[11px] font-bold text-left leading-tight truncate"><span style={{ color: K.cy }}>◈ {rt.identity || 'Router'}</span><br /><span className="text-[color:#7fa8d0] font-semibold">{online ? `${rt.board || ''} · RouterOS ${rt.version || ''} · up ${rt.uptime || ''}` : (rt.error || 'MIKROTIK OFFLINE')}</span></div>
      <div className="text-center leading-tight"><div className="nv-h1">Hotspot Network Center</div><div className="text-[11px] font-bold tracking-[.25em] uppercase" style={{ color: K.cy }}>Online supervision system</div></div>
      <div className="text-right text-[11px] font-bold leading-tight"><span style={{ color: conn && online ? K.gr : K.rd }}>● {conn ? (online ? 'LIVE' : 'ROUTER OFFLINE') : 'RECONNECTING'}</span><br /><span className="text-[color:#7fa8d0] font-semibold tabular-nums">{now.toLocaleDateString()} {now.toLocaleTimeString([], { hour12: false })}</span></div>
    </div>
    <div className="nv-grid">
      <div className="nv-col">
        <P title="Router health & voucher funnel" className="flex-[1.15]"><div className="grid grid-cols-[1.15fr_.85fr] gap-2 h-full items-center">
          <HBars items={[{ l: 'CPU load', p: num(rt.cpuLoad), c: K.cy }, { l: 'Memory', p: num(rt.memPercent), c: K.ye }, { l: 'Storage', p: num(rt.hddPercent), c: K.gr }]} />
          <Funnel rows={[{ l: 'Total vouchers', v: total }, { l: 'Active status', v: act }, { l: 'Online now', v: onl }, { l: 'Suspicious', v: num(sm.suspicious) }]} /></div></P>
        <P title="Voucher status & traffic split" className="flex-1"><div className="grid grid-cols-2 gap-2 h-full">
          <div className="flex flex-col min-h-0"><div className="flex-1 min-h-0"><Donut center={total} sub="vouchers" segs={[{ v: act, c: K.cy }, { v: expired, c: K.ye }, { v: dis, c: K.rd }]} /></div><Legend items={[{ t: 'Active', c: K.cy }, { t: 'Expired', c: K.ye }, { t: 'Off', c: K.rd }]} /></div>
          <div className="flex flex-col min-h-0"><div className="flex-1 min-h-0"><Donut center={fmtBytes(sm.totalData).replace(' ', '')} sub="total data" segs={[{ v: num(sm.download), c: K.gr }, { v: num(sm.upload), c: K.bl }]} /></div><Legend items={[{ t: 'Down', c: K.gr }, { t: 'Up', c: K.bl }]} /></div></div></P>
        <P title="Real-time throughput monitoring" className="flex-[1.2]"><div className="flex flex-col h-full"><div className="flex-1 min-h-0"><Line labels={hist.map(h => h.t)} series={[{ data: hist.map(h => h.down), c: K.ye }, { data: hist.map(h => h.up), c: K.cy }]} /></div>
          <div className="grid grid-cols-2 gap-x-3 text-[10px] font-bold pt-1"><span style={{ color: K.ye }}>▬ Download {fmtRate(num(last.down))}</span><span style={{ color: K.cy }}>▬ Upload {fmtRate(num(last.up))}</span><span className="text-[color:#7fa8d0]">Users {num(last.users)}</span><span className="text-[color:#7fa8d0]">Pools used {poolUsed}</span></div></div></P>
      </div>

      <div className="nv-col">
        <div className="nv-panel nv-tree flex-[3] !p-1 min-h-[360px] lg:min-h-0"><div className="nv-body"><Tree nodes={nodes} sessions={ss} hi={hi} /></div></div>
        <P title="Data usage & sessions - recent days" className="flex-[1.15]"><div className="flex flex-col h-full"><div className="flex-1 min-h-0"><Combo rows={daily} /></div><Legend items={[{ t: 'Upload', c: K.cy }, { t: 'Download', c: K.gr }, { t: 'Sessions', c: K.ye }]} /></div></P>
      </div>

      <div className="nv-col">
        <P title="Users & data reached" className="flex-[1.05]"><div className="flex gap-2 h-full items-center">
          <Ring p={pct(onl, total)} color={K.cy} label="Users online" value={`${onl} / ${total}`} scale={['0', '50', '100']} />
          <Ring p={dataPct} color={K.ye} label="Data used vs cap" value={fmtBytes(sm.totalData)} scale={['0', '50', '100']} /></div></P>
        <P title="Voucher profiles & activity" className="flex-[1.15]"><div className="grid grid-cols-2 gap-2 h-full">
          <div className="flex flex-col min-h-0"><div className="flex-1 min-h-0"><Pie segs={pie} /></div><Legend items={pie.map(p => ({ t: `${p.n} ${p.v}`, c: p.c }))} /></div>
          <div className="min-h-0"><Bars h={100} W={120} fs={9} items={[{ label: 'Online', value: onl, color: K.cy }, { label: 'Expired', value: expired, color: K.ye }]} /></div></div></P>
        <P title="Risk monitoring" className="flex-1"><div className="grid grid-cols-2 gap-2 h-full">
          <div className="flex flex-col min-h-0"><div className="flex-1 min-h-0"><Donut center={`${pct(num(sm.suspicious), Math.max(onl, 1))}%`} sub="suspicious" segs={[{ v: num(sm.suspicious), c: K.rd }, { v: Math.max(0, onl - num(sm.suspicious)), c: K.tr }]} /></div></div>
          <div className="flex flex-col min-h-0"><div className="flex-1 min-h-0"><Donut center={`${pct(dis, total)}%`} sub={`${num(sm.blockedDevices)} devices blocked`} segs={[{ v: dis, c: K.ye }, { v: Math.max(0, total - dis), c: K.tr }]} /></div></div></div></P>
        <P title="Top consumers (data used)" className="flex-[1.05]"><Bars items={top} fmt={fmtBytes} h={104} /></P>
      </div>
    </div>
  </div>;
}

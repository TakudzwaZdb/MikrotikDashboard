import React, { useEffect, useMemo, useState } from 'react';
import { api, fmtBytes, fmtRate, since } from './api.js';

// Read-only "command centre" page: live network / hotspot / voucher overview. No controls, navigation only.
// Look: near-black glass panels, orange / red / cyan / magenta neon, digital numerals (reference: dark supervision wall).
const K = { or: '#ff8a1f', rd: '#ff3b3b', ye: '#ffc933', cy: '#19d3ff', bl: '#2a6bff', mg: '#ff2fb0', gr: '#35e08a', tx: '#dfe5f0', mu: '#7c8596', tr: '#1a202e' };
const PAL = [K.cy, K.mg, K.bl, K.or, K.ye, K.gr];
const DIG = { fontFamily: "Orbitron, 'Share Tech Mono', ui-monospace, monospace" };
const num = v => Number(v) || 0;
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- panel shell ---------- */
const P = ({ title, tag, children, className = '' }) => <section className={`nv-panel ${className}`}>
  <h3 className="nv-title"><i />{title}{tag && <span className="nv-tag">{tag}</span>}</h3><div className="nv-body">{children}</div></section>;
const Empty = ({ t = 'Collecting live data…' }) => <div className="h-full w-full grid place-items-center text-[11px]" style={{ color: K.mu }}>{t}</div>;
const Glow = ({ id = 'nvg', sd = 2 }) => <filter id={id} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation={sd} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>;

/* digital readout: dim leading zeros + bright number */
function Digits({ value, n = 5, color = K.or, size = 'text-4xl' }) {
  const s = String(Math.max(0, Math.round(num(value)))), z = '0'.repeat(Math.max(0, n - s.length));
  return <div className={`nv-dig ${size}`} style={{ ...DIG, color, textShadow: `0 0 14px ${color}` }}><span style={{ opacity: .22 }}>{z}</span>{s}</div>;
}

/* ---------- 1. traffic flow map (dot-matrix world, glowing arcs) ---------- */
const BLOBS = [[150, 95, 78, 46], [215, 205, 30, 52], [305, 78, 34, 24], [325, 175, 42, 56], [440, 92, 92, 52], [500, 218, 32, 20], [60, 55, 24, 16]];
const DOTS = (() => { const r = rng(5), d = []; for (let y = 10; y < 290; y += 9) for (let x = 8; x < 592; x += 9) { const inb = BLOBS.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1); d.push([x, y, inb && r() > 0.2]); } return d; })();
const RIB = [['M-10,236 C110,118 215,208 330,128 S520,36 612,64', 7, .55], ['M-10,206 C100,96 238,176 340,118 S500,16 612,28', 3.4, .85], ['M-10,262 C150,168 262,236 360,152 S540,70 612,112', 4.6, .6], ['M-10,180 C120,150 250,120 350,150 S520,120 612,90', 2.2, .7], ['M-10,222 C140,190 270,176 340,170 S520,190 612,150', 2.8, .5]];
const SLOTS = [[110, 80], [180, 120], [250, 60], [390, 70], [470, 120], [540, 80], [520, 230], [140, 220]];
function FlowMap({ sessions, online, rate }) {
  const R = [330, 190], hosts = sessions.slice(0, SLOTS.length);
  const speed = Math.max(1.1, 4 - Math.min(2.8, rate / 2e6));
  return <svg viewBox="0 0 600 300" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
    <defs><Glow id="fmg" sd="2.4" /><linearGradient id="fma" x1="0" x2="1"><stop offset="0" stopColor={K.ye} /><stop offset=".5" stopColor={K.or} /><stop offset="1" stopColor={K.rd} /></linearGradient></defs>
    <defs><radialGradient id="fmh" cx="35%" cy="55%" r="60%"><stop offset="0" stopColor="#ff6a00" stopOpacity=".38" /><stop offset="1" stopColor="#ff6a00" stopOpacity="0" /></radialGradient></defs>
    <rect width="600" height="300" fill="url(#fmh)" />
    {DOTS.map(([x, y, on], i) => <circle key={i} cx={x} cy={y} r={on ? 1.7 : .7} fill={on ? '#8a93a6' : '#262c3a'} opacity={on ? .8 : .9} />)}
    <g fill="none" filter="url(#fmg)" strokeLinecap="round">
      {RIB.map(([d, w, o], i) => <g key={i}><path d={d} stroke="url(#fma)" strokeWidth={w} opacity={o} /><path d={d} stroke="#fff1c9" strokeWidth={Math.max(.6, w / 5)} opacity={o} /></g>)}
    </g>
    <g fill="none" filter="url(#fmg)" strokeLinecap="round">
      {(hosts.length ? hosts.map((_, i) => SLOTS[i]) : SLOTS.slice(0, 4)).map((s, i) => { const mx = (R[0] + s[0]) / 2, my = Math.min(R[1], s[1]) - 46 - (i % 3) * 16;
        return <g key={i} opacity={hosts.length ? 1 : .28}><path d={`M${R[0]},${R[1]} Q${mx},${my} ${s[0]},${s[1]}`} stroke="url(#fma)" strokeWidth={1.4 + (i % 3) * .5} opacity=".55" />
          <path className="nv-flow" style={{ animationDuration: `${speed + i * .35}s` }} d={`M${R[0]},${R[1]} Q${mx},${my} ${s[0]},${s[1]}`} stroke="#fff3c8" strokeWidth="1.8" strokeDasharray="6 120" /></g>; })}
    </g>
    {hosts.map((s, i) => <g key={(s.username || '') + i}><circle cx={SLOTS[i][0]} cy={SLOTS[i][1]} r="4" fill={K.gr} filter="url(#fmg)" /><circle className="nv-pulse" cx={SLOTS[i][0]} cy={SLOTS[i][1]} r="4" fill={K.gr} />
      <text x={SLOTS[i][0] + (SLOTS[i][0] > 450 ? -7 : 7)} textAnchor={SLOTS[i][0] > 450 ? 'end' : 'start'} y={SLOTS[i][1] + 3} fontSize="9" fontWeight="700" fill="#eaffef" stroke="#05060a" strokeWidth="2.4" paintOrder="stroke">{(s.host || s.username || '').slice(0, 14)}</text></g>)}
    <circle className="nv-pulse" cx={R[0]} cy={R[1]} r="6" fill={K.or} /><circle cx={R[0]} cy={R[1]} r="5" fill={online ? K.or : K.mu} filter="url(#fmg)" />
    <text x={R[0] + 9} y={R[1] + 14} fontSize="9" fontWeight="800" fill="#ffd9a8" stroke="#05060a" strokeWidth="2.4" paintOrder="stroke">ROUTER</text>
    {!hosts.length && <text x="300" y="285" textAnchor="middle" fontSize="10" fill={K.mu}>{online ? 'No active sessions' : 'Router offline - no data'}</text>}
  </svg>;
}

/* ---------- 2. globe + dial ---------- */
function Globe({ sessions }) {
  const pts = useMemo(() => { const r = rng(9); return Array.from({ length: 26 }, () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 54; return [60 + d * Math.cos(a), 60 + d * Math.sin(a)]; }); }, []);
  return <svg viewBox="0 -2 120 124" className="w-full h-full"><defs><Glow id="gl" sd="1.6" /><radialGradient id="glb" cx="40%" cy="38%"><stop offset="0" stopColor="#1d3550" /><stop offset="1" stopColor="#06080e" /></radialGradient></defs>
    <circle cx="60" cy="60" r="53" fill="url(#glb)" stroke={K.mu} strokeWidth=".8" />
    <g fill="none" stroke={K.cy} strokeWidth=".5" opacity=".5">{[16, 32, 46].map(rx => <ellipse key={rx} cx="60" cy="60" rx={rx} ry="56" />)}{[-34, -17, 0, 17, 34].map(y => <ellipse key={y} cx="60" cy={60 + y} rx={Math.sqrt(56 * 56 - y * y)} ry={Math.abs(y) < 1 ? 1 : 5} />)}</g>
    <g filter="url(#gl)">{pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i % 6 === 0 ? 1.9 : 1} fill={i % 6 === 0 ? K.or : '#c9d6ea'} opacity=".85" />)}</g>
    <g className="nv-sweep"><path d="M60,60 L60,4 A56,56 0 0 1 100,20 Z" fill={K.cy} opacity=".18" /><line x1="60" y1="60" x2="60" y2="4" stroke={K.cy} strokeWidth="1.2" /></g>
    <circle cx="60" cy="60" r="56" fill="none" stroke={K.or} strokeWidth="1.4" strokeDasharray="2 5" />
    <text x="60" y="119" textAnchor="middle" fontSize="6.5" fontWeight="700" fill={K.mu} letterSpacing="1">{sessions} DEVICES</text></svg>;
}
function Dial({ p, value, label }) {
  const r = 74, c = 2 * Math.PI * r, ticks = Array.from({ length: 60 }, (_, i) => i);
  return <svg viewBox="0 0 200 200" className="w-full h-full"><defs><Glow id="dg" sd="2.2" /></defs>
    <g>{ticks.map(i => { const a = (i / 60) * Math.PI * 2, big = i % 5 === 0, r1 = big ? 86 : 89, r2 = 94; return <line key={i} x1={100 + r1 * Math.sin(a)} y1={100 - r1 * Math.cos(a)} x2={100 + r2 * Math.sin(a)} y2={100 - r2 * Math.cos(a)} stroke={i / 60 * 100 <= p ? K.cy : '#2a3347'} strokeWidth={big ? 1.8 : .9} />; })}</g>
    <circle cx="100" cy="100" r={r} fill="none" stroke={K.tr} strokeWidth="9" />
    <circle cx="100" cy="100" r={r} fill="none" stroke={K.cy} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 100 100)" filter="url(#dg)" />
    <circle className="nv-rot" cx="100" cy="100" r="58" fill="none" stroke={K.or} strokeWidth="1.4" strokeDasharray="14 9" />
    <circle cx="100" cy="100" r="48" fill="#070a12" stroke="#2a3347" strokeWidth="1" />
    <text x="100" y="108" textAnchor="middle" fontSize="30" fontWeight="800" fill="#fff" style={DIG}>{value}</text>
    <text x="100" y="126" textAnchor="middle" fontSize="8.5" fontWeight="700" fill={K.or} letterSpacing="1.5">{label}</text>
    <text x="100" y="142" textAnchor="middle" fontSize="8" fill={K.mu}>{p}%</text></svg>;
}

/* ---------- 3. throughput candles ---------- */
function Candles({ hist }) {
  const W = 300, H = 130, L = 36, B = 16, T = 8, R = 6, n = hist.length;
  if (n < 4) return <Empty />;
  const g = Math.max(1, Math.ceil(n / 44)), cs = [];
  for (let i = 0; i < n; i += g) { const s = hist.slice(i, i + g).map(h => num(h.down)); cs.push({ o: s[0], c: s[s.length - 1], h: Math.max(...s), l: Math.min(...s), up: num(hist[Math.min(n - 1, i + g - 1)].up), us: num(hist[Math.min(n - 1, i + g - 1)].users), t: hist[i].t }); }
  const mu = Math.max(1, ...cs.map(c => c.us)), max = Math.max(1, ...cs.map(c => c.h), ...cs.map(c => c.up)) * 1.1, yu = v => T + (1 - v / mu) * (H - T - B) * .6 + 4, y = v => T + (1 - v / max) * (H - T - B), step = (W - L - R) / cs.length, x = i => L + i * step + step / 2, bw = Math.max(2, step * .5);
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
    {cs.map((_, i) => i % 4 === 0 && <line key={'v' + i} x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke={K.tr} strokeWidth=".5" />)}
    {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1={L} x2={W - R} y1={y(f * max)} y2={y(f * max)} stroke={K.tr} strokeWidth=".7" /><text x={L - 3} y={y(f * max) + 3} textAnchor="end" fontSize="7.5" fill={K.mu}>{fmtRate(f * max).replace(' ', '')}</text></g>)}
    <path d={'M' + cs.map((c, i) => `${x(i)},${y(c.up)}`).join(' L')} fill="none" stroke={K.bl} strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 3px ${K.bl})` }} />
    <path d={'M' + cs.map((c, i) => `${x(i)},${yu(c.us)}`).join(' L')} fill="none" stroke="#fff" strokeWidth=".7" opacity=".5" />
    {cs.map((c, i) => { const col = c.c >= c.o ? K.cy : K.or; return <g key={i}><line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth=".9" />
      <rect x={x(i) - bw / 2} y={Math.min(y(c.o), y(c.c))} width={bw} height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))} fill={col} style={{ filter: `drop-shadow(0 0 2px ${col})` }} /></g>; })}
    {[0, Math.floor(cs.length / 2), cs.length - 1].map(i => <text key={i} x={x(i)} y={H - 3} textAnchor="middle" fontSize="7.5" fill={K.mu}>{cs[i].t}</text>)}</svg>;
}

/* ---------- 4. segmented metric lines ---------- */
function Seg({ rows }) {
  return <div className="flex flex-col justify-around h-full gap-1.5">{rows.map(r => { const on = Math.round(Math.min(100, r.p) / 100 * 28);
    return <div key={r.l}><div className="flex justify-between text-[10px] font-bold uppercase tracking-wide"><span style={{ color: K.tx }}>{r.l}</span><span style={{ color: r.c, ...DIG, fontSize: 10 }}>{r.v}</span></div>
      <div className="flex gap-[2px] mt-[3px]">{Array.from({ length: 28 }, (_, i) => <i key={i} className="flex-1 h-[7px]" style={{ background: i < on ? r.c : '#1b2130', boxShadow: i < on ? `0 0 5px ${r.c}` : 'none', opacity: i < on ? 1 - (i / 28) * .25 : 1 }} />)}</div></div>; })}</div>;
}

function Lines({ rows }) {
  return <div className="flex flex-col justify-around h-full gap-1">{rows.map(r => <div key={r.l} className="flex items-center gap-2">
    <span className="w-[74px] shrink-0 text-[9.5px] font-bold uppercase tracking-wide truncate" style={{ color: K.tx }}>{r.l}</span>
    <div className="relative flex-1 h-[3px]" style={{ background: '#1d2330' }}><div className="absolute left-0 top-0 h-full" style={{ width: `${Math.max(2, Math.min(100, r.p))}%`, background: r.c, boxShadow: `0 0 8px ${r.c}` }} /><i className="absolute top-1/2 w-[7px] h-[7px] rounded-full -translate-y-1/2" style={{ left: `calc(${Math.max(2, Math.min(100, r.p))}% - 3px)`, background: '#fff', boxShadow: `0 0 8px ${r.c}` }} /></div>
    <span className="w-12 text-right" style={{ color: r.c, ...DIG, fontSize: 10, fontWeight: 700 }}>{r.v}</span></div>)}</div>;
}
/* red -> orange -> yellow segmented strip (bottom of each lower panel) */
function Strip({ p, n = 26 }) {
  const on = Math.round(Math.min(100, p) / 100 * n), col = i => (i / n < .4 ? K.rd : i / n < .72 ? K.or : K.ye);
  return <div className="flex gap-[2px] shrink-0 pt-1.5">{Array.from({ length: n }, (_, i) => <i key={i} className="flex-1 h-[7px]" style={{ background: i < on ? col(i) : '#1d2330', boxShadow: i < on ? `0 0 5px ${col(i)}` : 'none' }} />)}</div>;
}
function Burst({ p }) {
  const rr = rng(3);
  return <svg viewBox="0 0 120 90" className="w-full h-full"><defs><Glow id="bug" sd="1.5" /></defs>
    <g stroke={K.or} strokeLinecap="round" filter="url(#bug)">{Array.from({ length: 36 }, (_, i) => { const a = (i / 36) * Math.PI * 2, l = 10 + rr() * 22 + (p / 100) * 12; return <line key={i} x1={60 + 8 * Math.cos(a)} y1={45 + 8 * Math.sin(a)} x2={60 + l * Math.cos(a)} y2={45 + l * Math.sin(a) * .9} strokeWidth={i % 3 ? .7 : 1.5} opacity={i % 3 ? .75 : 1} />; })}</g>
    <circle cx="60" cy="45" r="6" fill="#fff" filter="url(#bug)" /><circle cx="60" cy="45" r="38" fill="none" stroke={K.cy} strokeWidth=".7" strokeDasharray="1 4" /></svg>;
}

/* ---------- 5. multicolour vertical bars ---------- */
function VBars({ items, fmt = v => v, h = 100, W = 330 }) {
  if (!items.length) return <Empty t="No usage history yet - fills in as vouchers are used" />;
  const max = Math.max(1, ...items.map(i => i.value)), step = (W - 16) / items.length, bw = Math.min(14, step * .5);
  return <svg viewBox={`0 0 ${W} ${h}`} className="w-full h-full"><defs><Glow id="vbg" sd="1.8" /></defs>
    {[.5, 1].map(f => <line key={f} x1="8" x2={W - 4} y1={h - 18 - f * (h - 38)} y2={h - 18 - f * (h - 38)} stroke={K.tr} strokeWidth=".7" />)}
    {items.map((it, i) => { const col = [K.cy, K.mg, K.bl][i % 3], bh = Math.max(2, (it.value / max) * (h - 38)), x = 8 + i * step + (step - bw) / 2;
      return <g key={i}><rect x={x} y={h - 18 - bh} width={bw} height={bh} fill={col} opacity=".92" filter="url(#vbg)" /><rect x={x} y={h - 18 - bh} width={bw} height="2" fill="#fff" opacity=".8" />
        <text x={x + bw / 2} y={h - 21 - bh} textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#fff">{fmt(it.value)}</text>
        <text x={x + bw / 2} y={h - 6} textAnchor="middle" fontSize="7.5" fill={K.mu}>{String(it.label).slice(0, 8)}</text></g>; })}</svg>;
}

/* ---------- 6. device node graph ---------- */
const BG = (() => { const r = rng(21), p = Array.from({ length: 30 }, () => [20 + r() * 260, 14 + r() * 132]), e = [];
  p.forEach((a, i) => p.map((b, j) => [j, Math.hypot(a[0] - b[0], a[1] - b[1])]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]).slice(0, 2).forEach(([j]) => e.push([i, j]))); return { p, e }; })();
function NodeGraph({ sessions, online }) {
  const C = [150, 82], hosts = sessions.slice(0, 10).map((s, i, a) => { const ang = (i / Math.max(a.length, 1)) * Math.PI * 2 - Math.PI / 2, rx = 96, ry = 52; return { s, x: C[0] + rx * Math.cos(ang), y: C[1] + ry * Math.sin(ang) }; });
  return <svg viewBox="0 0 300 164" className="w-full h-full"><defs><Glow id="ngg" sd="1.8" /></defs>
    <g stroke="#cfd6e4" strokeWidth=".45" opacity=".35">{BG.e.map(([a, b], i) => <line key={i} x1={BG.p[a][0]} y1={BG.p[a][1]} x2={BG.p[b][0]} y2={BG.p[b][1]} />)}</g>
    <g fill="#8a93a6" opacity=".7">{BG.p.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="1.3" />)}</g>
    {hosts.map((h, i) => <line key={i} x1={C[0]} y1={C[1]} x2={h.x} y2={h.y} stroke={K.or} strokeWidth=".9" opacity=".8" />)}
    {hosts.map((h, i) => <g key={i}><circle cx={h.x} cy={h.y} r="3.4" fill="#fff" filter="url(#ngg)" /><circle className="nv-pulse" cx={h.x} cy={h.y} r="3.4" fill={K.cy} />
      <text x={h.x} y={h.y - 6} textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff" stroke="#05060a" strokeWidth="2" paintOrder="stroke">{(h.s.host || h.s.username || '').slice(0, 12)}</text></g>)}
    <circle cx={C[0]} cy={C[1]} r="9" fill="#120a02" stroke={online ? K.or : K.mu} strokeWidth="2" filter="url(#ngg)" /><circle cx={C[0]} cy={C[1]} r="3.4" fill={online ? K.or : K.mu} />
    {!hosts.length && <text x="150" y="150" textAnchor="middle" fontSize="8.5" fill={K.mu}>{online ? 'No devices online' : 'Router offline - no data'}</text>}</svg>;
}

/* ---------- 7. radar ---------- */
function Radar({ axes }) {
  const n = axes.length, C = 100, pt = (i, f) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [C + 70 * f * Math.cos(a), C + 70 * f * Math.sin(a)]; };
  const poly = axes.map((a, i) => pt(i, Math.max(.03, a.p / 100)).join(',')).join(' ');
  return <svg viewBox="0 0 200 200" className="w-full h-full"><defs><Glow id="rg" sd="1.8" /></defs>
    {[.25, .5, .75, 1].map(f => <polygon key={f} points={axes.map((_, i) => pt(i, f).join(',')).join(' ')} fill="none" stroke="#2a3347" strokeWidth=".8" />)}
    {axes.map((a, i) => { const e = pt(i, 1), l = pt(i, 1.2); return <g key={i}><line x1={C} y1={C} x2={e[0]} y2={e[1]} stroke="#2a3347" strokeWidth=".7" /><text x={l[0]} y={l[1] + 3} textAnchor="middle" fontSize="7.5" fontWeight="700" fill={K.mu}>{a.l}</text></g>; })}
    <polygon points={poly} fill={K.or} fillOpacity=".28" stroke={K.or} strokeWidth="1.6" filter="url(#rg)" />
    {axes.map((a, i) => { const p = pt(i, Math.max(.03, a.p / 100)); return <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill={K.cy} />; })}</svg>;
}

/* ---------- 8. concentric rings ---------- */
function Rings({ rows }) {
  return <div className="flex items-center gap-3 h-full"><svg viewBox="0 0 100 100" className="h-full max-h-full max-w-[48%] aspect-square shrink-0"><defs><Glow id="rig" sd="1.4" /></defs>
    {rows.map((r, i) => { const rad = 44 - i * 9.5, c = 2 * Math.PI * rad; return <g key={r.l}><circle cx="50" cy="50" r={rad} fill="none" stroke={K.tr} strokeWidth="5" />
      <circle cx="50" cy="50" r={rad} fill="none" stroke={r.c} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(Math.min(100, r.p) / 100) * c * .75} ${c}`} transform="rotate(-225 50 50)" filter="url(#rig)" /></g>; })}</svg>
    <div className="flex-1 min-w-0 space-y-1.5">{rows.map(r => <div key={r.l} className="flex items-center justify-between gap-2 text-[10px] font-bold"><span className="flex items-center gap-1.5 truncate"><i className="inline-block w-2 h-2 rounded-full" style={{ background: r.c, boxShadow: `0 0 6px ${r.c}` }} />{r.l}</span><span style={{ color: r.c, ...DIG, fontSize: 11 }}>{r.p}%</span></div>)}</div></div>;
}

/* ---------- page ---------- */
export default function NetworkOverview({ live, hist, online, conn, onMenu }) {
  const rt = live?.router || {}, sm = live?.summary || {}, vs = live?.vouchers || [], ss = live?.sessions || [], sys = live?.system || {}, cap = live?.capBytes;
  const [now, setNow] = useState(new Date()), [daily, setDaily] = useState([]);
  useEffect(() => { const b = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(b); }, []);
  useEffect(() => { let on = true; const load = () => api('/reports?type=daily').then(r => on && setDaily(r.slice(-9).map(x => ({ label: String(x.day).slice(5, 10).replace('-', '.'), value: num(x.upload) + num(x.download) })))).catch(() => {});
    load(); const i = setInterval(load, 60000); return () => { on = false; clearInterval(i); }; }, []);

  const total = num(sm.total), act = vs.filter(v => v.status === 'ACTIVE').length, expired = num(sm.expired), dis = num(sm.disabled), onl = num(sm.activeUsers), susp = num(sm.suspicious);
  const leases = (sys.leases || []).length, poolUsed = (sys.pools || []).reduce((a, p) => a + p.used, 0), poolMax = (sys.pools || []).reduce((a, p) => a + (p.total || p.size || 0), 0);
  const lim = vs.map(v => [Math.min(v.limitBytesTotal || Infinity, cap || Infinity), v.total]).filter(([l]) => isFinite(l));
  const dataPct = pct(lim.reduce((a, [, u]) => a + u, 0), lim.reduce((a, [l]) => a + l, 0));
  const last = hist[hist.length - 1] || {};
  const top = [...vs].sort((a, b) => b.total - a.total).slice(0, 8).map(v => ({ label: v.host || v.username, value: v.total }));
  const bars = daily.length ? daily.slice(-14) : top;
  const cpu = num(rt.cpuLoad), mem = num(rt.memPercent), hdd = num(rt.hddPercent), usersP = pct(onl, total);

  return <div className="nv-root">
    <div className="nv-head">
      <div className="flex items-center gap-3 min-w-0"><button type="button" className="nv-menu" onClick={onMenu} aria-label="Open menu" title="Open menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg></button>
        <div className="text-[11px] font-bold text-left leading-tight truncate min-w-0"><span style={{ color: K.or }}>◈ {rt.identity || 'Router'}</span><br /><span style={{ color: K.mu }} className="font-semibold">{online ? `${rt.board || ''} · RouterOS ${rt.version || ''} · up ${rt.uptime || ''}` : `Router offline${live?.lastSync ? ' · last data ' + since(live.lastSync) : ' - no data yet'}`}</span></div></div>
      <div className="text-center leading-tight"><div className="nv-h1" style={DIG}>EWZ Network Center</div><div className="text-[11px] md:text-[13px] font-bold tracking-[.4em] uppercase mt-1" style={{ color: K.or }}>Online supervision system</div></div>
      <div className="text-right text-[11px] font-bold leading-tight"><span style={{ color: conn && online ? K.gr : K.rd }}>● {conn ? (online ? 'LIVE' : 'ROUTER OFFLINE') : 'RECONNECTING'}</span><br /><span style={{ color: K.mu, ...DIG, fontSize: 10.5 }} className="font-semibold tabular-nums">{now.toLocaleDateString()} {now.toLocaleTimeString([], { hour12: false })}</span></div>
    </div>

    <div className="nv-grid">
      <P title="Network traffic flow" tag={`↓ ${fmtRate(num(last.down))}  ↑ ${fmtRate(num(last.up))}`} className="nv-a"><FlowMap sessions={ss} online={online} rate={num(last.down) + num(last.up)} /></P>
      <P title="Users & devices" tag="LIVE" className="nv-b"><div className="grid grid-cols-[.9fr_1.1fr] gap-2 h-full items-center"><Globe sessions={ss.length} /><Dial p={usersP} value={onl} label="USERS ONLINE" /></div></P>
      <P title="Throughput monitor" tag="download / upload" className="nv-c"><div className="flex flex-col h-full"><div className="flex-1 min-h-0"><Candles hist={hist} /></div>
        <div className="flex gap-4 text-[10px] font-bold pt-1"><span style={{ color: K.cy }}>▮ Rising</span><span style={{ color: K.or }}>▮ Falling</span><span style={{ color: K.bl }}>▬ Upload</span><span style={{ color: '#fff' }}>▬ Users</span><span className="ml-auto" style={{ color: K.mu }}>Users {num(last.users)}</span></div></div></P>

      <P title="Router resources" className="nv-d"><Lines rows={[
        { l: 'CPU load', p: cpu, v: `${cpu}%`, c: K.ye }, { l: 'Memory', p: mem, v: `${mem}%`, c: K.rd }, { l: 'Storage', p: hdd, v: `${hdd}%`, c: '#fff' },
        { l: 'Users', p: usersP, v: `${onl}/${total}`, c: K.or }, { l: 'Data / cap', p: dataPct, v: `${dataPct}%`, c: K.ye }]} /></P>
      <P title={daily.length ? 'Data usage - recent days' : 'Top consumers (data used)'} className="nv-e"><VBars items={bars} fmt={fmtBytes} /></P>
      <P title="Live counters" className="nv-f"><div className="flex items-center justify-around h-full gap-3">
        <div className="text-center"><Digits value={onl} color={K.or} size="nv-big" /><div className="text-[9.5px] font-bold uppercase tracking-[.25em] mt-1" style={{ color: K.mu }}>Users online</div></div>
        <div className="space-y-1.5 text-right">{[['Vouchers', total], ['Devices', num(sm.activeDevices)], ['Leases', leases]].map(([l, v]) => <div key={l} className="flex items-baseline justify-end gap-2"><span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: K.mu }}>{l}</span><Digits value={v} n={4} color={K.or} size="text-base" /></div>)}</div></div></P>

      <P title="Voucher status" className="nv-g"><div className="flex flex-col h-full gap-1"><div className="flex items-start gap-2 flex-1 min-h-0"><div className="nv-num">{String(total).padStart(3, '0')}<small>VOUCHERS</small></div><div className="flex-1 min-w-0 h-full"><Burst p={pct(act, total)} /></div></div>
        <div className="flex justify-between text-[9.5px] font-bold" style={{ ...DIG }}><span style={{ color: K.cy }}>ACT {act}</span><span style={{ color: K.ye }}>EXP {expired}</span><span style={{ color: K.rd }}>OFF {dis}</span></div><Strip p={pct(act, total)} /></div></P>
      <P title="Device network" tag={`${ss.length} live`} className="nv-h"><div className="flex flex-col h-full gap-1"><div className="flex items-baseline gap-4"><div className="nv-num">{ss.length}<small>ONLINE</small></div><div className="nv-num">{leases}<small>LEASES</small></div></div><div className="flex-1 min-h-0"><NodeGraph sessions={ss} online={online} /></div><Strip p={usersP} /></div></P>
      <P title="Health radar" className="nv-i"><div className="flex flex-col h-full gap-1"><div className="flex items-baseline gap-4"><div className="nv-num">{cpu}<small>% CPU</small></div><div className="nv-num">{mem}<small>% MEM</small></div></div><div className="flex-1 min-h-0"><Radar axes={[{ l: 'CPU', p: cpu }, { l: 'MEM', p: mem }, { l: 'DISK', p: hdd }, { l: 'USERS', p: usersP }, { l: 'DATA', p: dataPct }, { l: 'RISK', p: pct(susp, Math.max(onl, 1)) }, { l: 'EXPIRED', p: pct(expired, total) }, { l: 'POOL', p: pct(poolUsed, poolMax) }]} /></div><Strip p={Math.max(cpu, mem)} /></div></P>
      <P title="Risk & capacity" className="nv-j"><div className="flex flex-col h-full gap-1"><div className="flex items-baseline gap-4"><div className="nv-num">{dataPct}<small>% DATA</small></div><div className="nv-num">{susp}<small>ALERTS</small></div></div><div className="flex-1 min-h-0"><Rings rows={[{ l: 'Users online', p: usersP, c: K.or }, { l: 'Data vs cap', p: dataPct, c: K.cy }, { l: 'Suspicious', p: pct(susp, Math.max(onl, 1)), c: K.rd }, { l: 'Disabled', p: pct(dis, total), c: K.mg }]} /></div><Strip p={dataPct} /></div></P>
    </div>
  </div>;
}

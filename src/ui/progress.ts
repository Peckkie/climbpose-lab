// M16 ui — PROGRESS dialog: Flow, % weight on hands and crux gap over time for one route (or all
// routes of a grade), as three small-multiple line charts with a hover/focus tooltip and a table.
import { listSessions } from '../history';
import { progressGroups, progressSeries, type ProgressPoint } from '../history/progress';
import { $ } from './dom';
import { getLang, t } from './i18n';

const NS = 'http://www.w3.org/2000/svg';
const LINE = '#3987e5', SENT = '#c98500', SURFACE = '#111316', GRID = '#24282E', MUTE = '#878D96', TEXT = '#EDEEF0';
let W = 520; // chart width in px, set from the dialog width so text stays readable on phones
const H = 132, PAD = { l: 34, r: 46, t: 10, b: 22 };

type ChartBox = HTMLDivElement & { show?: (i: number | null) => void };
interface Metric { key: 'flow' | 'hands' | 'gap'; max: (pts: ProgressPoint[]) => number; unit: string; }
const METRICS: Metric[] = [
  { key: 'flow', max: () => 100, unit: '' },
  { key: 'hands', max: () => 100, unit: '%' },
  { key: 'gap', max: (pts) => niceMax(Math.max(10, ...pts.map((p) => p.gap ?? 0))), unit: ' cm' },
];
const niceMax = (v: number) => { const s = v <= 50 ? 10 : v <= 100 ? 20 : 50; return Math.ceil(v / s) * s; };

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e); return e;
}
const fmtDate = (d: string, long = false) => new Date(d).toLocaleDateString(getLang() === 'th' ? 'th-TH' : undefined, long ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
const result = (p: ProgressPoint) => (p.flash ? t('hist.flash') : p.sent ? t('prog.sent') : t('prog.notSent'));

/** x positions: by date, or evenly spaced when every session is on the same day. */
function xScale(pts: ProgressPoint[]): (i: number) => number {
  const ts = pts.map((p) => +new Date(p.date)), lo = Math.min(...ts), hi = Math.max(...ts), w = W - PAD.l - PAD.r;
  if (pts.length === 1) return () => PAD.l + w / 2;
  if (hi - lo < 864e5) return (i) => PAD.l + (w * i) / (pts.length - 1);
  return (i) => PAD.l + (w * (ts[i] - lo)) / (hi - lo);
}

function chart(m: Metric, pts: ProgressPoint[], x: (i: number) => number, onHover: (i: number | null, ev?: MouseEvent | FocusEvent) => void): ChartBox {
  const box: ChartBox = document.createElement('div'); box.className = 'prog-chart';
  const h = document.createElement('div'); h.className = 'prog-h'; h.textContent = t(`prog.${m.key}` as 'prog.flow'); box.appendChild(h);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t(`prog.${m.key}` as 'prog.flow') }, box);
  const max = m.max(pts), y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  for (const v of [0, max / 2, max]) {
    el('line', { x1: PAD.l, x2: W - PAD.r + 8, y1: y(v), y2: y(v), stroke: GRID, 'stroke-width': 1 }, svg);
    el('text', { x: PAD.l - 6, y: y(v) + 3.5, 'text-anchor': 'end', fill: MUTE, 'font-size': 10, 'font-family': 'var(--mono)' }, svg).textContent = String(Math.round(v));
  }
  const dl = (i: number, anchor: string) => { const tx = el('text', { x: x(i), y: H - 6, 'text-anchor': anchor, fill: MUTE, 'font-size': 10, 'font-family': 'var(--mono)' }, svg); tx.textContent = fmtDate(pts[i].date); };
  dl(0, pts.length > 1 ? 'start' : 'middle'); if (pts.length > 1) dl(pts.length - 1, 'end');
  const cross = el('line', { y1: PAD.t, y2: H - PAD.b, stroke: MUTE, 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
  // line, broken where a session has no value
  let d = '', pen = false;
  pts.forEach((p, i) => { const v = p[m.key]; if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  if (d) el('path', { d, fill: 'none', stroke: LINE, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  pts.forEach((p, i) => {
    const v = p[m.key]; if (v == null) return;
    const cx = x(i), cy = y(v);
    void (p.sent // sent = amber diamond, otherwise blue dot; both with a surface ring
      ? el('path', { d: `M${cx},${cy - 6}L${cx + 6},${cy}L${cx},${cy + 6}L${cx - 6},${cy}Z`, fill: SENT, stroke: SURFACE, 'stroke-width': 2 }, svg)
      : el('circle', { cx, cy, r: 4.5, fill: LINE, stroke: SURFACE, 'stroke-width': 2 }, svg));
  });
  const last = pts.map((p, i) => [p[m.key], i] as const).filter(([v]) => v != null).pop();
  if (last) el('text', { x: x(last[1]) + 10, y: y(last[0]!) + 4, fill: TEXT, 'font-size': 12, 'font-weight': 600 }, svg).textContent = `${last[0]}${m.unit}`;
  // hit targets: a full-height band per session (bigger than the mark), focusable for keyboard users
  pts.forEach((p, i) => {
    const a = i ? (x(i - 1) + x(i)) / 2 : PAD.l - 6, b = i < pts.length - 1 ? (x(i) + x(i + 1)) / 2 : W - PAD.r + 8;
    const r = el('rect', { x: a, y: 0, width: Math.max(1, b - a), height: H, fill: 'transparent', tabindex: 0, 'aria-label': `${fmtDate(p.date, true)}: ${p[m.key] ?? '–'}${m.unit} · ${result(p)}` }, svg);
    r.addEventListener('mousemove', (e) => onHover(i, e)); r.addEventListener('focus', (e) => onHover(i, e));
    r.addEventListener('mouseleave', () => onHover(null)); r.addEventListener('blur', () => onHover(null));
  });
  box.show = (i) => {
    if (i == null) { cross.setAttribute('visibility', 'hidden'); return; }
    cross.setAttribute('x1', String(x(i))); cross.setAttribute('x2', String(x(i))); cross.setAttribute('visibility', 'visible');
  };
  return box;
}

function tableView(pts: ProgressPoint[]): HTMLElement {
  const det = document.createElement('details'), sum = document.createElement('summary'); sum.textContent = t('prog.table'); det.appendChild(sum);
  const tb = document.createElement('table'); tb.className = 'prog-table';
  const tr = (cells: string[], th = false) => { const r = tb.insertRow(); for (const c of cells) { const e = document.createElement(th ? 'th' : 'td'); e.textContent = c; r.appendChild(e); } };
  tr([t('prog.date'), 'Flow', t('prog.handsShort'), t('prog.gapShort'), t('prog.attempts'), t('prog.result')], true);
  for (const p of pts.slice().reverse()) tr([fmtDate(p.date, true), String(p.flow), p.hands != null ? `${p.hands}%` : '–', p.gap != null ? `${p.gap} cm` : '–', String(p.attempts), result(p)]);
  det.appendChild(tb); return det;
}

async function render(groupId?: string): Promise<void> {
  const body = $<HTMLElement>('#progBody'), selEl = $<HTMLSelectElement>('#progGroup');
  const list = await listSessions(), groups = progressGroups(list);
  body.replaceChildren();
  W = Math.round(Math.min(560, Math.max(280, body.clientWidth || 520)));
  if (!groups.length) { selEl.style.display = 'none'; const n = document.createElement('p'); n.className = 'note'; n.textContent = t('prog.none'); body.appendChild(n); return; }
  selEl.style.display = '';
  selEl.replaceChildren(...groups.map((g) => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.kind === 'grade' ? t('prog.grade', { g: g.label, n: g.count }) : `${g.label} (${g.count})`; return o; }));
  selEl.value = groupId && groups.some((g) => g.id === groupId) ? groupId : groups[0].id;
  const pts = progressSeries(list, selEl.value), x = xScale(pts);
  const tip = document.createElement('div'); tip.className = 'prog-tip'; tip.setAttribute('role', 'status');
  const key = document.createElement('div'); key.className = 'prog-key';
  key.innerHTML = `<span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="${LINE}"/></svg> ${t('prog.keySession')}</span><span><svg width="14" height="14"><path d="M7,1L13,7L7,13L1,7Z" fill="${SENT}"/></svg> ${t('prog.keySent')}</span>`;
  body.appendChild(key);
  if (pts.length < 2) { const n = document.createElement('p'); n.className = 'note'; n.textContent = t('prog.one'); body.appendChild(n); }
  const charts: ChartBox[] = [];
  const hover = (i: number | null, ev?: MouseEvent | FocusEvent) => {
    charts.forEach((c) => c.show?.(i));
    if (i == null) { tip.style.display = 'none'; return; }
    const p = pts[i];
    tip.replaceChildren();
    const b = document.createElement('b'); b.textContent = fmtDate(p.date, true); tip.appendChild(b);
    for (const line of [`Flow ${p.flow}`, `${t('prog.handsShort')} ${p.hands != null ? `${p.hands}%` : '–'}`, `${t('prog.gapShort')} ${p.gap != null ? `${p.gap} cm` : '–'}`, `${t('prog.attempts')} ${p.attempts} · ${result(p)}`]) {
      const d = document.createElement('div'); d.textContent = line; tip.appendChild(d);
    }
    tip.style.display = 'block';
    const host = body.getBoundingClientRect(), tgt = (ev?.target as Element | undefined)?.getBoundingClientRect();
    const cx = ev instanceof MouseEvent ? ev.clientX : tgt ? tgt.left + tgt.width / 2 : host.left;
    const cy = ev instanceof MouseEvent ? ev.clientY : tgt ? tgt.top + 20 : host.top;
    const left = cx - host.left + 14, w = tip.offsetWidth;
    tip.style.left = `${left + w > host.width ? cx - host.left - w - 14 : left}px`;
    tip.style.top = `${cy - host.top + 10}px`;
  };
  for (const m of METRICS) { const c = chart(m, pts, x, hover); charts.push(c); body.appendChild(c); }
  body.appendChild(tip); body.appendChild(tableView(pts));
}

export function openProgress(groupId?: string): void {
  const d = $<HTMLDialogElement>('#progress');
  if (!d.open) d.showModal();
  void render(groupId);
}

/** Show the header button only when some saved session has route info. */
export async function refreshProgressButton(): Promise<void> {
  $<HTMLButtonElement>('#progOpen').style.display = progressGroups(await listSessions()).length ? '' : 'none';
}

export function initProgress(): void {
  $<HTMLButtonElement>('#progOpen').onclick = () => openProgress();
  void refreshProgressButton();
  const d = $<HTMLDialogElement>('#progress');
  $<HTMLButtonElement>('#progClose').onclick = () => d.close();
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  $<HTMLSelectElement>('#progGroup').onchange = (e) => { void render((e.target as HTMLSelectElement).value); };
}

// M17 ui — sidebar report: Flow score, metric cards, attempts (with result override), crux breakdown.
import { clamp01, fmt } from '../util';
import { S } from '../app/store';
import { gotoCrux, process } from '../app/actions';
import { $ } from './dom';
import { envMode } from './environment-panel';
import { envText } from '../environment';
import { renderHistory, saveCurrentSession } from './history-panel';
import { t, getLang, type Key } from './i18n';
import { sayCue, sayTip } from '../coaching';
import { openGuide, TIP_FOR } from './guide';
import { exportCruxSequence } from './export-panel';

export function renderStats(): void {
  const el = $<HTMLElement>('#stats'), D = S.D;
  if (!D) { el.innerHTML = `<div class="note">${t('report.empty')}</div>`; return; }
  const M = D.M, sc = D.sc, E = envText(envMode()), f = (v: number, d = 1) => isFinite(v) ? v.toFixed(d) : '–';
  const card = (k: string, v: string, score: number | null, desc: string) =>
    `<div class="m"><div class="k"><span>${k}</span>${score != null ? `<span>${Math.round(score * 100)}</span>` : ''}</div><div class="v">${v}</div>${score != null ? `<div class="meter"><i style="width:${Math.round(score * 100)}%"></i></div>` : ''}<p>${desc}</p></div>`;
  const attempts = D.attempts.length ? D.attempts.map((a) => `#${a.n} · ${fmt(D.t0 + a.i0 / D.fps)} · ${a.dur.toFixed(1)} s · <b style="color:${a.sent ? '#FFD23F' : 'var(--bad)'}">${a.sent ? E.sent : t('att.notSent')}</b>${a.lastHold ? ` · ${a.sent ? t('att.top') : t('att.last')} ${t('att.hold')} #${a.lastHold.n}${isFinite(a.lastHoldM as number) ? ' (' + (a.lastHoldM as number).toFixed(1) + ' m)' : ''}` : ''} · ${a.end}
    <select data-att="${a.n}" style="margin-left:6px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;font-size:11px"><option value="auto"${a.override === 'auto' ? ' selected' : ''}>${t('att.auto')}${a.sentAuto ? t('att.autoSent') : t('att.autoNot')}</option><option value="sent"${a.override === 'sent' ? ' selected' : ''}>${t('att.sent')}</option><option value="fail"${a.override === 'fail' ? ' selected' : ''}>${t('att.fail')}</option></select>`).join('<br>')
    : t('m.attempts.none');
  const wall = M.wallDeg > 0 ? t('m.load.overhang', { d: M.wallDeg }) : M.wallDeg < 0 ? t('m.load.slab') : t('m.load.vertical');
  const issues = D.quality, warns = issues.filter((q) => q.level === 'warn');
  const quality = `<div class="m" style="border-color:${warns.length ? '#FFB020' : 'var(--line)'}"><div class="k"><span>${t('q.title')}</span><span>${warns.length ? '⚠ ' + warns.length : '✓'}</span></div>
    <p>${warns.length ? '' : `<span style="color:#3DDC97">●</span> ${t('q.good')}${issues.length ? '<br>' : ''}`}${issues.map((q) => `<span style="color:${q.level === 'warn' ? '#FFB020' : 'var(--mute)'}">●</span> ${t(`q.${q.id}` as Key, { v: q.value, v2: q.value2 ?? '' })}${TIP_FOR[q.id] ? ` <a href="#" data-guide="${TIP_FOR[q.id]}" style="color:var(--accent)">${t('q.fix')}</a>` : ''}`).join('<br>')}</p></div>`;
  el.innerHTML = quality + `<div class="score"><div class="big">${M.flow}</div><div><b>${t('report.flow')}</b><br><small>${t('report.tracked', { p: Math.round(M.coverage * 100) })}</small></div></div>
  <div class="metrics">
  ${card(t('m.fluency'), f(M.ldlj, 2), sc.fluency, t('m.fluency.d'))}
  ${card(t('m.path'), f(M.gie, 2), sc.path, t('m.path.d'))}
  ${card(t('m.arms'), isFinite(M.straightArm) ? Math.round(M.straightArm * 100) + '%' : '–', sc.arms, t('m.arms.d'))}
  ${card(t('m.feet'), t('m.feet.v', { f: M.footMoves, h: M.handMoves, r: f(M.footHand, 2) }), sc.feet, t('m.feet.d', { hh: M.handHolds, fh: M.footHolds }))}
  ${card(t('m.attempts'), t('m.attempts.v', { n: M.attempts, s: M.sends }), null, attempts)}
  ${card(t('m.high'), t('m.high.v', { f: f(M.highFootM, 2), c: f(M.ascentM, 2), s: f(M.vSpeed, 1) }), null, t('m.high.d'))}
  ${card(t('m.load'), isFinite(M.handShare) ? t('m.load.v', { h: Math.round(M.handShare * 100), k: Math.round(M.peakHandKg), nm: Math.round(M.peakShoulderNm) }) : '–', isFinite(M.handShare) ? clamp01(1 - (M.handShare - 0.25) / 0.5) : null,
    t('m.load.d', { kg: M.bodyKg, assumed: M.bodyKgAssumed ? t('m.load.assumed') : '', wall, pct: isFinite(M.highLoadPct) ? t('m.load.pctOf', { p: Math.round(M.highLoadPct * 100) }) : '–' }))}
  ${card(t('m.move'), t('m.move.v', { m: Math.round((1 - M.immobility) * 100), r: Math.round(M.immobility * 100), n: M.moves }), null, t('m.move.d'))}
  ${card(t('m.straight'), f(M.straightness, 2), null, t('m.straight.d'))}
  </div>
  <h3 style="margin-top:18px"><span>✕</span> ${t('crux.title')}</h3>
  ${D.cruxes.length ? D.cruxes.map((c, k) => `<div class="m"><div class="k"><span>${t('crux.att', { n: c.att, t: fmt(D.t0 + c.i / D.fps) })}</span><span style="display:flex;gap:6px"><button class="btn small" data-seq="${k}">${t('crux.seq')}</button><button class="btn small" data-crux="${k}">${t('crux.go')}</button></span></div>
    <p>${c.cues.map((q) => `<span style="color:${q.bad ? 'var(--bad)' : '#3DDC97'}">●</span> ${sayCue(q.id, q.p, getLang())}`).join('<br>')}</p>${c.tipKeys.length ? `<p style="color:var(--text)">${c.tipKeys.map((k) => `<b style="color:var(--accent)">${t('crux.try')}</b> ${sayTip(k.id, k.p, getLang())}`).join('<br>')}</p>` : ''}</div>`).join('') : `<div class="note">${t('crux.none')}</div>`}
  <div class="note">${t('crux.note')}</div>`;
  el.insertAdjacentHTML('beforeend', `<h3 style="margin-top:18px"><span>⟲</span> ${t('hist.title')}</h3><button class="btn small" id="saveSess">${t('hist.save')}</button><div id="hist"></div>`);
  $<HTMLButtonElement>('#saveSess').onclick = saveCurrentSession; renderHistory();
  el.querySelectorAll<HTMLAnchorElement>('[data-guide]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openGuide(a.dataset.guide); }));
  el.querySelectorAll<HTMLButtonElement>('[data-seq]').forEach((b) => (b.onclick = () => exportCruxSequence(+b.dataset.seq!)));
  el.querySelectorAll<HTMLButtonElement>('[data-crux]').forEach((b) => (b.onclick = () => gotoCrux(+b.dataset.crux!)));
  el.querySelectorAll<HTMLSelectElement>('[data-att]').forEach((sel) => (sel.onchange = () => {
    const n = sel.dataset.att!;
    if (sel.value === 'auto') delete S.attemptResult[n]; else S.attemptResult[n] = sel.value as 'sent' | 'fail';
    process();
  }));
}

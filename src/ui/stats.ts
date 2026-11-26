// M17 ui — sidebar report: Flow score, metric cards, attempts (with result override), crux breakdown.
import { clamp01, fmt } from '../util';
import { S } from '../app/store';
import { gotoCrux, process } from '../app/actions';
import { $ } from './dom';
import { envMode } from './environment-panel';
import { envText } from '../environment';
import { renderHistory, saveCurrentSession } from './history-panel';

export function renderStats(): void {
  const el = $<HTMLElement>('#stats'), D = S.D;
  if (!D) { el.innerHTML = '<div class="note">Analyze a video and the efficiency metrics will appear here</div>'; return; }
  const M = D.M, sc = D.sc, E = envText(envMode()), f = (v: number, d = 1) => isFinite(v) ? v.toFixed(d) : '–';
  const card = (k: string, v: string, score: number | null, desc: string) =>
    `<div class="m"><div class="k"><span>${k}</span>${score != null ? `<span>${Math.round(score * 100)}</span>` : ''}</div><div class="v">${v}</div>${score != null ? `<div class="meter"><i style="width:${Math.round(score * 100)}%"></i></div>` : ''}<p>${desc}</p></div>`;
  const attempts = D.attempts.length ? D.attempts.map((a) => `#${a.n} · ${fmt(D.t0 + a.i0 / D.fps)} · ${a.dur.toFixed(1)} s · <b style="color:${a.sent ? '#FFD23F' : 'var(--bad)'}">${a.sent ? E.sent : 'not sent'}</b>${a.lastHold ? ` · ${a.sent ? 'top' : 'last'} hold #${a.lastHold.n}${isFinite(a.lastHoldM as number) ? ' (' + (a.lastHoldM as number).toFixed(1) + ' m)' : ''}` : ''} · ${a.end}
    <select data-att="${a.n}" style="margin-left:6px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;font-size:11px"><option value="auto"${a.override === 'auto' ? ' selected' : ''}>Auto${a.sentAuto ? ' (sent)' : ' (not sent)'}</option><option value="sent"${a.override === 'sent' ? ' selected' : ''}>Sent</option><option value="fail"${a.override === 'fail' ? ' selected' : ''}>Not sent</option></select>`).join('<br>')
    : 'No attempt found (both feet never left the floor for 1.5 s)';
  el.innerHTML = `<div class="score"><div class="big">${M.flow}</div><div><b>FLOW SCORE</b><br><small>2D video estimate · climber tracked ${Math.round(M.coverage * 100)}%</small></div></div>
  <div class="metrics">
  ${card('Fluency · LDLJ', f(M.ldlj, 2), sc.fluency, 'Smoothness of the centre of mass; closer to 0 = less jerky')}
  ${card('Path entropy · GIE', f(M.gie, 2), sc.path, 'How much the CoM path wanders; lower = more direct climbing')}
  ${card('Straight-arm rest', isFinite(M.straightArm) ? Math.round(M.straightArm * 100) + '%' : '–', sc.arms, 'Share of rest time on a straight arm — hanging on bone, saving energy')}
  ${card('Foot : Hand', `${M.footMoves} : ${M.handMoves} moves  (${f(M.footHand, 2)})`, sc.feet, `Foot moves per hand move (re-gripping the same hold is not a move); strong climbers move their feet a lot. ${M.handHolds} hand holds · ${M.footHolds} footholds used.`)}
  ${card('Attempts', `${M.attempts} · ${M.sends} sent`, null, attempts)}
  ${card('High point', `feet ${f(M.highFootM, 2)} m · CoM +${f(M.ascentM, 2)} m · ${f(M.vSpeed, 1)} m/min`, null, 'Best attempt: highest foot above the floor, CoM height gained and vertical speed to the high point')}
  ${card('Body load', isFinite(M.handShare) ? `${Math.round(M.handShare * 100)}% on hands · peak ${Math.round(M.peakHandKg)} kg/hand · shoulder ${Math.round(M.peakShoulderNm)} Nm` : '–', isFinite(M.handShare) ? clamp01(1 - (M.handShare - 0.25) / 0.5) : null, `Static estimate for ${M.bodyKg} kg${M.bodyKgAssumed ? ' (ASSUMED — enter body weight for real kg/Nm)' : ''} on a ${M.wallDeg > 0 ? M.wallDeg + '° overhang' : M.wallDeg < 0 ? 'slab' : 'vertical wall'}. Less weight on the hands = feet doing the work. High one-hand load (>50% BW) ${isFinite(M.highLoadPct) ? Math.round(M.highLoadPct * 100) + '% of wall time' : '–'}.`)}
  ${card('Move / Rest', `${Math.round((1 - M.immobility) * 100)}% / ${Math.round(M.immobility * 100)}% · ${M.moves} moves`, null, 'Time moving vs. still (reading the route, resting, chalking)')}
  ${card('Path straightness', f(M.straightness, 2), null, 'Net displacement ÷ distance travelled by the CoM (1 = perfectly straight)')}
  </div>
  <h3 style="margin-top:18px"><span>✕</span> CRUX BREAKDOWN</h3>
  ${D.cruxes.length ? D.cruxes.map((c, k) => `<div class="m"><div class="k"><span>Attempt ${c.att} · ${fmt(D.t0 + c.i / D.fps)}</span><button class="btn small" data-crux="${k}">Go to crux ▸</button></div>
    <p>${c.cues.map((q) => `<span style="color:${q.bad ? 'var(--bad)' : '#3DDC97'}">●</span> ${q.t}`).join('<br>')}</p>${c.tips.length ? `<p style="color:var(--text)">${c.tips.map((t) => `<b style="color:var(--accent)">TRY →</b> ${t}`).join('<br>')}</p>` : ''}</div>`).join('') : '<div class="note">No failed attempt found — crux breakdown needs an attempt that did not top out.</div>'}
  <div class="note">Crux = the frame where the hand reached highest just before coming off. Thresholds (knee &lt;155°, hips &lt;38%, elbow &lt;150°, reach &lt;88%) are a first guess.</div>`;
  el.insertAdjacentHTML('beforeend', '<h3 style="margin-top:18px"><span>⟲</span> HISTORY</h3><button class="btn small" id="saveSess">Save this session</button><div id="hist"></div>');
  $<HTMLButtonElement>('#saveSess').onclick = saveCurrentSession; renderHistory();
  el.querySelectorAll<HTMLButtonElement>('[data-crux]').forEach((b) => (b.onclick = () => gotoCrux(+b.dataset.crux!)));
  el.querySelectorAll<HTMLSelectElement>('[data-att]').forEach((sel) => (sel.onchange = () => {
    const n = sel.dataset.att!;
    if (sel.value === 'auto') delete S.attemptResult[n]; else S.attemptResult[n] = sel.value as 'sent' | 'fail';
    process();
  }));
}

// M17 ui — LABEL card: mark what really happened in the clip (ground truth for npm run eval),
// with keyboard shortcuts, autosave per clip in this browser, and a live comparison with the
// app's own result.
import {
  newLabels, newSession, markStart, markEnd, markCrux, markLastHold, toggleSent, markLr, removeAttempt,
  validateLabels, parseLabels, serializeLabels, LabelError, type LabelSession, type Labels,
} from '../labeling';
import { compareLabels, metrics, predictedAttempts } from '../labeling/compare';
import { download } from '../export/files';
import { store } from '../history/storage';
import { fmt } from '../util';
import { S } from '../app/store';
import { $, setStatus, video } from './dom';
import { t as tr } from './i18n';

let session: LabelSession | null = null;
const key = (clip: string) => `climbpose.labels.${clip}`;
const NAME_KEY = 'climbpose.labeler';
const on = () => $('#lblMode').checked;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** New clip: restore its autosaved labels, or start empty. */
export function onClipLoaded(): void {
  const clip = S.srcName, saved = store.get<string | null>(key(clip), null);
  let L: Labels | null = null;
  if (saved) { try { L = parseLabels(saved); } catch { L = null; } }
  session = newSession(L || newLabels(clip, store.get(NAME_KEY, '')));
  refreshLabels();
}

function save(): void {
  if (!session) return;
  store.set(key(session.labels.clip), serializeLabels(session.labels));
}

function act(f: (s: LabelSession, t: number) => string | void): void {
  if (!session || !video.src) { setStatus(tr('st.loadVideo'), 'err'); return; }
  try { const msg = f(session, video.currentTime); save(); refreshLabels(); if (msg) setStatus(msg, 'ok'); }
  catch (e) { if (e instanceof LabelError) setStatus(tr('st.lblErr', { msg: e.message }), 'err'); else throw e; }
}

const ACTIONS: Record<string, (s: LabelSession, t: number) => string> = {
  start: (s, t) => { markStart(s, t); return tr('st.l.start', { t: fmt(t) }); },
  end: (s, t) => { const a = markEnd(s, t); return tr('st.l.end', { n: s.labels.attempts.indexOf(a) + 1, a: fmt(a.start_s), b: fmt(a.end_s) }); },
  sent: (s, t) => { const a = toggleSent(s.labels, t); return tr('st.l.sent', { n: s.labels.attempts.indexOf(a) + 1, r: a.sent ? tr('lbl.sentWord') : tr('lbl.notSent') }); },
  crux: (s, t) => { const a = markCrux(s.labels, t); return tr('st.l.crux', { n: s.labels.attempts.indexOf(a) + 1, t: fmt(t) }); },
  hold: (s, t) => { const a = markLastHold(s.labels, t); return tr('st.l.hold', { n: s.labels.attempts.indexOf(a) + 1, t: fmt(t) }); },
  lr: (s, t) => { const sp = markLr(s, t); return sp ? tr('st.l.lr', { a: fmt(sp.start_s), b: fmt(sp.end_s) }) : tr('st.l.lrOpen', { t: fmt(t) }); },
};
const KEYS: Record<string, string> = { s: 'start', e: 'end', x: 'sent', c: 'crux', h: 'hold', l: 'lr' };

/** Redraw the card and the strip on the video. */
export function refreshLabels(): void {
  S.labelMarks = on() && session ? {
    attempts: session.labels.attempts.map((a) => ({ s: a.start_s, e: a.end_s, sent: a.sent, crux: a.crux_s ?? null, last: a.last_hold_s ?? null })),
    open: session.openStart, lr: (session.labels.lrErrors || []).map((x) => ({ s: x.start_s, e: x.end_s })), lrOpen: session.openLr?.start_s ?? null,
  } : null;
  const list = $<HTMLElement>('#lblList'), cmp = $<HTMLElement>('#lblCompare');
  if (!session) { list.innerHTML = `<div class="note">${tr('lbl.noVideo')}</div>`; cmp.innerHTML = ''; return; }
  const L = session.labels, t = (x: number) => `<a href="#" data-seek="${x}">${fmt(x)}</a>`;
  $('#lblBy').value = L.labeledBy; $<HTMLSelectElement>('#lblStatus').value = L.status;
  let html = `<div class="note" style="margin:8px 0 4px">${tr('lbl.clip', { clip: esc(L.clip), n: L.attempts.length })}</div>`;
  html += L.attempts.map((a, k) => `<div class="m"><div class="k"><span>#${k + 1} · ${t(a.start_s)} – ${t(a.end_s)} · <b style="color:${a.sent ? '#3DDC97' : 'var(--bad)'}">${a.sent ? tr('lbl.sentWord') : tr('lbl.notSent')}</b></span><a href="#" data-del="${k}" style="color:var(--mute)">✕</a></div>
    <p>${a.crux_s != null ? tr('lbl.cruxAt', { t: t(a.crux_s) }) : a.sent ? '' : tr('lbl.cruxNone')}${a.last_hold_s != null ? tr('lbl.lastAt', { t: t(a.last_hold_s) }) : ''}</p>
    ${a.sent ? '' : `<input type="text" data-reason="${k}" placeholder="${tr('lbl.reasonPh')}" value="${esc(a.fall_reason || '')}" style="width:100%;margin-top:4px">`}</div>`).join('');
  if (session.openStart != null) html += `<div class="note" style="color:var(--accent)">${tr('lbl.open', { t: t(session.openStart) })}</div>`;
  for (const [k, sp] of (L.lrErrors || []).entries()) html += `<div class="note">${tr('lbl.lrSpan', { a: t(sp.start_s), b: t(sp.end_s) })} <a href="#" data-lrdel="${k}" style="color:var(--mute)">✕</a></div>`;
  if (session.openLr) html += `<div class="note" style="color:#FF7A00">${tr('lbl.lrOpen', { t: t(session.openLr.start_s) })}</div>`;
  const warn = validateLabels(L);
  if (warn.length) html += `<div class="note" style="color:var(--bad)">${warn.map(esc).join('<br>')}</div>`;
  list.innerHTML = html;
  list.querySelectorAll<HTMLAnchorElement>('[data-seek]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); video.pause(); S.endCard = 0; video.currentTime = +a.dataset.seek!; }));
  list.querySelectorAll<HTMLAnchorElement>('[data-del]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); removeAttempt(L, +a.dataset.del!); save(); refreshLabels(); }));
  list.querySelectorAll<HTMLAnchorElement>('[data-lrdel]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); L.lrErrors!.splice(+a.dataset.lrdel!, 1); save(); refreshLabels(); }));
  list.querySelectorAll<HTMLInputElement>('[data-reason]').forEach((inp) => (inp.onchange = () => { L.attempts[+inp.dataset.reason!].fall_reason = inp.value.trim(); save(); }));
  // labels vs this app's result
  if (S.D && L.attempts.length) {
    const { rows, sum } = compareLabels(L, predictedAttempts(S.D)), m = metrics(sum);
    cmp.innerHTML = `<div class="note" style="margin-top:10px">${tr('lbl.vs', { tp: sum.tp, n: m.labelledAttempts, fp: sum.fp, s: m.startErrMeanS ?? '–', e: m.endErrMeanS ?? '–', ok: sum.sentOk, sn: sum.sentN, crux: m.cruxLabelled ? tr('lbl.vsCrux', { c: m.cruxErrMeanS ?? '–' }) : '' })}</div>`
      + rows.map((r) => `<div class="note">${r.label != null ? '#' + (r.label + 1) : '—'} · ${tr('lbl.app')}: ${esc(r.predText)}${r.iou != null ? ` · Δstart ${r.startErrS} s · Δend ${r.endErrS} s${r.sentOk ? '' : ` · <b style="color:var(--bad)">${tr('lbl.sentWrong')}</b>`}` : ''}${r.cruxErrS != null ? ` · Δcrux ${r.cruxErrS.toFixed(2)} s` : r.cruxErrS === null ? ` · <b style="color:var(--bad)">${tr('lbl.noCrux')}</b>` : ''}</div>`).join('');
  } else cmp.innerHTML = S.D ? '' : `<div class="note">${tr('lbl.analyzeFirst')}</div>`;
}

export function initLabelPanel(): void {
  $('#lblMode').onchange = () => { $<HTMLElement>('#lblBody').style.display = on() ? 'block' : 'none'; refreshLabels(); };
  document.querySelectorAll<HTMLButtonElement>('[data-lbl]').forEach((b) => (b.onclick = () => act(ACTIONS[b.dataset.lbl!])));
  document.addEventListener('keydown', (e) => {
    if (!on() || e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
    const a = KEYS[e.key.toLowerCase()]; if (!a) return;
    e.preventDefault(); act(ACTIONS[a]);
  });
  $('#lblBy').onchange = () => { if (!session) return; session.labels.labeledBy = $('#lblBy').value.trim(); store.set(NAME_KEY, session.labels.labeledBy); save(); };
  $<HTMLSelectElement>('#lblStatus').onchange = () => { if (!session) return; session.labels.status = $<HTMLSelectElement>('#lblStatus').value as Labels['status']; save(); };
  $<HTMLButtonElement>('#lblSave').onclick = () => {
    if (!session) return;
    const warn = validateLabels(session.labels);
    if (warn.length) setStatus(tr('st.lblSavedProblems', { n: warn.length }), 'err');
    else setStatus(tr('st.lblSaved', { clip: session.labels.clip }), 'ok');
    download(new Blob([serializeLabels(session.labels)], { type: 'application/json' }), `${session.labels.clip}.labels.json`, $<HTMLElement>('#dlArea'));
  };
  $<HTMLButtonElement>('#lblLoad').onclick = () => $('#lblFile').click();
  $('#lblFile').onchange = async (e) => {
    const inp = e.target as HTMLInputElement, f = inp.files?.[0]; inp.value = ''; if (!f || !session) return;
    try {
      const L = parseLabels(await f.text());
      if (L.clip && L.clip !== S.srcName) setStatus(tr('st.lblOther', { a: L.clip, b: S.srcName }), 'err');
      else setStatus(tr('st.lblLoaded', { n: L.attempts.length }), 'ok');
      L.clip = S.srcName; session = newSession(L); save(); refreshLabels();
    } catch (err) { setStatus(tr('st.lblReadErr', { msg: (err as Error).message }), 'err'); }
  };
  $<HTMLButtonElement>('#lblClear').onclick = () => {
    if (!session || !confirm(tr('lbl.clearConfirm', { clip: session.labels.clip }))) return;
    session = newSession(newLabels(session.labels.clip, session.labels.labeledBy)); save(); refreshLabels();
  };
  refreshLabels();
}

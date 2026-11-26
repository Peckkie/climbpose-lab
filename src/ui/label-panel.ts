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
  if (!session || !video.src) { setStatus('Load a video first', 'err'); return; }
  try { const msg = f(session, video.currentTime); save(); refreshLabels(); if (msg) setStatus(msg, 'ok'); }
  catch (e) { if (e instanceof LabelError) setStatus('Label: ' + e.message, 'err'); else throw e; }
}

const ACTIONS: Record<string, (s: LabelSession, t: number) => string> = {
  start: (s, t) => { markStart(s, t); return `Attempt starts at ${fmt(t)} — press E where it ends`; },
  end: (s, t) => { const a = markEnd(s, t); return `Attempt ${s.labels.attempts.indexOf(a) + 1}: ${fmt(a.start_s)} – ${fmt(a.end_s)} (not sent — press X if it was)`; },
  sent: (s, t) => { const a = toggleSent(s.labels, t); return `Attempt ${s.labels.attempts.indexOf(a) + 1}: ${a.sent ? 'SENT' : 'not sent'}`; },
  crux: (s, t) => { const a = markCrux(s.labels, t); return `Crux of attempt ${s.labels.attempts.indexOf(a) + 1} at ${fmt(t)}`; },
  hold: (s, t) => { const a = markLastHold(s.labels, t); return `Last hold of attempt ${s.labels.attempts.indexOf(a) + 1} at ${fmt(t)}`; },
  lr: (s, t) => { const sp = markLr(s, t); return sp ? `Left/right wrong ${fmt(sp.start_s)} – ${fmt(sp.end_s)}` : `Left/right wrong from ${fmt(t)} — press L where it is right again`; },
};
const KEYS: Record<string, string> = { s: 'start', e: 'end', x: 'sent', c: 'crux', h: 'hold', l: 'lr' };

/** Redraw the card and the strip on the video. */
export function refreshLabels(): void {
  S.labelMarks = on() && session ? {
    attempts: session.labels.attempts.map((a) => ({ s: a.start_s, e: a.end_s, sent: a.sent, crux: a.crux_s ?? null, last: a.last_hold_s ?? null })),
    open: session.openStart, lr: (session.labels.lrErrors || []).map((x) => ({ s: x.start_s, e: x.end_s })), lrOpen: session.openLr?.start_s ?? null,
  } : null;
  const list = $<HTMLElement>('#lblList'), cmp = $<HTMLElement>('#lblCompare');
  if (!session) { list.innerHTML = '<div class="note">Load a video to label it.</div>'; cmp.innerHTML = ''; return; }
  const L = session.labels, t = (x: number) => `<a href="#" data-seek="${x}">${fmt(x)}</a>`;
  $('#lblBy').value = L.labeledBy; $<HTMLSelectElement>('#lblStatus').value = L.status;
  let html = `<div class="note" style="margin:8px 0 4px">Clip <b>${esc(L.clip)}</b> · ${L.attempts.length} attempt${L.attempts.length === 1 ? '' : 's'}</div>`;
  html += L.attempts.map((a, k) => `<div class="m"><div class="k"><span>#${k + 1} · ${t(a.start_s)} – ${t(a.end_s)} · <b style="color:${a.sent ? '#3DDC97' : 'var(--bad)'}">${a.sent ? 'SENT' : 'not sent'}</b></span><a href="#" data-del="${k}" style="color:var(--mute)">✕</a></div>
    <p>${a.crux_s != null ? `crux ${t(a.crux_s)}` : a.sent ? '' : 'crux: –'}${a.last_hold_s != null ? ` · last hold ${t(a.last_hold_s)}` : ''}</p>
    ${a.sent ? '' : `<input type="text" data-reason="${k}" placeholder="Why they came off (e.g. hips low, foot slipped)" value="${esc(a.fall_reason || '')}" style="width:100%;margin-top:4px">`}</div>`).join('');
  if (session.openStart != null) html += `<div class="note" style="color:var(--accent)">Attempt open from ${t(session.openStart)} — press E at the end</div>`;
  for (const [k, sp] of (L.lrErrors || []).entries()) html += `<div class="note">L/R wrong ${t(sp.start_s)} – ${t(sp.end_s)} <a href="#" data-lrdel="${k}" style="color:var(--mute)">✕</a></div>`;
  if (session.openLr) html += `<div class="note" style="color:#FF7A00">L/R wrong from ${t(session.openLr.start_s)} — press L where it is right again</div>`;
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
    cmp.innerHTML = `<div class="note" style="margin-top:10px"><b>VS APP RESULT</b> · found ${sum.tp}/${m.labelledAttempts} · extra ${sum.fp} · start err ${m.startErrMeanS ?? '–'} s · end err ${m.endErrMeanS ?? '–'} s · sent/not right ${sum.sentOk}/${sum.sentN}${m.cruxLabelled ? ` · crux err ${m.cruxErrMeanS ?? '–'} s` : ''}</div>`
      + rows.map((r) => `<div class="note">${r.label != null ? '#' + (r.label + 1) : '—'} · app: ${esc(r.predText)}${r.iou != null ? ` · Δstart ${r.startErrS} s · Δend ${r.endErrS} s${r.sentOk ? '' : ' · <b style="color:var(--bad)">sent wrong</b>'}` : ''}${r.cruxErrS != null ? ` · Δcrux ${r.cruxErrS.toFixed(2)} s` : r.cruxErrS === null ? ' · <b style="color:var(--bad)">no crux found</b>' : ''}</div>`).join('');
  } else cmp.innerHTML = S.D ? '' : '<div class="note">Analyze the clip to compare your labels with the app’s result.</div>';
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
    if (warn.length) setStatus(`Saved with ${warn.length} problem${warn.length === 1 ? '' : 's'} — see the LABEL card`, 'err');
    else setStatus(`Labels saved — put ${session.labels.clip}.labels.json in tests/fixtures/ next to its pose fixture`, 'ok');
    download(new Blob([serializeLabels(session.labels)], { type: 'application/json' }), `${session.labels.clip}.labels.json`, $<HTMLElement>('#dlArea'));
  };
  $<HTMLButtonElement>('#lblLoad').onclick = () => $('#lblFile').click();
  $('#lblFile').onchange = async (e) => {
    const inp = e.target as HTMLInputElement, f = inp.files?.[0]; inp.value = ''; if (!f || !session) return;
    try {
      const L = parseLabels(await f.text());
      if (L.clip && L.clip !== S.srcName) setStatus(`Loaded labels for "${L.clip}" onto "${S.srcName}" — check that it is the same clip`, 'err');
      else setStatus(`Loaded ${L.attempts.length} labelled attempts`, 'ok');
      L.clip = S.srcName; session = newSession(L); save(); refreshLabels();
    } catch (err) { setStatus('Could not read labels: ' + (err as Error).message, 'err'); }
  };
  $<HTMLButtonElement>('#lblClear').onclick = () => {
    if (!session || !confirm(`Delete all labels for ${session.labels.clip}? This cannot be undone.`)) return;
    session = newSession(newLabels(session.labels.clip, session.labels.labeledBy)); save(); refreshLabels();
  };
  refreshLabels();
}

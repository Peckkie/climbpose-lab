// M16/M17 ui — HISTORY card: sessions on this route (Flow Δ vs previous) and other recent ones.
// Saved sessions keep their pose track: re-analyse them all with the current code, export /
// import .climbpose.json, and reuse a saved analysis when the same clip is opened again.
import { deleteSession, findSavedForClip, listSessions, makeSaved, parseSessionFile, reanalyse, saveSession, sessionFile, type SavedSession } from '../history';
import { decodeRaw } from '../history/raw';
import { routeKey } from '../route';
import { download } from '../export/files';
import { seekTo } from '../media';
import { APP_VERSION } from '../app/version';
import { S } from '../app/store';
import { process, settings } from '../app/actions';
import { $, setStatus, video } from './dom';
import { routeInfo } from './route-panel';
import { envMode, applyEnv } from './environment-panel';
import { t } from './i18n';
import { openProgress, refreshProgressButton } from './progress';
import { progressGroups } from '../history/progress';

export async function saveCurrentSession(): Promise<void> {
  if (!S.D || !S.raw) return;
  await saveSession(makeSaved(S.D, S.raw, {
    route: routeInfo(), srcName: S.srcName, settings: settings(), env: envMode(),
    edits: { add: S.holdEdits.add, remove: S.holdEdits.remove, attemptResult: S.attemptResult },
    clip: { file: S.srcFile || S.srcName, duration: video.duration }, app: APP_VERSION,
  }));
  await renderHistory(); setStatus(t('hist.saved'), 'ok');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export async function renderHistory(): Promise<void> {
  void refreshProgressButton();
  const box = document.getElementById('hist'); if (!box) return;
  const list = await listSessions(), ri = routeInfo(), key = routeKey(ri);
  const hasRoute = key.replace(/\|/g, '').length > 0 && key !== routeKey({ environment: ri.environment, gym: ri.gym });
  const tools = `<div class="row" style="margin-top:6px;flex-wrap:wrap">${progressGroups(list).length ? `<button class="btn small" id="histProg">${t('prog.open')}</button>` : ''}<button class="btn small" id="histImport">${t('hist.import')}</button>${list.some((x) => x.raw) ? `<button class="btn small" id="histRe">${t('hist.reanalyse')}</button>` : ''}</div>`;
  if (!list.length) { box.innerHTML = `<div class="note">${t('hist.empty')}</div>` + tools; wireTools(box); return; }
  const same = hasRoute ? list.filter((x) => x.key === key) : [], others = list.filter((x) => !same.includes(x)).slice(0, 6);
  const row = (x: SavedSession, prev: SavedSession | null | undefined) => {
    const d = prev ? x.flow - prev.flow : null, lbl = esc([x.route.grade, x.route.tag, x.route.name].filter(Boolean).join(' · ') || x.src);
    const sent = x.attemptsToSend ? ` · <b style="color:#FFD23F">${x.attemptsToSend === 1 ? t('hist.flash') : t('hist.sentIn', { n: x.attemptsToSend })}</b>` : '';
    return `<div class="m"><div class="k"><span>${new Date(x.date).toLocaleDateString()} · ${lbl}</span><span>${x.flow}${d != null ? ` <b style="color:${d >= 0 ? '#3DDC97' : 'var(--bad)'}">${d >= 0 ? '+' : ''}${d}</b>` : ''}</span></div>
      <p>${t('hist.row', { n: x.attempts })}${sent}${x.tops ? t('hist.tops', { n: x.tops }) : ''}${x.handShare != null ? t('hist.hands', { p: x.handShare }) : ''}${x.cruxGapCm != null ? t('hist.gap', { c: x.cruxGapCm }) : ''}
      · ${x.raw ? `<a href="#" data-exp="${esc(x.id)}" style="color:var(--mute)">${t('hist.export')}</a> · ` : ''}<a href="#" data-del="${esc(x.id)}" style="color:var(--mute)">${t('hist.delete')}</a></p></div>`;
  };
  let html = '';
  if (same.length) {
    const sorted = same.slice().sort((a, b) => a.date.localeCompare(b.date));
    html += `<div class="note" style="margin:6px 0">${t('hist.thisRoute', { n: same.length })}</div>` + sorted.map((x, k) => row(x, sorted[k - 1])).reverse().join('');
  }
  if (others.length) html += `<div class="note" style="margin:10px 0 6px">${same.length ? t('hist.other') : t('hist.recent')}</div>` + others.map((x) => row(x, null)).join('');
  box.innerHTML = html + tools;
  const byId = new Map(list.map((x) => [x.id, x]));
  box.querySelectorAll<HTMLAnchorElement>('[data-del]').forEach((a) => (a.onclick = async (e) => {
    e.preventDefault(); if (!confirm(t('hist.deleteConfirm'))) return;
    await deleteSession(a.dataset.del!); renderHistory();
  }));
  box.querySelectorAll<HTMLAnchorElement>('[data-exp]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault(); const s = byId.get(a.dataset.exp!); if (!s) return;
    const name = `${s.src}_${s.date.slice(0, 10)}.climbpose.json`;
    download(new Blob([sessionFile(s)], { type: 'application/json' }), name, $<HTMLElement>('#dlArea'));
    setStatus(t('hist.exported', { name }), 'ok');
  }));
  wireTools(box);
}

function wireTools(box: HTMLElement): void {
  const prog = box.querySelector<HTMLButtonElement>('#histProg');
  if (prog) prog.onclick = () => openProgress(routeKey(routeInfo()));
  const imp = box.querySelector<HTMLButtonElement>('#histImport');
  if (imp) imp.onclick = () => $('#histFile').click();
  const re = box.querySelector<HTMLButtonElement>('#histRe');
  if (re) re.onclick = async () => {
    const list = (await listSessions()).filter((x) => x.raw);
    for (const s of list) await saveSession(reanalyse(s, APP_VERSION));
    await renderHistory(); setStatus(t('hist.reanalysed', { n: list.length }), 'ok');
  };
}

/** Clip just loaded: if there is a saved analysis of it, offer it (skips the pose model). */
export async function offerSaved(): Promise<void> {
  const btn = $<HTMLButtonElement>('#useSaved');
  btn.style.display = 'none';
  const s = await findSavedForClip(S.srcFile || S.srcName, video.duration);
  if (!s) return;
  btn.textContent = t('hist.useSaved', { date: new Date(s.date).toLocaleDateString() });
  btn.style.display = 'block';
  btn.onclick = () => useSaved(s);
}

async function useSaved(s: SavedSession): Promise<void> {
  if (!s.raw || !s.settings || S.busy) return;
  $('#height').value = String(s.settings.heightCm); $('#weight').value = s.settings.weightKg ? String(s.settings.weightKg) : '';
  $<HTMLSelectElement>('#wall').value = String(s.settings.wallDeg); $('#lrfix').checked = s.settings.lrFix;
  if (s.env) { $<HTMLSelectElement>('#env').value = s.env; applyEnv(); }
  S.raw = decodeRaw(s.raw); S.cache = {};
  S.holdEdits = { add: s.edits?.add ?? [], remove: s.edits?.remove ?? [] }; S.attemptResult = { ...(s.edits?.attemptResult ?? {}) };
  $('#t0').value = s.raw.t0.toFixed(1); $('#t1').value = s.raw.t1.toFixed(1);
  process();
  await seekTo(video, S.raw.t0);
  $<HTMLButtonElement>('#useSaved').style.display = 'none';
  setStatus(t('hist.usedSaved', { date: new Date(s.date).toLocaleDateString() }), 'ok');
}

export function initHistoryPanel(): void {
  for (const id of ['#gym', '#grade', '#tag', '#rname']) $(id).addEventListener('change', () => { void renderHistory(); });
  $('#histFile').onchange = async (e) => {
    const inp = e.target as HTMLInputElement, f = inp.files?.[0]; inp.value = ''; if (!f) return;
    try { const s = parseSessionFile(await f.text()); await saveSession(s); await renderHistory(); setStatus(t('hist.imported', { name: s.src }), 'ok'); }
    catch (err) { setStatus(t('hist.importErr', { msg: (err as Error).message }), 'err'); }
  };
}

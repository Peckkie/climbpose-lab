// M17 ui — HISTORY card: sessions on this route (Flow Δ vs previous) and other recent ones.
import { deleteSession, listSessions, saveSession, sessionSummary, type Session } from '../history';
import { routeKey } from '../route';
import { S } from '../app/store';
import { $, setStatus } from './dom';
import { routeInfo } from './route-panel';
import { t } from './i18n';

export function saveCurrentSession(): void {
  if (!S.D) return;
  saveSession(sessionSummary(S.D, routeInfo(), S.srcName));
  renderHistory(); setStatus(t('hist.saved'), 'ok');
}

export function renderHistory(): void {
  const box = document.getElementById('hist'); if (!box) return;
  const list = listSessions(), ri = routeInfo(), key = routeKey(ri);
  const hasRoute = key.replace(/\|/g, '').length > 0 && key !== routeKey({ environment: ri.environment, gym: ri.gym });
  if (!list.length) { box.innerHTML = `<div class="note">${t('hist.empty')}</div>`; return; }
  const same = hasRoute ? list.filter((x) => x.key === key) : [], others = list.filter((x) => !same.includes(x)).slice(0, 6);
  const row = (x: Session, prev: Session | null | undefined) => {
    const d = prev ? x.flow - prev.flow : null, lbl = [x.route.grade, x.route.tag, x.route.name].filter(Boolean).join(' · ') || x.src;
    return `<div class="m"><div class="k"><span>${new Date(x.date).toLocaleDateString()} · ${lbl}</span><span>${x.flow}${d != null ? ` <b style="color:${d >= 0 ? '#3DDC97' : 'var(--bad)'}">${d >= 0 ? '+' : ''}${d}</b>` : ''}</span></div>
      <p>${t('hist.row', { n: x.attempts })}${x.tops ? t('hist.tops', { n: x.tops }) : ''}${x.handShare != null ? t('hist.hands', { p: x.handShare }) : ''}${x.cruxGapCm != null ? t('hist.gap', { c: x.cruxGapCm }) : ''} · <a href="#" data-del="${x.id}" style="color:var(--mute)">${t('hist.delete')}</a></p></div>`;
  };
  let html = '';
  if (same.length) {
    const sorted = same.slice().sort((a, b) => a.date.localeCompare(b.date));
    html += `<div class="note" style="margin:6px 0">${t('hist.thisRoute', { n: same.length })}</div>` + sorted.map((x, k) => row(x, sorted[k - 1])).reverse().join('');
  }
  if (others.length) html += `<div class="note" style="margin:10px 0 6px">${same.length ? t('hist.other') : t('hist.recent')}</div>` + others.map((x) => row(x, null)).join('');
  box.innerHTML = html;
  box.querySelectorAll<HTMLAnchorElement>('[data-del]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); deleteSession(a.dataset.del!); renderHistory(); }));
}

export function initHistoryPanel(): void {
  for (const id of ['#gym', '#grade', '#tag', '#rname']) $(id).addEventListener('change', renderHistory);
}

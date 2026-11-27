// M17 ui — phone layout: the side panel becomes a bottom sheet with one tab per section. Tap a tab
// to open that section, tap it again to close. Desktop is untouched (the tab bar is hidden by CSS).
import { applyStatic } from './i18n';

const PHONE = '(max-width: 760px)';
let current = 'src';

export const isPhone = (): boolean => window.matchMedia(PHONE).matches;

function sections(): HTMLElement[] { return [...document.querySelectorAll<HTMLElement>('#sheet section[data-sec]')]; }

function render(open: boolean): void {
  const sheet = document.getElementById('sheet')!;
  sheet.classList.toggle('open', open);
  document.body.classList.toggle('sheet-open', open && isPhone()); // smaller video so it stays visible above the sheet
  for (const s of sections()) s.classList.toggle('cur', s.dataset.sec === current);
  document.querySelectorAll<HTMLButtonElement>('#sheetTabs button').forEach((b) => b.classList.toggle('on', open && b.dataset.sec === current));
}

/** Open a section (on phones; no-op on desktop). */
export function showSection(sec: string): void {
  current = sec;
  if (isPhone()) { render(true); document.querySelector('#sheet .sheet-body')?.scrollTo({ top: 0 }); }
}

export function initSheet(): void {
  const nav = document.getElementById('sheetTabs')!;
  // one tab per section, labelled like the section heading (same i18n key, so it follows the language)
  nav.innerHTML = sections().map((s) => {
    const key = s.querySelector<HTMLElement>('h3 [data-i18n]')?.dataset.i18n ?? '';
    return `<button data-sec="${s.dataset.sec}" data-i18n="${key}">${s.querySelector('h3 [data-i18n]')?.textContent ?? s.dataset.sec}</button>`;
  }).join('');
  applyStatic(nav);
  nav.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
    const open = document.getElementById('sheet')!.classList.contains('open');
    if (open && current === b.dataset.sec) render(false);
    else { current = b.dataset.sec!; render(true); document.querySelector('#sheet .sheet-body')?.scrollTo({ top: 0 }); }
  }));
  render(false);
  // rotating / resizing across the phone width: start closed again
  window.matchMedia(PHONE).addEventListener('change', () => render(false));
}

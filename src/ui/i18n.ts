// M17 ui — Thai / English text for the page (not the video overlay, which stays English: it is part
// of the clip's look and the display font has no Thai). Default: the browser's language.
import { store } from '../history/storage';
import { EN } from './strings-en';
import { TH } from './strings-th';

export type Lang = 'en' | 'th';
export type Key = keyof typeof EN;
const DICT: Record<Lang, Partial<Record<Key, string>>> = { en: EN, th: TH };
const KEY = 'climbpose.lang';

let lang: Lang = store.get<Lang | null>(KEY, null) ?? (typeof navigator !== 'undefined' && /^th\b/i.test(navigator.language) ? 'th' : 'en');
const listeners: (() => void)[] = [];

/** Text for key; {name} placeholders filled from p. Falls back to English. */
export function t(key: Key, p?: Record<string, string | number>): string {
  let s = DICT[lang][key] ?? EN[key];
  if (p) for (const [k, v] of Object.entries(p)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export const getLang = (): Lang => lang;
export function setLang(l: Lang): void {
  lang = l; store.set(KEY, l); applyStatic(); for (const f of listeners) f();
}
/** Re-render dynamic text when the language changes. */
export const onLangChange = (f: () => void): void => { listeners.push(f); };

/** Elements marked in index.html: data-i18n (text), data-i18n-html, data-i18n-ph (placeholder), data-i18n-title. */
export function applyStatic(root: ParentNode = document): void {
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n as Key); });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml as Key); });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh as Key); });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle as Key); });
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
}

export function initLangSwitch(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => (b.onclick = () => setLang(b.dataset.lang as Lang)));
  applyStatic();
}

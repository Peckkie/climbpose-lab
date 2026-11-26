// M17 ui — DOM access and the status line.

/** querySelector, typed as an input by default (most controls are inputs/selects). Elements are
 *  from index.html and always present. */
export const $ = <T extends Element = HTMLInputElement>(sel: string): T => document.querySelector(sel) as T;

export const video = $<HTMLVideoElement>('#vid');
export const cv = $<HTMLCanvasElement>('#cv');
export const ctx = cv.getContext('2d')!;

export type StatusKind = '' | 'ok' | 'busy' | 'err';
export function setStatus(msg: string, cls: StatusKind = ''): void {
  const s = $<HTMLElement>('#status'); s.className = cls; s.querySelector('span')!.textContent = msg;
}

export const num = (sel: string): number => +$(sel).value;
export const checked = (sel: string): boolean => $(sel).checked;

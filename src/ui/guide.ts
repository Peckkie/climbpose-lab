// M17 ui — filming guide: how to record a climb so the analysis works well. Opened from the header,
// the empty screen, and the quality warnings (each warning jumps to the tip that fixes it).
import type { QualityIssue } from '../types';
import { $ } from './dom';

/** Which tip helps with which quality warning. */
export const TIP_FOR: Partial<Record<QualityIssue['id'], string>> = {
  camera: 'steady', edge: 'frame', small: 'size', scale: 'angle', found: 'light', rejected: 'alone',
};

export function openGuide(tip?: string): void {
  const d = $<HTMLDialogElement>('#guide');
  if (!d.open) d.showModal();
  document.querySelectorAll('.tip.hl').forEach((el) => el.classList.remove('hl'));
  const el = tip ? document.getElementById(`tip-${tip}`) : null;
  if (el) { el.classList.add('hl'); el.scrollIntoView({ block: 'center' }); } else d.scrollTo({ top: 0 });
}

export function initGuide(): void {
  const d = $<HTMLDialogElement>('#guide');
  $<HTMLButtonElement>('#guideOpen').onclick = () => openGuide();
  $<HTMLButtonElement>('#guideEmpty').onclick = () => openGuide();
  $<HTMLButtonElement>('#guideClose').onclick = () => d.close();
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // tap outside the box
}

// M17 ui — player: render loop, play / seek / frame step / speed, looks, layers, framing.
import { drawFrame, layoutCanvas, type FrameMode, type ShowKey, type StyleName } from '../render';
import { fmt } from '../util';
import { S, R } from '../app/store';
import { process } from '../app/actions';
import { $, cv, video } from './dom';

function tick(): void {
  if (S.D && !video.paused && video.currentTime >= S.D.t1) {
    video.pause(); S.endCard = performance.now();
    if (S.onClipEnd) { const f = S.onClipEnd; S.onClipEnd = null; f(); }
  }
  if (!S.busy || S.exporting) drawFrame(R);
  const d = video.duration || 0;
  if (!S.dragging && d) $('#seek').value = String(Math.round(1000 * video.currentTime / d));
  $<HTMLElement>('#time').textContent = fmt(video.currentTime) + ' / ' + fmt(d);
  $<HTMLElement>('#play').textContent = video.paused ? '▶' : '❚❚';
  requestAnimationFrame(tick);
}

function stepFrame(d: number): void {
  if (!video.src) return;
  video.pause(); S.endCard = 0;
  const fps = S.D ? S.D.fps : 30;
  video.currentTime = Math.max(0, Math.min(video.duration - 0.01, video.currentTime + d / fps));
}

export function initPlayer(): void {
  $<HTMLButtonElement>('#play').onclick = () => {
    if (!video.src) return;
    if (video.paused) {
      const D = S.D;
      if (video.ended || (D && (video.currentTime >= D.t1 - 0.05 || video.currentTime < D.t0))) video.currentTime = D ? D.t0 : 0;
      S.endCard = 0; video.play();
    } else video.pause();
  };
  $('#seek').oninput = (e) => { S.dragging = true; S.endCard = 0; if (video.duration) video.currentTime = video.duration * +(e.target as HTMLInputElement).value / 1000; };
  $('#seek').onchange = () => { S.dragging = false; };
  $<HTMLButtonElement>('#stepB').onclick = () => stepFrame(-1); $<HTMLButtonElement>('#stepF').onclick = () => stepFrame(1);
  $<HTMLSelectElement>('#rate').onchange = (e) => { video.playbackRate = +(e.target as HTMLSelectElement).value; };
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
    if (e.key === ',') { stepFrame(-1); e.preventDefault(); } else if (e.key === '.') { stepFrame(1); e.preventDefault(); } else if (e.key === ' ') { $<HTMLButtonElement>('#play').click(); e.preventDefault(); }
  });
  video.addEventListener('ended', () => { if (S.D) S.endCard = performance.now(); });
  document.querySelectorAll<HTMLButtonElement>('#styles .chip').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#styles .chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); S.style = b.dataset.style as StyleName;
  }));
  document.querySelectorAll<HTMLInputElement>('[data-show]').forEach((c) => (c.onchange = () => { S.show[c.dataset.show as ShowKey] = c.checked ? 1 : 0; }));
  $<HTMLSelectElement>('#frame').onchange = (e) => {
    S.frame = (e.target as HTMLSelectElement).value as FrameMode;
    if (S.frame === 'reel' && !S.zoom) { S.zoom = 1; $<HTMLSelectElement>('#zoom').value = '1'; }
    layoutCanvas(cv, video, S.frame);
  };
  $<HTMLSelectElement>('#zoom').onchange = (e) => { S.zoom = +(e.target as HTMLSelectElement).value; };
  // settings that change the analysis re-run the core (cleanup stays cached)
  for (const id of ['#height', '#weight', '#wall', '#lrfix']) $(id).onchange = () => { if (S.raw) process(); };
  requestAnimationFrame(tick);
}

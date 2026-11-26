// M17 ui — manual hold tagging: click = hand hold, shift-click = foot hold, click a hold = remove.
import { lerp, fmt } from '../util';
import { viewAt } from '../render';
import { S, R } from '../app/store';
import { process } from '../app/actions';
import { $, cv, setStatus, video } from './dom';

/** Canvas click → wall coordinates at the current frame. */
function canvasToWall(e: MouseEvent) {
  const D = S.D; if (!D) return null;
  const r = cv.getBoundingClientRect();
  const cx = (e.clientX - r.left) * cv.width / r.width, cy = (e.clientY - r.top) * cv.height / r.height;
  const f = Math.max(0, Math.min(D.N - 1.001, (video.currentTime - D.t0) * D.fps - 0.25)), i = Math.floor(f), a = f - i, i1 = Math.min(i + 1, D.N - 1);
  const v = viewAt(R, i, a), ox = lerp(D.oX[i], D.oX[i1], a), oy = lerp(D.oY[i], D.oY[i1], a);
  return { x: (cx - v.ox) / v.s - ox, y: (cy - v.oy) / v.s - oy, i: Math.round(f) };
}

export function initTagging(): void {
  cv.addEventListener('click', (e) => {
    if (!$('#tagMode').checked || !S.D || S.busy) return;
    const w = canvasToWall(e); if (!w) return;
    video.pause(); S.endCard = 0;
    const D = S.D, near = D.holds.find((h) => Math.hypot(h.x - w.x, h.y - w.y) * D.mpp < 0.07);
    if (near) {
      const ai = S.holdEdits.add.findIndex((h) => Math.abs(h.x - near.x) < 1 && Math.abs(h.y - near.y) < 1);
      if (ai >= 0) S.holdEdits.add.splice(ai, 1); else S.holdEdits.remove.push({ x: near.x, y: near.y, kind: near.kind });
      setStatus(`Removed ${near.kind} hold`, 'ok');
    } else {
      const kind = e.shiftKey ? 'foot' : 'hand';
      S.holdEdits.add.push({ limb: 'tag', kind, x: w.x, y: w.y, i0: w.i, i1: Math.min(D.N - 1, w.i + Math.round(D.fps * 0.5)), manual: true });
      setStatus(`Tagged ${kind} hold at ${fmt(video.currentTime)}`, 'ok');
    }
    process();
  });
  $('#tagMode').onchange = () => { cv.style.cursor = $('#tagMode').checked ? 'crosshair' : ''; };
}

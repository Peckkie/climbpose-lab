// M13 export — MP4 with overlays.
// Preferred: render frame by frame from a timeline of segments (seek → draw → WebCodecs H.264 →
// MP4): exact 30 fps, faster than real time, works with the tab hidden.
// Fallback: real-time canvas recording with MediaRecorder.
import type { Analysis, Crux, Send } from '../types';
import { seekTo, clampTime } from '../media';
import { clamp01 } from '../util';
import { drawFrame, routeAttempt, ROUTE_SEC, ROUTE_BUILD, type Renderer, type ViewState } from '../render';

export const OUT_FPS = 30;
const CRUX_FREEZE_S = 3.5, SEND_FREEZE_S = 2.5, END_S = 3.5;
const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs';

export type Segment =
  | { kind: 'clip'; k0: number; k1: number }               // output frames k0..k1-1 of the clip
  | { kind: 'crux'; crux: Crux; frames: number }           // freeze on the crux breakdown
  | { kind: 'send'; send: Send; frames: number }           // freeze on the SENT card
  | { kind: 'route'; i0: number; frames: number }          // route map building up
  | { kind: 'end'; frames: number };                       // report card

/** Clip with freezes after the crux / send frames, then route map and report card. */
export function buildTimeline(D: Analysis, o: { freezes: boolean; fps?: number }): Segment[] {
  const FPS = o.fps ?? OUT_FPS, nClip = Math.round((D.t1 - D.t0) * FPS);
  const at = (i: number) => Math.round((i + 0.25) / D.fps * FPS);
  // one freeze per output frame; a send on the same frame as a crux wins (as in v0.2)
  const freezeAt = new Map<number, Segment>();
  if (o.freezes) {
    for (const c of D.cruxes) freezeAt.set(at(c.i), { kind: 'crux', crux: c, frames: Math.round(CRUX_FREEZE_S * FPS) });
    for (const s of D.sends) freezeAt.set(at(s.i), { kind: 'send', send: s, frames: Math.round(SEND_FREEZE_S * FPS) });
  }
  const out: Segment[] = [];
  let k0 = 0;
  for (const k of [...freezeAt.keys()].filter((k) => k >= 0 && k < nClip).sort((a, b) => a - b)) {
    out.push({ kind: 'clip', k0, k1: k + 1 }, freezeAt.get(k)!); k0 = k + 1;
  }
  if (k0 < nClip) out.push({ kind: 'clip', k0, k1: nClip });
  const ra = routeAttempt(D);
  if (ra) out.push({ kind: 'route', i0: ra.i0, frames: Math.round(ROUTE_SEC * FPS) });
  out.push({ kind: 'end', frames: Math.round(END_S * FPS) });
  return out;
}

export const segmentFrames = (s: Segment): number => s.kind === 'clip' ? s.k1 - s.k0 : s.frames;

export interface ExportProgress { (frame: number, total: number, etaS: number): void; }

export async function renderOffline(r: Renderer, onProgress?: ExportProgress): Promise<Blob> {
  const { Muxer, ArrayBufferTarget } = await import(/* @vite-ignore */ MUXER_URL);
  const { cv, video, s } = r, D = s.D!, W = cv.width, H = cv.height, FPS = OUT_FPS;
  let cfg: VideoEncoderConfig | null = null;
  for (const codec of ['avc1.640033', 'avc1.4d0033', 'avc1.42003e']) {
    const c = { codec, width: W, height: H, bitrate: 14e6, framerate: FPS };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch { /* try next */ }
  }
  if (!cfg) throw new Error('no H.264 encoder available');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
  let encErr: unknown = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  enc.configure(cfg);
  const timeline = buildTimeline(D, { freezes: !!s.show.crux, fps: FPS });
  const total = timeline.reduce((n, seg) => n + segmentFrames(seg), 0), tStart = performance.now();
  let n = 0;
  const emit = async () => {
    if (encErr) throw encErr;
    const fr = new VideoFrame(cv, { timestamp: Math.round(n * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(fr, { keyFrame: n % 60 === 0 }); fr.close(); n++;
    while (enc.encodeQueueSize > 6) await new Promise((res) => setTimeout(res, 4));
    if (n % 15 === 0) { const el = (performance.now() - tStart) / 1000; onProgress?.(n, total, el / n * (total - n)); }
  };
  const seekFrame = (i: number) => seekTo(video, clampTime(video, D.t0 + (i + 0.25) / D.fps));
  try {
    for (const seg of timeline) {
      if (seg.kind === 'clip') {
        for (let k = seg.k0; k < seg.k1; k++) {
          // a quarter into the frame, like the analysis pass (a frame boundary can show the previous frame)
          const t = D.t0 + (k + 0.25) / FPS; await seekTo(video, clampTime(video, t)); s.endCardAlpha = 0; drawFrame(r, t); await emit();
        }
      } else if (seg.kind === 'crux' || seg.kind === 'send') {
        const i = seg.kind === 'crux' ? seg.crux.i : seg.send.i, tc = D.t0 + (i + 0.25) / D.fps;
        await seekFrame(i);
        if (seg.kind === 'crux') s.cruxFreeze = seg.crux; else s.sendFreeze = seg.send;
        for (let q = 0; q < seg.frames; q++) { drawFrame(r, tc); await emit(); }
        s.cruxFreeze = null; s.sendFreeze = null;
      } else if (seg.kind === 'route') {
        // route map over the frame where the attempt starts (climber at the bottom, route clear above)
        s.routeBg = seg.i0; await seekFrame(seg.i0);
        for (let q = 0; q < seg.frames; q++) { s.routeProg = clamp01(q / (ROUTE_BUILD * FPS)); s.endCardAlpha = null; drawFrame(r, D.t1); await emit(); }
      } else {
        for (let q = 0; q < seg.frames; q++) { s.routeProg = null; s.endCardAlpha = clamp01(q / (0.5 * FPS)); drawFrame(r, D.t1); await emit(); }
      }
    }
    await enc.flush();
  } finally {
    s.endCardAlpha = null; s.routeProg = null; s.routeBg = null; s.cruxFreeze = null; s.sendFreeze = null;
    try { enc.close(); } catch { /* already closed */ }
  }
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

export interface RealtimeState extends ViewState { exporting: boolean; onClipEnd: (() => void) | null; }

/** Plays the clip and records the canvas (needs the tab visible). */
export async function recordRealtime(r: Renderer & { s: RealtimeState }, onStart?: () => void): Promise<Blob> {
  const { cv, video, s } = r;
  const types = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('this browser cannot record a canvas — try Chrome');
  s.exporting = true; s.endCard = 0; await seekTo(video, s.D!.t0);
  const rec = new MediaRecorder(cv.captureStream(30), { mimeType: mime, videoBitsPerSecond: 14e6 });
  const chunks: Blob[] = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => (rec.onstop = res));
  rec.start(250); onStart?.();
  const clipDone = new Promise<void>((res) => {
    s.onClipEnd = res;
    video.addEventListener('ended', () => { if (s.onClipEnd) { s.onClipEnd = null; s.endCard = performance.now(); res(); } }, { once: true });
  });
  await video.play(); await clipDone;
  await new Promise((res) => setTimeout(res, ((routeAttempt(s.D) ? ROUTE_SEC : 0) + END_S) * 1000));
  rec.stop(); await stopped; s.exporting = false;
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  if (!blob.size) throw new Error('the recording came out empty (was the tab hidden?)');
  return blob;
}

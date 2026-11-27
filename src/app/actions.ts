// M00 app — actions: load a clip, analyse it, re-run the core after edits.
import type { Settings } from '../types';
import { runPipeline } from '../core/pipeline';
import type { ModelKind } from '../pose';
import { extractTrack, Cancelled } from '../pose/extract';
import { seekTo } from '../media';
import { drawFrame, layoutCanvas } from '../render';
import { $, checked, num, setStatus, video, cv } from '../ui/dom';
import { renderStats } from '../ui/stats';
import { updatePhotoInfo } from '../ui/route-panel';
import { applyEnv, envMode, runEnvDetection } from '../ui/environment-panel';
import { onClipLoaded, refreshLabels } from '../ui/label-panel';
import { S, R } from './store';
import { t } from '../ui/i18n';

const RESULT_BUTTONS = ['#rec', '#csv', '#json', '#fixture'];

export function settings(): Settings {
  const w = num('#weight');
  return { heightCm: num('#height') || 170, weightKg: w > 0 ? w : null, wallDeg: num('#wall') || 0, lrFix: checked('#lrfix') };
}

/** Run the analysis core on the current pose track (cached cleanup makes edits fast). */
export function process(): void {
  if (!S.raw) return;
  S.D = runPipeline({ raw: S.raw, settings: settings(), env: envMode(), cache: S.cache,
    edits: { add: S.holdEdits.add, remove: S.holdEdits.remove, attemptResult: S.attemptResult } });
  renderStats(); refreshLabels();
  for (const id of RESULT_BUTTONS) $(id).disabled = false;
}

export function lockUI(on: boolean): void {
  for (const id of ['#analyze', ...RESULT_BUTTONS, '#play', '#seek']) $(id).disabled = on || (RESULT_BUTTONS.includes(id) && !S.D);
  document.querySelectorAll<HTMLInputElement>('#styles .chip,#frame,#zoom,#file,#loadUrl,[data-show]').forEach((el) => (el.disabled = on));
}

export function loadSrc(src: string, name: string, cors: boolean): void {
  S.attemptResult = {}; S.raw = null; S.cache = {}; S.D = null; S.livePose = null; S.routePhoto = null; S.holdEdits = { add: [], remove: [] };
  updatePhotoInfo(); renderStats();
  video.removeAttribute('crossorigin');
  if (cors) video.crossOrigin = 'anonymous';
  video.src = src;
  S.srcFile = (name || 'clip').split(/[\\/]/).pop()!.slice(0, 60);
  S.srcName = (name || 'clip').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40);
  onClipLoaded();
  setStatus(t('st.loading'), 'busy');
  video.onloadedmetadata = () => {
    $<HTMLElement>('#empty').style.display = 'none';
    layoutCanvas(cv, video, S.frame);
    $('#analyze').disabled = false;
    $('#t0').value = '0'; $('#t1').value = Math.min(video.duration, 60).toFixed(1); $('#t1').max = video.duration.toFixed(1);
    setStatus(t('st.videoReady', { w: video.videoWidth, h: video.videoHeight, d: video.duration.toFixed(1) }), 'ok');
    S.envDetected = null; applyEnv(); runEnvDetection();
  };
  video.onerror = () => setStatus(t('st.videoErr'), 'err');
}

let abort: AbortController | null = null;
const analyzeBtn = () => $<HTMLButtonElement>('#analyze');

/** M01 media → M02 pose + M03 camera → core. While running, the Analyze button cancels. */
export async function analyze(): Promise<void> {
  if (S.busy) { if (abort) { abort.abort(); setStatus(t('st.cancelling'), 'busy'); } return; }
  S.busy = true; lockUI(true);
  abort = new AbortController();
  const btn = analyzeBtn(); btn.disabled = false; btn.textContent = t('src.cancel');
  const bar = $<HTMLElement>('#bar');
  try {
    const kind = $<HTMLSelectElement>('#model').value as ModelKind;
    setStatus(t('st.loadModel', { kind }), 'busy');
    video.pause(); bar.style.display = 'block';
    let tStart = 0, mode = '';
    const vw = video.videoWidth, vh = video.videoHeight;
    const { raw, found } = await extractTrack({
      video, model: kind, fps: num('#fps'), t0: num('#t0') || 0, t1: num('#t1') || video.duration, camera: checked('#camcomp'), signal: abort.signal,
      onMode: (m) => { mode = m; tStart = performance.now(); },
      onFrame: (i, N, nFound, lm) => {
        S.livePose = lm ? lm.map((p) => ({ x: p.x * vw, y: p.y * vh, v: p.visibility ?? 1 })) : null;
        if (i % 2 === 0) {
          drawFrame(R, -1);
          $<HTMLElement>('#bar i').style.width = (100 * (i + 1) / N).toFixed(1) + '%';
          const el = (performance.now() - tStart) / 1000, eta = el / (i + 1) * (N - i - 1);
          setStatus(t('st.analyzing', { i: i + 1, n: N, p: Math.round(100 * nFound / (i + 1)), eta: Math.ceil(eta) }), 'busy');
        }
      },
    });
    S.livePose = null; S.raw = raw; S.cache = {};
    const N = raw.N;
    if (found < N * 0.2) setStatus(t('st.fewFound', { p: Math.round(100 * found / N) }), 'err');
    process();
    const nWarn = S.D ? S.D.quality.filter((q) => q.level === 'warn').length : 0;
    if (found >= N * 0.2) setStatus(nWarn ? t('st.doneWarn', { p: Math.round(100 * found / N), n: nWarn }) : t('st.done', { p: Math.round(100 * found / N) }), 'ok');
    await seekTo(video, raw.t0);
  } catch (e) {
    S.livePose = null;
    if (e instanceof Cancelled) setStatus(S.D ? t('st.cancelledKeep') : t('st.cancelled'), 'ok');
    else { console.error(e); setStatus(t('st.failed', { msg: (e as Error).message }), 'err'); }
  }
  abort = null; btn.textContent = t('src.analyze');
  bar.style.display = 'none'; S.busy = false; lockUI(false);
}

export async function gotoCrux(k: number): Promise<void> {
  const D = S.D, c = D && D.cruxes[k]; if (!D || !c) return;
  video.pause(); S.endCard = 0; S.show.crux = 1;
  const cb = document.querySelector<HTMLInputElement>('[data-show=crux]'); if (cb) cb.checked = true;
  await seekTo(video, D.t0 + (c.i + 0.25) / D.fps);
}

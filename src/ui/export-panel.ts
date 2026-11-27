// M17 ui — EXPORT card: video with overlays, per-frame CSV, summary JSON, pose fixture (dev).
import { download, framesCsv, poseFixture, summaryJson } from '../export/files';
import { recordRealtime, renderOffline } from '../export/video';
import { renderCruxSequence } from '../export/sequence';
import { routeLabel } from '../route';
import { fmt } from '../util';
import { seekTo } from '../media';
import { APP_VERSION } from '../app/version';
import { S, R } from '../app/store';
import { lockUI } from '../app/actions';
import { $, checked, num, setStatus, video } from './dom';
import { envMode } from './environment-panel';
import { routeInfo } from './route-panel';
import { t } from './i18n';

const save = (blob: Blob, name: string) => download(blob, name, $<HTMLElement>('#dlArea'));

async function exportVideo(): Promise<void> {
  if (!S.D || S.busy || S.exporting) return;
  S.busy = true; lockUI(true); video.pause();
  const bar = $<HTMLElement>('#bar');
  let blob: Blob | null = null, how = '';
  try {
    if (window.VideoEncoder && window.VideoFrame) {
      bar.style.display = 'block';
      try {
        blob = await renderOffline(R, (n, total, eta) => {
          $<HTMLElement>('#bar i').style.width = (100 * n / total).toFixed(1) + '%';
          setStatus(t('st.rendering', { n, total, eta: Math.ceil(eta) }), 'busy');
        });
        how = 'rendered';
      } catch (e) { console.warn('offline render failed, falling back', e); }
      bar.style.display = 'none';
    }
    if (!blob) { S.busy = false; blob = await recordRealtime(R, () => setStatus(t('st.recording'), 'busy')); how = 'recorded'; }
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm', g = routeInfo().grade;
    save(blob, `${S.srcName}${g ? '_' + g.replace(/[^\w+]/g, '') : ''}_climbpose_${S.style}_${S.frame}.${ext}`);
    setStatus(t('st.exported', { how: how === 'rendered' ? t('st.howRendered') : t('st.howRecorded'), mb: (blob.size / 1048576).toFixed(0) }), 'ok');
  } catch (e) { console.error(e); setStatus(t('st.exportFail', { msg: (e as Error).message }), 'err'); }
  S.busy = false; S.exporting = false; lockUI(false); await seekTo(video, S.D.t0);
}

/** One image of the frames before a fall (crux k of the report). */
export async function exportCruxSequence(k: number): Promise<void> {
  const D = S.D, c = D?.cruxes[k];
  if (!D || !c || S.busy || S.exporting) return;
  S.busy = true; lockUI(true); setStatus(t('st.seqMaking'), 'busy');
  try {
    const route = routeLabel(routeInfo()), bad = c.cues.filter((q) => q.bad).map((q) => q.t);
    const blob = await renderCruxSequence(R, c, {
      title: 'CRUX SEQUENCE',
      subtitle: [route || S.srcFile || S.srcName, `ATTEMPT ${c.att}`, `OFF AT ${fmt(D.t0 + c.i / D.fps)}`].join(' · '),
      footer: [...bad, ...c.tips.map((tip) => 'TRY → ' + tip)],
    });
    const name = `${S.srcName}_crux${c.att}_sequence.png`;
    save(blob, name); setStatus(t('st.seqSaved', { name }), 'ok');
  } catch (e) { console.error(e); setStatus(t('st.exportFail', { msg: (e as Error).message }), 'err'); }
  S.busy = false; lockUI(false);
}

export function initExportPanel(): void {
  $<HTMLButtonElement>('#rec').onclick = exportVideo;
  $<HTMLButtonElement>('#csv').onclick = () => {
    if (!S.D) return;
    save(new Blob([framesCsv(S.D)], { type: 'text/csv' }), `${S.srcName}_climbpose_frames.csv`);
  };
  $<HTMLButtonElement>('#json').onclick = () => {
    const D = S.D; if (!D) return;
    const out = summaryJson({
      D, app: `CLIMB/POSE ${APP_VERSION}`, env: envMode(), envDetected: S.envDetected, route: routeInfo(),
      photo: S.routePhoto ? S.routePhoto.kind : 'auto', holdEdits: { added: S.holdEdits.add.length, removed: S.holdEdits.remove.length },
      source: S.srcName, heightCm: num('#height'),
    });
    save(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), `${S.srcName}_climbpose_summary.json`);
  };
  // Developer export: put it in tests/fixtures/ (gzip optional) and run `npm run golden:update`.
  $<HTMLButtonElement>('#fixture').onclick = () => {
    const raw = S.raw; if (!raw || !S.D) return;
    const w = num('#weight');
    const fx = poseFixture({
      raw, clip: S.srcFile || S.srcName, createdWith: APP_VERSION, env: envMode(), envScores: S.envScores,
      settings: { heightCm: num('#height') || 170, fps: raw.fps, model: $<HTMLSelectElement>('#model').value, wallDeg: num('#wall') || 0, weightKg: w > 0 ? w : null, cameraCompensation: checked('#camcomp'), lrFix: checked('#lrfix') },
    });
    save(new Blob([JSON.stringify(fx)], { type: 'application/json' }), `${S.srcName}.pose.json`);
    setStatus(t('st.fixture'), 'ok');
  };
}

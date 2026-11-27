// M00 app — the one mutable state object and the renderer bound to it.
import type { Analysis, Edits, Env, Hold, RawTrack } from '../types';
import type { PipelineCache } from '../core/pipeline';
import type { EnvScores } from '../environment';
import { envText } from '../environment';
import { routeLabel } from '../route';
import type { Renderer } from '../render';
import type { RealtimeState } from '../export/video';
import { cv, ctx, video } from '../ui/dom';
import { envMode } from '../ui/environment-panel';
import { routeInfo } from '../ui/route-panel';

export interface AppState extends RealtimeState {
  raw: RawTrack | null; cache: PipelineCache; D: Analysis | null;
  holdEdits: { add: Hold[]; remove: Edits['remove'] };
  attemptResult: Record<string, 'sent' | 'fail'>;
  srcName: string; srcFile?: string;
  envDetected: Env | null; envScores: EnvScores | null;
  dragging: boolean;
}

export const S: AppState = {
  raw: null, cache: {}, D: null, holdEdits: { add: [], remove: [] }, attemptResult: {},
  srcName: 'clip', envDetected: null, envScores: null, dragging: false,
  style: 'neon', show: { skel: 1, com: 1, limbs: 1, holds: 1, angles: 1, hud: 1, crux: 1, load: 1, ghost: 0 }, frame: 'orig', zoom: 0,
  busy: false, exporting: false, livePose: null, onClipEnd: null,
  endCard: 0, routeProg: null, endCardAlpha: null, cruxFreeze: null, sendFreeze: null, routeBg: null, routePhoto: null, labelMarks: null,
};

export const R: Renderer & { s: AppState } = {
  cv, ctx, video, s: S,
  env: () => envText(envMode()),
  route: () => { const ri = routeInfo(); return { label: routeLabel(ri), tagHex: ri.tagHex, gym: ri.gym }; },
};

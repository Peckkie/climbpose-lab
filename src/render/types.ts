// M12 render — what the renderer reads. The app's store implements ViewState.
import type { Analysis, Crux, Send } from '../types';
import type { EnvText } from '../environment';
import type { Style, StyleName } from './style';

export type ShowKey = 'skel' | 'com' | 'limbs' | 'holds' | 'angles' | 'hud' | 'crux' | 'load';
export type FrameMode = 'orig' | 'reel';

export interface RoutePhoto { kind: 'upload' | 'frame'; el: CanvasImageSource; w: number; h: number; k?: number; t?: number; }
export interface RouteLabels { label: string; tagHex: string | null; gym: string; }
export interface LivePoint { x: number; y: number; v: number; }

export interface ViewState {
  D: Analysis | null;
  style: StyleName; show: Record<ShowKey, number>; frame: FrameMode; zoom: number;
  busy: boolean; livePose: LivePoint[] | null; srcFile?: string;
  // end of clip / export timeline
  endCard: number;                 // performance.now() when the clip ended in the player (0 = not)
  routeProg: number | null;        // export: route map build-up 0..1
  endCardAlpha: number | null;     // export: report card fade
  cruxFreeze: Crux | null; sendFreeze: Send | null;
  routeBg: number | null;          // frame index used as route-map background
  routePhoto: RoutePhoto | null;
}

export interface Renderer {
  cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; video: HTMLVideoElement;
  s: ViewState;
  env(): EnvText;
  route(): RouteLabels;
}

export type P3 = [number, number, number];
export type PFn = (k: number) => P3 | null;
export type TFn = (x: number, y: number) => [number, number];
export interface View { s: number; ox: number; oy: number; }

/** One analysed frame being drawn. */
export interface FrameCtx {
  r: Renderer; ctx: CanvasRenderingContext2D; D: Analysis; st: Style;
  u: number; W: number; H: number;
  t: number; f: number; i: number; a: number; i1: number;
  v: View; T: TFn; Tw: TFn; P: PFn;
  summary: number;                 // report card alpha drawn on top (0 = none)
}

/** A render layer: drawn in list order when `on` says so. */
export interface Layer { name: string; on(fc: FrameCtx): boolean; draw(fc: FrameCtx): void; }

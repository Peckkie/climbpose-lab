// Ground-truth labels for a clip (tests/fixtures/<clip>.labels.json): what really happened, marked
// by a person watching the video. Used to measure accuracy (npm run eval and the app's LABEL card).
// Times are seconds in the source video. Pure: no DOM.

export const LABELS_FORMAT = 'climbpose.labels/1';
export const DEFAULT_TOLERANCE_S = 0.7;

export interface LabelAttempt {
  start_s: number; end_s: number; sent: boolean;
  crux_s?: number | null;        // frame the climber came off from (max reach before falling)
  last_hold_s?: number | null;   // when the top / highest hold was grabbed
  fall_reason?: string;          // why they came off, in the labeller's words
  note?: string;
}
export type LrPart = 'any' | 'arms' | 'legs' | 'shoulders' | 'hips';
export interface LrSpan { start_s: number; end_s: number; part: LrPart; }

export interface Labels {
  format: string; clip: string;
  status: 'draft' | 'confirmed'; labeledBy: string; note?: string;
  toleranceS: number;
  attempts: LabelAttempt[];
  lrErrors?: LrSpan[];           // spans where the skeleton's left/right is wrong
  updated?: string;
}

/** Editing state: labels plus marks that are opened but not closed yet. */
export interface LabelSession { labels: Labels; openStart: number | null; openLr: { start_s: number; part: LrPart } | null; }

export const newLabels = (clip: string, labeledBy = ''): Labels =>
  ({ format: LABELS_FORMAT, clip, status: 'draft', labeledBy, toleranceS: DEFAULT_TOLERANCE_S, attempts: [], lrErrors: [] });

export const newSession = (labels: Labels): LabelSession => ({ labels, openStart: null, openLr: null });

const r2 = (t: number) => Math.round(t * 100) / 100;
const sortAttempts = (L: Labels) => L.attempts.sort((a, b) => a.start_s - b.start_s);

export class LabelError extends Error {}

/** Index of the attempt that contains t (or null). */
export function attemptAt(L: Labels, t: number): number | null {
  const k = L.attempts.findIndex((a) => t >= a.start_s - 0.05 && t <= a.end_s + 0.05);
  return k >= 0 ? k : null;
}

export function markStart(s: LabelSession, t: number): void {
  if (attemptAt(s.labels, t) != null) throw new LabelError('this time is already inside an attempt');
  s.openStart = r2(t);
}

/** Closes the open attempt (not sent until marked). */
export function markEnd(s: LabelSession, t: number): LabelAttempt {
  if (s.openStart == null) throw new LabelError('mark the start of the attempt first');
  const a = { start_s: Math.min(s.openStart, r2(t)), end_s: Math.max(s.openStart, r2(t)), sent: false };
  if (a.end_s - a.start_s < 0.2) throw new LabelError('the attempt is shorter than 0.2 s');
  if (s.labels.attempts.some((b) => a.start_s < b.end_s && b.start_s < a.end_s)) throw new LabelError('it overlaps another attempt');
  s.labels.attempts.push(a); sortAttempts(s.labels); s.openStart = null;
  return a;
}

function inAttempt(L: Labels, t: number): LabelAttempt {
  const k = attemptAt(L, t);
  if (k == null) throw new LabelError('no labelled attempt at this time');
  return L.attempts[k];
}
/** Crux = the frame they came off from; only for attempts that were not sent. */
export function markCrux(L: Labels, t: number): LabelAttempt { const a = inAttempt(L, t); a.crux_s = r2(t); return a; }
export function markLastHold(L: Labels, t: number): LabelAttempt { const a = inAttempt(L, t); a.last_hold_s = r2(t); return a; }
export function toggleSent(L: Labels, t: number): LabelAttempt { const a = inAttempt(L, t); a.sent = !a.sent; return a; }
export function removeAttempt(L: Labels, k: number): void { L.attempts.splice(k, 1); }

/** Left/right-wrong spans: first call opens, second closes. Returns the closed span, if any. */
export function markLr(s: LabelSession, t: number, part: LrPart = 'any'): LrSpan | null {
  if (!s.openLr) { s.openLr = { start_s: r2(t), part }; return null; }
  const sp = { start_s: Math.min(s.openLr.start_s, r2(t)), end_s: Math.max(s.openLr.start_s, r2(t)), part: s.openLr.part };
  s.openLr = null;
  if (sp.end_s - sp.start_s < 0.05) return null;
  (s.labels.lrErrors ??= []).push(sp); s.labels.lrErrors.sort((a, b) => a.start_s - b.start_s);
  return sp;
}

/** Problems a labeller should fix before saving. */
export function validateLabels(L: Labels): string[] {
  const out: string[] = [];
  L.attempts.forEach((a, k) => {
    const n = `attempt ${k + 1}`;
    if (!(a.end_s > a.start_s)) out.push(`${n}: end is not after start`);
    if (k && a.start_s < L.attempts[k - 1].end_s) out.push(`${n}: overlaps attempt ${k}`);
    if (a.crux_s != null && (a.crux_s < a.start_s || a.crux_s > a.end_s)) out.push(`${n}: crux is outside the attempt`);
    if (a.crux_s != null && a.sent) out.push(`${n}: marked sent but has a crux`);
    if (a.last_hold_s != null && (a.last_hold_s < a.start_s || a.last_hold_s > a.end_s)) out.push(`${n}: last hold is outside the attempt`);
  });
  return out;
}

/** Read a labels file (older drafts lack the optional fields). Throws on anything else. */
export function parseLabels(text: string): Labels {
  const j = JSON.parse(text) as Partial<Labels>;
  if (j.format !== LABELS_FORMAT) throw new LabelError(`not a ${LABELS_FORMAT} file`);
  if (!Array.isArray(j.attempts) || j.attempts.some((a) => typeof a.start_s !== 'number' || typeof a.end_s !== 'number' || typeof a.sent !== 'boolean'))
    throw new LabelError('attempts need start_s, end_s and sent');
  const L: Labels = { ...newLabels(j.clip || ''), ...j, attempts: j.attempts.slice(), lrErrors: (j.lrErrors || []).slice() };
  sortAttempts(L);
  return L;
}

export function serializeLabels(L: Labels, now = new Date()): string {
  const clean: Labels = { ...L, updated: now.toISOString(), attempts: L.attempts.map((a) => {
    const o: LabelAttempt = { start_s: a.start_s, end_s: a.end_s, sent: a.sent };
    if (a.crux_s != null) o.crux_s = a.crux_s;
    if (a.last_hold_s != null) o.last_hold_s = a.last_hold_s;
    if (a.fall_reason) o.fall_reason = a.fall_reason;
    if (a.note) o.note = a.note;
    return o;
  }) };
  if (!clean.lrErrors?.length) delete clean.lrErrors;
  return JSON.stringify(clean, null, 2) + '\n';
}

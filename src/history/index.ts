// M16 history — sessions kept in this browser (IndexedDB), compared per route. A saved session keeps
// its raw pose track, settings and edits, so it can be re-analysed with newer analysis code, reused
// when the same clip is opened again, and exported / imported as a .climbpose.json file.
import type { Analysis, Edits, Env, Settings } from '../types';
import { routeKey, type RouteInfo } from '../route';
import { runPipeline } from '../core/pipeline';
import { store } from './storage';
import { dbAll, dbDelete, dbPut } from './db';
import { decodeRaw, encodeRaw, type EncodedRaw } from './raw';
import type { RawTrack } from '../types';

export interface Session {
  id: string; date: string; src: string; route: RouteInfo; key: string;
  flow: number; scores: Record<string, number>; attempts: number; tops: number;
  highFootM: number | null; handShare: number | null; cruxGapCm: number | null; cruxes: number;
  sends?: number;                    // attempts that were sent
  attemptsToSend?: number | null;    // number of the first sent attempt (1 = flash in this clip)
}

/** A session with what is needed to re-run the analysis. */
export interface SavedSession extends Session {
  raw?: EncodedRaw; settings?: Settings; env?: Env; edits?: Edits;
  clip?: { file: string; duration: number };
  analysedWith?: string;             // app version of the last analysis
}

export const SESSION_FORMAT = 'climbpose.session/1';
const LEGACY_KEY = 'climbpose.sessions';

export function sessionSummary(D: Analysis, route: RouteInfo, srcName: string): Session {
  const M = D.M, gaps = D.cruxes.filter((c) => c.target).map((c) => c.target!.distM * 100);
  const firstSent = D.attempts.find((a) => a.sent);
  return {
    id: `${srcName}|${D.t0.toFixed(1)}|${D.t1.toFixed(1)}`, date: new Date().toISOString(), src: srcName, route, key: routeKey(route),
    flow: M.flow, scores: Object.fromEntries(Object.entries(D.sc).map(([k, v]) => [k, Math.round(v * 100)])), attempts: M.attempts,
    tops: D.attempts.filter((a) => a.end === 'top-out').length,
    highFootM: isFinite(M.highFootM) ? +M.highFootM.toFixed(2) : null, handShare: isFinite(M.handShare) ? Math.round(M.handShare * 100) : null,
    cruxGapCm: gaps.length ? Math.round(Math.min(...gaps)) : null, cruxes: D.cruxes.length,
    sends: M.sends, attemptsToSend: firstSent ? firstSent.n : null,
  };
}

/** Everything needed to save this analysis. */
export function makeSaved(D: Analysis, raw: RawTrack, o: { route: RouteInfo; srcName: string; settings: Settings; env: Env; edits: Edits; clip: { file: string; duration: number }; app: string }): SavedSession {
  return { ...sessionSummary(D, o.route, o.srcName), raw: encodeRaw(raw), settings: o.settings, env: o.env, edits: o.edits, clip: o.clip, analysedWith: o.app };
}

let migrated = false;
/** All sessions, newest first (older localStorage summaries are moved into IndexedDB once). */
export async function listSessions(): Promise<SavedSession[]> {
  if (!migrated) {
    migrated = true;
    const legacy = store.get<Session[]>(LEGACY_KEY, []);
    if (legacy.length) { for (const s of legacy) await dbPut(s); store.set(LEGACY_KEY, []); }
  }
  return (await dbAll<SavedSession>()).sort((a, b) => b.date.localeCompare(a.date));
}

export const saveSession = (s: SavedSession): Promise<void> => dbPut(s);
export const deleteSession = (id: string): Promise<void> => dbDelete(id);

/** A saved analysis of this very clip (same file name and length), newest first. */
export async function findSavedForClip(file: string, duration: number): Promise<SavedSession | null> {
  const list = await listSessions();
  return list.find((s) => s.raw && s.clip && s.clip.file === file && Math.abs(s.clip.duration - duration) < 0.1) ?? null;
}

/** Re-run the current analysis on a saved session's pose track; keeps its id, date and route. */
export function reanalyse(s: SavedSession, app: string): SavedSession {
  if (!s.raw || !s.settings) return s;
  const D = runPipeline({ raw: decodeRaw(s.raw), settings: s.settings, env: s.env ?? 'gym', edits: s.edits });
  const fresh = sessionSummary(D, s.route, s.src);
  return { ...s, ...fresh, id: s.id, date: s.date, analysedWith: app };
}

export function sessionFile(s: SavedSession): string { return JSON.stringify({ format: SESSION_FORMAT, session: s }); }

export function parseSessionFile(text: string): SavedSession {
  const j = JSON.parse(text) as { format?: string; session?: SavedSession };
  if (j.format !== SESSION_FORMAT || !j.session || typeof j.session.id !== 'string' || !j.session.route) throw new Error(`not a ${SESSION_FORMAT} file`);
  return j.session;
}

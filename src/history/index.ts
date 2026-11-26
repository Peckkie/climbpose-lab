// M16 history — session summaries kept in this browser, compared per route.
import type { Analysis } from '../types';
import { routeKey, type RouteInfo } from '../route';
import { store } from './storage';

export interface Session {
  id: string; date: string; src: string; route: RouteInfo; key: string;
  flow: number; scores: Record<string, number>; attempts: number; tops: number;
  highFootM: number | null; handShare: number | null; cruxGapCm: number | null; cruxes: number;
}

const KEY = 'climbpose.sessions', MAX = 60;

export function sessionSummary(D: Analysis, route: RouteInfo, srcName: string): Session {
  const M = D.M, gaps = D.cruxes.filter((c) => c.target).map((c) => c.target!.distM * 100);
  return {
    id: `${srcName}|${D.t0.toFixed(1)}|${D.t1.toFixed(1)}`, date: new Date().toISOString(), src: srcName, route, key: routeKey(route),
    flow: M.flow, scores: Object.fromEntries(Object.entries(D.sc).map(([k, v]) => [k, Math.round(v * 100)])), attempts: M.attempts,
    tops: D.attempts.filter((a) => a.end === 'top-out').length,
    highFootM: isFinite(M.highFootM) ? +M.highFootM.toFixed(2) : null, handShare: isFinite(M.handShare) ? Math.round(M.handShare * 100) : null,
    cruxGapCm: gaps.length ? Math.round(Math.min(...gaps)) : null, cruxes: D.cruxes.length,
  };
}

export const listSessions = (): Session[] => store.get<Session[]>(KEY, []);

/** Insert or replace (same clip + range), newest first. */
export function saveSession(s: Session): void {
  const list = listSessions(), k = list.findIndex((x) => x.id === s.id);
  if (k >= 0) list[k] = s; else list.unshift(s);
  store.set(KEY, list.slice(0, MAX));
}

export const deleteSession = (id: string): void => store.set(KEY, listSessions().filter((x) => x.id !== id));

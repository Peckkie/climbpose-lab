// M16 history — progress over time: group saved sessions by route (or by grade) and turn them into
// series for the progress charts. Pure.
import type { Session } from '.';

export interface ProgressGroup { id: string; kind: 'route' | 'grade'; label: string; count: number; }
export interface ProgressPoint {
  date: string; src: string; attempts: number;
  flow: number; hands: number | null; gap: number | null;
  sent: boolean; flash: boolean;
}

const routeLabel = (s: Session) => [s.route.grade, s.route.tag, s.route.name].filter(Boolean).join(' · ');
const gradeId = (s: Session) => `grade:${s.route.environment}|${s.route.system}|${s.route.grade}`;

/** Routes that have a name/grade/tag (most sessions first), then grades with sessions on 2+ routes. */
export function progressGroups(list: Session[]): ProgressGroup[] {
  const routes = new Map<string, ProgressGroup>(), grades = new Map<string, ProgressGroup & { keys: Set<string> }>();
  for (const s of list) {
    const label = routeLabel(s);
    if (!label) continue; // no route info: can't tell which route it was
    const r = routes.get(s.key) ?? { id: s.key, kind: 'route' as const, label: s.route.gym && !s.route.gym.startsWith('Any ') ? `${label} · ${s.route.gym}` : label, count: 0 };
    r.count++; routes.set(s.key, r);
    if (s.route.grade) {
      const g = grades.get(gradeId(s)) ?? { id: gradeId(s), kind: 'grade' as const, label: s.route.grade, count: 0, keys: new Set<string>() };
      g.count++; g.keys.add(s.key); grades.set(gradeId(s), g);
    }
  }
  const byCount = (a: ProgressGroup, b: ProgressGroup) => b.count - a.count || a.label.localeCompare(b.label);
  return [...[...routes.values()].sort(byCount), ...[...grades.values()].filter((g) => g.keys.size > 1).map(({ keys: _k, ...g }) => g).sort(byCount)];
}

export function progressSeries(list: Session[], groupId: string): ProgressPoint[] {
  const inGroup = groupId.startsWith('grade:') ? (s: Session) => gradeId(s) === groupId : (s: Session) => s.key === groupId;
  return list.filter(inGroup).sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({
    date: s.date, src: s.src, attempts: s.attempts,
    flow: s.flow, hands: s.handShare, gap: s.cruxGapCm,
    sent: !!(s.sends || s.tops), flash: s.attemptsToSend === 1,
  }));
}

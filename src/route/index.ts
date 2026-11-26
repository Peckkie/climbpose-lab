// M15 route — gyms / crags, grade systems, tag colours, Google Maps links, route labels.
import type { Env } from '../types';
import { store } from '../history/storage';

export const TAGS: [string, string][] = [['Yellow', '#F5D90A'], ['Green', '#30A46C'], ['Blue', '#3E63DD'], ['Red', '#E5484D'], ['Black', '#111111'], ['White', '#F2F2F2'], ['Purple', '#8E4EC6'], ['Orange', '#F76B15'], ['Pink', '#E93D82'], ['Grey', '#8B8D98'], ['Teal', '#12A594'], ['Brown', '#AD7F58']];
export const GRADES: Record<'V' | 'Font', string[]> = {
  V: Array.from({ length: 13 }, (_, k) => 'V' + k),
  Font: ['4', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C'],
};
export type GradeSystem = 'V' | 'Font' | 'Color';

export interface MapPin { url: string; lat: number | null; lng: number | null; }
export interface Gym { name: string; sys: GradeSystem; env?: Env; colors?: string; map?: MapPin; }

export const DEFAULT_GYMS: Gym[] = [
  { name: 'Any gym · V-scale', sys: 'V' }, { name: 'Any gym · Font', sys: 'Font' },
  { name: 'Example · colour circuit', sys: 'Color', colors: 'Yellow=V0-V1, Green=V1-V2, Blue=V2-V4, Red=V4-V5, Black=V6+' },
  { name: 'Any crag · Font', sys: 'Font', env: 'rock' }, { name: 'Any crag · V-scale', sys: 'V', env: 'rock' },
];

export function loadGyms(): Gym[] {
  let g = store.get<Gym[] | null>('climbpose.gyms', null) || DEFAULT_GYMS.slice();
  if (!g.some((x) => x.env === 'rock')) g = g.concat(DEFAULT_GYMS.filter((x) => x.env === 'rock'));
  return g;
}
export const saveGyms = (g: Gym[]): void => store.set('climbpose.gyms', g);

/** "Yellow=V0-V1, Green=V2-V3" → [{color, grade}] */
export const parseColors = (t?: string): { color: string; grade: string }[] =>
  (t || '').split(',').map((x) => x.split('=').map((y) => y.trim())).filter((x) => x[0] && x[1]).map(([c, g]) => ({ color: c, grade: g }));

export interface MapsLink { url: string; name?: string; lat?: number; lng?: number; short: boolean; }
/** Google Maps link → name + coordinates. Full links (google.com/maps/place/NAME/@lat,lng…) carry
 *  both; short links (maps.app.goo.gl/…) can't be expanded from the page, so only the URL is kept. */
export function parseMapsLink(u: string): MapsLink | null {
  const url = u.trim(); if (!url) return null;
  const out: MapsLink = { url, short: false };
  let m = url.match(/\/maps\/place\/([^/@?]+)/); if (m) out.name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
  if (!out.name) { m = url.match(/[?&](?:q|query)=([^&]+)/); if (m && !/^-?\d+(\.\d+)?,-?\d+/.test(decodeURIComponent(m[1]))) out.name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); }
  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) { out.lat = +m[1]; out.lng = +m[2]; }
  out.short = /goo\.gl|maps\.app/.test(url);
  return out;
}

export interface RouteInfo {
  environment: Env; gym: string; gym_map: MapPin | null; system: GradeSystem;
  grade: string; tag: string; tagHex: string | null; name: string;
}
export const routeLabel = (r: RouteInfo): string => [r.grade, r.tag, r.name].filter(Boolean).join(' · ');
/** Same route across sessions = same environment + place + grade + tag + name. */
export const routeKey = (r: Partial<RouteInfo>): string =>
  [r.environment, r.gym, r.grade, r.tag, r.name].map((x) => (x || '').toLowerCase().trim()).join('|');

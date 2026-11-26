// M17 ui — ROUTE → Where: auto-detect / gym wall / real rock.
import type { Env } from '../types';
import { detectEnv, envText } from '../environment';
import { S } from '../app/store';
import { process } from '../app/actions';
import { $, video } from './dom';
import { fillGyms } from './route-panel';
import { t } from './i18n';

export function envMode(): Env {
  const v = $<HTMLSelectElement>('#env').value;
  return v === 'auto' ? (S.envDetected || 'gym') : v as Env;
}

/** Wording that depends on the environment (also re-run when the language changes). */
export function envLabels(): void {
  const E = envText(envMode()), v = $<HTMLSelectElement>('#env').value, sc = S.envScores;
  $<HTMLElement>('#envInfo').textContent = v === 'auto'
    ? (S.envDetected ? t('env.detected', { what: E.rock ? t('env.realRock') : t('env.gymWall'), scores: sc ? t('env.scores', { s: Math.round(sc.smooth * 100), v: Math.round(sc.vivid * 100), p: Math.round(sc.veg * 100) }) : '' }) : t('env.detecting'))
    : '';
  $<HTMLElement>('#placeLbl').textContent = E.rock ? t('place.crag') : t('place.gym'); $<HTMLElement>('#tagRow').style.display = E.rock ? 'none' : 'flex';
  $<HTMLOptionElement>('#sysColor').disabled = E.rock; $('#gymName').placeholder = E.rock ? t('crag.namePh') : t('gym.namePh');
}

export function applyEnv(): void {
  envLabels(); fillGyms(); if (S.raw) process();
}

/** Sample the new clip; on failure keep the previous guess (or gym). */
export async function runEnvDetection(): Promise<void> {
  try { const r = await detectEnv(video); S.envDetected = r.env; S.envScores = r.scores; }
  catch { S.envDetected = S.envDetected || 'gym'; }
  applyEnv();
}

export function initEnvironmentPanel(): void { $<HTMLSelectElement>('#env').onchange = applyEnv; }

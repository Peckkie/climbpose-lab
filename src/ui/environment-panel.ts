// M17 ui — ROUTE → Where: auto-detect / gym wall / real rock.
import type { Env } from '../types';
import { detectEnv, envText } from '../environment';
import { S } from '../app/store';
import { process } from '../app/actions';
import { $, video } from './dom';
import { fillGyms } from './route-panel';

export function envMode(): Env {
  const v = $<HTMLSelectElement>('#env').value;
  return v === 'auto' ? (S.envDetected || 'gym') : v as Env;
}

export function applyEnv(): void {
  const E = envText(envMode()), v = $<HTMLSelectElement>('#env').value, sc = S.envScores;
  $<HTMLElement>('#envInfo').textContent = v === 'auto'
    ? (S.envDetected ? `Detected: ${E.rock ? 'real rock' : 'gym wall'}${sc ? ` (smooth panels ${Math.round(sc.smooth * 100)}% · vivid holds ${Math.round(sc.vivid * 100)}% · plants ${Math.round(sc.veg * 100)}%)` : ''} — change it above if wrong.` : 'Detecting…')
    : '';
  $<HTMLElement>('#placeLbl').textContent = E.place; $<HTMLElement>('#tagRow').style.display = E.rock ? 'none' : 'flex';
  $<HTMLOptionElement>('#sysColor').disabled = E.rock; $('#gymName').placeholder = E.rock ? 'Crag / area name' : 'Gym name';
  fillGyms(); if (S.raw) process();
}

/** Sample the new clip; on failure keep the previous guess (or gym). */
export async function runEnvDetection(): Promise<void> {
  try { const r = await detectEnv(video); S.envDetected = r.env; S.envScores = r.scores; }
  catch { S.envDetected = S.envDetected || 'gym'; }
  applyEnv();
}

export function initEnvironmentPanel(): void { $<HTMLSelectElement>('#env').onchange = applyEnv; }

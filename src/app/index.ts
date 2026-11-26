// M00 app — wires the UI panels to the store and actions.
import { $ } from '../ui/dom';
import { initPlayer } from '../ui/player';
import { initRoutePanel } from '../ui/route-panel';
import { initEnvironmentPanel } from '../ui/environment-panel';
import { initHistoryPanel } from '../ui/history-panel';
import { initTagging } from '../ui/tagging';
import { initExportPanel } from '../ui/export-panel';
import { initLabelPanel } from '../ui/label-panel';
import { S } from './store';
import { analyze, loadSrc, process } from './actions';

function initSource(): void {
  $<HTMLElement>('#drop').onclick = () => $('#file').click();
  $('#file').onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) loadSrc(URL.createObjectURL(f), f.name, false); };
  $<HTMLButtonElement>('#loadUrl').onclick = () => { const u = $('#url').value.trim(); if (u) loadSrc(u, u.split('/').pop() || 'clip', true); };
  for (const el of [$<HTMLElement>('#drop'), $<HTMLElement>('#wrap')]) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); $<HTMLElement>('#drop').classList.add('over'); });
    el.addEventListener('dragleave', () => $<HTMLElement>('#drop').classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); $<HTMLElement>('#drop').classList.remove('over');
      const f = e.dataTransfer?.files[0]; if (f && f.type.startsWith('video')) loadSrc(URL.createObjectURL(f), f.name, false);
    });
  }
  $<HTMLButtonElement>('#analyze').onclick = analyze;
}

export function start(): void {
  initRoutePanel();
  initEnvironmentPanel();
  initHistoryPanel();
  initSource();
  initTagging();
  initExportPanel();
  initLabelPanel();
  initPlayer();
  document.fonts?.load('700 20px "Space Grotesk"');
  // debugging handle
  Object.assign(window, { __climbpose: Object.assign(S, { reprocess: () => { if (S.raw) { S.cache = {}; process(); } } }) });
}

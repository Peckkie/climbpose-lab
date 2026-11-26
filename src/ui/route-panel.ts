// M17 ui — ROUTE card: place (gym / crag + Google Maps), grade, tag colour, name, route photo.
import { GRADES, TAGS, loadGyms, parseColors, parseMapsLink, saveGyms, type Gym, type GradeSystem, type RouteInfo } from '../route';
import { store } from '../history/storage';
import { fmt } from '../util';
import { S } from '../app/store';
import { $, setStatus, video } from './dom';
import { envMode } from './environment-panel';

let GYMS: Gym[] = loadGyms();
const sel = () => $<HTMLSelectElement>('#gym');
const currentGym = (): Gym => GYMS[+sel().value] || GYMS[0];

export function fillGyms(want?: number): void {
  const env = envMode(), g = sel();
  g.innerHTML = GYMS.map((x, k) => ((x.env || 'gym') === env ? `<option value="${k}">${x.name.replace(/</g, '&lt;')}</option>` : '')).join('') + `<option value="add">+ Add ${env === 'rock' ? 'crag' : 'gym'}…</option>`;
  g.value = String(want != null ? want : store.get('climbpose.gymSel', 0));
  if (!g.value || g.value === 'add') { const first = g.querySelector('option'); g.value = first ? first.value : 'add'; }
  fillGrades(); updateGymPin();
}

function fillGrades(): void {
  const gym = currentGym(), grade = $<HTMLSelectElement>('#grade');
  if (gym.sys === 'Color') { const cs = parseColors(gym.colors); grade.innerHTML = cs.map((c) => `<option value="${c.grade}" data-color="${c.color}">${c.color} · ${c.grade}</option>`).join('') || '<option value="">–</option>'; }
  else grade.innerHTML = '<option value="">–</option>' + GRADES[gym.sys].map((x) => `<option>${x}</option>`).join('');
  $<HTMLSelectElement>('#tag').innerHTML = '<option value="">–</option>' + TAGS.map(([n]) => `<option>${n}</option>`).join('');
  syncTagFromGrade();
}

/** Colour-circuit grades imply the tag colour. */
function syncTagFromGrade(): void {
  const o = $<HTMLSelectElement>('#grade').selectedOptions[0];
  if (o && o.dataset.color) { const t = TAGS.find(([n]) => n.toLowerCase() === o.dataset.color!.toLowerCase()); if (t) $<HTMLSelectElement>('#tag').value = t[0]; }
}

export function routeInfo(): RouteInfo {
  const gym = currentGym(), tag = TAGS.find(([n]) => n === $<HTMLSelectElement>('#tag').value), rock = envMode() === 'rock';
  return {
    environment: rock ? 'rock' : 'gym', gym: gym.name, gym_map: gym.map || null, system: gym.sys, grade: $<HTMLSelectElement>('#grade').value || '',
    tag: !rock && tag ? tag[0] : '', tagHex: !rock && tag ? tag[1] : null, name: $('#rname').value.trim(),
  };
}

function updateGymPin(): void {
  const g = GYMS[+sel().value], a = $<HTMLAnchorElement>('#gymPin');
  if (g && g.map) { a.href = g.map.url; a.style.display = 'inline-block'; } else a.style.display = 'none';
}

export function updatePhotoInfo(): void {
  const r = S.routePhoto;
  $<HTMLElement>('#photoInfo').textContent = !r ? 'Auto: the route map uses the frame where the attempt starts. Best results: take the route photo from the same spot as the camera, camera on a tripod.'
    : r.kind === 'upload' ? `Photo ${r.w}×${r.h} — mapped assuming it was shot from the camera position (same framing as the video).`
    : `Using the video frame at ${fmt(r.t ?? 0)} as the route photo.`;
}

export function initRoutePanel(): void {
  $('#gymMap').oninput = () => {
    const r = parseMapsLink($('#gymMap').value), info = $<HTMLElement>('#gymMapInfo');
    if (!r) { info.style.display = 'none'; return; } info.style.display = 'block';
    if (r.name && !$('#gymName').value.trim()) $('#gymName').value = r.name;
    info.textContent = r.name ? `📍 ${r.name}${r.lat != null ? ` · ${r.lat.toFixed(5)}, ${r.lng!.toFixed(5)}` : ''}`
      : r.short ? '📍 Short link saved — type the gym name below (short links can’t be read from the page).'
      : r.lat != null ? `📍 ${r.lat.toFixed(5)}, ${r.lng!.toFixed(5)} — type the gym name below.` : 'Not a Google Maps link?';
  };
  sel().onchange = () => {
    if (sel().value === 'add') { $<HTMLElement>('#gymForm').style.display = 'block'; $('#gymMap').focus(); updateGymPin(); return; }
    store.set('climbpose.gymSel', +sel().value); fillGrades(); updateGymPin();
  };
  $<HTMLSelectElement>('#gymSys').onchange = () => { $<HTMLElement>('#gymColorsRow').style.display = $<HTMLSelectElement>('#gymSys').value === 'Color' ? 'flex' : 'none'; };
  $<HTMLButtonElement>('#gymCancel').onclick = () => { $<HTMLElement>('#gymForm').style.display = 'none'; fillGyms(); };
  $<HTMLButtonElement>('#gymSave').onclick = () => {
    const name = $('#gymName').value.trim(); if (!name) { $('#gymName').focus(); return; }
    const g: Gym = { name, sys: $<HTMLSelectElement>('#gymSys').value as GradeSystem, env: envMode() };
    if (g.sys === 'Color') g.colors = $('#gymColors').value;
    const mp = parseMapsLink($('#gymMap').value); if (mp) g.map = { url: mp.url, lat: mp.lat ?? null, lng: mp.lng ?? null };
    $('#gymMap').value = ''; $('#gymName').value = ''; $<HTMLElement>('#gymMapInfo').style.display = 'none';
    GYMS.push(g); saveGyms(GYMS); $<HTMLElement>('#gymForm').style.display = 'none'; fillGyms(GYMS.length - 1); store.set('climbpose.gymSel', GYMS.length - 1);
  };
  $<HTMLSelectElement>('#grade').onchange = syncTagFromGrade;
  fillGyms();

  // route photo: uploaded (assumed shot from the camera position), a video frame, or Auto
  $<HTMLButtonElement>('#photoBtn').onclick = () => $('#photoFile').click();
  $('#photoFile').onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    try { const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); S.routePhoto = { kind: 'upload', el: bmp, w: bmp.width, h: bmp.height }; updatePhotoInfo(); }
    catch { setStatus('Could not read that photo', 'err'); }
  };
  $<HTMLButtonElement>('#photoFrame').onclick = () => {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d')!.drawImage(video, 0, 0);
    const D = S.D, k = D ? Math.min(D.N - 1, Math.max(0, Math.round((video.currentTime - D.t0) * D.fps))) : 0;
    S.routePhoto = { kind: 'frame', el: c, w: c.width, h: c.height, k, t: video.currentTime }; updatePhotoInfo();
  };
  $<HTMLButtonElement>('#photoAuto').onclick = () => { S.routePhoto = null; updatePhotoInfo(); };
}

/** for tests / debugging */
export const _gyms = (): Gym[] => GYMS;
export const _resetGyms = (): void => { GYMS = loadGyms(); };

// M01 media — reading frames from a <video> element.

/** Time of frame i when sampling at `fps` from t0. Seek a quarter into the frame so the decoder
 *  lands on frame i itself and not on the end of frame i-1 (the skeleton was one frame ahead). */
export const frameTime = (t0: number, i: number, fps: number): number => t0 + (i + 0.25) / fps;

/** Seek and wait until the frame is ready (or 4 s, so a stuck decoder can't hang the analysis). */
export function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 4000): Promise<void> {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; video.removeEventListener('seeked', fin); res(); } };
    video.addEventListener('seeked', fin);
    video.currentTime = t;
    setTimeout(fin, timeoutMs);
  });
}

/** Clamp a time to the playable range (the very last frame often can't be decoded). */
export const clampTime = (video: HTMLVideoElement, t: number): number => Math.min(video.duration - 0.01, Math.max(0, t));

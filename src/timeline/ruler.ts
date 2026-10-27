// Régua da timeline: passo e rótulos mm:ss:ff que se adaptam ao zoom.
import { formatTimecode } from "./timecode";

/** Time label for the ruler: mm:ss:ff, with hours (hh:mm:ss:ff) only when the composition needs them. */
export function formatRulerTime(seconds: number, fps: number, withHours = false) {
  const text = formatTimecode(seconds, fps);
  return withHours ? text : text.slice(3);
}

/** Smallest "nice" step (seconds) that keeps labels at least minPixels apart. */
export function rulerStep(fps: number, pixelsPerSecond: number, minPixels = 84) {
  const frame = 1 / Math.max(1, fps);
  const candidates = [frame, frame * 2, frame * 5, frame * 10, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
    .filter((step, index, all) => index === 0 || step > all[index - 1]);
  return candidates.find((step) => step * pixelsPerSecond >= minPixels) ?? candidates[candidates.length - 1];
}

export function rulerTicks(duration: number, fps: number, contentPixels: number) {
  const step = rulerStep(fps, contentPixels / Math.max(.001, duration));
  const withHours = duration >= 3600;
  const ticks: Array<{ time: number; label: string }> = [];
  for (let index = 0; index * step <= duration + 1e-9 && ticks.length < 1500; index++) {
    const time = index * step;
    ticks.push({ time, label: formatRulerTime(time, fps, withHours) });
  }
  return ticks;
}

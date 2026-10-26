import type { AudioTrack, Layer } from "../model/types";
import { clamp } from "../model/math";

type FadeTiming = Pick<AudioTrack, "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">;

export function normalizeFades(item: Pick<Layer, "startTime" | "endTime" | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">) {
  item.fadeInStart = clamp(item.fadeInStart, item.startTime, item.endTime);
  item.fadeInEnd = clamp(item.fadeInEnd, item.fadeInStart, item.endTime);
  item.fadeOutEnd = clamp(item.fadeOutEnd, item.startTime, item.endTime);
  item.fadeOutStart = clamp(item.fadeOutStart, item.startTime, item.fadeOutEnd);
}

export function fadeInEnvelope(item: FadeTiming, time: number) {
  if (item.fadeInEnd <= item.fadeInStart) return 1;
  if (time <= item.fadeInStart) return 0;
  if (time >= item.fadeInEnd) return 1;
  return (time - item.fadeInStart) / (item.fadeInEnd - item.fadeInStart);
}

export function fadeOutEnvelope(item: FadeTiming, time: number) {
  if (item.fadeOutEnd <= item.fadeOutStart) return 1;
  if (time <= item.fadeOutStart) return 1;
  if (time >= item.fadeOutEnd) return 0;
  return 1 - (time - item.fadeOutStart) / (item.fadeOutEnd - item.fadeOutStart);
}

// O envelope não verifica se o clipe está ativo; manter fades de duração zero.
export function fadeEnvelope(item: FadeTiming, time: number) {
  return fadeInEnvelope(item, time) * fadeOutEnvelope(item, time);
}

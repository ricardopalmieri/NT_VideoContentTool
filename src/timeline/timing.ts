import type { AudioTrack, Layer } from "../model/types";
import { clamp } from "../model/math";

type FadeTiming = Pick<AudioTrack, "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">;

// Fades ficam ancorados nas bordas do clipe: o fade-in começa no início e o
// fade-out termina no fim. Só a duração de cada fade é preservada, então mover,
// aparar ou estender o clipe nunca cria trechos invisíveis. O formato `.ntvct`
// v2 continua com os quatro tempos absolutos.
export function normalizeFades(item: Pick<Layer, "startTime" | "endTime" | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">) {
  const length = Math.max(0, item.endTime - item.startTime);
  const fadeIn = clamp(item.fadeInEnd - item.fadeInStart, 0, length);
  const fadeOut = clamp(item.fadeOutEnd - item.fadeOutStart, 0, length);
  item.fadeInStart = item.startTime;
  item.fadeInEnd = item.startTime + fadeIn;
  item.fadeOutEnd = item.endTime;
  item.fadeOutStart = item.endTime - fadeOut;
}

// Ajusta a duração de um fade pela posição da alça na timeline.
export function setFadeHandle(item: Pick<Layer, "startTime" | "endTime" | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">, side: "in" | "out", time: number) {
  const length = Math.max(0, item.endTime - item.startTime);
  if (side === "in") {
    item.fadeInStart = item.startTime;
    item.fadeInEnd = item.startTime + clamp(time - item.startTime, 0, length);
  } else {
    item.fadeOutEnd = item.endTime;
    item.fadeOutStart = item.endTime - clamp(item.endTime - time, 0, length);
  }
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

import type { Layer } from "../model/types";
import { clamp } from "../model/math";

export function normalizeFades(item: Pick<Layer, "startTime" | "endTime" | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">) {
  item.fadeInStart = clamp(item.fadeInStart, item.startTime, item.endTime);
  item.fadeInEnd = clamp(item.fadeInEnd, item.fadeInStart, item.endTime);
  item.fadeOutEnd = clamp(item.fadeOutEnd, item.startTime, item.endTime);
  item.fadeOutStart = clamp(item.fadeOutStart, item.startTime, item.fadeOutEnd);
}

// O envelope não verifica se o clipe está ativo; manter fades de duração zero.
export function fadeEnvelope(layer: Pick<Layer, "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">, time: number) {
    let value = 1;
    if (layer.fadeInEnd > layer.fadeInStart) value *= time <= layer.fadeInStart ? 0 : time < layer.fadeInEnd ? (time - layer.fadeInStart) / (layer.fadeInEnd - layer.fadeInStart) : 1;
    if (layer.fadeOutEnd > layer.fadeOutStart) value *= time <= layer.fadeOutStart ? 1 : time < layer.fadeOutEnd ? 1 - (time - layer.fadeOutStart) / (layer.fadeOutEnd - layer.fadeOutStart) : 0;
    return Math.max(0, Math.min(1, value));
  }

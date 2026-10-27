import type { Layer } from "../model/types";

// sourceOffset só vale para projetos antigos sem sourceIn; zero em sourceIn é um corte no início.
export function sourceTimeFor(layer: Layer, timelineTime: number, mediaDuration: number, evaluatedPlaybackRate: number) {
    const sourceIn = Math.max(0, Math.min(mediaDuration, layer.sourceIn ?? layer.sourceOffset ?? 0));
    const configuredOut = layer.sourceOut > sourceIn ? layer.sourceOut : mediaDuration;
    const sourceOut = Math.max(sourceIn, Math.min(mediaDuration, configuredOut));
    const span = Math.max(.001, sourceOut - sourceIn);
    const speed = Math.max(.05, Math.abs(evaluatedPlaybackRate || 1));
    let elapsed = Math.max(0, timelineTime - layer.startTime) * speed;
    if (layer.loop) elapsed %= span;
    else elapsed = Math.min(span, elapsed);
    const sourceTime = layer.reverse ? sourceOut - elapsed : sourceIn + elapsed;
    return Math.max(0, Math.min(Math.max(0, mediaDuration - .001), sourceTime));
  }

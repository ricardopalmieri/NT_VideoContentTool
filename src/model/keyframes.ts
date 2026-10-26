import type { Easing, Keyframe } from "./types";

export function keyframeAt(
  keyframes: readonly Keyframe[] | undefined,
  time: number,
  tolerance: number,
) {
  return keyframes?.find((keyframe) => Math.abs(keyframe.time - time) <= tolerance);
}

export function upsertKeyframe(
  keyframes: readonly Keyframe[],
  time: number,
  value: number,
  tolerance: number,
  easing: Easing,
) {
  const existing = keyframeAt(keyframes, time, tolerance);
  if (existing) {
    return {
      keyframes: keyframes.map((keyframe) => keyframe === existing ? { ...keyframe, value } : keyframe),
      created: false,
    };
  }
  const next = [...keyframes, { time, value, easing }].sort((a, b) => a.time - b.time);
  return { keyframes: next, created: true };
}

export function toggleKeyframe(
  keyframes: readonly Keyframe[],
  time: number,
  value: number,
  tolerance: number,
  easing: Easing,
) {
  const existing = keyframeAt(keyframes, time, tolerance);
  if (existing) {
    return {
      keyframes: keyframes.filter((keyframe) => keyframe !== existing),
      action: "removed" as const,
      keyframe: undefined,
    };
  }
  const keyframe: Keyframe = { time, value, easing };
  return {
    keyframes: [...keyframes, keyframe].sort((a, b) => a.time - b.time),
    action: "added" as const,
    keyframe,
  };
}

import type { ProjectDocument } from "../model/types";
import { clamp } from "../model/math";

export interface TimelineSnapExclusions {
  layerId?: string;
  audioId?: string;
  playhead?: boolean;
}

export function timelineSnapCandidates(
  project: ProjectDocument | null,
  currentTime: number,
  exclusions: TimelineSnapExclusions = {},
) {
  if (!project) return [];
  const excludedLayers = new Set(exclusions.layerId ? [exclusions.layerId] : []);
  const excludedAudio = new Set(exclusions.audioId ? [exclusions.audioId] : []);
  for (const track of project.audioTracks) {
    if (track.linked && track.linkedLayerId && excludedLayers.has(track.linkedLayerId)) excludedAudio.add(track.id);
    if (track.linked && track.linkedLayerId && excludedAudio.has(track.id)) excludedLayers.add(track.linkedLayerId);
  }
  const values = exclusions.playhead ? [0, project.settings.duration] : [0, project.settings.duration, currentTime];
  for (const layer of project.layers) {
    if (excludedLayers.has(layer.id)) continue;
    values.push(layer.startTime, layer.endTime, layer.fadeInStart, layer.fadeInEnd, layer.fadeOutStart, layer.fadeOutEnd);
    for (const keys of Object.values(layer.keyframes)) for (const key of keys) values.push(key.time);
    for (const effect of layer.effects) for (const keys of Object.values(effect.keyframes)) for (const key of keys) values.push(key.time);
  }
  for (const track of project.audioTracks) {
    if (excludedAudio.has(track.id)) continue;
    values.push(track.startTime, track.endTime, track.fadeInStart, track.fadeInEnd, track.fadeOutStart, track.fadeOutEnd);
  }
  return values;
}

export function snapTimelineTime(value: number, project: ProjectDocument | null, timelineSnap: boolean, getWidth: () => number, getCandidates: () => number[], bypass = false) {
  if (!project) return value;
  const frameValue = Math.round(value * project.settings.fps) / project.settings.fps;
  if (!timelineSnap || bypass) return clamp(frameValue, 0, project.settings.duration);
  const threshold = Math.max(1 / project.settings.fps, 9 / Math.max(1, getWidth()) * project.settings.duration);
  let result = frameValue;
  let distance = threshold;
  for (const candidate of getCandidates()) {
    const nextDistance = Math.abs(candidate - frameValue);
    if (nextDistance <= distance) {
      distance = nextDistance;
      result = candidate;
    }
  }
  return clamp(result, 0, project.settings.duration);
}

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
  const area = project.settings.workArea;
  if (area) values.push(area.in, area.out);
  values.push(...gridTimes(project.settings));
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

/** Beat times of the musical grid inside the composition (at most 4000). */
export function gridTimes(settings: Pick<ProjectDocument["settings"], "duration" | "grid">) {
  const grid = settings.grid;
  if (!grid || grid.bpm <= 0) return [];
  const beat = 60 / grid.bpm;
  const times: number[] = [];
  for (let time = grid.offset % beat; time <= settings.duration + 1e-9 && times.length < 4000; time += beat) times.push(+time.toFixed(6));
  return times;
}

/** Tempo from taps (ms timestamps): median interval of the last 8 taps, 20..400 BPM. */
export function tapTempo(taps: readonly number[]) {
  const recent = taps.slice(-9);
  if (recent.length < 3) return null;
  const intervals = recent.slice(1).map((time, index) => time - recent[index]).filter((value) => value > 150 && value < 3000).sort((a, b) => a - b);
  if (intervals.length < 2) return null;
  const median = intervals[Math.floor(intervals.length / 2)];
  return Math.round(60000 / median * 10) / 10;
}

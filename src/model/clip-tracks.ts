// Faixas com vários clipes. Cada clipe continua sendo uma Layer (com transform,
// keyframes e efeitos próprios); `trackId` agrupa clipes na mesma faixa visual.
// Sem `trackId`, a layer é a própria faixa (`trackId = id`), então projetos v2
// antigos abrem iguais e o arquivo só ganha o campo quando há corte ou movimento.
import { normalizeFades } from "../timeline/timing";
import { uid, type AudioTrack, type Layer, type ProjectDocument } from "./types";

export const trackIdOf = (layer: Pick<Layer, "id" | "trackId">) => layer.trackId || layer.id;
export const laneIdOf = (track: Pick<AudioTrack, "id" | "laneId">) => track.laneId || track.id;

export interface VisualTrack {
  id: string;
  clips: Layer[];
}

// Faixas na ordem da primeira aparição em `project.layers` (índice 0 = topo).
export function visualTracks(project: Pick<ProjectDocument, "layers">): VisualTrack[] {
  const tracks = new Map<string, VisualTrack>();
  for (const layer of project.layers) {
    const id = trackIdOf(layer);
    let track = tracks.get(id);
    if (!track) tracks.set(id, track = { id, clips: [] });
    track.clips.push(layer);
  }
  return [...tracks.values()];
}

export function audioLanes(project: Pick<ProjectDocument, "audioTracks">) {
  const lanes = new Map<string, { id: string; clips: AudioTrack[] }>();
  for (const track of project.audioTracks) {
    const id = laneIdOf(track);
    let lane = lanes.get(id);
    if (!lane) lanes.set(id, lane = { id, clips: [] });
    lane.clips.push(track);
  }
  return [...lanes.values()];
}

// Reescreve `project.layers` com as faixas contíguas, na ordem dada.
function writeTracks(project: ProjectDocument, tracks: VisualTrack[]) {
  project.layers = tracks.flatMap((track) => track.clips);
}

export function shiftTrack(project: ProjectDocument, trackId: string, direction: number) {
  const tracks = visualTracks(project);
  const index = tracks.findIndex((track) => track.id === trackId);
  const target = Math.max(0, Math.min(tracks.length - 1, index + direction));
  if (index < 0 || target === index) return false;
  const [moved] = tracks.splice(index, 1);
  tracks.splice(target, 0, moved);
  writeTracks(project, tracks);
  return true;
}

export function placeTrack(project: ProjectDocument, trackId: string, targetTrackId: string, after: boolean) {
  if (trackId === targetTrackId) return false;
  const tracks = visualTracks(project);
  const source = tracks.findIndex((track) => track.id === trackId);
  if (source < 0) return false;
  const [moved] = tracks.splice(source, 1);
  const target = tracks.findIndex((track) => track.id === targetTrackId);
  if (target < 0) return false;
  tracks.splice(target + (after ? 1 : 0), 0, moved);
  writeTracks(project, tracks);
  return true;
}

const EPSILON = 1e-6;

// Limites livres ao redor de um clipe na própria faixa: fim do vizinho anterior
// e início do próximo. Clipes de uma faixa não se sobrepõem.
export function clipNeighbors(project: Pick<ProjectDocument, "layers">, layerId: string) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) return { previousEnd: 0, nextStart: Number.POSITIVE_INFINITY };
  let previousEnd = 0;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const clip of project.layers) {
    if (clip.id === layerId || trackIdOf(clip) !== trackIdOf(layer)) continue;
    if (clip.endTime <= layer.startTime + EPSILON) previousEnd = Math.max(previousEnd, clip.endTime);
    else if (clip.startTime >= layer.endTime - EPSILON) nextStart = Math.min(nextStart, clip.startTime);
  }
  return { previousEnd, nextStart };
}

export function overlapsTrack(project: Pick<ProjectDocument, "layers">, trackId: string, start: number, end: number, ignoreId = "") {
  return project.layers.some((clip) => clip.id !== ignoreId && trackIdOf(clip) === trackId
    && clip.startTime < end - EPSILON && clip.endTime > start + EPSILON);
}

// Move um clipe para outra faixa (a faixa de destino mantém sua posição).
// Recusa se o trecho do clipe já estiver ocupado na faixa de destino.
export function moveClipToTrack(project: ProjectDocument, layerId: string, targetTrackId: string, allowOverlap = false) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer || trackIdOf(layer) === targetTrackId) return false;
  const tracks = visualTracks(project);
  const target = tracks.find((track) => track.id === targetTrackId);
  if (!target || (!allowOverlap && overlapsTrack(project, targetTrackId, layer.startTime, layer.endTime, layerId))) return false;
  for (const track of tracks) track.clips = track.clips.filter((clip) => clip.id !== layerId);
  layer.trackId = targetTrackId;
  target.clips.push(layer);
  writeTracks(project, tracks.filter((track) => track.clips.length));
  return true;
}

type Timed = Pick<Layer, "startTime" | "endTime" | "sourceIn" | "sourceOut" | "playbackRate" | "reverse"
  | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd"> & { sourceOffset?: number };

// Ajusta tempo, fades e trecho de origem das duas partes. O corte é seco: a
// primeira parte perde o fade-out e a segunda o fade-in. Clipes em loop
// reiniciam o loop na segunda parte.
function splitTiming(first: Timed, second: Timed, time: number, mediaDuration: number, adjustSource = true) {
  const fadeOut = first.fadeOutEnd - first.fadeOutStart;
  const sourceIn = first.sourceIn || first.sourceOffset || 0;
  const sourceOut = first.sourceOut > sourceIn ? first.sourceOut : mediaDuration;
  const elapsed = Math.max(0, time - first.startTime) * Math.max(.05, Math.abs(first.playbackRate || 1));
  first.endTime = time;
  second.startTime = time;
  first.fadeOutStart = first.fadeOutEnd = time;
  second.fadeInStart = second.fadeInEnd = time;
  second.fadeOutEnd = second.endTime;
  second.fadeOutStart = second.endTime - fadeOut;
  normalizeFades(first);
  normalizeFades(second);
  if (!adjustSource || sourceOut <= sourceIn) return;
  if (first.reverse) {
    const cut = Math.max(sourceIn + .001, sourceOut - elapsed);
    first.sourceIn = cut;
    second.sourceOut = cut;
  } else {
    const cut = Math.min(sourceOut - .001, sourceIn + elapsed);
    first.sourceOut = cut;
    second.sourceIn = cut;
  }
}

export interface SplitResult {
  first: Layer;
  second: Layer;
}

// Divide a layer no tempo dado. Keyframes ficam nas duas partes (tempo absoluto),
// então a animação continua contínua. Áudio vinculado é dividido junto.
export function splitClip(project: ProjectDocument, layerId: string, time: number, mediaDuration = 0, minLength = 1 / 60, newId: (prefix: string) => string = uid): SplitResult | null {
  const index = project.layers.findIndex((item) => item.id === layerId);
  const first = project.layers[index];
  if (!first || time <= first.startTime + minLength || time >= first.endTime - minLength) return null;
  const media = first.kind === "video" ? mediaDuration : 0;
  const second = structuredClone(first);
  second.id = newId("layer");
  second.trackId = trackIdOf(first);
  // O corte cria uma borda seca; a entrada pertence à primeira parte.
  delete second.transition;
  second.effects.forEach((effect) => effect.id = newId("fx"));
  splitTiming(first, second, time, media, first.kind === "video");
  project.layers.splice(index + 1, 0, second);

  for (const audio of [...project.audioTracks]) {
    if (!audio.linked || audio.linkedLayerId !== first.id) continue;
    const audioIndex = project.audioTracks.indexOf(audio);
    const audioSecond = structuredClone(audio);
    audioSecond.id = newId("audio");
    audioSecond.laneId = laneIdOf(audio);
    audioSecond.linkedLayerId = second.id;
    audioSecond.effects.forEach((effect) => effect.id = newId("afx"));
    splitTiming(audio, audioSecond, time, media || audio.sourceOut);
    project.audioTracks.splice(audioIndex + 1, 0, audioSecond);
  }
  return { first, second };
}

// Desloca um clipe no tempo com fades, keyframes (da layer e dos efeitos) e o
// áudio vinculado.
export function shiftClip(project: ProjectDocument, layer: Layer, delta: number) {
  if (!delta) return;
  layer.startTime += delta;
  layer.endTime += delta;
  layer.fadeInStart += delta;
  layer.fadeInEnd += delta;
  layer.fadeOutStart += delta;
  layer.fadeOutEnd += delta;
  for (const keys of Object.values(layer.keyframes)) for (const key of keys) key.time += delta;
  for (const effect of layer.effects) for (const keys of Object.values(effect.keyframes)) for (const key of keys) key.time += delta;
  for (const track of project.audioTracks) {
    if (track.linkedLayerId !== layer.id || !track.linked) continue;
    track.startTime += delta;
    track.endTime += delta;
    track.fadeInStart += delta;
    track.fadeInEnd += delta;
    track.fadeOutStart += delta;
    track.fadeOutEnd += delta;
  }
}

// Apaga clipes e fecha o espaço até o vizinho anterior. Em sobreposições, usa
// o início real do próximo clipe, evitando deixar uma lacuna ou tempo negativo.
// Áudio vinculado sai junto.
export function rippleDelete(project: ProjectDocument, layerIds: string[]) {
  const removed = project.layers.filter((layer) => layerIds.includes(layer.id)).sort((a, b) => b.startTime - a.startTime);
  if (!removed.length) return 0;
  for (const clip of removed) {
    const trackId = trackIdOf(clip);
    project.layers = project.layers.filter((layer) => layer.id !== clip.id);
    project.audioTracks = project.audioTracks.filter((track) => !(track.linked && track.linkedLayerId === clip.id));
    const sameTrack = project.layers.filter((layer) => trackIdOf(layer) === trackId);
    const previousEnd = sameTrack.reduce((end, layer) => layer.endTime <= clip.startTime + EPSILON
      ? Math.max(end, layer.endTime)
      : end, 0);
    const nextStart = sameTrack.reduce((start, layer) => layer.startTime >= clip.startTime - EPSILON
      ? Math.min(start, layer.startTime)
      : start, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextStart)) continue;
    const gap = Math.max(0, nextStart - previousEnd);
    if (gap <= EPSILON) continue;
    for (const layer of sameTrack) {
      if (layer.startTime >= nextStart - EPSILON) shiftClip(project, layer, -gap);
    }
  }
  return removed.length;
}

export interface ClipboardClips {
  layers: Layer[];
  audio: AudioTrack[];
}

export function copyClips(project: ProjectDocument, layerIds: string[]): ClipboardClips {
  const layers = project.layers.filter((layer) => layerIds.includes(layer.id));
  return {
    layers: structuredClone(layers),
    audio: structuredClone(project.audioTracks.filter((track) => track.linked && layerIds.includes(track.linkedLayerId || ""))),
  };
}

// Cola no playhead: o clipe mais cedo começa em `time`. Cada clipe volta para a
// faixa original se ela existir e estiver livre; senão ganha uma faixa nova no topo.
export function pasteClips(project: ProjectDocument, clipboard: ClipboardClips, time: number, newId: (prefix: string) => string = uid) {
  if (!clipboard.layers.length) return [];
  const delta = time - Math.min(...clipboard.layers.map((layer) => layer.startTime));
  const pasted: Layer[] = [];
  const copy = structuredClone(clipboard);
  for (const layer of copy.layers) {
    const originalId = layer.id;
    const originalTrack = trackIdOf(layer);
    layer.id = newId("layer");
    layer.effects.forEach((effect) => effect.id = newId("fx"));
    const pastedAudio: Array<{ track: AudioTrack; lane: string }> = [];
    for (const track of copy.audio) {
      if (track.linkedLayerId !== originalId) continue;
      pastedAudio.push({ track, lane: laneIdOf(track) });
      track.id = newId("audio");
      track.effects.forEach((effect) => effect.id = newId("afx"));
      track.linkedLayerId = layer.id;
      project.audioTracks.push(track);
    }
    shiftClip(project, layer, delta);
    // O áudio volta para a faixa de áudio original se ela estiver livre no trecho.
    for (const { track, lane } of pastedAudio) {
      const busy = project.audioTracks.some((other) => other !== track && laneIdOf(other) === lane
        && other.startTime < track.endTime - 1e-6 && other.endTime > track.startTime + 1e-6);
      const exists = project.audioTracks.some((other) => other !== track && laneIdOf(other) === lane);
      track.laneId = exists && !busy ? lane : undefined;
    }
    const trackExists = project.layers.some((clip) => trackIdOf(clip) === originalTrack);
    const free = trackExists && !overlapsTrack(project, originalTrack, layer.startTime, layer.endTime);
    layer.trackId = free ? originalTrack : undefined;
    if (free) {
      const index = project.layers.findIndex((clip) => trackIdOf(clip) === originalTrack);
      project.layers.splice(index, 0, layer);
    } else {
      project.layers.unshift(layer);
    }
    pasted.push(layer);
  }
  return pasted;
}

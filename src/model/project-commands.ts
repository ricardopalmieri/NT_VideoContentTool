// Commands added for the UI migration (Batch 1): property sets, audio clips,
// composition, effect order/state, keyframe tracks and track order. Both the
// editor UI and window.vct run these through runProjectCommands.
import { checkField, isRecord, type FieldSpec } from "./command-schema";
import { laneIdOf, overlapsTrack, placeTrack, trackIdOf, visualTracks } from "./clip-tracks";
import { EFFECT_PARAMETERS } from "./effect-catalog";
import { syncLinkedAudioTracks, syncLinkedVideoLayer } from "./linked-media";
import {
  AUDIO_PROPERTIES, COMPOSITION_PROPERTIES, KEYFRAME_PROPERTIES, LAYER_PROPERTIES, LOCK_EXEMPT_PROPERTIES, TIMING_PROPERTIES,
} from "./property-tables";
import { createAudioTrack, type AudioTrack, type Easing, type Keyframe, type Layer, type ProjectDocument } from "./types";
import { syncTransitionAudioFades } from "./transitions";

const EPSILON = 1e-6;
const EASINGS: readonly Easing[] = ["linear", "bezier", "easeIn", "easeOut", "easeInOut", "hold"];

function findLayer(project: ProjectDocument, layerId: string) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`Camada não encontrada: ${layerId}.`);
  return layer;
}

function findAudio(project: ProjectDocument, trackId: string) {
  const track = project.audioTracks.find((item) => item.id === trackId);
  if (!track) throw new Error(`Clipe de áudio não encontrado: ${trackId}.`);
  return track;
}

function parseProps(props: unknown, table: Readonly<Record<string, FieldSpec>>, context: string) {
  if (!isRecord(props) || !Object.keys(props).length) throw new Error(`props deve ser um objeto com ao menos uma propriedade.`);
  for (const [key, value] of Object.entries(props)) {
    if (!Object.hasOwn(table, key)) throw new Error(`Propriedade desconhecida em ${context}: ${key}.`);
    checkField(key, table[key], value);
  }
  return props;
}

function assertTiming(item: Pick<Layer, "startTime" | "endTime">, duration: number, label: string) {
  if (item.endTime <= item.startTime + EPSILON) throw new Error(`${label}: endTime deve ser maior que startTime.`);
  if (item.endTime > duration + EPSILON) throw new Error(`${label}: o clipe deve terminar até ${duration} s (duração da composição).`);
}

function idInUse(project: ProjectDocument, id: string) {
  return project.layers.some((layer) => layer.id === id || layer.trackId === id || layer.effects.some((effect) => effect.id === id))
    || project.audioTracks.some((track) => track.id === id || track.laneId === id || track.effects.some((effect) => effect.id === id))
    || project.postEffects.some((effect) => effect.id === id);
}

export function setLayerProps(project: ProjectDocument, layerId: string, rawProps: unknown, allowOverlap = false) {
  const props = parseProps(rawProps, LAYER_PROPERTIES, "layer.set");
  const layer = findLayer(project, layerId);
  if (layer.locked && Object.keys(props).some((key) => !LOCK_EXEMPT_PROPERTIES.includes(key))) {
    throw new Error(`A camada está bloqueada: ${layer.id}.`);
  }
  if ("text" in props && layer.kind !== "text") throw new Error("text só vale para camadas de texto.");
  Object.assign(layer, props);
  if (Object.keys(props).some((key) => TIMING_PROPERTIES.includes(key))) {
    assertTiming(layer, project.settings.duration, layer.id);
    if (!allowOverlap && overlapsTrack(project, trackIdOf(layer), layer.startTime, layer.endTime, layer.id)) {
      throw new Error(`${layer.id}: o novo tempo sobrepõe outro clipe da faixa (use allowOverlap para transição).`);
    }
    syncLinkedAudioTracks(layer, project.audioTracks);
    syncTransitionAudioFades(project);
  }
  return { layerId: layer.id, props };
}

export interface SetManyCommand {
  layerIds?: string[]; trackId?: string; kind?: Layer["kind"];
  props?: Record<string, unknown>; multiply?: Record<string, number>;
}

/**
 * Same props for many layers (layerIds, trackId and kind narrow the choice together), validated like
 * layer.set. `multiply` scales numeric props by a factor from each layer's current value (fontSize 1.4).
 */
export function setManyLayerProps(project: ProjectDocument, command: SetManyCommand) {
  const { layerIds, trackId, kind, props, multiply } = command;
  if (!layerIds && !trackId && !kind) throw new Error("Informe layerIds, trackId e/ou kind para escolher as camadas.");
  if (!props && !multiply) throw new Error("Informe props e/ou multiply.");
  if (props !== undefined && (!isRecord(props) || !Object.keys(props).length)) throw new Error("props deve ser um objeto com ao menos uma propriedade.");
  if (multiply !== undefined && (!isRecord(multiply) || !Object.keys(multiply).length)) throw new Error("multiply deve ser um objeto com ao menos uma propriedade.");
  for (const [key, factor] of Object.entries(multiply ?? {})) {
    if (!Object.hasOwn(LAYER_PROPERTIES, key) || LAYER_PROPERTIES[key as keyof typeof LAYER_PROPERTIES].type !== "number") {
      throw new Error(`multiply vale só para propriedades numéricas de layer.set: ${key}.`);
    }
    if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0 || factor > 100) throw new Error(`multiply.${key} precisa de um fator maior que 0 e até 100.`);
    if (props && key in props) throw new Error(`${key} aparece em props e em multiply; use só um dos dois.`);
  }
  let layers = layerIds ? layerIds.map((id) => findLayer(project, id)) : [...project.layers];
  if (trackId) layers = layers.filter((layer) => trackIdOf(layer) === trackId);
  if (kind) layers = layers.filter((layer) => layer.kind === kind);
  if (!layers.length) throw new Error("Nenhuma camada corresponde à seleção (layerIds, trackId, kind).");
  for (const layer of layers) {
    const next: Record<string, unknown> = { ...props };
    for (const [key, factor] of Object.entries(multiply ?? {})) {
      const current = (layer as unknown as Record<string, unknown>)[key];
      if (typeof current === "number") next[key] = Math.round(current * factor * 1000) / 1000;
    }
    if (!Object.keys(next).length) continue;
    try {
      setLayerProps(project, layer.id, next);
    } catch (error) {
      throw new Error(`${layer.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { layerIds: layers.map((layer) => layer.id), count: layers.length };
}

/** Fade in/out of a clip in seconds; the linked audio clip gets the same fades (see syncLinkedAudioTracks). */
export function fadeClip(project: ProjectDocument, layerId: string, fadeIn?: number, fadeOut?: number) {
  if (fadeIn === undefined && fadeOut === undefined) throw new Error("Informe in e/ou out (segundos).");
  const layer = findLayer(project, layerId);
  const length = layer.endTime - layer.startTime;
  const inLength = fadeIn ?? Math.max(0, layer.fadeInEnd - layer.fadeInStart);
  const outLength = fadeOut ?? Math.max(0, layer.fadeOutEnd - layer.fadeOutStart);
  if (inLength + outLength > length + EPSILON) {
    throw new Error(`Os fades somam ${+(inLength + outLength).toFixed(3)} s, mais que o clipe (${+length.toFixed(3)} s).`);
  }
  const props: Record<string, number> = {};
  if (fadeIn !== undefined) Object.assign(props, { fadeInStart: layer.startTime, fadeInEnd: +(layer.startTime + fadeIn).toFixed(4) });
  if (fadeOut !== undefined) Object.assign(props, { fadeOutStart: +(layer.endTime - fadeOut).toFixed(4), fadeOutEnd: layer.endTime });
  setLayerProps(project, layerId, props, true);
  return { layerId, fadeIn: inLength, fadeOut: outLength, audioIds: project.audioTracks.filter((track) => track.linked && track.linkedLayerId === layerId).map((track) => track.id) };
}

export function setAudioProps(project: ProjectDocument, trackId: string, rawProps: unknown) {
  const props = parseProps(rawProps, AUDIO_PROPERTIES, "audio.set");
  const track = findAudio(project, trackId);
  Object.assign(track, props);
  if (Object.keys(props).some((key) => TIMING_PROPERTIES.includes(key))) {
    assertTiming(track, project.settings.duration, track.id);
    const video = syncLinkedVideoLayer(track, project.layers, project.audioTracks);
    if (video?.locked) throw new Error(`A camada está bloqueada: ${video.id}.`);
  }
  return { trackId: track.id, props };
}

export function createAudioClip(project: ProjectDocument, command: {
  trackId: string; asset: string; name: string; startTime: number; endTime: number; laneId?: string; props?: unknown;
}) {
  if (idInUse(project, command.trackId)) throw new Error(`O identificador já está em uso: ${command.trackId}.`);
  const duration = command.endTime - command.startTime;
  const track = createAudioTrack(command.name, command.asset, duration, {
    id: command.trackId, startTime: command.startTime, endTime: command.endTime,
    fadeOutStart: command.endTime, fadeOutEnd: command.endTime, fadeInStart: command.startTime, fadeInEnd: command.startTime,
  });
  if (command.laneId) {
    if (!project.audioTracks.some((item) => laneIdOf(item) === command.laneId)) throw new Error(`Faixa de áudio não encontrada: ${command.laneId}.`);
    track.laneId = command.laneId;
  }
  project.audioTracks.push(track);
  if (command.props !== undefined) setAudioProps(project, track.id, command.props);
  assertTiming(track, project.settings.duration, track.id);
  return { trackId: track.id };
}

export function removeAudioClip(project: ProjectDocument, trackId: string) {
  const track = findAudio(project, trackId);
  project.audioTracks = project.audioTracks.filter((item) => item !== track);
  return { trackId: track.id, removed: true };
}

export function linkAudio(project: ProjectDocument, trackId: string, layerId?: string) {
  const track = findAudio(project, trackId);
  const target = layerId ?? track.linkedLayerId;
  if (!target) throw new Error("Informe layerId: este áudio nunca foi vinculado a um vídeo.");
  const layer = findLayer(project, target);
  if (layer.kind !== "video") throw new Error("Só é possível vincular áudio a uma camada de vídeo.");
  track.linked = true;
  track.linkedLayerId = layer.id;
  syncLinkedAudioTracks(layer, project.audioTracks);
  return { trackId: track.id, layerId: layer.id, linked: true };
}

export function unlinkAudio(project: ProjectDocument, trackId: string) {
  const track = findAudio(project, trackId);
  track.linked = false;
  return { trackId: track.id, linked: false };
}

function remapLayer(layer: Layer, oldWidth: number, oldHeight: number, newWidth: number, newHeight: number) {
  const scale = Math.min(newWidth / oldWidth, newHeight / oldHeight);
  const mapX = (value: number) => (value - oldWidth / 2) * scale + newWidth / 2;
  const mapY = (value: number) => (value - oldHeight / 2) * scale + newHeight / 2;
  layer.x = mapX(layer.x);
  layer.y = mapY(layer.y);
  layer.width *= scale;
  layer.height *= scale;
  if (layer.fontSize) layer.fontSize *= scale;
  layer.strokeWidth *= scale;
  for (const keyframe of layer.keyframes.x || []) keyframe.value = mapX(keyframe.value);
  for (const keyframe of layer.keyframes.y || []) keyframe.value = mapY(keyframe.value);
  for (const property of ["width", "height", "fontSize", "strokeWidth"]) {
    for (const keyframe of layer.keyframes[property] || []) keyframe.value *= scale;
  }
}

function recenterLayer(layer: Layer, oldWidth: number, oldHeight: number, newWidth: number, newHeight: number) {
  const shiftX = (newWidth - oldWidth) / 2;
  const shiftY = (newHeight - oldHeight) / 2;
  layer.x += shiftX;
  layer.y += shiftY;
  for (const keyframe of layer.keyframes.x || []) keyframe.value += shiftX;
  for (const keyframe of layer.keyframes.y || []) keyframe.value += shiftY;
}

export function setComposition(project: ProjectDocument, rawProps: unknown, resize: "adapt" | "keep" = "adapt") {
  const props = parseProps(rawProps, COMPOSITION_PROPERTIES, "composition.set") as Partial<ProjectDocument["settings"]>;
  const width = props.width ?? project.settings.width;
  const height = props.height ?? project.settings.height;
  if (width * height > 33_554_432) throw new Error("A composição excede o limite seguro de pixels para a GPU.");
  const { width: oldWidth, height: oldHeight } = project.settings;
  if (width !== oldWidth || height !== oldHeight) {
    for (const layer of project.layers) {
      if (resize === "adapt") remapLayer(layer, oldWidth, oldHeight, width, height);
      else recenterLayer(layer, oldWidth, oldHeight, width, height);
    }
  }
  const cleared = (["workArea", "grid"] as const).filter((key) => key in (rawProps as object) && (rawProps as Record<string, unknown>)[key] === null);
  if ("workArea" in props) {
    const area = props.workArea as unknown;
    if (area === null) delete props.workArea;
    else if (!isRecord(area) || Object.keys(area).some((key) => key !== "in" && key !== "out")) throw new Error("workArea deve ser {in, out}.");
    else {
      checkField("workArea.in", { type: "number", min: 0, max: 7200 }, area.in);
      checkField("workArea.out", { type: "number", min: 0, max: 7200 }, area.out);
      if ((area.out as number) <= (area.in as number)) throw new Error("workArea.out deve ser maior que workArea.in.");
    }
  }
  if ("grid" in props) {
    const grid = props.grid as unknown;
    if (grid === null) delete props.grid;
    else if (!isRecord(grid) || Object.keys(grid).some((key) => !["bpm", "offset", "beatsPerBar"].includes(key))) throw new Error("grid deve ser {bpm, offset, beatsPerBar}.");
    else {
      checkField("grid.bpm", { type: "number", min: 20, max: 400 }, grid.bpm);
      grid.offset ??= 0;
      grid.beatsPerBar ??= 4;
      checkField("grid.offset", { type: "number", min: 0, max: 60 }, grid.offset);
      checkField("grid.beatsPerBar", { type: "number", min: 1, max: 16, integer: true }, grid.beatsPerBar);
    }
  }
  Object.assign(project.settings, props);
  for (const key of cleared) delete project.settings[key];
  const end = project.settings.workArea?.out;
  if (end !== undefined && end > project.settings.duration + EPSILON) throw new Error("workArea.out passa da duração da composição.");
  if (props.duration !== undefined) {
    const late = [...project.layers, ...project.audioTracks].find((item) => item.endTime > props.duration! + EPSILON);
    if (late) throw new Error(`O clipe ${late.id} termina depois de ${props.duration} s. Corte ou mova antes de encurtar a composição.`);
  }
  return { settings: structuredClone(project.settings) };
}

function moveInList<T extends { id: string }>(list: T[], id: string, index: number) {
  const from = list.findIndex((item) => item.id === id);
  if (from < 0) return false;
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, index)), 0, item);
  return true;
}

export function setEffect(project: ProjectDocument, effectId: string, patch: { enabled?: boolean; name?: string }) {
  for (const layer of project.layers) {
    const effect = layer.effects.find((item) => item.id === effectId);
    if (!effect) continue;
    if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
    Object.assign(effect, patch);
    return { effectId, ...patch };
  }
  const post = project.postEffects.find((item) => item.id === effectId);
  if (!post) throw new Error(`Efeito não encontrado: ${effectId}.`);
  Object.assign(post, patch);
  return { effectId, ...patch };
}

export function reorderEffect(project: ProjectDocument, effectId: string, index: number) {
  for (const layer of project.layers) {
    if (!layer.effects.some((item) => item.id === effectId)) continue;
    if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
    moveInList(layer.effects, effectId, index);
    return { effectId, index: layer.effects.findIndex((item) => item.id === effectId) };
  }
  if (!moveInList(project.postEffects, effectId, index)) throw new Error(`Efeito não encontrado: ${effectId}.`);
  return { effectId, index: project.postEffects.findIndex((item) => item.id === effectId) };
}

export function setAudioEffect(project: ProjectDocument, effectId: string, patch: { enabled?: boolean }) {
  for (const track of project.audioTracks) {
    const effect = track.effects.find((item) => item.id === effectId);
    if (!effect) continue;
    Object.assign(effect, patch);
    return { effectId, ...patch };
  }
  throw new Error(`Efeito de áudio não encontrado: ${effectId}.`);
}

export function reorderAudioEffect(project: ProjectDocument, effectId: string, index: number) {
  for (const track of project.audioTracks) {
    if (!moveInList(track.effects, effectId, index)) continue;
    return { effectId, index: track.effects.findIndex((item) => item.id === effectId) };
  }
  throw new Error(`Efeito de áudio não encontrado: ${effectId}.`);
}

function parseKeys(keys: unknown, duration: number, valueSpec: FieldSpec = { type: "number" }): Keyframe[] {
  if (!Array.isArray(keys) || keys.length > 2000) throw new Error("keys deve ser uma lista com até 2000 keyframes.");
  const parsed = keys.map((key, index) => {
    if (!isRecord(key)) throw new Error(`Keyframe ${index} inválido.`);
    for (const field of Object.keys(key)) if (!["time", "value", "easing", "curve"].includes(field)) throw new Error(`Campo desconhecido no keyframe: ${field}.`);
    checkField("time", { type: "number", min: 0, max: duration }, key.time);
    checkField("value", valueSpec, key.value);
    const easing = (key.easing ?? "easeInOut") as Easing;
    if (!EASINGS.includes(easing)) throw new Error("easing não é suportado.");
    const result: Keyframe = { time: key.time as number, value: key.value as number, easing };
    if (key.curve !== undefined) {
      checkField("curve", { type: "number", min: 0, max: 1 }, key.curve);
      result.curve = key.curve as number;
    }
    return result;
  });
  return parsed.sort((a, b) => a.time - b.time);
}

/** Replaces a whole keyframe track; an empty list removes the animation. */
export function setLayerKeyframes(project: ProjectDocument, layerId: string, property: string, keys: unknown) {
  const layer = findLayer(project, layerId);
  if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
  if (!(KEYFRAME_PROPERTIES as readonly string[]).includes(property) && property !== "fillColor" && property !== "strokeColor") {
    throw new Error(`Trilha de keyframes não permitida: ${property}.`);
  }
  const valueSpec: FieldSpec = property === "fillColor" || property === "strokeColor"
    ? { type: "number", min: 0, max: 0xffffff, integer: true }
    : (LAYER_PROPERTIES as Record<string, FieldSpec>)[property];
  const parsed = parseKeys(keys, project.settings.duration, valueSpec);
  if (parsed.length) layer.keyframes[property] = parsed;
  else delete layer.keyframes[property];
  return { layerId, property, count: parsed.length };
}

export function setEffectKeyframes(project: ProjectDocument, effectId: string, property: string, keys: unknown) {
  const owner = project.layers.find((layer) => layer.effects.some((effect) => effect.id === effectId));
  const effect = owner?.effects.find((item) => item.id === effectId) ?? project.postEffects.find((item) => item.id === effectId);
  if (!effect) throw new Error(`Efeito não encontrado: ${effectId}.`);
  if (owner?.locked) throw new Error(`A camada está bloqueada: ${owner.id}.`);
  if (property !== "mix" && !(property in effect.params)) throw new Error(`Parâmetro desconhecido: ${property}.`);
  const definition = property === "mix" ? [0, 1] : EFFECT_PARAMETERS[effect.kind].find((item) => item[1] === property)?.slice(2, 4);
  const parsed = parseKeys(keys, project.settings.duration, definition ? { type: "number", min: definition[0] as number, max: definition[1] as number } : { type: "number" });
  effect.keyframes ||= {};
  if (parsed.length) effect.keyframes[property] = parsed;
  else delete effect.keyframes[property];
  return { effectId, property, count: parsed.length };
}

/** Moves a whole visual track to an index (0 = top). */
export function reorderTrack(project: ProjectDocument, trackId: string, index: number) {
  const tracks = visualTracks(project);
  const from = tracks.findIndex((track) => track.id === trackId);
  if (from < 0) throw new Error(`Faixa não encontrada: ${trackId}.`);
  const clamped = Math.max(0, Math.min(tracks.length - 1, index));
  if (clamped !== from) {
    const target = tracks[clamped].id;
    placeTrack(project, trackId, target, clamped > from);
  }
  return { trackId, index: visualTracks(project).findIndex((track) => track.id === trackId) };
}

/** Moves an audio lane to an index (0 = first lane). */
export function reorderAudioLane(project: ProjectDocument, laneId: string, index: number) {
  const lanes = new Map<string, AudioTrack[]>();
  for (const track of project.audioTracks) {
    const id = laneIdOf(track);
    lanes.set(id, [...(lanes.get(id) ?? []), track]);
  }
  const order = [...lanes.keys()];
  for (const track of project.tracks ?? []) if (track.kind === "audio" && !order.includes(track.id)) order.push(track.id);
  const from = order.indexOf(laneId);
  if (from < 0) throw new Error(`Faixa de áudio não encontrada: ${laneId}.`);
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(order.length, index)), 0, laneId);
  project.audioTracks = order.flatMap((id) => lanes.get(id) ?? []);
  if (project.tracks) {
    // Named lanes (empty ones included) follow the same order.
    const meta = project.tracks.filter((track) => track.kind === "audio");
    const named = new Map(meta.map((track) => [track.id, track]));
    const ordered = [...order.filter((id) => named.has(id)).map((id) => named.get(id)!), ...meta.filter((track) => !order.includes(track.id))];
    project.tracks = [...project.tracks.filter((track) => track.kind === "video"), ...ordered];
  }
  return { laneId, index: order.indexOf(laneId) };
}

/** Moves an audio clip to another lane, or to a new lane when laneId is omitted. */
export function moveAudioClip(project: ProjectDocument, trackId: string, startTime: number, laneId?: string) {
  const track = findAudio(project, trackId);
  const delta = startTime - track.startTime;
  track.startTime += delta; track.endTime += delta;
  track.fadeInStart += delta; track.fadeInEnd += delta; track.fadeOutStart += delta; track.fadeOutEnd += delta;
  assertTiming(track, project.settings.duration, track.id);
  if (laneId !== undefined) {
    if (laneId !== laneIdOf(track) && !project.audioTracks.some((item) => item !== track && laneIdOf(item) === laneId)) {
      throw new Error(`Faixa de áudio não encontrada: ${laneId}.`);
    }
    const busy = project.audioTracks.some((item) => item !== track && laneIdOf(item) === laneId
      && item.startTime < track.endTime - EPSILON && item.endTime > track.startTime + EPSILON);
    if (busy) throw new Error("Faixa de áudio de destino ocupada.");
    track.laneId = laneId === track.id ? undefined : laneId;
  }
  const video = syncLinkedVideoLayer(track, project.layers, project.audioTracks);
  if (video?.locked) throw new Error(`A camada está bloqueada: ${video.id}.`);
  return { trackId: track.id, laneId: laneIdOf(track), startTime: track.startTime, endTime: track.endTime };
}

export { trackIdOf };

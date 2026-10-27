import { AUDIO_EFFECT_KINDS, EFFECT_KINDS } from "./effect-catalog";
import { isTransitionType } from "./transitions";
import type { ProjectDocument } from "./types";

const inputKinds = new Set(["image", "video", "guide", "geometry", "text"]);
const easings = new Set(["linear", "bezier", "easeIn", "easeOut", "easeInOut", "hold"]);
const maxDimension = 8192;
const maxDuration = 7200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateKeyframes(value: unknown, path: string, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`${path} deve ser um objeto de trilhas.`);
    return;
  }
  for (const [property, keys] of Object.entries(value)) {
    if (!Array.isArray(keys)) {
      issues.push(`${path}.${property} deve ser uma lista.`);
      continue;
    }
    keys.forEach((key, index) => {
      const keyPath = `${path}.${property}[${index}]`;
      if (!isRecord(key)) {
        issues.push(`${keyPath} contém um keyframe inválido.`);
        return;
      }
      const time = key.time;
      const easing = key.easing;
      const curve = key.curve;
      if (!hasFiniteNumber(time) || time < 0 || time > maxDuration
        || !hasFiniteNumber(key.value)
        || typeof easing !== "string" || !easings.has(easing)
        || (curve !== undefined && (!hasFiniteNumber(curve) || curve < 0 || curve > 1))) {
        issues.push(`${keyPath} contém um keyframe inválido.`);
      }
    });
  }
}

function validateEffect(value: unknown, path: string, audio: boolean, issues: string[], ids: Set<string>) {
  if (!isRecord(value)) {
    issues.push(`${path} deve ser um efeito.`);
    return;
  }
  const kinds = audio ? AUDIO_EFFECT_KINDS : EFFECT_KINDS;
  if (typeof value.id !== "string" || !value.id.trim()) issues.push(`${path}.id é obrigatório.`);
  else if (ids.has(value.id)) issues.push(`${path}.id duplicado: ${value.id}.`);
  else ids.add(value.id);
  if (typeof value.kind !== "string" || !kinds.includes(value.kind as never)) issues.push(`${path}.kind não é suportado.`);
  if (typeof value.enabled !== "boolean") issues.push(`${path}.enabled deve ser booleano.`);
  if (!isRecord(value.params)
    || Object.entries(value.params).some(([key, parameter]) => !key || !hasFiniteNumber(parameter))) {
    issues.push(`${path}.params contém parâmetros inválidos.`);
  }
  if (!audio) validateKeyframes(value.keyframes, `${path}.keyframes`, issues);
}

export function hasValidProjectEnvelope(value: unknown): boolean {
  if (!isRecord(value) || value.format !== "noisetupi-video-content-tool") return false;
  const settings = value.settings;
  const layers = value.layers;
  const audioTracks = value.audioTracks;
  const postEffects = value.postEffects;
  const assetMetadata = value.assetMetadata;
  if (!isRecord(settings) || !Array.isArray(layers)) return false;

  return typeof settings.name === "string"
    && hasFiniteNumber(settings.width)
    && hasFiniteNumber(settings.height)
    && hasFiniteNumber(settings.fps)
    && hasFiniteNumber(settings.duration)
    && typeof settings.background === "string"
    && typeof settings.transparent === "boolean"
    && layers.every((layer) => isRecord(layer) && inputKinds.has(String(layer.kind)))
    && (audioTracks === undefined || (Array.isArray(audioTracks) && audioTracks.every((track) => isRecord(track) && typeof track.asset === "string")))
    && (postEffects === undefined || (Array.isArray(postEffects) && postEffects.every(isRecord)))
    && (assetMetadata === undefined || (isRecord(assetMetadata) && Object.values(assetMetadata).every((metadata) =>
      isRecord(metadata)
      && typeof metadata.originalName === "string"
      && hasFiniteNumber(metadata.size) && Number(metadata.size) >= 0
      && hasFiniteNumber(metadata.lastModified) && Number(metadata.lastModified) >= 0
      && typeof metadata.mimeType === "string"
      && (metadata.sourcePath === undefined || typeof metadata.sourcePath === "string"))));
}

export function validateProjectDocument(value: unknown) {
  const issues: string[] = [];
  if (!hasValidProjectEnvelope(value) || !isRecord(value)) {
    return { valid: false, issues: ["Envelope ou formato do projeto inválido."] };
  }

  const settings = value.settings as Record<string, unknown>;
  const projectName = settings.name as string;
  if (!projectName.trim() || projectName.length > 200) issues.push("settings.name deve ter entre 1 e 200 caracteres.");
  for (const dimension of ["width", "height"] as const) {
    const number = settings[dimension] as number;
    if (!Number.isInteger(number) || number < 16 || number > maxDimension) {
      issues.push(`settings.${dimension} deve ser inteiro entre 16 e ${maxDimension}.`);
    }
  }
  const fps = settings.fps as number;
  const duration = settings.duration as number;
  if (!Number.isInteger(fps) || fps < 1 || fps > 240) issues.push("settings.fps deve ser inteiro entre 1 e 240.");
  if (duration < .1 || duration > maxDuration) issues.push(`settings.duration deve estar entre 0.1 e ${maxDuration} segundos.`);
  if (!/^#[\da-f]{6}$/i.test(settings.background as string)) issues.push("settings.background deve ser uma cor hexadecimal RGB.");

  const ids = new Set<string>();
  const layers = value.layers as unknown[];
  layers.forEach((entry, index) => {
    const path = `layers[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${path} deve ser uma camada.`);
      return;
    }
    const layer = entry;
    if (typeof layer.id !== "string" || !layer.id.trim()) issues.push(`${path}.id é obrigatório.`);
    else if (ids.has(layer.id)) issues.push(`${path}.id duplicado: ${layer.id}.`);
    else ids.add(layer.id);
    if (typeof layer.name !== "string" || !layer.name.trim()) issues.push(`${path}.name é obrigatório.`);
    if (layer.trackId !== undefined && (typeof layer.trackId !== "string" || !layer.trackId.trim())) {
      issues.push(`${path}.trackId deve ser um texto não vazio.`);
    }
    if (layer.transition !== undefined) {
      if (!isRecord(layer.transition)
        || !isTransitionType(layer.transition.type)
        || !hasFiniteNumber(layer.transition.duration)
        || layer.transition.duration < 0
        || layer.transition.duration > maxDuration) {
        issues.push(`${path}.transition é inválida.`);
      }
    }
    for (const key of ["visible", "locked", "exportable", "reverse", "loop", "scaleLocked", "sizeLocked", "fillEnabled", "strokeEnabled"]) {
      if (typeof layer[key] !== "boolean") issues.push(`${path}.${key} deve ser booleano.`);
    }
    if (layer.asset !== undefined && typeof layer.asset !== "string") issues.push(`${path}.asset deve ser texto.`);
    for (const key of ["fill", "stroke"]) {
      if (typeof layer[key] !== "string") issues.push(`${path}.${key} deve ser texto.`);
    }
    for (const key of [
      "fillOpacity", "strokeOpacity", "strokeWidth", "x", "y", "width", "height", "scaleX", "scaleY",
      "rotation", "opacity", "startTime", "endTime", "sourceOffset", "sourceIn", "sourceOut", "playbackRate",
      "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd",
    ]) {
      if (!hasFiniteNumber(layer[key])) issues.push(`${path}.${key} deve ser um número finito.`);
    }
    if (hasFiniteNumber(layer.startTime) && layer.startTime < 0) issues.push(`${path}.startTime não pode ser negativo.`);
    const layerStart = layer.startTime;
    const layerEnd = layer.endTime;
    const layerPlaybackRate = layer.playbackRate;
    if (hasFiniteNumber(layerEnd) && hasFiniteNumber(layerStart) && layerEnd <= layerStart) issues.push(`${path}.endTime deve ser posterior a startTime.`);
    if (hasFiniteNumber(layerPlaybackRate) && layerPlaybackRate <= 0) issues.push(`${path}.playbackRate deve ser maior que zero.`);
    if (!Array.isArray(layer.effects)) issues.push(`${path}.effects deve ser uma lista.`);
    else layer.effects.forEach((effect, effectIndex) => validateEffect(effect, `${path}.effects[${effectIndex}]`, false, issues, ids));
    validateKeyframes(layer.keyframes, `${path}.keyframes`, issues);
  });

  const audioTracks = value.audioTracks === undefined ? [] : value.audioTracks as unknown[];
  audioTracks.forEach((entry, index) => {
    const path = `audioTracks[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${path} deve ser uma faixa.`);
      return;
    }
    const track = entry;
    if (typeof track.id !== "string" || !track.id.trim()) issues.push(`${path}.id é obrigatório.`);
    else if (ids.has(track.id)) issues.push(`${path}.id duplicado: ${track.id}.`);
    else ids.add(track.id);
    if (typeof track.name !== "string" || typeof track.asset !== "string" || !track.asset) issues.push(`${path} precisa de nome e referência de mídia.`);
    if (track.laneId !== undefined && (typeof track.laneId !== "string" || !track.laneId.trim())) {
      issues.push(`${path}.laneId deve ser um texto não vazio.`);
    }
    for (const key of ["linked", "muted", "reverse", "loop"]) {
      if (typeof track[key] !== "boolean") issues.push(`${path}.${key} deve ser booleano.`);
    }
    for (const key of ["volume", "startTime", "endTime", "sourceIn", "sourceOut", "playbackRate", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"]) {
      if (!hasFiniteNumber(track[key])) issues.push(`${path}.${key} deve ser um número finito.`);
    }
    if (hasFiniteNumber(track.startTime) && track.startTime < 0) issues.push(`${path}.startTime não pode ser negativo.`);
    const trackStart = track.startTime;
    const trackEnd = track.endTime;
    const trackPlaybackRate = track.playbackRate;
    if (hasFiniteNumber(trackEnd) && hasFiniteNumber(trackStart) && trackEnd <= trackStart) issues.push(`${path}.endTime deve ser posterior a startTime.`);
    if (hasFiniteNumber(trackPlaybackRate) && trackPlaybackRate <= 0) issues.push(`${path}.playbackRate deve ser maior que zero.`);
    if (!Array.isArray(track.effects)) issues.push(`${path}.effects deve ser uma lista.`);
    else track.effects.forEach((effect, effectIndex) => validateEffect(effect, `${path}.effects[${effectIndex}]`, true, issues, ids));
  });

  if (!Array.isArray(value.postEffects)) issues.push("postEffects deve ser uma lista.");
  else value.postEffects.forEach((effect, index) => validateEffect(effect, `postEffects[${index}]`, false, issues, ids));
  if (value.tracks !== undefined) {
    const trackIds = new Set<string>();
    if (!Array.isArray(value.tracks)) issues.push("tracks deve ser uma lista.");
    else value.tracks.forEach((track, index) => {
      if (!isRecord(track) || typeof track.id !== "string" || !track.id.trim() || trackIds.has(track.id)
        || typeof track.name !== "string" || !track.name.trim() || track.name.length > 200
        || (track.kind !== "video" && track.kind !== "audio")) issues.push(`tracks[${index}] inválida (id único, name 1–200, kind video|audio).`);
      else trackIds.add(track.id);
    });
  }
  return { valid: issues.length === 0, issues };
}

export function assertValidProjectDocument(value: unknown): asserts value is ProjectDocument {
  const result = validateProjectDocument(value);
  if (!result.valid) throw new Error(`Projeto inválido: ${result.issues.join(" ")}`);
}

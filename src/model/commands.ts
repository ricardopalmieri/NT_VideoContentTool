import {
  AUDIO_EFFECT_CATALOG,
  AUDIO_EFFECT_PARAMETERS,
  EFFECT_CATALOG,
  EFFECT_PARAMETERS,
} from "./effect-catalog";
import { syncLinkedAudioTracks } from "./linked-media";
import { toggleKeyframe, upsertKeyframe } from "./keyframes";
import { assertValidProjectDocument } from "./validate-project";
import type { AudioEffectKind, Easing, EffectKind, Keyframe, ProjectDocument } from "./types";

type LayerNumericProperty =
  | "x" | "y" | "scaleX" | "scaleY" | "rotation" | "opacity" | "width" | "height"
  | "startTime" | "endTime" | "playbackRate" | "sourceIn" | "sourceOut"
  | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd"
  | "fontSize" | "fontWeight" | "fillOpacity" | "strokeOpacity" | "strokeWidth";
const numericLayerProperties: readonly LayerNumericProperty[] = [
  "x", "y", "scaleX", "scaleY", "rotation", "opacity", "width", "height",
  "startTime", "endTime", "playbackRate", "sourceIn", "sourceOut",
  "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd",
  "fontSize", "fontWeight", "fillOpacity", "strokeOpacity", "strokeWidth",
];
const easingValues = new Set<Easing>(["linear", "bezier", "easeIn", "easeOut", "easeInOut", "hold"]);
const maxCommandsPerBatch = 100;
const layerNumericRanges: Record<LayerNumericProperty, readonly [number, number]> = {
  x: [-32768, 32768], y: [-32768, 32768], scaleX: [-20, 20], scaleY: [-20, 20],
  rotation: [-3600, 3600], opacity: [0, 1], width: [1, 16384], height: [1, 16384],
  startTime: [0, 7200], endTime: [.001, 7200], playbackRate: [.05, 8], sourceIn: [0, 7200],
  sourceOut: [0, 7200], fadeInStart: [0, 7200], fadeInEnd: [0, 7200], fadeOutStart: [0, 7200],
  fadeOutEnd: [0, 7200], fontSize: [4, 2000], fontWeight: [100, 900], fillOpacity: [0, 1],
  strokeOpacity: [0, 1], strokeWidth: [0, 1000],
};

function isNumericLayerProperty(property: string): property is LayerNumericProperty {
  return numericLayerProperties.includes(property as LayerNumericProperty);
}

export type VctCommand =
  | { type: "layer.setNumeric"; layerId: string; property: string; value: number }
  | { type: "layer.setName"; layerId: string; name: string }
  | { type: "keyframe.upsert"; layerId: string; property: string; time: number; value: number; easing?: Easing }
  | { type: "keyframe.toggle"; layerId: string; property: string; time: number; value: number; easing?: Easing }
  | { type: "effect.keyframe.upsert"; effectId: string; property: string; time: number; value: number; easing?: Easing }
  | { type: "effect.keyframe.toggle"; effectId: string; property: string; time: number; value: number; easing?: Easing }
  | { type: "effect.add"; kind: EffectKind; ownerId: string; effectId: string }
  | { type: "effect.setParam"; effectId: string; parameter: string; value: number }
  | { type: "effect.remove"; effectId: string }
  | { type: "audioEffect.add"; trackId: string; kind: AudioEffectKind; effectId: string }
  | { type: "audioEffect.setParam"; effectId: string; parameter: string; value: number }
  | { type: "audioEffect.remove"; effectId: string };

export interface CommandResult {
  project: ProjectDocument;
  results: unknown[];
  commands: readonly VctCommand[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} precisa ser um texto não vazio.`);
  return value;
}

function finiteNumber(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} precisa ser um número finito.`);
  return value;
}

function parseCommand(value: unknown): VctCommand {
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Comando VCT inválido.");
  switch (value.type) {
    case "layer.setNumeric":
      return {
        type: value.type,
        layerId: requiredText(value.layerId, "layerId"),
        property: requiredText(value.property, "property"),
        value: finiteNumber(value.value, "value"),
      };
    case "layer.setName":
      return {
        type: value.type,
        layerId: requiredText(value.layerId, "layerId"),
        name: requiredText(value.name, "name"),
      };
    case "keyframe.upsert":
    case "keyframe.toggle":
    case "effect.keyframe.upsert":
    case "effect.keyframe.toggle": {
      const easing = value.easing === undefined ? "easeInOut" : value.easing;
      if (typeof easing !== "string" || !easingValues.has(easing as Easing)) throw new Error("easing não é suportado.");
      const base = {
        property: requiredText(value.property, "property"),
        time: finiteNumber(value.time, "time"),
        value: finiteNumber(value.value, "value"),
        easing: easing as Easing,
      };
      if (value.type === "effect.keyframe.upsert" || value.type === "effect.keyframe.toggle") {
        return { ...base, type: value.type, effectId: requiredText(value.effectId, "effectId") };
      }
      return {
        ...base,
        type: value.type,
        layerId: requiredText(value.layerId, "layerId"),
      };
    }
    case "effect.add":
      return {
        type: value.type,
        kind: requiredText(value.kind, "kind") as EffectKind,
        ownerId: requiredText(value.ownerId, "ownerId"),
        effectId: requiredText(value.effectId, "effectId"),
      };
    case "effect.setParam":
      return {
        type: value.type,
        effectId: requiredText(value.effectId, "effectId"),
        parameter: requiredText(value.parameter, "parameter"),
        value: finiteNumber(value.value, "value"),
      };
    case "effect.remove":
      return { type: value.type, effectId: requiredText(value.effectId, "effectId") };
    case "audioEffect.add":
      return {
        type: value.type,
        trackId: requiredText(value.trackId, "trackId"),
        kind: requiredText(value.kind, "kind") as AudioEffectKind,
        effectId: requiredText(value.effectId, "effectId"),
      };
    case "audioEffect.setParam":
      return {
        type: value.type,
        effectId: requiredText(value.effectId, "effectId"),
        parameter: requiredText(value.parameter, "parameter"),
        value: finiteNumber(value.value, "value"),
      };
    case "audioEffect.remove":
      return { type: value.type, effectId: requiredText(value.effectId, "effectId") };
    default:
      throw new Error(`Comando VCT não suportado: ${value.type}.`);
  }
}

function findLayer(project: ProjectDocument, layerId: string) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`Camada não encontrada: ${layerId}.`);
  return layer;
}

function findEffect(project: ProjectDocument, effectId: string) {
  for (const layer of project.layers) {
    const effect = layer.effects.find((item) => item.id === effectId);
    if (effect) return effect;
  }
  return project.postEffects.find((item) => item.id === effectId);
}

function findEffectOwner(project: ProjectDocument, effectId: string) {
  return project.layers.find((layer) => layer.effects.some((effect) => effect.id === effectId));
}

function findAudioEffect(project: ProjectDocument, effectId: string) {
  for (const track of project.audioTracks) {
    const effect = track.effects.find((item) => item.id === effectId);
    if (effect) return effect;
  }
}

function validateEffectParameter(effect: { kind: EffectKind; params: Record<string, number> }, parameter: string, value: number) {
  const definition = parameter === "mix"
    ? ["DRY / WET", "mix", 0, 1, .01] as const
    : EFFECT_PARAMETERS[effect.kind].find((item) => item[1] === parameter);
  if (!definition || value < definition[2] || value > definition[3]) {
    throw new Error(`Valor fora dos limites do parâmetro ${parameter}.`);
  }
}

function validateAudioEffectParameter(
  effect: { kind: AudioEffectKind },
  parameter: string,
  value: number,
) {
  const definition = AUDIO_EFFECT_PARAMETERS[effect.kind].find((item) => item[1] === parameter);
  if (!definition || value < definition[2] || value > definition[3]) {
    throw new Error(`Valor fora dos limites do parâmetro ${parameter}.`);
  }
}

function executeCommand(project: ProjectDocument, command: VctCommand, tolerance: number) {
  switch (command.type) {
    case "layer.setNumeric": {
      if (!isNumericLayerProperty(command.property)) throw new Error(`Propriedade numérica não permitida: ${command.property}.`);
      const layer = findLayer(project, command.layerId);
      if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
      const [min, max] = layerNumericRanges[command.property];
      if (command.value < min || command.value > max) throw new Error(`${command.property} deve estar entre ${min} e ${max}.`);
      layer[command.property] = command.value;
      if (layer.kind === "video" && [
        "startTime", "endTime", "sourceIn", "sourceOut", "playbackRate",
        "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd",
      ].includes(command.property)) {
        syncLinkedAudioTracks(layer, project.audioTracks);
      }
      return { layerId: layer.id, property: command.property, value: command.value };
    }
    case "layer.setName": {
      const layer = findLayer(project, command.layerId);
      if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
      layer.name = command.name.slice(0, 200);
      return { layerId: layer.id, name: layer.name };
    }
    case "keyframe.upsert":
    case "keyframe.toggle": {
      const layer = findLayer(project, command.layerId);
      if (!isNumericLayerProperty(command.property) && !["fillColor", "strokeColor"].includes(command.property)) {
        throw new Error(`Trilha de keyframes não permitida: ${command.property}.`);
      }
      if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
      if (command.time < 0 || command.time > project.settings.duration) {
        throw new Error(`O tempo do keyframe deve estar entre 0 e ${project.settings.duration} segundos.`);
      }
      if (command.property === "fillColor" || command.property === "strokeColor") {
        if (command.value < 0 || command.value > 0xffffff || !Number.isInteger(command.value)) {
          throw new Error("O valor do keyframe de cor deve ser RGB inteiro.");
        }
      } else if (isNumericLayerProperty(command.property)) {
        const [min, max] = layerNumericRanges[command.property];
        if (command.value < min || command.value > max) throw new Error(`${command.property} deve estar entre ${min} e ${max}.`);
      }
      const keys = layer.keyframes[command.property] || [];
      const result = command.type === "keyframe.upsert"
        ? upsertKeyframe(keys, command.time, command.value, tolerance, command.easing || "easeInOut")
        : toggleKeyframe(keys, command.time, command.value, tolerance, command.easing || "easeInOut");
      layer.keyframes[command.property] = result.keyframes as Keyframe[];
      return { layerId: layer.id, property: command.property, ...result };
    }
    case "effect.keyframe.upsert":
    case "effect.keyframe.toggle": {
      const effect = findEffect(project, command.effectId);
      if (!effect) throw new Error(`Efeito não encontrado: ${command.effectId}.`);
      const owner = findEffectOwner(project, command.effectId);
      if (owner?.locked) throw new Error(`A camada está bloqueada: ${owner.id}.`);
      validateEffectParameter(effect, command.property, command.value);
      if (command.time < 0 || command.time > project.settings.duration) {
        throw new Error(`O tempo do keyframe deve estar entre 0 e ${project.settings.duration} segundos.`);
      }
      effect.keyframes ||= {};
      const keys = effect.keyframes[command.property] || [];
      const result = command.type === "effect.keyframe.upsert"
        ? upsertKeyframe(keys, command.time, command.value, tolerance, command.easing || "easeInOut")
        : toggleKeyframe(keys, command.time, command.value, tolerance, command.easing || "easeInOut");
      effect.keyframes[command.property] = result.keyframes;
      return { effectId: effect.id, property: command.property, ...result };
    }
    case "effect.add": {
      const definition = EFFECT_CATALOG[command.kind];
      if (!definition) throw new Error(`Efeito não suportado: ${command.kind}.`);
      if (project.layers.some((layer) => layer.effects.some((effect) => effect.id === command.effectId))
        || project.postEffects.some((effect) => effect.id === command.effectId)
        || project.layers.some((layer) => layer.id === command.effectId)
        || project.audioTracks.some((track) => track.id === command.effectId || track.effects.some((effect) => effect.id === command.effectId))) {
        throw new Error(`O identificador já está em uso: ${command.effectId}.`);
      }
      const effect = {
        id: command.effectId,
        kind: command.kind,
        name: command.kind,
        enabled: true,
        params: { mix: 1, ...definition.defaults },
        keyframes: {},
      };
      if (definition.category === "post") {
        if (command.ownerId !== "__post__") throw new Error(`${command.kind} só pode ser aplicado em pós-produção.`);
        project.postEffects.push(effect);
      } else {
        if (command.ownerId === "__post__") throw new Error(`${command.kind} precisa ser aplicado a uma camada.`);
        const owner = findLayer(project, command.ownerId);
        if (owner.locked) throw new Error(`A camada está bloqueada: ${owner.id}.`);
        owner.effects.push(effect);
      }
      return { effectId: effect.id, kind: effect.kind, ownerId: command.ownerId };
    }
    case "effect.setParam": {
      const effect = findEffect(project, command.effectId);
      if (!effect) throw new Error(`Efeito não encontrado: ${command.effectId}.`);
      const owner = findEffectOwner(project, command.effectId);
      if (owner?.locked) throw new Error(`A camada está bloqueada: ${owner.id}.`);
      validateEffectParameter(effect, command.parameter, command.value);
      effect.params[command.parameter] = command.value;
      return { effectId: effect.id, parameter: command.parameter, value: command.value };
    }
    case "effect.remove": {
      for (const layer of project.layers) {
        const index = layer.effects.findIndex((effect) => effect.id === command.effectId);
        if (index >= 0) {
          if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
          layer.effects.splice(index, 1);
          return { effectId: command.effectId, removed: true };
        }
      }
      const index = project.postEffects.findIndex((effect) => effect.id === command.effectId);
      if (index >= 0) {
        project.postEffects.splice(index, 1);
        return { effectId: command.effectId, removed: true };
      }
      throw new Error(`Efeito não encontrado: ${command.effectId}.`);
    }
    case "audioEffect.add": {
      const definition = AUDIO_EFFECT_CATALOG[command.kind];
      if (!definition) throw new Error(`Efeito de áudio não suportado: ${command.kind}.`);
      const track = project.audioTracks.find((item) => item.id === command.trackId);
      if (!track) throw new Error(`Faixa de áudio não encontrada: ${command.trackId}.`);
      const idInUse = project.layers.some((layer) => layer.id === command.effectId || layer.effects.some((effect) => effect.id === command.effectId))
        || project.audioTracks.some((item) => item.id === command.effectId || item.effects.some((effect) => effect.id === command.effectId))
        || project.postEffects.some((effect) => effect.id === command.effectId);
      if (idInUse) throw new Error(`O identificador já está em uso: ${command.effectId}.`);
      track.effects.push({ id: command.effectId, kind: command.kind, enabled: true, params: { ...definition.defaults } });
      return { effectId: command.effectId, kind: command.kind, trackId: track.id };
    }
    case "audioEffect.setParam": {
      const effect = findAudioEffect(project, command.effectId);
      if (!effect) throw new Error(`Efeito de áudio não encontrado: ${command.effectId}.`);
      validateAudioEffectParameter(effect, command.parameter, command.value);
      effect.params[command.parameter] = command.value;
      return { effectId: effect.id, parameter: command.parameter, value: command.value };
    }
    case "audioEffect.remove": {
      for (const track of project.audioTracks) {
        const index = track.effects.findIndex((effect) => effect.id === command.effectId);
        if (index >= 0) {
          track.effects.splice(index, 1);
          return { effectId: command.effectId, removed: true };
        }
      }
      throw new Error(`Efeito de áudio não encontrado: ${command.effectId}.`);
    }
  }
}

export function runProjectCommands(
  source: ProjectDocument,
  input: readonly unknown[],
  tolerance: number,
): CommandResult {
  if (!input.length || input.length > maxCommandsPerBatch) {
    throw new Error(`O lote deve conter entre 1 e ${maxCommandsPerBatch} comandos.`);
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("A tolerância de keyframe é inválida.");
  const commands = input.map(parseCommand);
  const project = structuredClone(source);
  const results = commands.map((command) => executeCommand(project, command, tolerance));
  assertValidProjectDocument(project);
  return { project, results, commands };
}

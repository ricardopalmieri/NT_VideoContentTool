import {
  AUDIO_EFFECT_CATALOG,
  AUDIO_EFFECT_PARAMETERS,
  EFFECT_CATALOG,
  EFFECT_PARAMETERS,
} from "./effect-catalog";
import { executeEditingCommand, type EditingCommand } from "./editing-commands";
import { isRecord } from "./command-schema";
import { COMMANDS, parseCommandFields } from "./command-registry";
import { copyClips, normalizeTrackMeta, pasteClips, type ClipboardClips } from "./clip-tracks";
import { isTransitionType } from "./transitions";
import { LOCK_EXEMPT_PROPERTIES } from "./property-tables";
import * as ops from "./project-commands";
import * as media from "./media-commands";
import { resolveCommandTimes } from "./musical-time";
import * as macros from "./macros";
import type { Fit } from "./media-assets";
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
export const MAX_COMMANDS_PER_BATCH = 500;
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

type TimeBase = "composition" | "clip";

export type VctCommand =
  | EditingCommand
  | { type: "layer.setNumeric"; layerId: string; property: string; value: number }
  | { type: "layer.setName"; layerId: string; name: string }
  | { type: "keyframe.upsert"; layerId: string; property: string; time: number; value: number; easing?: Easing; curve?: number; timeBase?: TimeBase }
  | { type: "keyframe.toggle"; layerId: string; property: string; time: number; value: number; easing?: Easing; curve?: number; timeBase?: TimeBase }
  | { type: "effect.keyframe.upsert"; effectId: string; property: string; time: number; value: number; easing?: Easing; curve?: number; timeBase?: TimeBase }
  | { type: "effect.keyframe.toggle"; effectId: string; property: string; time: number; value: number; easing?: Easing; curve?: number; timeBase?: TimeBase }
  | { type: "effect.add"; kind: EffectKind; ownerId: string; effectId: string }
  | { type: "effect.setParam"; effectId: string; parameter: string; value: number }
  | { type: "effect.remove"; effectId: string }
  | { type: "audioEffect.add"; trackId: string; kind: AudioEffectKind; effectId: string }
  | { type: "audioEffect.setParam"; effectId: string; parameter: string; value: number }
  | { type: "audioEffect.remove"; effectId: string }
  | { type: "layer.set"; layerId: string; props: Record<string, unknown>; allowOverlap?: boolean }
  | { type: "clip.paste"; clipboard: ClipboardClips; startTime: number }
  | { type: "track.reorder"; trackId: string; index: number }
  | { type: "keyframe.set"; layerId: string; property: string; keys: unknown[]; timeBase?: TimeBase }
  | { type: "effect.keyframe.set"; effectId: string; property: string; keys: unknown[]; timeBase?: TimeBase }
  | { type: "effect.set"; effectId: string; enabled?: boolean; name?: string }
  | { type: "effect.reorder"; effectId: string; index: number }
  | { type: "audio.create"; trackId: string; asset: string; name: string; startTime: number; endTime: number; laneId?: string; props?: Record<string, unknown> }
  | { type: "audio.set"; trackId: string; props: Record<string, unknown> }
  | { type: "audio.move"; trackId: string; startTime: number; laneId?: string }
  | { type: "audio.link"; trackId: string; layerId?: string }
  | { type: "audio.unlink"; trackId: string }
  | { type: "audio.remove"; trackId: string }
  | { type: "audio.reorderLane"; laneId: string; index: number }
  | { type: "audioEffect.set"; effectId: string; enabled: boolean }
  | { type: "audioEffect.reorder"; effectId: string; index: number }
  | { type: "composition.set"; props: Record<string, unknown>; resize?: "adapt" | "keep" }
  | ({ type: "clip.place" } & media.PlaceCommand)
  | { type: "layer.fit"; layerId: string; fit: Fit }
  | { type: "asset.add"; asset: string; metadata: Record<string, unknown> }
  | { type: "asset.remove"; asset: string }
  | { type: "track.create"; trackId: string; kind: "video" | "audio"; name?: string; index?: number }
  | { type: "track.rename"; trackId: string; name: string }
  | { type: "track.remove"; trackId: string }
  | ({ type: "loop.seam" } & Parameters<typeof macros.expandLoopSeam>[1])
  | ({ type: "fx.stutter" } & Parameters<typeof macros.expandStutter>[1])
  | ({ type: "fx.strobe" } & Parameters<typeof macros.expandStrobe>[1])
  | ({ type: "fx.spike" } & Parameters<typeof macros.expandSpike>[1])
  | ({ type: "text.animate" } & Parameters<typeof macros.expandAnimate>[1])
  | ({ type: "text.fromSrt" } & Parameters<typeof macros.expandSrt>[1]);

export interface CommandResult {
  project: ProjectDocument;
  results: unknown[];
  commands: readonly VctCommand[];
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} precisa ser um texto não vazio.`);
  return value;
}

// Strict parse: the registry rejects unknown fields and checks types/ranges;
// the few nested shapes are checked here.
function parseCommand(value: unknown): VctCommand {
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Comando VCT inválido.");
  const type = parseCommandFields(value);
  if (type === "clip.setTransition" && value.transition !== null) {
    const t = value.transition;
    if (!isRecord(t) || !isTransitionType(t.type) || typeof t.duration !== "number" || !Number.isFinite(t.duration)
      || t.duration <= 0 || t.duration > 7200 || Object.keys(t).some((key) => key !== "type" && key !== "duration")) {
      throw new Error("Transição inválida.");
    }
  }
  if (type === "layer.create" && ["image", "video", "guide"].includes(value.kind as string)) requiredText(value.asset, "asset");
  if (type === "clip.paste") {
    const clipboard = value.clipboard as Record<string, unknown>;
    if (!Array.isArray(clipboard.layers) || !Array.isArray(clipboard.audio) || !clipboard.layers.length) {
      throw new Error("clipboard deve ter layers (não vazia) e audio.");
    }
  }
  const command = structuredClone(value) as VctCommand & { easing?: Easing };
  if ("easing" in COMMANDS[type].fields && command.easing === undefined) command.easing = "easeInOut";
  return command;
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

// timeBase "clip": key times count from the start of the clip that owns them.
function toCompositionTime(project: ProjectDocument, command: VctCommand) {
  if (!("timeBase" in command) || command.timeBase !== "clip") return command;
  const owner = "layerId" in command
    ? project.layers.find((layer) => layer.id === command.layerId)
    : project.layers.find((layer) => layer.effects.some((effect) => effect.id === (command as { effectId: string }).effectId));
  const start = owner?.startTime ?? 0;
  const copy = structuredClone(command) as VctCommand & { time?: number; keys?: Array<{ time?: unknown }> };
  if (typeof copy.time === "number") copy.time += start;
  for (const key of copy.keys ?? []) if (typeof key.time === "number") key.time += start;
  return copy;
}

function setCurve(keys: Keyframe[] | undefined, time: number, curve: number | undefined, tolerance: number) {
  if (curve === undefined || !keys) return;
  const key = keys.find((item) => Math.abs(item.time - time) <= tolerance);
  if (key) key.curve = curve;
}

function executeCommand(project: ProjectDocument, input: VctCommand, tolerance: number): unknown {
  const command = toCompositionTime(project, input);
  const result = runCommand(project, command, tolerance);
  if ((command.type === "keyframe.upsert" || command.type === "keyframe.toggle") && command.curve !== undefined) {
    setCurve(project.layers.find((layer) => layer.id === command.layerId)?.keyframes[command.property], command.time, command.curve, tolerance);
  }
  if ((command.type === "effect.keyframe.upsert" || command.type === "effect.keyframe.toggle") && command.curve !== undefined) {
    const effect = findEffect(project, command.effectId);
    setCurve(effect?.keyframes[command.property], command.time, command.curve, tolerance);
  }
  return result;
}

function runCommand(project: ProjectDocument, command: VctCommand, tolerance: number): unknown {
  switch (command.type) {
    case 'layer.create': case 'layer.setText': case 'clip.split': case 'clip.move':
    case 'clip.duplicate': case 'clip.remove': case 'clip.setTransition':
      return executeEditingCommand(project, command);
    case "layer.setNumeric": {
      if (!isNumericLayerProperty(command.property)) throw new Error(`Propriedade numérica não permitida: ${command.property}.`);
      const layer = findLayer(project, command.layerId);
      if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
      ops.setLayerProps(project, layer.id, { [command.property]: command.value });
      return { layerId: layer.id, property: command.property, value: command.value };
    }
    case "layer.setName": {
      const layer = findLayer(project, command.layerId);
      if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
      layer.name = command.name;
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
    case "layer.set": return ops.setLayerProps(project, command.layerId, command.props, command.allowOverlap);
    case "clip.paste": {
      const pasted = pasteClips(project, command.clipboard, command.startTime);
      return { layerIds: pasted.map((layer) => layer.id) };
    }
    case "track.reorder": return ops.reorderTrack(project, command.trackId, command.index);
    case "keyframe.set": return ops.setLayerKeyframes(project, command.layerId, command.property, command.keys);
    case "effect.keyframe.set": return ops.setEffectKeyframes(project, command.effectId, command.property, command.keys);
    case "effect.set": return ops.setEffect(project, command.effectId, { enabled: command.enabled, name: command.name });
    case "effect.reorder": return ops.reorderEffect(project, command.effectId, command.index);
    case "audio.create": return ops.createAudioClip(project, command);
    case "audio.set": return ops.setAudioProps(project, command.trackId, command.props);
    case "audio.move": return ops.moveAudioClip(project, command.trackId, command.startTime, command.laneId);
    case "audio.link": return ops.linkAudio(project, command.trackId, command.layerId);
    case "audio.unlink": return ops.unlinkAudio(project, command.trackId);
    case "audio.remove": return ops.removeAudioClip(project, command.trackId);
    case "audio.reorderLane": return ops.reorderAudioLane(project, command.laneId, command.index);
    case "audioEffect.set": return ops.setAudioEffect(project, command.effectId, { enabled: command.enabled });
    case "audioEffect.reorder": return ops.reorderAudioEffect(project, command.effectId, command.index);
    case "composition.set": return ops.setComposition(project, command.props, command.resize);
    case "clip.place": return media.placeClip(project, command);
    case "layer.fit": return media.fitLayer(project, command.layerId, command.fit);
    case "asset.add": return media.addAsset(project, command.asset, command.metadata);
    case "asset.remove": return media.removeAsset(project, command.asset);
    case "track.create": return media.createTrack(project, command.trackId, command.kind, command.name, command.index);
    case "track.rename": return media.renameTrack(project, command.trackId, command.name);
    case "track.remove": return media.removeTrack(project, command.trackId);
    case "loop.seam": return runMacro(project, macros.expandLoopSeam(project, command), tolerance);
    case "fx.stutter": return runMacro(project, macros.expandStutter(project, command), tolerance);
    case "fx.strobe": {
      if (!command.times.every((time) => typeof time === "number" && Number.isFinite(time) && time >= 0)) throw new Error("times deve ser uma lista de segundos.");
      return runMacro(project, macros.expandStrobe(project, command), tolerance);
    }
    case "fx.spike": return runMacro(project, macros.expandSpike(project, command), tolerance);
    case "text.animate": return runMacro(project, macros.expandAnimate(project, command), tolerance);
    case "text.fromSrt": return runMacro(project, macros.expandSrt(project, command), tolerance);
  }
}

/** Runs a macro's base commands in order; the result lists them for review. */
function runMacro(project: ProjectDocument, expanded: Array<Record<string, unknown>>, tolerance: number): { expanded: Array<Record<string, unknown>>; results: unknown[] } {
  const results: unknown[] = expanded.map((item) => executeCommand(project, parseCommand(resolveCommandTimes(item, project.settings)), tolerance));
  return { expanded, results };
}

/** Copies clips for clip.paste (same shape the editor clipboard uses). */
export function clipboardFor(project: ProjectDocument, layerIds: string[]) {
  return copyClips(project, layerIds);
}

export function runProjectCommands(
  source: ProjectDocument,
  input: readonly unknown[],
  tolerance: number,
): CommandResult {
  if (!Array.isArray(input) || !input.length || input.length > MAX_COMMANDS_PER_BATCH) {
    throw new Error(`O lote deve conter entre 1 e ${MAX_COMMANDS_PER_BATCH} comandos.`);
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("A tolerância de keyframe é inválida.");
  // bar:beat times use the grid already in the project or set earlier in this batch.
  let timing = source.settings;
  const commands = input.map((value) => {
    const command = parseCommand(resolveCommandTimes(value, timing));
    if (command.type === "composition.set" && isRecord(command.props) && isRecord(command.props.grid)) {
      timing = { ...timing, grid: { offset: 0, beatsPerBar: 4, ...command.props.grid } as ProjectDocument["settings"]["grid"] };
    }
    return command;
  });
  const project = structuredClone(source);
  const results = commands.map((command) => executeCommand(project, command, tolerance));
  normalizeTrackMeta(project);
  // A composition resize remaps every layer, locked ones included (as the editor always did).
  const resizing = commands.some((command) => command.type === "composition.set" && ("width" in command.props || "height" in command.props));
  const resizeKeys = ["x", "y", "width", "height", "fontSize", "strokeWidth", "keyframes"];
  const lockedView = (layer: object) => JSON.stringify(layer, (key, value) => LOCK_EXEMPT_PROPERTIES.includes(key) || (resizing && resizeKeys.includes(key)) ? undefined : value);
  for (const locked of source.layers.filter(layer => layer.locked)) {
    const after = project.layers.find(layer => layer.id === locked.id);
    if (after && lockedView(after) !== lockedView(locked)) {
      throw new Error(`A camada está bloqueada: ${locked.id}.`);
    }
  }
  assertValidProjectDocument(project);
  return { project, results, commands };
}

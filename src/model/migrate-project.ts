import type { ProjectDocument, EffectNode, ProjectSettings } from "./types";
import { clamp } from "./math";
import { normalizeFades } from "../timeline/timing";
import { isTransitionType } from "./transitions";

// Normalização histórica in-place: a ordem e os operadores ||= e ??= são intencionais.
export function migrateProject(project: ProjectDocument) {
  const legacyProject = (project.version || 1) < 2;
  project.audioTracks ||= [];
  for (const track of project.audioTracks) {
    track.linked ??= Boolean(track.linkedLayerId);
    track.muted ??= false;
    track.volume ??= 1;
    track.playbackRate ??= 1;
    track.reverse ??= false;
    track.loop ??= false;
    track.fadeInStart ??= track.startTime;
    track.fadeInEnd ??= track.startTime;
    track.fadeOutStart ??= track.endTime;
    track.fadeOutEnd ??= track.endTime;
    normalizeFades(track);
    track.effects ||= [];
  }
  for (const layer of project.layers) {
    layer.keyframes ||= {};
    for (const keys of Object.values(layer.keyframes)) {
      for (const key of keys) key.easing ||= "easeInOut";
    }
    layer.effects ||= [];
    layer.blendMode ||= "normal";
    layer.playbackRate ??= 1;
    layer.reverse ??= false;
    layer.sourceIn ??= layer.sourceOffset || 0;
    layer.sourceOut ??= 0;
    layer.fillOpacity ??= 1;
    layer.strokeOpacity ??= 1;
    layer.fadeInStart ??= layer.startTime;
    layer.fadeInEnd ??= layer.startTime;
    layer.fadeOutStart ??= layer.endTime;
    layer.fadeOutEnd ??= layer.endTime;
    normalizeFades(layer);
    if (layer.transition && !isTransitionType(layer.transition.type)) delete layer.transition;
    layer.scaleLocked ??= true;
    layer.sizeLocked ??= true;
    if (legacyProject && layer.kind === "text") layer.sizeLocked = false;
    for (const effect of layer.effects) {
      effect.keyframes ||= {};
      for (const keys of Object.values(effect.keyframes)) {
        for (const key of keys) key.easing ||= "easeInOut";
      }
      migrateFeedback(effect, project.settings);
      migrateModernEffect(effect);
    }
  }
  project.postEffects ||= [];
  project.version = 2;
  for (const effect of project.postEffects) {
    effect.keyframes ||= {};
    for (const keys of Object.values(effect.keyframes)) {
      for (const key of keys) key.easing ||= "easeInOut";
    }
    migrateFeedback(effect, project.settings);
    migrateModernEffect(effect);
  }
}

function migrateModernEffect(effect: EffectNode) {
  effect.params.mix ??= 1;
  if (effect.kind === "blur") effect.params.quality ??= 2;
  if (effect.kind === "glow") {
    effect.params.knee ??= 0.22;
    effect.params.saturation ??= 1;
  }
  if (effect.kind === "rgbDelay") {
    const legacyDelay = Math.max(1, Math.round((effect.params.amount ?? .008) * 750));
    effect.params.redDelay ??= 0;
    effect.params.greenDelay ??= -Math.round(legacyDelay * .5);
    effect.params.blueDelay ??= -legacyDelay;
  }
  if (effect.kind === "glitch") {
    effect.params.blockSize ??= effect.params.blocks ?? 24;
    effect.params.shift ??= .12;
    effect.params.rgbSplit ??= 6;
    effect.params.scanlines ??= .18;
  }
}

function migrateFeedback(effect: EffectNode, settings: ProjectSettings) {
  if (effect.kind !== "feedback" || "count" in effect.params) return;
  const previous = effect.params;
  effect.params = {
    count: 8,
    spacing: 0.06,
    decay: clamp(previous.amount ?? 0.78, 0.05, 1),
    offsetX: (previous.offsetX ?? 0.01) * settings.width,
    offsetY: (previous.offsetY ?? 0.01) * settings.height,
  };
}

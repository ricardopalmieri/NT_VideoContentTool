import type { AudioEffectKind, EffectKind } from "./types";

export interface EffectCatalogEntry {
  category: "layer" | "post";
  labels: { "pt-BR": string; en: string };
  defaults: Readonly<Record<string, number>>;
}

export type EffectParameterDefinition = readonly [label: string, key: string, min: number, max: number, step: number];

export const EFFECT_CATALOG: Record<EffectKind, EffectCatalogEntry> = {
  mirror: { category: "layer", labels: { "pt-BR": "Espelho", en: "Mirror" }, defaults: { mode: 1, center: .5 } },
  feedback: { category: "layer", labels: { "pt-BR": "Rastro", en: "Trail" }, defaults: { count: 8, spacing: .06, decay: .78, offsetX: 6, offsetY: 6 } },
  levels: { category: "layer", labels: { "pt-BR": "Níveis / cores", en: "Levels / color" }, defaults: { brightness: 0, contrast: 1, saturation: 1, gamma: 1, exposure: 0, temperature: 0, tint: 0, vibrance: 0 } },
  kaleidoscope: { category: "layer", labels: { "pt-BR": "Caleidoscópio", en: "Kaleidoscope" }, defaults: { segments: 6, rotation: 0, zoom: 1 } },
  blur: { category: "layer", labels: { "pt-BR": "Desfoque", en: "Blur" }, defaults: { radius: 8, quality: 2 } },
  crop: { category: "layer", labels: { "pt-BR": "Recorte", en: "Crop" }, defaults: { left: 0, right: 1, top: 0, bottom: 1 } },
  edge: { category: "layer", labels: { "pt-BR": "Bordas", en: "Edge" }, defaults: { amount: 1, threshold: .15, colorize: 0 } },
  colorKey: { category: "layer", labels: { "pt-BR": "Chroma key", en: "Color key" }, defaults: { hue: .33, tolerance: .15, softness: .08 } },
  lumaKey: { category: "layer", labels: { "pt-BR": "Luma key", en: "Luma key" }, defaults: { threshold: .08, softness: .12, invert: 0 } },
  chromaKey: { category: "layer", labels: { "pt-BR": "Chroma key (YCbCr)", en: "Chroma key (YCbCr)" }, defaults: { red: 0, green: 1, blue: 0, tolerance: .1, softness: .08, spill: .5 } },
  animaTracer: { category: "layer", labels: { "pt-BR": "animaTracer", en: "animaTracer" }, defaults: { progress: 0, sensitivity: .2, thickness: 1, softness: .08, direction: 0, irregularity: .15, invert: 0 } },
  sharpen: { category: "layer", labels: { "pt-BR": "Nitidez", en: "Sharpen" }, defaults: { amount: 1, radius: 1.5 } },
  zoomBlur: { category: "layer", labels: { "pt-BR": "Desfoque de zoom", en: "Zoom blur" }, defaults: { strength: .3, centerX: .5, centerY: .5 } },
  tiltShift: { category: "layer", labels: { "pt-BR": "Tilt-shift", en: "Tilt-shift" }, defaults: { blur: 12, focus: .5, gradient: 140, angle: 0 } },
  halftone: { category: "layer", labels: { "pt-BR": "Meio-tom", en: "Halftone" }, defaults: { size: 8, angle: 25 } },
  rgbDelay: { category: "post", labels: { "pt-BR": "RGB Delay", en: "RGB Delay" }, defaults: { redDelay: 0, greenDelay: -3, blueDelay: -6, mix: 1 } },
  noise: { category: "post", labels: { "pt-BR": "Ruído", en: "Noise" }, defaults: { amount: .12, scale: 1 } },
  glitch: { category: "post", labels: { "pt-BR": "Glitch", en: "Glitch" }, defaults: { amount: .3, frequency: 8, blockSize: 36, shift: .12, rgbSplit: 7, scanlines: .18, mix: 1 } },
  vhs: { category: "post", labels: { "pt-BR": "VHS", en: "VHS" }, defaults: { amount: .25, scanlines: 480, tracking: .15 } },
  cameraShake: { category: "post", labels: { "pt-BR": "Tremor de câmera", en: "Camera shake" }, defaults: { amount: .01, speed: 8 } },
  glow: { category: "post", labels: { "pt-BR": "Bloom", en: "Bloom" }, defaults: { threshold: .62, radius: 14, intensity: 1.4, knee: .22, saturation: 1, mix: 1 } },
  vignette: { category: "post", labels: { "pt-BR": "Vinheta", en: "Vignette" }, defaults: { offset: .5, darkness: .5, roundness: 0 } },
  chromaticAberration: { category: "post", labels: { "pt-BR": "Aberração cromática", en: "Chromatic aberration" }, defaults: { offset: 6, radial: 1, angle: 0 } },
};

export interface AudioEffectCatalogEntry {
  label: string;
  defaults: Readonly<Record<string, number>>;
}

export const AUDIO_EFFECT_CATALOG: Record<AudioEffectKind, AudioEffectCatalogEntry> = {
  lowpass: { label: "LOW PASS", defaults: { frequency: 12000, resonance: .7 } },
  highpass: { label: "HIGH PASS", defaults: { frequency: 80, resonance: .7 } },
  eq3: { label: "EQ 3-BAND", defaults: { low: 0, mid: 0, high: 0 } },
  delay: { label: "DELAY", defaults: { time: .25, feedback: .3, mix: .25 } },
  compressor: { label: "COMPRESSOR", defaults: { threshold: -18, ratio: 4, attack: .01, release: .25 } },
  reverb: { label: "REVERB", defaults: { duration: 1.5, decay: 2.5, mix: .25 } },
};

export const EFFECT_PARAMETERS: Record<EffectKind, readonly EffectParameterDefinition[]> = {
  mirror: [["MODE", "mode", 1, 3, 1], ["CENTER", "center", 0, 1, .01]],
  feedback: [["INSTANCES", "count", 1, 32, 1], ["TIME SPACING", "spacing", 0, 1, .01], ["OPACITY DECAY", "decay", .05, 1, .01], ["OFFSET X", "offsetX", -500, 500, 1], ["OFFSET Y", "offsetY", -500, 500, 1]],
  levels: [["BRIGHTNESS", "brightness", -1, 1, .01], ["CONTRAST", "contrast", 0, 4, .01], ["SATURATION", "saturation", 0, 4, .01], ["GAMMA", "gamma", .05, 4, .01], ["EXPOSURE", "exposure", -4, 4, .01], ["TEMPERATURE", "temperature", -1, 1, .01], ["TINT", "tint", -1, 1, .01], ["VIBRANCE", "vibrance", -1, 1, .01]],
  kaleidoscope: [["SEGMENTS", "segments", 2, 32, 1], ["ROTATION", "rotation", -6.28, 6.28, .01], ["ZOOM", "zoom", .1, 5, .01]],
  blur: [["GAUSSIAN RADIUS", "radius", 0, 160, .1], ["QUALITY", "quality", 1, 3, 1]],
  crop: [["LEFT", "left", 0, 1, .01], ["RIGHT", "right", 0, 1, .01], ["TOP", "top", 0, 1, .01], ["BOTTOM", "bottom", 0, 1, .01]],
  edge: [["AMOUNT", "amount", 0, 4, .01], ["THRESHOLD", "threshold", 0, 1, .01], ["COLORIZE", "colorize", 0, 1, 1]],
  colorKey: [["HUE", "hue", 0, 1, .01], ["TOLERANCE", "tolerance", 0, 1, .01], ["SOFTNESS", "softness", 0, .5, .01]],
  lumaKey: [["THRESHOLD", "threshold", 0, 1, .01], ["SOFTNESS", "softness", .001, .5, .001], ["KEEP DARK", "invert", 0, 1, 1]],
  chromaKey: [["KEY RED", "red", 0, 1, .01], ["KEY GREEN", "green", 0, 1, .01], ["KEY BLUE", "blue", 0, 1, .01], ["TOLERANCE", "tolerance", 0, .5, .005], ["SOFTNESS", "softness", .001, .5, .001], ["SPILL", "spill", 0, 1, .01]],
  animaTracer: [["PROGRESS", "progress", 0, 1, .001], ["EDGE SENSITIVITY", "sensitivity", 0, 1, .01], ["LINE THICKNESS", "thickness", .5, 12, .1], ["SOFTNESS", "softness", .001, .5, .001], ["DIRECTION", "direction", 0, 3, 1], ["IRREGULARITY", "irregularity", 0, 1, .01], ["INVERT", "invert", 0, 1, 1]],
  sharpen: [["AMOUNT", "amount", 0, 5, .01], ["RADIUS", "radius", .3, 20, .1]],
  zoomBlur: [["STRENGTH", "strength", 0, 1, .01], ["CENTER X", "centerX", 0, 1, .01], ["CENTER Y", "centerY", 0, 1, .01]],
  tiltShift: [["BLUR RADIUS", "blur", 0, 60, .1], ["FOCUS LINE", "focus", 0, 1, .01], ["TRANSITION", "gradient", 10, 600, 1], ["ANGLE", "angle", -90, 90, .5]],
  halftone: [["DOT SIZE", "size", 2, 40, .5], ["ANGLE", "angle", 0, 90, .5]],
  rgbDelay: [["RED DELAY / FRAMES", "redDelay", -24, 0, 1], ["GREEN DELAY / FRAMES", "greenDelay", -24, 0, 1], ["BLUE DELAY / FRAMES", "blueDelay", -24, 0, 1]],
  noise: [["AMOUNT", "amount", 0, 1, .01], ["SCALE", "scale", .1, 10, .1]],
  glitch: [["AMOUNT", "amount", 0, 1, .01], ["RATE", "frequency", .1, 60, .1], ["BLOCK SIZE", "blockSize", 2, 240, 1], ["H SHIFT", "shift", 0, .5, .001], ["RGB SPLIT", "rgbSplit", 0, 80, .5], ["SCANLINES", "scanlines", 0, 1, .01]],
  vhs: [["AMOUNT", "amount", 0, 1, .01], ["SCANLINES", "scanlines", 20, 2000, 1], ["TRACKING", "tracking", 0, 1, .01]],
  cameraShake: [["AMOUNT", "amount", 0, .2, .001], ["SPEED", "speed", .1, 60, .1]],
  glow: [["THRESHOLD", "threshold", 0, 1, .01], ["SOFT KNEE", "knee", .01, .75, .01], ["RADIUS", "radius", 0, 120, .5], ["INTENSITY", "intensity", 0, 6, .01], ["SATURATION", "saturation", 0, 2, .01]],
  vignette: [["OFFSET", "offset", 0, 1, .01], ["DARKNESS", "darkness", 0, 1, .01], ["ROUNDNESS", "roundness", 0, 1, .01]],
  chromaticAberration: [["OFFSET PX", "offset", 0, 80, .1], ["RADIAL", "radial", 0, 1, .01], ["ANGLE", "angle", 0, 360, 1]],
};

export const AUDIO_EFFECT_PARAMETERS: Record<AudioEffectKind, readonly EffectParameterDefinition[]> = {
  lowpass: [["FREQUENCY", "frequency", 20, 22000, 1], ["RESONANCE", "resonance", .01, 30, .01]],
  highpass: [["FREQUENCY", "frequency", 20, 22000, 1], ["RESONANCE", "resonance", .01, 30, .01]],
  eq3: [["LOW DB", "low", -24, 24, .1], ["MID DB", "mid", -24, 24, .1], ["HIGH DB", "high", -24, 24, .1]],
  delay: [["TIME", "time", .01, 4, .01], ["FEEDBACK", "feedback", 0, .92, .01], ["MIX", "mix", 0, 1, .01]],
  compressor: [["THRESHOLD", "threshold", -80, 0, 1], ["RATIO", "ratio", 1, 20, .1], ["ATTACK", "attack", 0, 1, .001], ["RELEASE", "release", .01, 1, .01]],
  reverb: [["DURATION", "duration", .1, 6, .1], ["DECAY", "decay", .1, 8, .1], ["MIX", "mix", 0, 1, .01]],
};

export const EFFECT_KINDS = Object.keys(EFFECT_CATALOG) as EffectKind[];
export const AUDIO_EFFECT_KINDS = Object.keys(AUDIO_EFFECT_CATALOG) as AudioEffectKind[];

export function listEffectCatalog() {
  return EFFECT_KINDS.map((kind) => ({
    kind,
    category: EFFECT_CATALOG[kind].category,
    labels: { ...EFFECT_CATALOG[kind].labels },
    defaults: { mix: 1, ...EFFECT_CATALOG[kind].defaults },
    parameters: [...EFFECT_PARAMETERS[kind], ["DRY / WET", "mix", 0, 1, .01] as const],
  }));
}

export function listAudioEffectCatalog() {
  return AUDIO_EFFECT_KINDS.map((kind) => ({
    kind,
    label: AUDIO_EFFECT_CATALOG[kind].label,
    defaults: { ...AUDIO_EFFECT_CATALOG[kind].defaults },
    parameters: AUDIO_EFFECT_PARAMETERS[kind],
  }));
}

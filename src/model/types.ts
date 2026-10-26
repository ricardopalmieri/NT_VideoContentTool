export type Language = "pt-BR" | "en";
export type InputKind = "image" | "video" | "guide" | "geometry" | "text";
export type GeometryKind = "rectangle" | "ellipse" | "triangle" | "polygon" | "line";
export type EffectKind =
  | "mirror"
  | "feedback"
  | "levels"
  | "kaleidoscope"
  | "blur"
  | "crop"
  | "edge"
  | "colorKey"
  | "animaTracer"
  | "rgbDelay"
  | "noise"
  | "glitch"
  | "vhs"
  | "cameraShake"
  | "glow";

export type Easing = "linear" | "bezier" | "easeIn" | "easeOut" | "easeInOut" | "hold";

export interface Keyframe {
  time: number;
  value: number;
  easing: Easing;
  curve?: number;
}

export interface EffectNode {
  id: string;
  kind: EffectKind;
  name: string;
  enabled: boolean;
  params: Record<string, number>;
  keyframes: Record<string, Keyframe[]>;
}

export type AudioEffectKind = "lowpass" | "highpass" | "eq3" | "delay" | "compressor" | "reverb";

export interface AudioEffectNode {
  id: string;
  kind: AudioEffectKind;
  enabled: boolean;
  params: Record<string, number>;
}

export interface Layer {
  id: string;
  name: string;
  kind: InputKind;
  visible: boolean;
  locked: boolean;
  exportable: boolean;
  asset?: string;
  geometry?: GeometryKind;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  align?: CanvasTextAlign;
  fill: string;
  stroke: string;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
  fillEnabled: boolean;
  strokeEnabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  blendMode: string;
  startTime: number;
  endTime: number;
  sourceOffset: number;
  sourceIn: number;
  sourceOut: number;
  playbackRate: number;
  reverse: boolean;
  loop: boolean;
  fadeInStart: number;
  fadeInEnd: number;
  fadeOutStart: number;
  fadeOutEnd: number;
  scaleLocked: boolean;
  sizeLocked: boolean;
  effects: EffectNode[];
  keyframes: Record<string, Keyframe[]>;
}

export interface AudioTrack {
  id: string;
  name: string;
  asset: string;
  linkedLayerId?: string;
  linked: boolean;
  muted: boolean;
  volume: number;
  startTime: number;
  endTime: number;
  sourceIn: number;
  sourceOut: number;
  playbackRate: number;
  reverse: boolean;
  loop: boolean;
  fadeInStart: number;
  fadeInEnd: number;
  fadeOutStart: number;
  fadeOutEnd: number;
  effects: AudioEffectNode[];
}

export interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background: string;
  transparent: boolean;
}

export interface ProjectDocument {
  format: "noisetupi-video-content-tool";
  version: number;
  settings: ProjectSettings;
  layers: Layer[];
  audioTracks: AudioTrack[];
  postEffects: EffectNode[];
  createdAt: string;
  modifiedAt: string;
}

export interface OpenProjectResult {
  root: string;
  jsonPath: string;
  project: ProjectDocument;
}

export interface ImportedAsset {
  relativePath: string;
  absolutePath: string;
  fileName: string;
}

export interface ExportOptions {
  format:
    | "webm-vp9"
    | "mov-prores4444"
    | "mov-hap-alpha"
    | "mov-animation"
    | "mkv-ffv1"
    | "mp4-h264"
    | "png-sequence"
    | "apng"
    | "gif";
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  transparent: boolean;
  quality: number;
}

export interface ExportSession {
  sessionId: string;
  framesDir: string;
  expectedFrames: number;
}

export const uid = (prefix = "node") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createEffect = (kind: EffectKind): EffectNode => {
  const defaults: Record<EffectKind, Record<string, number>> = {
    mirror: { mode: 1, center: 0.5 },
    feedback: { count: 8, spacing: 0.06, decay: 0.78, offsetX: 6, offsetY: 6 },
    levels: { brightness: 0, contrast: 1, saturation: 1, gamma: 1 },
    kaleidoscope: { segments: 6, rotation: 0, zoom: 1 },
    blur: { radius: 8, quality: 2 },
    crop: { left: 0, right: 1, top: 0, bottom: 1 },
    edge: { amount: 1, threshold: 0.15, colorize: 0 },
    colorKey: { hue: 0.33, tolerance: 0.15, softness: 0.08 },
    animaTracer: {
      progress: 0,
      sensitivity: 0.2,
      thickness: 1,
      softness: 0.08,
      direction: 0,
      irregularity: 0.15,
      invert: 0,
    },
    rgbDelay: { redDelay: 0, greenDelay: -3, blueDelay: -6, mix: 1 },
    noise: { amount: 0.12, scale: 1 },
    glitch: { amount: 0.3, frequency: 8, blockSize: 36, shift: 0.12, rgbSplit: 7, scanlines: 0.18, mix: 1 },
    vhs: { amount: 0.25, scanlines: 480, tracking: 0.15 },
    cameraShake: { amount: 0.01, speed: 8 },
    glow: { threshold: 0.62, radius: 14, intensity: 1.4, knee: 0.22, saturation: 1, mix: 1 },
  };
  return {
    id: uid("fx"),
    kind,
    name: kind,
    enabled: true,
    params: { mix: 1, ...defaults[kind] },
    keyframes: {},
  };
};

export const createAudioEffect = (kind: AudioEffectKind): AudioEffectNode => {
  const defaults: Record<AudioEffectKind, Record<string, number>> = {
    lowpass: { frequency: 12000, resonance: .7 },
    highpass: { frequency: 80, resonance: .7 },
    eq3: { low: 0, mid: 0, high: 0 },
    delay: { time: .25, feedback: .3, mix: .25 },
    compressor: { threshold: -18, ratio: 4, attack: .01, release: .25 },
    reverb: { duration: 1.5, decay: 2.5, mix: .25 },
  };
  return { id: uid("afx"), kind, enabled: true, params: { ...defaults[kind] } };
};

export const createLayer = (
  kind: InputKind,
  settings: ProjectSettings,
  overrides: Partial<Layer> = {},
): Layer => ({
  id: uid("layer"),
  name: kind === "guide" ? "Guide" : kind[0].toUpperCase() + kind.slice(1),
  kind,
  visible: true,
  locked: false,
  exportable: kind !== "guide",
  geometry: "rectangle",
  text: "NOISETUPI",
  fontFamily: "IBM Plex Sans",
  fontSize: Math.max(32, Math.round(settings.height * 0.1)),
  fontWeight: 500,
  align: "center",
  fill: "#f0eee8",
  stroke: "#ce111b",
  fillOpacity: 1,
  strokeOpacity: 1,
  strokeWidth: 4,
  fillEnabled: true,
  strokeEnabled: false,
  x: settings.width / 2,
  y: settings.height / 2,
  width: kind === "geometry" ? Math.min(settings.width, settings.height) * 0.35 : kind === "text" ? settings.width * 0.6 : settings.width * 0.45,
  height: kind === "geometry" ? Math.min(settings.width, settings.height) * 0.35 : kind === "text" ? Math.max(48, settings.height * 0.16) : settings.height * 0.35,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: kind === "guide" ? 0.55 : 1,
  blendMode: "normal",
  startTime: 0,
  endTime: settings.duration,
  sourceOffset: 0,
  sourceIn: 0,
  sourceOut: 0,
  playbackRate: 1,
  reverse: false,
  loop: kind !== "video",
  fadeInStart: 0,
  fadeInEnd: 0,
  fadeOutStart: settings.duration,
  fadeOutEnd: settings.duration,
  scaleLocked: true,
  sizeLocked: kind !== "text",
  effects: [],
  keyframes: {},
  ...overrides,
});

export const createAudioTrack = (
  name: string,
  asset: string,
  duration: number,
  overrides: Partial<AudioTrack> = {},
): AudioTrack => ({
  id: uid("audio"),
  name,
  asset,
  linked: false,
  muted: false,
  volume: 1,
  startTime: 0,
  endTime: duration,
  sourceIn: 0,
  sourceOut: duration,
  playbackRate: 1,
  reverse: false,
  loop: false,
  fadeInStart: 0,
  fadeInEnd: 0,
  fadeOutStart: duration,
  fadeOutEnd: duration,
  effects: [],
  ...overrides,
});

export const createProject = (settings: ProjectSettings): ProjectDocument => ({
  format: "noisetupi-video-content-tool",
  version: 2,
  settings,
  layers: [],
  audioTracks: [],
  postEffects: [],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
});

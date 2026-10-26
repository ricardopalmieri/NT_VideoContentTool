import { AUDIO_EFFECT_CATALOG, EFFECT_CATALOG } from "./effect-catalog";

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
  assetMetadata?: Record<string, AssetSourceMetadata>;
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
  sourceMetadata: AssetSourceMetadata;
}

export interface AssetSourceMetadata {
  originalName: string;
  sourcePath?: string;
  size: number;
  lastModified: number;
  mimeType: string;
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
  const definition = EFFECT_CATALOG[kind];
  return {
    id: uid("fx"),
    kind,
    name: kind,
    enabled: true,
    params: { mix: 1, ...definition.defaults },
    keyframes: {},
  };
};

export const createAudioEffect = (kind: AudioEffectKind): AudioEffectNode => {
  const definition = AUDIO_EFFECT_CATALOG[kind];
  return { id: uid("afx"), kind, enabled: true, params: { ...definition.defaults } };
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

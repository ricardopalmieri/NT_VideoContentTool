// Editable properties of layers, audio clips and the composition. Commands that
// set properties (layer.set, audio.set, composition.set) validate against these
// tables; describe() prints them for agents.
import type { FieldSpec } from "./command-schema";

const time = (description?: string): FieldSpec => ({ type: "number", min: 0, max: 7200, description });

export const BLEND_MODES = ["normal", "add", "multiply", "screen", "lighten", "darken"] as const;
export const GEOMETRY_KINDS = ["rectangle", "ellipse", "triangle", "polygon", "line"] as const;
export const TEXT_ALIGNS = ["left", "center", "right", "start", "end"] as const;

export const LAYER_PROPERTIES = {
  name: { type: "string", maxLength: 200 },
  text: { type: "string", maxLength: 10000, allowEmpty: true, description: "só camadas de texto" },
  fontFamily: { type: "string", maxLength: 120 },
  fontSize: { type: "number", min: 4, max: 2000 },
  fontWeight: { type: "number", min: 100, max: 900 },
  align: { type: "enum", values: TEXT_ALIGNS },
  geometry: { type: "enum", values: GEOMETRY_KINDS },
  asset: { type: "string", maxLength: 500, description: "referência media/… de uma mídia já importada" },
  fill: { type: "color" },
  stroke: { type: "color" },
  fillOpacity: { type: "number", min: 0, max: 1 },
  strokeOpacity: { type: "number", min: 0, max: 1 },
  strokeWidth: { type: "number", min: 0, max: 1000 },
  fillEnabled: { type: "boolean" },
  strokeEnabled: { type: "boolean" },
  shadowColor: { type: "color", description: "sombra do texto" },
  shadowOpacity: { type: "number", min: 0, max: 1 },
  shadowBlur: { type: "number", min: 0, max: 200 },
  shadowX: { type: "number", min: -500, max: 500 },
  shadowY: { type: "number", min: -500, max: 500 },
  x: { type: "number", min: -32768, max: 32768, description: "centro, px da composição" },
  y: { type: "number", min: -32768, max: 32768, description: "centro, px da composição" },
  width: { type: "number", min: 1, max: 16384 },
  height: { type: "number", min: 1, max: 16384 },
  scaleX: { type: "number", min: -20, max: 20 },
  scaleY: { type: "number", min: -20, max: 20 },
  rotation: { type: "number", min: -3600, max: 3600, description: "graus" },
  opacity: { type: "number", min: 0, max: 1 },
  blendMode: { type: "enum", values: BLEND_MODES },
  visible: { type: "boolean" },
  locked: { type: "boolean" },
  exportable: { type: "boolean" },
  startTime: time("início na timeline"),
  endTime: { type: "number", min: .001, max: 7200, description: "fim na timeline" },
  sourceIn: time("início no arquivo"),
  sourceOut: time("fim no arquivo; 0 vale até o fim"),
  playbackRate: { type: "number", min: .05, max: 8 },
  reverse: { type: "boolean" },
  loop: { type: "boolean" },
  fadeInStart: time(), fadeInEnd: time(), fadeOutStart: time(), fadeOutEnd: time(),
  scaleLocked: { type: "boolean" },
  sizeLocked: { type: "boolean" },
} as const satisfies Record<string, FieldSpec>;

export type LayerProperty = keyof typeof LAYER_PROPERTIES;

/** Numeric layer properties that accept keyframes (plus fillColor/strokeColor as RGB ints). */
export const KEYFRAME_PROPERTIES = [
  "x", "y", "scaleX", "scaleY", "rotation", "opacity", "width", "height",
  "startTime", "endTime", "playbackRate", "sourceIn", "sourceOut",
  "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd",
  "fontSize", "fontWeight", "fillOpacity", "strokeOpacity", "strokeWidth",
] as const;

/** Properties a locked layer may still change. */
export const LOCK_EXEMPT_PROPERTIES: readonly string[] = ["locked", "visible"];

export const TIMING_PROPERTIES: readonly string[] = [
  "startTime", "endTime", "sourceIn", "sourceOut", "playbackRate",
  "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd", "reverse", "loop",
];

export const AUDIO_PROPERTIES = {
  name: { type: "string", maxLength: 200 },
  asset: { type: "string", maxLength: 500 },
  volume: { type: "number", min: 0, max: 2 },
  muted: { type: "boolean" },
  startTime: time(), endTime: { type: "number", min: .001, max: 7200 },
  sourceIn: time(), sourceOut: time(),
  playbackRate: { type: "number", min: .05, max: 8 },
  reverse: { type: "boolean" },
  loop: { type: "boolean" },
  fadeInStart: time(), fadeInEnd: time(), fadeOutStart: time(), fadeOutEnd: time(),
} as const satisfies Record<string, FieldSpec>;

export type AudioProperty = keyof typeof AUDIO_PROPERTIES;

export const COMPOSITION_PROPERTIES = {
  name: { type: "string", maxLength: 200 },
  width: { type: "number", min: 16, max: 8192, integer: true },
  height: { type: "number", min: 16, max: 8192, integer: true },
  fps: { type: "number", min: 1, max: 240, integer: true },
  duration: { type: "number", min: .1, max: 7200, description: "segundos" },
  background: { type: "color" },
  transparent: { type: "boolean" },
  workArea: { type: "object", nullable: true, description: "{in, out} em s; null volta à composição inteira" },
  grid: { type: "object", nullable: true, description: "{bpm, offset, beatsPerBar}; null remove" },
} as const satisfies Record<string, FieldSpec>;

export type CompositionProperty = keyof typeof COMPOSITION_PROPERTIES;

export type PropertyKind = "text" | "geometry" | "image" | "video" | "guide" | "audio" | "composition";

const COMMON_LAYER_PROPERTIES: readonly LayerProperty[] = [
  "name", "x", "y", "width", "height", "scaleX", "scaleY", "rotation", "opacity", "blendMode", "visible", "locked", "exportable",
  "startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd", "scaleLocked", "sizeLocked",
];
const PAINT_PROPERTIES: readonly LayerProperty[] = ["fill", "fillOpacity", "fillEnabled", "stroke", "strokeOpacity", "strokeWidth", "strokeEnabled"];

/** Which layer.set properties make sense for each kind of layer (layer.set itself accepts the whole table). */
export const LAYER_KIND_PROPERTIES: Readonly<Record<"text" | "geometry" | "image" | "video" | "guide", readonly LayerProperty[]>> = {
  text: [...COMMON_LAYER_PROPERTIES, "text", "fontFamily", "fontSize", "fontWeight", "align", ...PAINT_PROPERTIES, "shadowColor", "shadowOpacity", "shadowBlur", "shadowX", "shadowY"],
  geometry: [...COMMON_LAYER_PROPERTIES, "geometry", ...PAINT_PROPERTIES],
  image: [...COMMON_LAYER_PROPERTIES, "asset"],
  video: [...COMMON_LAYER_PROPERTIES, "asset", "sourceIn", "sourceOut", "playbackRate", "reverse", "loop"],
  guide: [...COMMON_LAYER_PROPERTIES, "asset"],
};

/** Names an agent may type after "props" in describe(), without accents. */
const PROPERTY_KIND_ALIASES: Readonly<Record<string, PropertyKind | "layer">> = {
  texto: "text", text: "text", forma: "geometry", geometria: "geometry", geometry: "geometry", shape: "geometry",
  imagem: "image", image: "image", video: "video", guia: "guide", guide: "guide", audio: "audio",
  composicao: "composition", composition: "composition", camada: "layer", layer: "layer",
};

export function propertyKindOf(name: string) {
  return PROPERTY_KIND_ALIASES[name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()];
}

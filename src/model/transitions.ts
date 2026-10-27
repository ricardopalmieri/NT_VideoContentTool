// Transições entre clipes da mesma faixa. A transição fica no clipe que entra.
// Com sobreposição (modo Sobrepor), a janela é o trecho em que o clipe anterior
// e o que entra se sobrepõem; sem sobreposição, o clipe entra sozinho durante
// `transition.duration` segundos a partir do próprio início.
import { trackIdOf } from "./clip-tracks";
import type { AudioTrack, Layer, ProjectDocument } from "./types";

export const TRANSITION_TYPES = ["dissolve", "dip", "wipe-right", "wipe-left", "push-left"] as const;
export type TransitionType = typeof TRANSITION_TYPES[number];

export interface ClipTransition {
  type: TransitionType;
  /** Duração quando não há sobreposição com o clipe anterior (segundos). */
  duration: number;
}

export const DEFAULT_TRANSITION_DURATION = .5;
const EPSILON = 1e-6;

export function isTransitionType(value: unknown): value is TransitionType {
  return typeof value === "string" && (TRANSITION_TYPES as readonly string[]).includes(value);
}

// Clipe anterior da mesma faixa que se sobrepõe ao início do clipe dado.
function overlappingPrevious(project: Pick<ProjectDocument, "layers">, layer: Layer) {
  let partner: Layer | undefined;
  for (const clip of project.layers) {
    if (clip.id === layer.id || trackIdOf(clip) !== trackIdOf(layer)) continue;
    if (clip.startTime < layer.startTime - EPSILON && clip.endTime > layer.startTime + EPSILON) {
      if (!partner || clip.endTime > partner.endTime) partner = clip;
    }
  }
  return partner;
}

export interface TransitionWindow {
  start: number;
  end: number;
  partner?: Layer;
}

export function transitionWindow(project: Pick<ProjectDocument, "layers">, layer: Layer): TransitionWindow | null {
  if (!layer.transition || !isTransitionType(layer.transition.type)) return null;
  const partner = overlappingPrevious(project, layer);
  const end = partner
    ? Math.min(partner.endTime, layer.endTime)
    : Math.min(layer.endTime, layer.startTime + Math.max(0, layer.transition.duration || 0));
  if (end <= layer.startTime + EPSILON) return null;
  return { start: layer.startTime, end, partner };
}

export interface TransitionState {
  opacity: number;
  offsetX: number;
  /** Parte visível do clipe na largura da composição (0–1) e de onde ela cresce. */
  reveal?: { from: "left" | "right"; amount: number };
}

const NEUTRAL: TransitionState = { opacity: 1, offsetX: 0 };

function incoming(type: TransitionType, progress: number, width: number, hasPartner: boolean): TransitionState {
  if (type === "dissolve") return { opacity: progress, offsetX: 0 };
  if (type === "dip") return { opacity: hasPartner ? Math.max(0, progress * 2 - 1) : progress, offsetX: 0 };
  if (type === "wipe-right") return { opacity: 1, offsetX: 0, reveal: { from: "left", amount: progress } };
  if (type === "wipe-left") return { opacity: 1, offsetX: 0, reveal: { from: "right", amount: progress } };
  return { opacity: 1, offsetX: width * (1 - progress) };
}

function outgoing(type: TransitionType, progress: number, width: number): TransitionState {
  if (type === "dip") return { opacity: Math.max(0, 1 - progress * 2), offsetX: 0 };
  if (type === "push-left") return { opacity: 1, offsetX: -width * progress };
  return NEUTRAL;
}

// Efeito da transição sobre um clipe no tempo dado: como clipe que entra
// (a própria transição) e como clipe que sai (transição do próximo clipe).
export function transitionState(project: Pick<ProjectDocument, "layers" | "settings">, layer: Layer, time: number): TransitionState {
  const width = project.settings.width;
  const own = transitionWindow(project, layer);
  if (own && time < own.end) {
    const progress = Math.max(0, Math.min(1, (time - own.start) / (own.end - own.start)));
    return incoming(layer.transition!.type, progress, width, Boolean(own.partner));
  }
  for (const next of project.layers) {
    if (next.id === layer.id || !next.transition || trackIdOf(next) !== trackIdOf(layer)) continue;
    const window = transitionWindow(project, next);
    if (!window || window.partner?.id !== layer.id || time < window.start) continue;
    const progress = Math.max(0, Math.min(1, (time - window.start) / (window.end - window.start)));
    return outgoing(next.transition.type, progress, width);
  }
  return NEUTRAL;
}

// Modo Sobrepor: um clipe que passa a sobrepor o anterior ganha Dissolver se
// ainda não tem transição (como no Vegas). Devolve os ids alterados.
export function autoTransitionsForOverlap(project: Pick<ProjectDocument, "layers">) {
  const changed: string[] = [];
  for (const layer of project.layers) {
    if (layer.transition || !overlappingPrevious(project, layer)) continue;
    layer.transition = { type: "dissolve", duration: DEFAULT_TRANSITION_DURATION };
    changed.push(layer.id);
  }
  return changed;
}

// Áudio vinculado acompanha o crossfade: entra com fade-in e o anterior sai com
// fade-out na mesma janela de sobreposição.
export function syncTransitionAudioFades(project: Pick<ProjectDocument, "layers" | "audioTracks">) {
  const linkedAudio = (layerId: string) => project.audioTracks.filter((track: AudioTrack) => track.linked && track.linkedLayerId === layerId);
  for (const layer of project.layers) {
    const window = transitionWindow(project, layer);
    if (!window?.partner) continue;
    const overlap = window.end - window.start;
    for (const track of linkedAudio(layer.id)) {
      track.fadeInStart = track.startTime;
      track.fadeInEnd = Math.min(track.endTime, track.startTime + overlap);
    }
    for (const track of linkedAudio(window.partner.id)) {
      track.fadeOutEnd = track.endTime;
      track.fadeOutStart = Math.max(track.startTime, track.endTime - overlap);
    }
  }
}

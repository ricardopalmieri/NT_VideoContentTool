// Creative macros: each one expands to base commands from the current state, so
// dryRun shows exactly what will change and undo stays one step per batch.
import { sourceTimeFor } from "../renderer/source-time";
import { visualTracks } from "./clip-tracks";
import type { ProjectDocument } from "./types";

type Command = Record<string, unknown> & { type: string };

const round = (project: ProjectDocument, time: number) => Math.round(time * project.settings.fps) / project.settings.fps;

function layerOf(project: ProjectDocument, layerId: string) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`Camada não encontrada: ${layerId}.`);
  return layer;
}

function beatLength(project: ProjectDocument, beat?: number) {
  if (beat) return beat;
  if (project.settings.grid) return 60 / project.settings.grid.bpm;
  throw new Error("Informe beat (s) ou defina a grade com composition.set grid {bpm}.");
}

function fraction(token: string) {
  const [a, b] = token.split("/");
  const value = b === undefined ? Number(a) : Number(a) / Number(b);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Passo inválido no pattern: ${token}. Use frações como 1/2 1/4 ou flip.`);
  return value;
}

/**
 * Loop seam: a copy of the opening shot fades in over the last `fade` seconds
 * and ends on the frame the loop starts with, so the cut back to 0 is invisible.
 */
export function expandLoopSeam(project: ProjectDocument, command: { fade?: number; trackId?: string; newLayerId?: string }): Command[] {
  const fade = command.fade ?? .5;
  const start = project.settings.workArea?.in ?? 0;
  const end = project.settings.workArea?.out ?? project.settings.duration;
  const tracks = visualTracks(project);
  const track = command.trackId ? tracks.find((item) => item.id === command.trackId) : tracks.at(-1);
  if (!track) throw new Error("Nenhuma faixa de vídeo para costurar o loop.");
  const first = [...track.clips].sort((a, b) => a.startTime - b.startTime).find((clip) => clip.startTime <= start + 1e-6 && clip.endTime > start);
  if (!first || !first.asset) throw new Error(`A faixa ${track.id} não tem mídia começando em ${start} s.`);
  const rate = Math.abs(first.playbackRate || 1);
  const sourceStart = first.sourceIn - fade * rate;
  if (first.kind === "video" && sourceStart < -1e-6) {
    throw new Error(`O primeiro plano começa em ${first.sourceIn} s do arquivo; a costura de ${fade} s precisa de sourceIn de pelo menos ${fade * rate} s. Use fade menor ou mova o sourceIn.`);
  }
  const id = command.newLayerId || `${first.id}_seam`;
  return [
    { type: "clip.place", layerId: id, asset: first.asset, startTime: round(project, end - fade), endTime: end, trackId: undefined as unknown as string,
      ...(first.kind === "video" ? { sourceIn: Math.max(0, sourceStart), playbackRate: rate } : {}), audio: "none", name: `${first.name} (costura)`,
      props: { x: first.x, y: first.y, width: first.width, height: first.height, rotation: first.rotation, scaleX: first.scaleX, scaleY: first.scaleY,
        fadeInStart: round(project, end - fade), fadeInEnd: end } },
  ].map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)) as Command);
}

/** Stutter: repeats the slice that starts at `at` with step lengths in beats; "flip" mirrors the next step. */
export function expandStutter(project: ProjectDocument, command: { layerId: string; at: number; pattern: string; beat?: number; newLayerId?: string }): Command[] {
  const layer = layerOf(project, command.layerId);
  if (!layer.asset || layer.kind !== "video") throw new Error("fx.stutter vale para clipes de vídeo.");
  const beat = beatLength(project, command.beat);
  const source = sourceTimeFor(layer, command.at, project.assetMetadata?.[layer.asset]?.duration ?? 7200, layer.playbackRate || 1);
  const commands: Command[] = [];
  const trackId = command.newLayerId ? `${command.newLayerId}_track` : `${layer.id}_stutter`;
  commands.push({ type: "track.create", trackId, kind: "video", name: "Stutter", index: 0 });
  let time = command.at;
  let flip = false;
  let index = 0;
  for (const token of command.pattern.trim().split(/\s+/)) {
    if (token === "flip") { flip = !flip; continue; }
    const length = fraction(token) * beat;
    const start = round(project, time);
    const end = round(project, time + length);
    if (end <= start) throw new Error(`Passo ${token} menor que um frame.`);
    commands.push({ type: "clip.place", layerId: `${command.newLayerId || layer.id}_st${++index}`, asset: layer.asset, startTime: start, endTime: end,
      trackId, sourceIn: Math.max(0, source), playbackRate: layer.playbackRate || 1, audio: "none",
      props: { x: layer.x, y: layer.y, width: layer.width, height: layer.height, rotation: layer.rotation, scaleY: layer.scaleY, scaleX: flip ? -Math.abs(layer.scaleX) : Math.abs(layer.scaleX) } });
    time += length;
  }
  if (!index) throw new Error("pattern sem passos.");
  return commands;
}

/** Strobe: full-frame flashes of `frames` frames at each time. Lint warns above 3 per second. */
export function expandStrobe(project: ProjectDocument, command: { times: number[]; frames?: number; color?: string; opacity?: number; id?: string }): Command[] {
  const frames = command.frames ?? 2;
  const base = command.id || "strobe";
  const trackId = `${base}_track`;
  const commands: Command[] = [{ type: "track.create", trackId, kind: "video", name: "Strobe", index: 0 }];
  command.times.forEach((time, index) => {
    const start = round(project, time);
    commands.push({ type: "layer.create", layerId: `${base}${index + 1}`, kind: "geometry", name: "Flash", startTime: start, endTime: round(project, start + frames / project.settings.fps), trackId,
      props: { fill: command.color || "#ffffff", opacity: command.opacity ?? 1, width: project.settings.width, height: project.settings.height, x: project.settings.width / 2, y: project.settings.height / 2, scaleLocked: false, sizeLocked: false } });
  });
  return commands;
}

/** Spike: an effect jumps to `intensity` at `at` and falls back to 0 over `dur`. */
export function expandSpike(project: ProjectDocument, command: { effect: string; at: number; dur?: number; intensity?: number; ownerId?: string; effectId?: string; parameter?: string }): Command[] {
  const dur = command.dur ?? .25;
  const parameter = command.parameter || "mix";
  const effectId = command.effectId || `${command.effect}_spike_${Math.round(command.at * 1000)}`;
  const existing = project.postEffects.find((item) => item.id === effectId) || project.layers.flatMap((layer) => layer.effects).find((item) => item.id === effectId);
  const post = ["rgbDelay", "noise", "glitch", "vhs", "cameraShake", "glow"].includes(command.effect);
  if (!existing && !post && !command.ownerId) throw new Error(`${command.effect} é efeito de camada: informe ownerId (a camada).`);
  const commands: Command[] = existing ? [] : [{ type: "effect.add", kind: command.effect, ownerId: post ? "__post__" : command.ownerId!, effectId }];
  const previous = existing?.keyframes?.[parameter] || [];
  const at = round(project, command.at);
  const before = round(project, at - 1 / project.settings.fps);
  const after = Math.min(project.settings.duration, round(project, at + Math.max(dur, 1 / project.settings.fps)));
  const spike = [
    ...(before >= 0 ? [{ time: before, value: 0, easing: "hold" }] : []),
    { time: at, value: command.intensity ?? 1, easing: "easeOut" },
    ...(after > at + 1e-6 ? [{ time: after, value: 0, easing: "hold" }] : []),
  ];
  const keys = [
    ...previous.filter((key) => key.time < spike[0].time - 1e-6 || key.time > spike.at(-1)!.time + 1e-6),
    ...spike,
  ].sort((a, b) => a.time - b.time);
  commands.push({ type: "effect.keyframe.set", effectId, property: parameter, keys });
  return commands;
}

/** Entrance/exit presets for text and other layers, as keyframes. */
export function expandAnimate(project: ProjectDocument, command: { layerId: string; in?: string; out?: string; duration?: number }): Command[] {
  const layer = layerOf(project, command.layerId);
  const dur = command.duration ?? .4;
  const startA = layer.startTime;
  const startB = round(project, layer.startTime + dur);
  const endA = round(project, layer.endTime - dur);
  const endB = layer.endTime;
  const tracks = new Map<string, Array<{ time: number; value: number; easing: string }>>();
  const add = (property: string, time: number, value: number, easing = "easeOut") => {
    tracks.set(property, [...(tracks.get(property) || []), { time, value, easing }]);
  };
  const shift = project.settings.height * .04;
  const preset = (name: string | undefined, entering: boolean) => {
    if (!name || name === "none") return;
    const [from, to] = entering ? [startA, startB] : [endA, endB];
    const easing = entering ? "easeOut" : "easeIn";
    if (name === "fade") { add("opacity", from, entering ? 0 : layer.opacity, easing); add("opacity", to, entering ? layer.opacity : 0, easing); }
    else if (name === "slide-up") {
      add("opacity", from, entering ? 0 : layer.opacity, easing); add("opacity", to, entering ? layer.opacity : 0, easing);
      add("y", from, entering ? layer.y + shift : layer.y, easing); add("y", to, entering ? layer.y : layer.y - shift, easing);
    } else if (name === "pop") {
      add("scaleX", from, entering ? layer.scaleX * .6 : layer.scaleX, easing); add("scaleX", to, entering ? layer.scaleX : layer.scaleX * .6, easing);
      add("scaleY", from, entering ? layer.scaleY * .6 : layer.scaleY, easing); add("scaleY", to, entering ? layer.scaleY : layer.scaleY * .6, easing);
      add("opacity", from, entering ? 0 : layer.opacity, easing); add("opacity", to, entering ? layer.opacity : 0, easing);
    } else throw new Error(`Animação desconhecida: ${name}. Use fade, slide-up, pop ou none.`);
  };
  if (startB > endA + 1e-6 && command.in && command.out) throw new Error("O clipe é curto demais para entrada e saída com essa duração.");
  preset(command.in, true);
  preset(command.out, false);
  return [...tracks].map(([property, keys]) => ({ type: "keyframe.set", layerId: layer.id, property, keys }));
}

function srtTime(value: string) {
  const match = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(value);
  if (!match) throw new Error(`Tempo SRT inválido: ${value}.`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, "0").slice(0, 3)) / 1000;
}

/** Subtitles: one text clip per SRT cue on a new track. */
export function expandSrt(project: ProjectDocument, command: { srt: string; trackId?: string; idPrefix?: string; props?: Record<string, unknown> }): Command[] {
  const prefix = command.idPrefix || "legenda";
  const trackId = command.trackId || `${prefix}_track`;
  const cues = command.srt.replace(/\r/g, "").split(/\n\s*\n/).map((block) => block.trim().split("\n")).filter((lines) => lines.length >= 2);
  const commands: Command[] = project.tracks?.some((track) => track.id === trackId) ? [] : [{ type: "track.create", trackId, kind: "video", name: "Legendas", index: 0 }];
  const margin = project.settings.height * (project.settings.height > project.settings.width * 1.3 ? 420 / 1920 : .12);
  const parsed = cues.flatMap((lines) => {
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) return [];
    const [from, to] = lines[timing].split("-->").map((part) => part.trim());
    const text = lines.slice(timing + 1).join("\n").trim();
    return text ? [{ start: round(project, srtTime(from)), end: round(project, srtTime(to)), text }] : [];
  }).sort((a, b) => a.start - b.start);
  let index = 0;
  for (const [position, cue] of parsed.entries()) {
    // Overlapping cues are common in SRT: each one ends where the next begins.
    const next = parsed[position + 1];
    const { start, text } = cue;
    const end = next && next.start < cue.end ? next.start : cue.end;
    if (end <= start || end > project.settings.duration + 1e-6) continue;
    commands.push({ type: "layer.create", layerId: `${prefix}${++index}`, kind: "text", name: `Legenda ${index}`, startTime: start, endTime: end, trackId,
      props: { text, fontSize: Math.round(project.settings.height * .035), y: project.settings.height - margin, width: project.settings.width * .86, height: project.settings.height * .09, ...command.props } });
  }
  if (!index) throw new Error("Nenhuma legenda válida dentro da composição.");
  return commands;
}

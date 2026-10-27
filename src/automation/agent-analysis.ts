// "Listening" for agents: mix and file analysis as short text (no ? & or =).
import { detectOnsets, estimateTempo, levelProfile, sections, toDb } from "../audio/audio-analysis";
import { decodeAsset, mixProjectAudio } from "../audio/audio-engine";
import type { ProjectDocument } from "../model/types";

const db = (value: number) => `${Math.round(toDb(value))} dB`;
const fileCache = new Map<string, string>();

function channels(buffer: AudioBuffer) {
  return Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
}

/** Level of the final mix per step seconds, which clips sound in each slice, clipping alerts. */
const mixLine = (run: { from: number; to: number; body: string }) =>
  `${run.from.toFixed(1)}${run.to > run.from ? `-${run.to.toFixed(1)}` : ""} ${run.body}`;

export async function analyzeMixText(project: ProjectDocument, start = 0, end = project.settings.duration, step = .5) {
  const buffer = await mixProjectAudio(project, 22_050);
  if (!buffer) return "Mixagem vazia: nenhum áudio audível (sem clipes de áudio ou todos mudos).";
  const points = levelProfile(channels(buffer), buffer.sampleRate, Math.max(0, start), Math.min(end, buffer.duration), step);
  // Trechos seguidos com a mesma leitura viram uma linha só ("0.0-7.5 ..."): menos texto para o agente.
  const lines: string[] = [];
  let run: { from: number; to: number; body: string } | null = null;
  for (const point of points) {
    const sources = project.audioTracks
      .filter((track) => !track.muted && track.volume > .001 && track.startTime < point.time + step && track.endTime > point.time)
      .map((track) => `${track.id}${track.volume !== 1 ? ` x${+track.volume.toFixed(2)}` : ""}`);
    const clip = point.peak >= .99 ? " CLIPPING" : "";
    const body = `rms ${db(point.rms)} pico ${db(point.peak)}${clip} | ${sources.join(" ") || "silêncio"}`;
    if (run && run.body === body) run.to = point.time;
    else {
      if (run) lines.push(mixLine(run));
      run = { from: point.time, to: point.time, body };
    }
  }
  if (run) lines.push(mixLine(run));
  const clipping = points.filter((point) => point.peak >= .99).length;
  const loudest = points.reduce((best, point) => point.rms > best.rms ? point : best, points[0]);
  return [
    `Mix ${start}-${end} s em passos de ${step} s. Pico máximo ${db(Math.max(...points.map((point) => point.peak)))}, trecho mais alto em ${loudest?.time ?? 0} s.`,
    clipping ? `ALERTA: ${clipping} trecho(s) com clipping; baixe volume com audio.set.` : "Sem clipping.",
    ...lines,
  ].join("\n");
}

/** Tempo, beat grid offset, onsets, loudness sections of one bin file (cached). */
export async function analyzeAudioText(asset: string) {
  const cached = fileCache.get(asset);
  if (cached) return cached;
  const buffer = await decodeAsset(asset);
  const data = channels(buffer);
  const { onsets, flux, hop } = detectOnsets(data, buffer.sampleRate);
  const tempo = estimateTempo(flux, hop, onsets);
  const step = buffer.duration > 120 ? 2 : 1;
  const parts = sections(levelProfile(data, buffer.sampleRate, 0, buffer.duration, step), step);
  const text = [
    `${asset} · ${buffer.duration.toFixed(2)} s`,
    tempo ? `BPM ${tempo.bpm} · offset ${tempo.offset} s · confiança ${tempo.confidence} (use composition.set grid bpm ${tempo.bpm} offset ${tempo.offset})` : "Tempo não detectado.",
    `Onsets (${onsets.length}): ${onsets.slice(0, 64).join(" ")}${onsets.length > 64 ? " …" : ""}`,
    `Seções: ${parts.map((part) => `${part.start}-${part.end} ${part.level}`).join(" | ")}`,
  ].join("\n");
  fileCache.set(asset, text);
  return text;
}

const videoCache = new Map<string, string>();

function seekTo(video: HTMLVideoElement, time: number) {
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), 4000);
    video.addEventListener("seeked", () => { window.clearTimeout(timeout); resolve(video.readyState >= 2); }, { once: true });
    video.currentTime = time;
  });
}

/** Scene cuts, brightness, dominant color and motion of a bin video, sampled every step seconds. */
export async function analyzeVideoText(asset: string, step = .5) {
  const key = `${asset}@${step}`;
  const cached = videoCache.get(key);
  if (cached) return cached;
  const { resolveAssetUrl } = await import("../io/web-platform");
  const url = resolveAssetUrl(asset);
  if (!url) throw new Error(`Arquivo não carregado nesta sessão: ${asset}.`);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error(`Não foi possível decodificar ${asset}.`)), { once: true });
  });
  if (!Number.isFinite(video.duration)) {
    // Gravações do MediaRecorder chegam sem duração no cabeçalho; um seek ao fim a revela.
    await new Promise<void>((resolve) => {
      const done = () => { window.clearTimeout(timer); resolve(); };
      const timer = window.setTimeout(done, 3000);
      video.addEventListener("durationchange", () => { if (Number.isFinite(video.duration)) done(); });
      video.currentTime = 1e7;
    });
  }
  // Lidos antes do loop: limpar o src no fim zera duração e tamanho.
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const { videoWidth, videoHeight } = video;
  const width = 48;
  const height = Math.max(1, Math.round(width * videoHeight / Math.max(1, videoWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const samples = Math.min(600, Math.floor(duration / step) + 1);
  let previous: Uint8ClampedArray | null = null;
  const rows: Array<{ time: number; luma: number; motion: number; color: string; cut: boolean }> = [];
  for (let index = 0; index < samples; index++) {
    const time = Math.min(duration - .05, index * step);
    if (!await seekTo(video, time)) continue;
    context.drawImage(video, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let r = 0, g = 0, b = 0, diff = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      r += pixels[offset]; g += pixels[offset + 1]; b += pixels[offset + 2];
      if (previous) diff += Math.abs(pixels[offset] - previous[offset]) + Math.abs(pixels[offset + 1] - previous[offset + 1]) + Math.abs(pixels[offset + 2] - previous[offset + 2]);
    }
    const count = pixels.length / 4;
    const motion = previous ? diff / (count * 3 * 255) : 0;
    const hex = (value: number) => Math.round(value / count).toString(16).padStart(2, "0");
    rows.push({ time: +time.toFixed(2), luma: (.2126 * r + .7152 * g + .0722 * b) / (count * 255), motion, color: `#${hex(r)}${hex(g)}${hex(b)}`, cut: motion > .22 });
    previous = new Uint8ClampedArray(pixels);
  }
  video.removeAttribute("src");
  video.load();
  const cuts = rows.filter((row) => row.cut).map((row) => row.time);
  const level = (value: number) => value < .15 ? "escuro" : value < .45 ? "médio" : "claro";
  const movement = (value: number) => value < .02 ? "parado" : value < .08 ? "suave" : "rápido";
  // Segments between cuts, summarized.
  const bounds = [0, ...cuts, +duration.toFixed(2)];
  const segments = bounds.slice(0, -1).map((start, index) => {
    const end = bounds[index + 1];
    const inside = rows.filter((row) => row.time >= start && row.time < end);
    const average = (pick: (row: typeof rows[number]) => number) => inside.reduce((sum, row) => sum + pick(row), 0) / Math.max(1, inside.length);
    return `${start}-${end} ${level(average((row) => row.luma))} ${movement(average((row) => row.motion))} ${inside[Math.floor(inside.length / 2)]?.color ?? ""}`;
  });
  const text = [
    `${asset} · ${duration.toFixed(2)} s · ${videoWidth}x${videoHeight} · amostras a cada ${step} s`,
    `Cortes de cena: ${cuts.join(" ") || "nenhum"}`,
    `Trechos (início-fim brilho movimento cor): ${segments.join(" | ")}`,
    `Mais claro em ${rows.reduce((best, row) => row.luma > best.luma ? row : best, rows[0])?.time ?? 0} s; mais movimento em ${rows.reduce((best, row) => row.motion > best.motion ? row : best, rows[0])?.time ?? 0} s.`,
  ].join("\n");
  videoCache.set(key, text);
  return text;
}

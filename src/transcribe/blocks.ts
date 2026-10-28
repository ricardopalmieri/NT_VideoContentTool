// Transcrição em blocos independentes: o áudio de 16 kHz é fatiado em blocos de ~5 min com
// 5 s de sobreposição, cada bloco vai ao Whisper numa chamada própria e os resultados são
// juntados sem repetir o que cai na sobreposição. Tudo aqui é puro (sem DOM, sem worker) e
// testado em tests/unit/transcribe-blocks.test.ts.
import { levelProfile, toDb, type LevelPoint } from "../audio/audio-analysis";
import { WHISPER_RATE } from "./audio-prep";
import type { TimedSegment } from "./cues";
import type { WhisperSize } from "./model-catalog";

export const BLOCK_SECONDS = 300;
export const BLOCK_OVERLAP_SECONDS = 5;
/** Um resto menor que isto é anexado ao último bloco em vez de virar um bloco curto. */
export const MIN_TAIL_SECONDS = 30;
/** Silêncio interno de pelo menos isto não é enviado ao modelo. */
export const MIN_SILENCE_SECONDS = 15;
/** Margem mantida em volta de cada trecho com fala. */
export const SPEECH_PAD_SECONDS = 1;
/** Acima disto o diálogo avisa que vai demorar e oferece um trecho menor. */
export const LONG_MEDIA_SECONDS = 600;
/** Mídia até este tamanho usa tempos por palavra por padrão; acima, por frase. */
export const WORD_TIMESTAMP_MAX_SECONDS = 300;
/**
 * Sem sinal de vida do motor (heartbeat do worker, a cada ~3 s) por este tempo, ele é encerrado (ms). Um
 * motor sem heartbeat (ou o de teste) conta o tempo sem mudança de progresso, no mínimo o estimado para o bloco.
 */
export const STALL_MS = 60_000;
/** Medir a velocidade só vale depois disto (s de relógio) e de algum áudio processado. */
const MIN_ETA_ELAPSED_SECONDS = 1;

/** Ajustes que os testes trocam (globalThis.__VCT_TRANSCRIBE_TUNING__). */
export interface TranscribeTuning {
  blockSeconds: number;
  overlapSeconds: number;
  minTailSeconds: number;
  stallMs: number;
}

export function transcribeTuning(): TranscribeTuning {
  const override = globalThis.__VCT_TRANSCRIBE_TUNING__ ?? {};
  return {
    blockSeconds: BLOCK_SECONDS, overlapSeconds: BLOCK_OVERLAP_SECONDS, minTailSeconds: MIN_TAIL_SECONDS, stallMs: STALL_MS,
    ...override,
  };
}

/** Bloco em amostras do áudio de 16 kHz: [start, end). */
export interface AudioBlock {
  index: number;
  start: number;
  end: number;
}

/** Trecho do áudio, em segundos. */
export interface SpeechRange {
  start: number;
  end: number;
}

export const blockSecondsOf = (block: AudioBlock, rate = WHISPER_RATE) => (block.end - block.start) / rate;

export interface PlanOptions {
  rate?: number;
  blockSeconds?: number;
  overlapSeconds?: number;
  minTailSeconds?: number;
  /** Trechos com fala (segundos). Sem isto, o áudio inteiro. */
  ranges?: readonly SpeechRange[];
}

/**
 * Fatia o áudio em blocos. Cada trecho com fala vira um ou mais blocos de até blockSeconds; blocos
 * seguidos do mesmo trecho se sobrepõem em overlapSeconds. A memória de um bloco não depende da duração.
 */
export function planBlocks(totalSamples: number, options: PlanOptions = {}): AudioBlock[] {
  const rate = options.rate ?? WHISPER_RATE;
  const block = Math.max(1, Math.round((options.blockSeconds ?? BLOCK_SECONDS) * rate));
  const overlap = Math.min(Math.max(0, Math.round((options.overlapSeconds ?? BLOCK_OVERLAP_SECONDS) * rate)), Math.floor(block / 2));
  const minTail = Math.max(0, Math.round((options.minTailSeconds ?? MIN_TAIL_SECONDS) * rate));
  const spans = (options.ranges ?? [{ start: 0, end: totalSamples / rate }])
    .map((range) => ({ start: Math.max(0, Math.round(range.start * rate)), end: Math.min(totalSamples, Math.round(range.end * rate)) }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const blocks: AudioBlock[] = [];
  for (const span of spans) {
    let position = span.start;
    for (;;) {
      let end = Math.min(position + block, span.end);
      if (span.end - end < minTail) end = span.end;
      blocks.push({ index: blocks.length, start: position, end });
      if (end >= span.end) break;
      position = end - overlap;
    }
  }
  return blocks;
}

/** Sobreposição entre dois blocos seguidos (em segundos), ou null se não se tocam. */
export function blockOverlap(previous: AudioBlock | undefined, next: AudioBlock, rate = WHISPER_RATE): SpeechRange | null {
  if (!previous || next.start >= previous.end) return null;
  return { start: next.start / rate, end: previous.end / rate };
}

/** Soma dos segundos de áudio dos blocos (a medida do trabalho a fazer). */
export function planSeconds(blocks: readonly AudioBlock[], rate = WHISPER_RATE) {
  return blocks.reduce((sum, block) => sum + blockSecondsOf(block, rate), 0);
}

// ---- Silêncio.

/** Limiar (dB) abaixo do qual um passo conta como silêncio: acompanha o nível da gravação. */
export function silenceThresholdDb(points: readonly LevelPoint[]) {
  const levels = points.map((point) => toDb(point.rms)).sort((a, b) => a - b);
  if (!levels.length) return -60;
  const loud = levels[Math.floor((levels.length - 1) * .95)];
  return Math.min(-45, Math.max(-60, loud - 35));
}

/**
 * Trechos com fala a partir do perfil de nível: silêncio interno de minSilence ou mais fica de fora, o
 * silêncio nas pontas sempre; cada trecho mantém uma pequena margem.
 */
export function speechRanges(points: readonly LevelPoint[], step: number, totalSeconds: number, options: { minSilence?: number; pad?: number; thresholdDb?: number } = {}): SpeechRange[] {
  const minSilence = options.minSilence ?? MIN_SILENCE_SECONDS;
  const pad = options.pad ?? SPEECH_PAD_SECONDS;
  const threshold = options.thresholdDb ?? silenceThresholdDb(points);
  const raw: SpeechRange[] = [];
  for (const point of points) {
    if (toDb(point.rms) < threshold) continue;
    const last = raw[raw.length - 1];
    if (last && point.time - last.end < minSilence - 1e-9) last.end = point.time + step;
    else raw.push({ start: point.time, end: point.time + step });
  }
  const padded: SpeechRange[] = [];
  for (const range of raw) {
    const next = { start: Math.max(0, range.start - pad), end: Math.min(totalSeconds, range.end + pad) };
    const last = padded[padded.length - 1];
    if (last && next.start <= last.end) last.end = Math.max(last.end, next.end);
    else padded.push(next);
  }
  return padded.filter((range) => range.end > range.start);
}

/** Trechos com fala de um áudio mono de 16 kHz (nível a cada meio segundo). */
export function findSpeechRanges(audio: Float32Array, rate = WHISPER_RATE, options: { minSilence?: number } = {}) {
  const step = .5;
  const total = audio.length / rate;
  return speechRanges(levelProfile([audio], rate, 0, total, step), step, total, options);
}

// ---- Junção.

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const normalize = (text: string) => clean(text).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "");

/** Mantém só o que começa onde a regra deixa; palavras são cortadas uma a uma. */
function trimSegments(segments: readonly TimedSegment[], keep: (start: number) => boolean): TimedSegment[] {
  const out: TimedSegment[] = [];
  for (const segment of segments) {
    if (!segment.words?.length) {
      if (keep(segment.start)) out.push(segment);
      continue;
    }
    const words = segment.words.filter((word) => keep(word.start));
    if (!words.length) continue;
    if (words.length === segment.words.length) { out.push(segment); continue; }
    out.push({ start: words[0].start, end: words[words.length - 1].end, text: clean(words.map((word) => word.text).join(" ")), words });
  }
  return out;
}

/**
 * Junta o resultado de um bloco ao que já existe. Na sobreposição vale o meio dela: o bloco anterior
 * fica com o que começa antes, o novo com o que começa depois (as bordas de cada bloco são o ponto
 * fraco do modelo). Sem sobreposição, só acrescenta. Um bloco sem fala depois do corte não apaga nada.
 */
export function mergeBlockSegments(accumulated: readonly TimedSegment[], incoming: readonly TimedSegment[], overlap: SpeechRange | null): TimedSegment[] {
  let added = [...incoming];
  let base = [...accumulated];
  if (overlap && overlap.end > overlap.start) {
    const cut = (overlap.start + overlap.end) / 2;
    added = trimSegments(incoming, (start) => start >= cut - 1e-9);
    if (added.length) base = trimSegments(accumulated, (start) => start < cut - 1e-9);
  }
  // Repetição exata na emenda (o mesmo texto quase no mesmo instante) conta uma vez só.
  const last = base[base.length - 1];
  const first = added[0];
  if (last && first && normalize(last.text) === normalize(first.text) && Math.abs(first.start - last.start) < 3) added.shift();
  return [...base, ...added];
}

// ---- Tempo.

/** Segundos que faltam, pela velocidade medida (áudio processado por segundo de relógio); null sem base. */
export function estimateRemainingSeconds(input: { doneSeconds: number; totalSeconds: number; elapsedSeconds: number }) {
  const { doneSeconds, totalSeconds, elapsedSeconds } = input;
  if (!(doneSeconds > 0) || !(elapsedSeconds >= MIN_ETA_ELAPSED_SECONDS) || !(totalSeconds > 0)) return null;
  return Math.max(0, (totalSeconds - doneSeconds) / (doneSeconds / elapsedSeconds));
}

/** Minutos inteiros para mostrar (arredonda para cima, no mínimo 1). */
export const etaMinutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

/** Segundos de áudio já feitos: blocos concluídos mais a fração do bloco em andamento. */
export function doneAudioSeconds(blocks: readonly AudioBlock[], blocksDone: number, blockFraction = 0, rate = WHISPER_RATE) {
  let done = 0;
  for (let index = 0; index < Math.min(blocksDone, blocks.length); index++) done += blockSecondsOf(blocks[index], rate);
  const current = blocks[blocksDone];
  if (current) done += blockSecondsOf(current, rate) * Math.max(0, Math.min(1, blockFraction));
  return done;
}

/**
 * Segundos de relógio por segundo de áudio, de forma grosseira (para avisar antes de começar), por modelo
 * e dispositivo. webgpu vale com os arquivos do perfil webgpu (encoder fp32/fp16 e decoder q4). wasm é
 * de uma thread só (página sem isolamento de origem); wasmThreads, com até 4 threads (COOP e COEP ligados).
 * Medido em 28/10/2026 (Chrome, RTX 4060, 12 núcleos, 60-170 s de fala, 1o uso com compilação de shaders):
 * base webgpu-f16 0,11-0,16; small webgpu-f16 0,17; base wasm 0,47 (1 thread) e 0,24 (4 threads); small wasm 0,61 (4 threads).
 * small wasm de uma thread não foi medido (chute). Máquinas mais fracas ficam acima disso.
 */
const REAL_TIME_FACTOR: Record<WhisperSize, { webgpu: number; wasm: number; wasmThreads: number }> = {
  base: { webgpu: .12, wasm: .47, wasmThreads: .24 },
  small: { webgpu: .2, wasm: 1.3, wasmThreads: .65 },
};

export function estimateTranscribeSeconds(audioSeconds: number, model: WhisperSize, webgpu: boolean, threaded = false) {
  const factors = REAL_TIME_FACTOR[model];
  return Math.max(0, audioSeconds) * (webgpu ? factors.webgpu : threaded ? factors.wasmThreads : factors.wasm);
}

export const defaultWordTimestamps = (audioSeconds: number) => audioSeconds <= WORD_TIMESTAMP_MAX_SECONDS;

/** "90", "1:30" ou "1:02:03" em segundos; null se não for um tempo. */
export function parseClock(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  return `${hours ? `${hours}:${pad(Math.floor(total / 60) % 60)}` : String(Math.floor(total / 60))}:${pad(total % 60)}`;
}

declare global {
  // eslint-disable-next-line no-var
  var __VCT_TRANSCRIBE_TUNING__: Partial<TranscribeTuning> | undefined;
}

// Mensagens entre a página e o worker do Whisper, e o contrato do motor de transcrição.
import type { AudioBlock } from "./blocks";
import type { TimedSegment } from "./cues";
import type { TranscribeErrorKind } from "./errors";
import type { ModelProfile, ModelSource, TranscribeLanguage, WhisperSize } from "./model-catalog";

export type TranscribeDevice = "webgpu" | "wasm";

export interface TranscribeProgress {
  phase: "download" | "loading" | "transcribing";
  /** Bytes baixados (ou lidos do cache) e total esperado, somando os arquivos do modelo. */
  loaded?: number;
  total?: number;
  /** Blocos concluídos (nunca passa de chunksTotal) e blocos planejados. */
  chunksDone?: number;
  chunksTotal?: number;
  /** Quanto do bloco em andamento já foi (0 a 1). */
  blockFraction?: number;
  device?: TranscribeDevice;
}

/** Resultado de um bloco: segmentos já no tempo do áudio inteiro (a sobreposição ainda não foi tratada). */
export interface BlockResult {
  index: number;
  segments: TimedSegment[];
  /** Os segmentos têm tempos por palavra (words). */
  wordLevel: boolean;
}

export interface TranscribeResult {
  device: TranscribeDevice | "fake";
}

/** Primeira mensagem ao worker: carrega o modelo. Os blocos vêm depois, um a um. */
export interface WorkerInit {
  type: "init";
  model: WhisperSize;
  language: TranscribeLanguage;
  source: ModelSource;
  /** Quais arquivos do modelo usar: wasm (q8) ou webgpu (encoder fp32/fp16, decoder q4). */
  profile: ModelProfile;
  /** Pasta do app (termina em /): dela saem models/ e ort/. */
  baseUrl: string;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
  /** Tempos por palavra (senão por frase). */
  wordTimestamps: boolean;
}

/** Um bloco de áudio (16 kHz mono); o worker só guarda um por vez. */
export interface WorkerBlock {
  type: "block";
  index: number;
  audio: Float32Array;
}

export type WorkerCommand = WorkerInit | WorkerBlock;

export type WorkerReply =
  | ({ type: "progress" } & TranscribeProgress)
  | { type: "ready"; device: TranscribeDevice }
  /** Sinal de vida a cada poucos segundos enquanto o worker trabalha (qualquer mensagem do worker conta como vida para o watchdog). */
  | { type: "heartbeat" }
  | { type: "block"; index: number; segments: TimedSegment[]; wordLevel: boolean; device: TranscribeDevice }
  | { type: "error"; message: string; kind: TranscribeErrorKind };

export interface ImportReport {
  stored: string[];
  /** Arquivos que o modelo precisa e não vieram. */
  missing: string[];
  /** Arquivos com o nome certo, mas tamanho de outro modelo. */
  rejected: string[];
}

export interface TranscribeRequest {
  model: WhisperSize;
  language: TranscribeLanguage;
  /** Todo o áudio (16 kHz mono). O motor não o altera; fatia pelos blocos. */
  audio: Float32Array;
  source: ModelSource;
  profile: ModelProfile;
  /** Plano de blocos (ver blocks.ts). O motor os processa em ordem, a partir de startBlock. */
  blocks: readonly AudioBlock[];
  startBlock?: number;
  /** Tempos por palavra (senão por frase). */
  wordTimestamps: boolean;
  onProgress(progress: TranscribeProgress): void;
  /** O motor está vivo: chamado a cada mensagem do worker (heartbeat, progresso), mesmo sem progresso novo. Motores sem sinal de vida não chamam. */
  onAlive?(): void;
  /** Chamado ao fim de cada bloco, em ordem, com os segmentos no tempo do áudio inteiro. */
  onBlock(result: BlockResult): void;
  signal?: AbortSignal;
}

/**
 * O motor: de onde o modelo vem e a transcrição em si. O real usa um worker com
 * Transformers.js (engine.ts). Testes substituem o motor definindo
 * globalThis.__VCT_TRANSCRIBE_ENGINE__ antes da página carregar, para a suíte
 * nunca baixar um modelo.
 */
export interface TranscribeEngine {
  availability(model: WhisperSize, profile: ModelProfile): Promise<ModelSource>;
  importFiles(model: WhisperSize, files: readonly File[], profile: ModelProfile): Promise<ImportReport>;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
}

declare global {
  // eslint-disable-next-line no-var
  var __VCT_TRANSCRIBE_ENGINE__: TranscribeEngine | undefined;
}

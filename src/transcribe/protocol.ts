// Mensagens entre a página e o worker do Whisper, e o contrato do motor de transcrição.
import type { TimedSegment } from "./cues";
import type { ModelSource, TranscribeLanguage, WhisperSize } from "./model-catalog";

export type TranscribeDevice = "webgpu" | "wasm";

export interface TranscribeProgress {
  phase: "download" | "loading" | "transcribing";
  /** Bytes baixados (ou lidos do cache) e total esperado, somando os arquivos do modelo. */
  loaded?: number;
  total?: number;
  chunksDone?: number;
  chunksTotal?: number;
  device?: TranscribeDevice;
}

export interface TranscribeResult {
  segments: TimedSegment[];
  /** Texto corrido, sem tempos. */
  text: string;
  device: TranscribeDevice | "fake";
}

export interface WorkerRun {
  type: "run";
  model: WhisperSize;
  language: TranscribeLanguage;
  source: ModelSource;
  /** Pasta do app (termina em /): dela saem models/ e ort/. */
  baseUrl: string;
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
  audio: Float32Array;
}

export type WorkerReply =
  | ({ type: "progress" } & TranscribeProgress)
  | { type: "result"; result: TranscribeResult }
  | { type: "error"; message: string };

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
  audio: Float32Array;
  source: ModelSource;
  onProgress(progress: TranscribeProgress): void;
  signal?: AbortSignal;
}

/**
 * O motor: de onde o modelo vem e a transcrição em si. O real usa um worker com
 * Transformers.js (engine.ts). Testes substituem o motor definindo
 * globalThis.__VCT_TRANSCRIBE_ENGINE__ antes da página carregar, para a suíte
 * nunca baixar um modelo.
 */
export interface TranscribeEngine {
  availability(model: WhisperSize): Promise<ModelSource>;
  importFiles(model: WhisperSize, files: readonly File[]): Promise<ImportReport>;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
}

declare global {
  // eslint-disable-next-line no-var
  var __VCT_TRANSCRIBE_ENGINE__: TranscribeEngine | undefined;
}

// Estado da legenda automática, sem DOM: o diálogo (carregado só quando a pessoa
// pede) escreve aqui, e window.vct.status()/transcript() só leem. Fica fora do
// diálogo para o app principal não carregar o diálogo só para responder status().
import { WHISPER_MODELS, formatMegabytes, type TranscribeLanguage, type WhisperSize } from "./model-catalog";

export type JobPhase =
  | "idle" | "waiting" | "preparing" | "download" | "loading" | "transcribing"
  | "review" | "inserted" | "failed" | "cancelled";

export interface JobSnapshot {
  phase: JobPhase;
  model: WhisperSize;
  language: TranscribeLanguage;
  /** "mix" ou o caminho da mídia. */
  source: string;
  loaded: number;
  total: number;
  chunksDone: number;
  chunksTotal: number;
  startedAt: number;
  cues: number;
  srt: string;
  error: string;
  device: string;
}

export interface TranscribeStore {
  get(): JobSnapshot;
  set(patch: Partial<JobSnapshot>): void;
  reset(initial?: Partial<JobSnapshot>): void;
  subscribe(listener: () => void): () => void;
}

export const BUSY_PHASES: readonly JobPhase[] = ["waiting", "preparing", "download", "loading", "transcribing"];

const blank = (): JobSnapshot => ({
  phase: "idle", model: "base", language: "pt", source: "mix", loaded: 0, total: 0, chunksDone: 0, chunksTotal: 0,
  startedAt: 0, cues: 0, srt: "", error: "", device: "",
});

export function createTranscribeStore(): TranscribeStore {
  let state = blank();
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    get: () => state,
    set(patch) { state = { ...state, ...patch }; emit(); },
    reset(initial = {}) { state = { ...blank(), ...initial }; emit(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** Um só trabalho por vez no app. */
export const transcribeStore = createTranscribeStore();

/** Contagem de legendas no texto do SRT (blocos com seta de tempo). */
export function countCues(srt: string) {
  return (srt.match(/-->/g) || []).length;
}

/** Linha curta de status para o agente (o texto final passa por safeText em window-vct). */
export function transcribeStatusText(snapshot: JobSnapshot, now = Date.now()) {
  const model = WHISPER_MODELS[snapshot.model];
  const seconds = snapshot.startedAt ? Math.max(0, Math.round((now - snapshot.startedAt) / 1000)) : 0;
  const head = "Legenda automática:";
  switch (snapshot.phase) {
    case "idle": return `${head} nenhuma em andamento.`;
    case "waiting": return `${head} aguardando a pessoa confirmar o download do modelo ${snapshot.model} (${formatMegabytes(model.bytes)}).`;
    case "preparing": return `${head} preparando o áudio (${snapshot.source}).`;
    case "download": return `${head} baixando o modelo ${snapshot.model}, ${snapshot.total ? Math.min(100, Math.round(snapshot.loaded / snapshot.total * 100)) : 0}% de ${formatMegabytes(model.bytes)}.`;
    case "loading": return `${head} carregando o modelo ${snapshot.model}.`;
    case "transcribing": return `${head} transcrevendo, ${snapshot.chunksDone} de ${snapshot.chunksTotal || 1} trechos, há ${seconds} s.`;
    case "review": return `${head} pronta, ${snapshot.cues} legendas. Leia com vct.transcript(); a pessoa decide inserir na timeline.`;
    case "inserted": return `${head} ${snapshot.cues} legendas inseridas na timeline pela pessoa.`;
    case "cancelled": return `${head} cancelada pela pessoa.`;
    case "failed": return `${head} falhou: ${snapshot.error || "erro desconhecido"}`;
  }
}

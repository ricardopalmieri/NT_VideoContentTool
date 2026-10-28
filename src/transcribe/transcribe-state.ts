// Estado da legenda automática, sem DOM: o diálogo (carregado só quando a pessoa
// pede) escreve aqui, e window.vct.status()/transcript() só leem. Fica fora do
// diálogo para o app principal não carregar o diálogo só para responder status().
import { etaMinutes } from "./blocks";
import { WHISPER_MODELS, formatMegabytes, type TranscribeLanguage, type WhisperSize } from "./model-catalog";

/** "stalled": o motor parou de responder e foi encerrado; a pessoa pode retomar do bloco guardado. */
export type JobPhase =
  | "idle" | "waiting" | "preparing" | "download" | "loading" | "transcribing"
  | "review" | "inserted" | "failed" | "cancelled" | "stalled";

export interface JobSnapshot {
  phase: JobPhase;
  model: WhisperSize;
  language: TranscribeLanguage;
  /** "mix" ou o caminho da mídia. */
  source: string;
  loaded: number;
  total: number;
  /** Blocos concluídos e blocos planejados (chunksDone nunca passa de chunksTotal). */
  chunksDone: number;
  chunksTotal: number;
  /** Segundos que faltam pela velocidade medida; -1 enquanto não há base. */
  etaSeconds: number;
  /** Bloco (a partir de 1) em que a retomada recomeça depois de um travamento; 0 se não há. */
  resumeBlock: number;
  /** Trecho transcrito, em segundos do arquivo ou da timeline (0 e 0 = tudo). */
  rangeStart: number;
  rangeEnd: number;
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
  etaSeconds: -1, resumeBlock: 0, rangeStart: 0, rangeEnd: 0, startedAt: 0, cues: 0, srt: "", error: "", device: "",
});

export function createTranscribeStore(): TranscribeStore {
  let state = blank();
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      if (state.chunksTotal > 0 && state.chunksDone > state.chunksTotal) state = { ...state, chunksDone: state.chunksTotal };
      emit();
    },
    reset(initial = {}) { state = { ...blank(), ...initial }; emit(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** Um só trabalho por vez no app. */
export const transcribeStore = createTranscribeStore();

/**
 * Quem está rodando o trabalho (o diálogo) registra aqui como cancelá-lo: window.vct.cancelTranscribe()
 * funciona sem carregar o diálogo. Devolve false se não havia o que cancelar.
 */
let canceller: (() => boolean) | null = null;
export function registerTranscribeCanceller(cancel: (() => boolean) | null) { canceller = cancel; }
export function cancelTranscribeJob() { return canceller ? canceller() : false; }

/** Contagem de legendas no texto do SRT (blocos com seta de tempo). */
export function countCues(srt: string) {
  return (srt.match(/-->/g) || []).length;
}

/** Linha curta de status para o agente (o texto final passa por safeText em window-vct). */
export function transcribeStatusText(snapshot: JobSnapshot, now = Date.now()) {
  // O tamanho vem do download em curso ou do aviso (depende do dispositivo); sem isso, o do perfil menor.
  const bytes = snapshot.total || WHISPER_MODELS[snapshot.model].bytes;
  const seconds = snapshot.startedAt ? Math.max(0, Math.round((now - snapshot.startedAt) / 1000)) : 0;
  const head = "Legenda automática:";
  const partial = snapshot.cues ? ` ${snapshot.cues} legendas até agora (vct.transcript()).` : "";
  switch (snapshot.phase) {
    case "idle": return `${head} nenhuma em andamento.`;
    case "waiting": return `${head} aguardando a pessoa confirmar o download do modelo ${snapshot.model} (${formatMegabytes(bytes)}).`;
    case "preparing": return `${head} preparando o áudio (${snapshot.source}).`;
    case "download": return `${head} baixando o modelo ${snapshot.model}, ${snapshot.total ? Math.min(100, Math.round(snapshot.loaded / snapshot.total * 100)) : 0}% de ${formatMegabytes(bytes)}.`;
    case "loading": return `${head} carregando o modelo ${snapshot.model}.`;
    case "transcribing": {
      const total = Math.max(1, snapshot.chunksTotal);
      const block = `bloco ${Math.min(snapshot.chunksDone + 1, total)} de ${total}`;
      const eta = snapshot.etaSeconds >= 0 ? `, ~${etaMinutes(snapshot.etaSeconds)} min restantes` : "";
      return `${head} transcrevendo, ${block}${eta}, há ${seconds} s.${partial}`;
    }
    case "stalled": return `${head} o motor parou de responder no bloco ${snapshot.resumeBlock} de ${Math.max(1, snapshot.chunksTotal)} e foi encerrado.${partial} A pessoa pode clicar em Retomar do bloco ${snapshot.resumeBlock} no diálogo.`;
    case "review": return `${head} pronta, ${snapshot.cues} legendas. Leia com vct.transcript(); a pessoa decide inserir na timeline.`;
    case "inserted": return `${head} ${snapshot.cues} legendas inseridas na timeline pela pessoa.`;
    case "cancelled": return `${head} cancelada.${partial}`;
    case "failed": return `${head} falhou: ${snapshot.error || "erro desconhecido"}${partial}`;
  }
}

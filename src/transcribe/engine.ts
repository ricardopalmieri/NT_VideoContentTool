// Motor de transcrição usado pela interface: worker real, ou o motor de teste
// em globalThis.__VCT_TRANSCRIBE_ENGINE__ (ver protocol.ts).
import { appBaseUrl, modelSource, storeModelFiles } from "./model-store";
import type { TranscribeEngine, TranscribeRequest, TranscribeResult, WorkerReply, WorkerRun } from "./protocol";

function abortError() {
  return new DOMException("Transcrição cancelada.", "AbortError");
}

function transcribeInWorker(request: TranscribeRequest) {
  return new Promise<TranscribeResult>((resolve, reject) => {
    if (request.signal?.aborted) { reject(abortError()); return; }
    const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    const finish = (settle: () => void) => {
      request.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      settle();
    };
    const onAbort = () => finish(() => reject(abortError()));
    request.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      if (message.type === "progress") request.onProgress(message);
      else if (message.type === "result") finish(() => resolve(message.result));
      else finish(() => reject(new Error(message.message)));
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || "Falha ao iniciar o motor de transcrição.")));
    const run: WorkerRun = {
      type: "run", model: request.model, language: request.language, source: request.source, baseUrl: appBaseUrl(),
      crossOriginIsolated: self.crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency || 2, audio: request.audio,
    };
    // O áudio muda de dono (sem cópia): quem chamou não o usa mais.
    worker.postMessage(run, [request.audio.buffer]);
  });
}

const realEngine: TranscribeEngine = {
  availability: modelSource,
  importFiles: storeModelFiles,
  transcribe: transcribeInWorker,
};

export function getTranscribeEngine(): TranscribeEngine {
  return globalThis.__VCT_TRANSCRIBE_ENGINE__ ?? realEngine;
}

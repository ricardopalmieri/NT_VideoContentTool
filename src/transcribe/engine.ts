// Motor de transcrição usado pela interface: worker real, ou o motor de teste
// em globalThis.__VCT_TRANSCRIBE_ENGINE__ (ver protocol.ts).
//
// O worker carrega o modelo uma vez; a página manda o áudio bloco a bloco (uma cópia de ~5 min por
// vez, transferida sem segunda cópia), então o worker nunca guarda mais que um bloco. Quem chamou
// continua dono do áudio inteiro: pode retomar de um bloco depois de uma falha ou de um travamento.
import { WHISPER_RATE } from "./audio-prep";
import { offsetSegments } from "./cues";
import { TranscribeError, classifyError } from "./errors";
import { appBaseUrl, modelSource, storeModelFiles } from "./model-store";
import type { TranscribeDevice, TranscribeEngine, TranscribeRequest, TranscribeResult, WorkerBlock, WorkerCommand, WorkerInit, WorkerReply } from "./protocol";

function abortError() {
  return new DOMException("Transcrição cancelada.", "AbortError");
}

function transcribeInWorker(request: TranscribeRequest) {
  return new Promise<TranscribeResult>((resolve, reject) => {
    if (request.signal?.aborted) { reject(abortError()); return; }
    const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    const total = request.blocks.length;
    let settled = false;
    let device: TranscribeDevice = "wasm";
    let position = request.startBlock ?? 0;
    let waiter: ((reply: Extract<WorkerReply, { type: "ready" | "block" }>) => void) | null = null;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      request.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      settle();
    };
    const fail = (error: unknown) => finish(() => reject(classifyError(error)));
    const onAbort = () => finish(() => reject(abortError()));
    request.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      // Qualquer mensagem prova que o worker está vivo. O heartbeat de 3 s sozinho não basta: no WASM de uma
      // thread a conta do modelo ocupa o worker e o timer quase não roda; os avisos de progresso (a cada token) passam.
      request.onAlive?.();
      if (message.type === "heartbeat") return;
      if (message.type === "progress") {
        const { type: _type, ...progress } = message;
        // O worker conta só o bloco em andamento; a página sabe em que posição do plano ele está.
        request.onProgress(progress.phase === "transcribing" ? { ...progress, chunksDone: Math.min(position, total), chunksTotal: total } : progress);
      } else if (message.type === "error") finish(() => reject(new TranscribeError(message.kind, message.message)));
      else if (waiter) {
        const resolveWait = waiter;
        waiter = null;
        resolveWait(message);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(() => reject(new TranscribeError("worker", event.message || "O motor de transcrição parou de funcionar.")));
    };
    worker.onmessageerror = () => finish(() => reject(new TranscribeError("worker", "A mensagem do motor de transcrição não pôde ser lida.")));
    const send = (command: WorkerCommand, transfer: Transferable[] = []) => worker.postMessage(command, transfer);
    const next = <T extends "ready" | "block">(type: T) =>
      new Promise<Extract<WorkerReply, { type: T }>>((resolveWait) => {
        waiter = (reply) => { if (reply.type === type) resolveWait(reply as Extract<WorkerReply, { type: T }>); };
      });

    const init: WorkerInit = {
      type: "init", model: request.model, language: request.language, source: request.source, profile: request.profile, baseUrl: appBaseUrl(),
      crossOriginIsolated: self.crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency || 2, wordTimestamps: request.wordTimestamps,
    };
    void (async () => {
      const ready = next("ready");
      send(init);
      device = (await ready).device;
      let wordLevel = request.wordTimestamps;
      for (; position < total; position++) {
        if (settled) return;
        const block = request.blocks[position];
        request.onProgress({ phase: "transcribing", chunksDone: position, chunksTotal: total, blockFraction: 0, device });
        // Cópia do bloco: o áudio inteiro fica com a página e o worker recebe só este pedaço.
        const audio = request.audio.slice(block.start, block.end);
        const reply = next("block");
        send({ type: "block", index: block.index, audio } satisfies WorkerBlock, [audio.buffer]);
        const done = await reply;
        if (settled) return;
        device = done.device;
        wordLevel = done.wordLevel;
        request.onBlock({ index: block.index, segments: offsetSegments(done.segments, block.start / WHISPER_RATE), wordLevel });
      }
      request.onProgress({ phase: "transcribing", chunksDone: total, chunksTotal: total, blockFraction: 1, device });
      finish(() => resolve({ device }));
    })().catch(fail);
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

// Worker do Whisper (Transformers.js + ONNX Runtime Web). Só é carregado quando a
// pessoa pede uma legenda: o app principal não importa este arquivo. O áudio chega
// em 16 kHz mono e não sai da máquina; o modelo vem do cache do navegador, da
// pasta models/ do servidor ou do Hugging Face (ver model-store.ts).
import { env, pipeline } from "@huggingface/transformers";
import { CHUNK_SECONDS, STRIDE_SECONDS, chunkCount } from "./audio-prep";
import { groupWords, type TimedSegment, type TimedWord } from "./cues";
import { WHISPER_MODELS, whisperLanguageName } from "./model-catalog";
import type { TranscribeDevice, TranscribeProgress, TranscribeResult, WorkerReply, WorkerRun } from "./protocol";

const scope = self as unknown as {
  postMessage(message: WorkerReply): void;
  onmessage: ((event: MessageEvent<WorkerRun>) => void) | null;
};
const send = (message: WorkerReply) => scope.postMessage(message);
const report = (progress: TranscribeProgress) => send({ type: "progress", ...progress });

/** Safari anterior ao 26 sem WebGPU precisa do build do ONNX Runtime sem asyncify. */
function runtimeSuffix(hasWebGpu: boolean) {
  const match = /Version\/(\d+)[\d.]* .*Safari/.exec(navigator.userAgent);
  return match && !/Chrom(e|ium)/.test(navigator.userAgent) && Number(match[1]) < 26 && !hasWebGpu ? "" : ".asyncify";
}

async function hasWebGpu() {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function configure(run: WorkerRun, webgpu: boolean) {
  const base = run.baseUrl;
  // pasta models/ do servidor; cache do navegador; internet: só um deles vale por vez.
  env.allowLocalModels = run.source !== "download";
  // Caminho a partir da raiz do site, não URL completa: o Transformers.js só procura arquivos locais
  // quando o caminho não é http(s) (get_file_metadata decide os arquivos do pipeline assim).
  env.localModelPath = new URL("models/", base).pathname;
  env.allowRemoteModels = run.source === "download";
  // Os arquivos lidos do servidor também ficam no cache do navegador: a segunda vez não baixa de novo.
  env.useBrowserCache = true;
  // O cache de WASM do transformers troca o .mjs por um blob:, que a CSP do app não deixa carregar.
  env.useWasmCache = false;
  const suffix = runtimeSuffix(webgpu);
  const wasm = (env.backends as unknown as { onnx: { wasm: Record<string, unknown> } }).onnx.wasm;
  // O runtime vem do próprio app (dist/ort/), nunca de uma CDN.
  wasm.wasmPaths = { mjs: `${base}ort/ort-wasm-simd-threaded${suffix}.mjs`, wasm: `${base}ort/ort-wasm-simd-threaded${suffix}.wasm` };
  wasm.numThreads = run.crossOriginIsolated ? Math.max(1, Math.min(4, run.hardwareConcurrency - 1)) : 1;
  wasm.proxy = false;
}

interface AsrChunk { text: string; timestamp: [number, number | null] }
interface AsrOutput { text: string; chunks?: AsrChunk[] }
type Recognizer = ((audio: Float32Array, options: Record<string, unknown>) => Promise<AsrOutput>) & { dispose?: () => Promise<void> };

async function loadRecognizer(run: WorkerRun, device: TranscribeDevice): Promise<Recognizer> {
  const model = WHISPER_MODELS[run.model];
  const files = new Map<string, number>();
  let lastPost = 0;
  const phase = run.source === "download" ? "download" : "loading";
  const post = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastPost < 120) return;
    lastPost = now;
    report({ phase, loaded: [...files.values()].reduce((sum, bytes) => sum + bytes, 0), total: model.bytes, device });
  };
  report({ phase, loaded: 0, total: model.bytes, device });
  const create = pipeline as unknown as (task: string, id: string, options: Record<string, unknown>) => Promise<Recognizer>;
  return create("automatic-speech-recognition", model.id, {
    device,
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: (event: { status: string; file?: string; loaded?: number }) => {
      if (!event.file) return;
      if (event.status === "progress") files.set(event.file, event.loaded ?? 0);
      else if (event.status === "done") files.set(event.file, model.files.find((file) => file.path === event.file)?.bytes ?? files.get(event.file) ?? 0);
      else return;
      post(event.status === "done");
    },
  });
}

async function recognize(recognizer: Recognizer, run: WorkerRun, device: TranscribeDevice): Promise<TranscribeResult> {
  const total = chunkCount(run.audio.length);
  const language = whisperLanguageName(run.language);
  const attempt = async (timestamps: "word" | true) => {
    let done = 0;
    report({ phase: "transcribing", chunksDone: 0, chunksTotal: total, device });
    // generate() chama end() ao terminar cada pedaço de 30 s: serve de contador de progresso.
    const streamer = { put() { /* tokens não interessam */ }, end() { report({ phase: "transcribing", chunksDone: ++done, chunksTotal: total, device }); } };
    return recognizer(run.audio, {
      chunk_length_s: CHUNK_SECONDS, stride_length_s: STRIDE_SECONDS, task: "transcribe",
      ...(language ? { language } : {}), return_timestamps: timestamps, streamer,
    });
  };
  let output: AsrOutput;
  let wordLevel = true;
  try {
    output = await attempt("word");
  } catch {
    // Alguns modelos/dispositivos não têm tempos por palavra: tempos por trecho bastam.
    wordLevel = false;
    output = await attempt(true);
  }
  const chunks = (output.chunks ?? []).filter((chunk) => chunk.text.trim());
  const segments: TimedSegment[] = wordLevel
    ? groupWords(chunks.map((chunk): TimedWord => ({ text: chunk.text.trim(), start: chunk.timestamp[0], end: chunk.timestamp[1] ?? chunk.timestamp[0] + .4 })))
    : chunks.map((chunk) => ({ start: chunk.timestamp[0], end: chunk.timestamp[1], text: chunk.text.trim() }));
  return { segments, text: output.text.trim(), device };
}

async function transcribe(run: WorkerRun) {
  const webgpu = await hasWebGpu();
  configure(run, webgpu);
  const devices: TranscribeDevice[] = webgpu ? ["webgpu", "wasm"] : ["wasm"];
  let failure: unknown;
  for (const device of devices) {
    let recognizer: Recognizer | null = null;
    try {
      recognizer = await loadRecognizer(run, device);
      report({ phase: "loading", device });
      return await recognize(recognizer, run, device);
    } catch (error) {
      // WebGPU que falha ao carregar ou rodar recomeça no WASM, que funciona em todo navegador.
      failure = error;
    } finally {
      try { await recognizer?.dispose?.(); } catch { /* já liberado */ }
    }
  }
  throw failure;
}

scope.onmessage = (event) => {
  if (event.data?.type !== "run") return;
  transcribe(event.data).then(
    (result) => send({ type: "result", result }),
    (error) => send({ type: "error", message: error instanceof Error ? error.message : String(error) }),
  );
};

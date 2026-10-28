// Worker do Whisper (Transformers.js + ONNX Runtime Web). Só é carregado quando a
// pessoa pede uma legenda: o app principal não importa este arquivo. O áudio chega
// em 16 kHz mono e não sai da máquina; o modelo vem do cache do navegador, da
// pasta models/ do servidor ou do Hugging Face (ver model-store.ts).
import { env, pipeline } from "@huggingface/transformers";
import { CHUNK_SECONDS, STRIDE_SECONDS, chunkCount } from "./audio-prep";
import { groupWords, type TimedSegment, type TimedWord } from "./cues";
import { classifyError, isWordTimestampError } from "./errors";
import { PROFILE_DTYPES, whisperLanguageName, whisperModel, type ModelProfile } from "./model-catalog";
import type { TranscribeDevice, TranscribeProgress, WorkerBlock, WorkerCommand, WorkerInit, WorkerReply } from "./protocol";

const scope = self as unknown as {
  postMessage(message: WorkerReply): void;
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
  addEventListener(type: string, listener: (event: Event) => void): void;
};
const send = (message: WorkerReply) => scope.postMessage(message);
const report = (progress: TranscribeProgress) => send({ type: "progress", ...progress });

/** Sinal de vida enquanto o worker trabalha. A página encerra o motor só se ele ficar muito tempo calado. */
const HEARTBEAT_MS = 3000;
setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_MS);

/** Tokens que um pedaço de 20 s costuma gerar: só para mexer a barra dentro do bloco (não precisa ser exato). */
const TOKENS_PER_CHUNK = 110;
const deviceOf = (profile: ModelProfile): TranscribeDevice => (profile === "wasm" ? "wasm" : "webgpu");

/** Safari anterior ao 26 sem WebGPU precisa do build do ONNX Runtime sem asyncify. */
function runtimeSuffix(hasWebGpu: boolean) {
  const match = /Version\/(\d+)[\d.]* .*Safari/.exec(navigator.userAgent);
  return match && !/Chrom(e|ium)/.test(navigator.userAgent) && Number(match[1]) < 26 && !hasWebGpu ? "" : ".asyncify";
}

function configure(run: WorkerInit, webgpu: boolean) {
  const base = run.baseUrl;
  // O cache do navegador vale sempre. A pasta models/ do servidor só quando o modelo vem dela (e então nada
  // vem da internet); vindo do cache, um arquivo que falte (cache incompleto: a janela fechou no meio do
  // download) é baixado de novo, em vez de ser procurado no servidor, que não o tem.
  env.allowLocalModels = run.source === "server";
  // Caminho a partir da raiz do site, não URL completa: o Transformers.js só procura arquivos locais
  // quando o caminho não é http(s) (get_file_metadata decide os arquivos do pipeline assim).
  env.localModelPath = new URL("models/", base).pathname;
  env.allowRemoteModels = run.source !== "server";
  // Os arquivos lidos do servidor também ficam no cache do navegador: a segunda vez não baixa de novo.
  env.useBrowserCache = true;
  // O cache de WASM do transformers troca o .mjs por um blob:, que a CSP do app não deixa carregar.
  env.useWasmCache = false;
  const suffix = runtimeSuffix(webgpu);
  const wasm = (env.backends as unknown as { onnx: { wasm: Record<string, unknown> } }).onnx.wasm;
  // O runtime vem do próprio app (dist/ort/), nunca de uma CDN.
  wasm.wasmPaths = { mjs: `${base}ort/ort-wasm-simd-threaded${suffix}.mjs`, wasm: `${base}ort/ort-wasm-simd-threaded${suffix}.wasm` };
  // Uma thread só. Com 2 ou mais (página isolada por COOP/COEP), o InferenceSession.create nunca termina no Chrome 156
  // do site publicado, na WebGPU e no WASM (medido: 1 thread fica pronto em 2-3 s; 2 e 4 threads, nunca). A WebGPU não
  // precisa delas; o WASM fica ~2x mais lento, como era antes do isolamento.
  wasm.numThreads = 1;
  wasm.proxy = false;
}

interface AsrChunk { text: string; timestamp: [number, number | null] }
interface AsrOutput { text: string; chunks?: AsrChunk[] }
type Recognizer = ((audio: Float32Array, options: Record<string, unknown>) => Promise<AsrOutput>) & { dispose?: () => Promise<void> };

async function loadRecognizer(run: WorkerInit, profile: ModelProfile): Promise<Recognizer> {
  const device = deviceOf(profile);
  const model = whisperModel(run.model, profile);
  // Quem pediu o modelo do servidor ou do cache e cai para o WASM pode precisar de arquivos que não baixou:
  // o perfil de reserva é o mesmo modelo em q8, então permite a internet só para ele.
  if (profile !== run.profile) env.allowRemoteModels = true;
  const files = new Map<string, number>();
  const finished = new Set<string>();
  let lastPost = 0;
  const post = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastPost < 120) return;
    lastPost = now;
    // Com todos os arquivos lidos falta só montar o modelo (na WebGPU, compilar os shaders): a tela sai de "Baixando".
    const phase = run.source === "download" && model.files.some((file) => !finished.has(file.path)) ? "download" : "loading";
    report({ phase, loaded: [...files.values()].reduce((sum, bytes) => sum + bytes, 0), total: model.bytes, device });
  };
  const phase = run.source === "download" ? "download" : "loading";
  report({ phase, loaded: 0, total: model.bytes, device });
  const create = pipeline as unknown as (task: string, id: string, options: Record<string, unknown>) => Promise<Recognizer>;
  return create("automatic-speech-recognition", model.id, {
    device,
    // WebGPU: encoder fp32/fp16 e decoder q4. O int8 (q8) cai na CPU no ONNX Runtime Web e fica mais de 10x mais lento.
    dtype: PROFILE_DTYPES[profile],
    progress_callback: (event: { status: string; file?: string; loaded?: number }) => {
      if (!event.file) return;
      if (event.status === "progress") files.set(event.file, event.loaded ?? 0);
      else if (event.status === "done") {
        files.set(event.file, model.files.find((file) => file.path === event.file)?.bytes ?? files.get(event.file) ?? 0);
        finished.add(event.file);
      } else return;
      post(event.status === "done");
    },
  });
}

/** Uma sessão por worker: o modelo fica carregado e cada bloco de áudio chega numa mensagem. */
interface Session {
  run: WorkerInit;
  profile: ModelProfile;
  device: TranscribeDevice;
  recognizer: Recognizer | null;
  /** Vira false quando o modelo mostra que não dá tempos por palavra; vale para os blocos seguintes. */
  wordLevel: boolean;
}

let session: Session | null = null;

async function openRecognizer(profile: ModelProfile) {
  const current = session!;
  try { await current.recognizer?.dispose?.(); } catch { /* já liberado */ }
  current.recognizer = null;
  current.recognizer = await loadRecognizer(current.run, profile);
  current.profile = profile;
  current.device = deviceOf(profile);
}

async function init(run: WorkerInit) {
  send({ type: "heartbeat" });
  configure(run, run.profile !== "wasm");
  const current: Session = { run, profile: run.profile, device: deviceOf(run.profile), recognizer: null, wordLevel: run.wordTimestamps };
  session = current;
  try {
    await openRecognizer(run.profile);
  } catch (error) {
    // WebGPU que falha ao carregar recomeça no WASM, que funciona em todo navegador.
    if (run.profile === "wasm") throw error;
    await openRecognizer("wasm");
  }
  report({ phase: "loading", device: current.device });
  send({ type: "ready", device: current.device });
}

async function recognizeOnce(audio: Float32Array): Promise<{ segments: TimedSegment[]; wordLevel: boolean }> {
  const current = session!;
  const language = whisperLanguageName(current.run.language);
  const total = chunkCount(audio.length);
  const call = (timestamps: "word" | true) => {
    let done = 0;
    let tokens = 0;
    let lastReport = 0;
    // generate() chama put() a cada token e end() ao terminar cada pedaço de 30 s: contadores de progresso do bloco.
    const streamer = {
      put() {
        tokens++;
        const now = Date.now();
        if (now - lastReport < 400) return;
        lastReport = now;
        const within = Math.min(.9, tokens / TOKENS_PER_CHUNK);
        report({ phase: "transcribing", blockFraction: Math.min(1, (done + within) / total), device: current.device });
      },
      end() {
        done++;
        tokens = 0;
        report({ phase: "transcribing", blockFraction: Math.min(1, done / total), device: current.device });
      },
    };
    return current.recognizer!(audio, {
      chunk_length_s: CHUNK_SECONDS, stride_length_s: STRIDE_SECONDS, task: "transcribe",
      ...(language ? { language } : {}), return_timestamps: timestamps, streamer,
    });
  };
  let output: AsrOutput;
  let wordLevel = current.wordLevel;
  if (wordLevel) {
    try {
      output = await call("word");
    } catch (error) {
      // Só a falta de tempos por palavra autoriza tempos por frase; memória ou qualquer outro erro segue como erro.
      if (!isWordTimestampError(error)) throw error;
      current.wordLevel = wordLevel = false;
      output = await call(true);
    }
  } else {
    output = await call(true);
  }
  const chunks = (output.chunks ?? []).filter((chunk) => chunk.text.trim());
  const segments: TimedSegment[] = wordLevel
    ? groupWords(chunks.map((chunk): TimedWord => ({ text: chunk.text.trim(), start: chunk.timestamp[0], end: chunk.timestamp[1] ?? chunk.timestamp[0] + .4 })))
    : chunks.map((chunk) => ({ start: chunk.timestamp[0], end: chunk.timestamp[1], text: chunk.text.trim() }));
  return { segments, wordLevel };
}

/** Um bloco, com uma segunda chance só para ele (no WASM, se a primeira foi na WebGPU). */
async function processBlock(command: WorkerBlock) {
  const current = session;
  if (!current?.recognizer) throw new Error("O modelo não está carregado.");
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { segments, wordLevel } = await recognizeOnce(command.audio);
      send({ type: "block", index: command.index, segments, wordLevel, device: current.device });
      return;
    } catch (error) {
      failure = error;
      if (attempt === 0 && current.profile !== "wasm") {
        try { await openRecognizer("wasm"); report({ phase: "loading", device: "wasm" }); } catch { break; }
      }
    }
  }
  throw failure;
}

const fail = (error: unknown) => {
  const known = classifyError(error);
  send({ type: "error", message: known.message, kind: known.kind });
};

scope.onmessage = (event) => {
  const command = event.data;
  if (command?.type === "init") init(command).catch(fail);
  else if (command?.type === "block") processBlock(command).catch(fail);
};

// Falhas fora das promessas acima também chegam à página, em vez de deixá-la esperando.
scope.addEventListener("error", (event) => {
  const failure = event as ErrorEvent;
  fail(failure.error ?? failure.message);
});
scope.addEventListener("unhandledrejection", (event) => fail((event as PromiseRejectionEvent).reason));
scope.addEventListener("messageerror", () => send({ type: "error", message: "O áudio não chegou inteiro ao motor de transcrição.", kind: "worker" }));

// Modelos Whisper da legenda automática: ids, arquivos e tamanhos por perfil de
// dispositivo. Os tamanhos foram medidos em huggingface.co; servem para o aviso
// antes do download e para a barra de progresso. Sem DOM nem transformers: a
// página e o worker importam este arquivo.
export type WhisperSize = "base" | "small";
export const WHISPER_SIZES: readonly WhisperSize[] = ["base", "small"];

/**
 * Perfil de dispositivo = quais arquivos ONNX o modelo usa. O ONNX Runtime Web tem kernels de int8
 * fracos na WebGPU (as operações caem na CPU e tudo fica mais de 10x mais lento), então:
 * - wasm: encoder e decoder q8 (pequenos e rápidos na CPU);
 * - webgpu: encoder fp32 e decoder q4 (como o exemplo whisper-webgpu do Transformers.js);
 * - webgpu-f16: o mesmo com encoder fp16, quando o adaptador tem a extensão shader-f16.
 */
export type ModelProfile = "wasm" | "webgpu" | "webgpu-f16";
export const MODEL_PROFILES: readonly ModelProfile[] = ["wasm", "webgpu-f16", "webgpu"];

export function isModelProfile(value: unknown): value is ModelProfile {
  return value === "wasm" || value === "webgpu" || value === "webgpu-f16";
}

export type EncoderDtype = "q8" | "fp32" | "fp16";
export type DecoderDtype = "q8" | "q4";

/** dtype de cada parte do modelo, como o Transformers.js espera em pipeline({ dtype }). */
export const PROFILE_DTYPES: Readonly<Record<ModelProfile, { encoder_model: EncoderDtype; decoder_model_merged: DecoderDtype }>> = {
  wasm: { encoder_model: "q8", decoder_model_merged: "q8" },
  webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
  "webgpu-f16": { encoder_model: "fp16", decoder_model_merged: "q4" },
};

/** Sufixo do arquivo .onnx para cada dtype (DEFAULT_DTYPE_SUFFIX_MAPPING do Transformers.js). */
const DTYPE_SUFFIX: Readonly<Record<EncoderDtype | DecoderDtype, string>> = { q8: "_quantized", fp32: "", fp16: "_fp16", q4: "_q4" };

export interface WhisperFile {
  /** Caminho dentro do repositório do modelo. */
  path: string;
  bytes: number;
}

export interface WhisperModel {
  size: WhisperSize;
  profile: ModelProfile;
  /** Repositório no Hugging Face. */
  id: string;
  /** Nome curto para a interface (pt-BR, en). */
  label: [string, string];
  files: readonly WhisperFile[];
  bytes: number;
}

interface SizeTable {
  label: [string, string];
  /** config.json, generation_config.json, tokenizer.json, tokenizer_config.json, preprocessor_config.json. */
  shared: readonly [number, number, number, number, number];
  encoder: Readonly<Record<EncoderDtype, number>>;
  decoder: Readonly<Record<DecoderDtype, number>>;
}

const SIZES: Readonly<Record<WhisperSize, SizeTable>> = {
  base: {
    label: ["Rápido", "Fast"],
    shared: [2243, 3832, 2480466, 282682, 339],
    encoder: { q8: 23201314, fp32: 82468078, fp16: 41332612 },
    decoder: { q8: 53693315, q4: 123602419 },
  },
  small: {
    label: ["Preciso", "Accurate"],
    shared: [2227, 3893, 2480466, 282683, 339],
    encoder: { q8: 92326160, fp32: 352825870, fp16: 176607756 },
    decoder: { q8: 156750845, q4: 233149327 },
  },
};

const SHARED_PATHS = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "preprocessor_config.json"] as const;

/** Arquivos (e tamanhos) que o modelo de um perfil precisa. */
export function whisperModel(size: WhisperSize, profile: ModelProfile): WhisperModel {
  const table = SIZES[size];
  const dtypes = PROFILE_DTYPES[profile];
  const shared = (index: number): WhisperFile => ({ path: SHARED_PATHS[index], bytes: table.shared[index] });
  const files: WhisperFile[] = [
    shared(0),
    { path: `onnx/encoder_model${DTYPE_SUFFIX[dtypes.encoder_model]}.onnx`, bytes: table.encoder[dtypes.encoder_model] },
    { path: `onnx/decoder_model_merged${DTYPE_SUFFIX[dtypes.decoder_model_merged]}.onnx`, bytes: table.decoder[dtypes.decoder_model_merged] },
    shared(1), shared(2), shared(3), shared(4),
  ];
  return { size, profile, id: `onnx-community/whisper-${size}`, label: table.label, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

/** Modelos do perfil wasm (o menor): usado onde o perfil ainda não é conhecido. */
export const WHISPER_MODELS: Readonly<Record<WhisperSize, WhisperModel>> = {
  base: whisperModel("base", "wasm"),
  small: whisperModel("small", "wasm"),
};

export const HF_HOST = "https://huggingface.co/";
/** Nome do Cache Storage onde a biblioteca guarda os arquivos (env.cacheKey). */
export const MODEL_CACHE_NAME = "transformers-cache";

/** URL que a biblioteca usa como chave no cache (env.remoteHost + modelo + resolve/main + arquivo). */
export function modelCacheKey(model: WhisperModel, path: string) {
  return `${HF_HOST}${model.id}/resolve/main/${path}`;
}

export function isWhisperSize(value: unknown): value is WhisperSize {
  return value === "base" || value === "small";
}

/** Tamanho legível em MB decimais ("81 MB", "252 MB"). */
export function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / 1e6)} MB`;
}

export type TranscribeLanguage = "pt" | "en" | "es" | "auto";
export const TRANSCRIBE_LANGUAGES: readonly TranscribeLanguage[] = ["pt", "en", "es", "auto"];

export function isTranscribeLanguage(value: unknown): value is TranscribeLanguage {
  return value === "pt" || value === "en" || value === "es" || value === "auto";
}

/** Nome do idioma que o Whisper entende; undefined detecta sozinho. */
export function whisperLanguageName(language: TranscribeLanguage) {
  return ({ pt: "portuguese", en: "english", es: "spanish", auto: undefined } as const)[language];
}

/** Onde o modelo está disponível: cache do navegador, pasta models/ do servidor, ou só na internet. */
export type ModelSource = "cache" | "server" | "download";

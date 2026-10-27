// Modelos Whisper da legenda automática: ids, arquivos e tamanhos (q8, "quantized").
// Os tamanhos foram medidos em huggingface.co; servem para o aviso antes do
// download e para a barra de progresso. Sem DOM nem transformers: a página e o
// worker importam este arquivo.
export type WhisperSize = "base" | "small";
export const WHISPER_SIZES: readonly WhisperSize[] = ["base", "small"];

export interface WhisperFile {
  /** Caminho dentro do repositório do modelo. */
  path: string;
  bytes: number;
}

export interface WhisperModel {
  size: WhisperSize;
  /** Repositório no Hugging Face. */
  id: string;
  /** Nome curto para a interface (pt-BR, en). */
  label: [string, string];
  files: readonly WhisperFile[];
  bytes: number;
}

const ONNX = ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];

function model(size: WhisperSize, label: [string, string], sizes: readonly number[]): WhisperModel {
  const paths = ["config.json", ...ONNX, "generation_config.json", "tokenizer.json", "tokenizer_config.json", "preprocessor_config.json"];
  const files = paths.map((path, index) => ({ path, bytes: sizes[index] }));
  return { size, id: `onnx-community/whisper-${size}`, label, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

export const WHISPER_MODELS: Readonly<Record<WhisperSize, WhisperModel>> = {
  base: model("base", ["Rápido", "Fast"], [2243, 23201314, 53693315, 3832, 2480466, 282682, 339]),
  small: model("small", ["Preciso", "Accurate"], [2227, 92326160, 156750845, 3893, 2480466, 282683, 339]),
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

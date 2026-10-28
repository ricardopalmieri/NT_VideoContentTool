// Erros do motor de transcrição: o que é falta de tempos por palavra (cai para frases), o que é falta
// de memória e o resto. Puro, usado no worker e na página.
export type TranscribeErrorKind = "memory" | "worker" | "other";

export class TranscribeError extends Error {
  constructor(readonly kind: TranscribeErrorKind, detail: string) {
    super(detail);
    this.name = "TranscribeError";
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number") return `código ${error}`;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "";
}

/**
 * O erro específico do Transformers.js quando o modelo não entrega tempos por palavra
 * ("Model outputs must contain cross attentions to extract timestamps…"). Só ele autoriza voltar para
 * tempos por frase; qualquer outro erro continua sendo erro.
 */
export function isWordTimestampError(error: unknown) {
  return /cross.?attentions?|output_attentions|extract timestamps|alignment.?heads|word.?level timestamps/i.test(messageOf(error));
}

const MEMORY = /out of memory|memory access out of bounds|allocation (failed|error)|failed to allocate|cannot allocate|array buffer allocation|invalid (typed )?array length|\bOOM\b|RangeError/i;

/** Falta de memória, inclusive os números crus (ponteiros) que o ONNX Runtime às vezes lança. */
export function isMemoryError(error: unknown) {
  if (typeof error === "number") return true;
  return MEMORY.test(messageOf(error)) || (error instanceof RangeError);
}

export function classifyError(error: unknown): TranscribeError {
  if (error instanceof TranscribeError) return error;
  const detail = messageOf(error).trim() || "erro desconhecido";
  return new TranscribeError(isMemoryError(error) ? "memory" : "other", detail);
}

// Prepara o áudio para o Whisper: 16 kHz, mono, em Float32Array. As contas são
// puras (testadas); só resampleTo16kMono usa o navegador (OfflineAudioContext).
export const WHISPER_RATE = 16_000;
export const CHUNK_SECONDS = 30;
export const STRIDE_SECONDS = 5;

export function resampledLength(frames: number, fromRate: number, toRate = WHISPER_RATE) {
  return Math.max(1, Math.ceil(frames * toRate / fromRate));
}

/** Média dos canais. Um canal só volta como está. */
export function mixToMono(channels: readonly Float32Array[]) {
  if (channels.length === 1) return channels[0];
  const mono = new Float32Array(channels[0]?.length ?? 0);
  for (const channel of channels) for (let index = 0; index < mono.length; index++) mono[index] += channel[index] / channels.length;
  return mono;
}

/** Trecho do áudio a transcrever, limitado ao que existe: início e duração em segundos. */
export function audioWindow(total: number, from: number, length?: number) {
  const start = Math.min(Math.max(0, from), Math.max(0, total - .01));
  const duration = Math.max(.01, Math.min(length ?? total - start, total - start));
  return { start, duration };
}

/**
 * Quantos pedaços o Whisper processa: o pipeline avança chunk - 2 × stride a cada
 * passo, até um pedaço alcançar o fim do áudio.
 */
export function chunkCount(samples: number, rate = WHISPER_RATE, chunkSeconds = CHUNK_SECONDS, strideSeconds = STRIDE_SECONDS) {
  const window = rate * chunkSeconds;
  const jump = window - 2 * rate * strideSeconds;
  if (samples <= window || jump <= 0) return 1;
  return Math.ceil((samples - window) / jump) + 1;
}

/** Decodificado -> 16 kHz mono do trecho [from, from + length). O resampler do navegador faz o filtro. */
export async function resampleTo16kMono(buffer: AudioBuffer, from = 0, length?: number) {
  const { start, duration } = audioWindow(buffer.duration, from, length);
  const context = new OfflineAudioContext(1, resampledLength(Math.round(duration * buffer.sampleRate), buffer.sampleRate), WHISPER_RATE);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start(0, start, duration);
  const rendered = await context.startRendering();
  // Copia: a mensagem para o worker transfere os bytes e o buffer renderizado não deve ser desfeito.
  return new Float32Array(rendered.getChannelData(0));
}

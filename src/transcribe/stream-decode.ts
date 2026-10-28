// Lê o áudio de um arquivo da bandeja em janelas (mediabunny + WebCodecs) e entrega 16 kHz mono
// direto num Float32Array do tamanho final. O pico de memória é o resultado (30 min ≈ 115 MB) mais
// uma janela de 30 s e alguns pedaços decodificados, em vez do áudio inteiro em float.
// mediabunny entra por import dinâmico: o pacote principal não cresce.
import { DECODE_WINDOW_SECONDS, StreamResampler, decodeRange, downmixInto, placeDecoded } from "./stream-resample";

/** O contêiner ou o codec não pode ser lido em partes: quem chamou volta ao caminho antigo. */
export class StreamUnsupportedError extends Error {}

export interface StreamDecodeOptions {
  /** Início e duração do trecho, em segundos (padrão: arquivo todo). */
  from?: number;
  length?: number;
  signal?: AbortSignal;
  /** 0 a 1, uma vez por janela. */
  onProgress?(fraction: number): void;
}

export interface StreamDecodeStats {
  path: "stream" | "fallback";
  windows: number;
  inputFrames: number;
  outputSamples: number;
  /** Maior janela (em quadros de entrada) que ficou na memória. */
  windowFrames: number;
  /** Só no caminho antigo: por que o leitor em partes não serviu. */
  reason?: string;
}

function abortError() {
  return new DOMException("Transcrição cancelada.", "AbortError");
}

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function streamDecodeTo16kMono(blob: Blob, options: StreamDecodeOptions = {}) {
  const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    let track;
    try {
      track = await input.getPrimaryAudioTrack();
    } catch (error) {
      throw new StreamUnsupportedError(error instanceof Error ? error.message : String(error));
    }
    if (!track) throw new StreamUnsupportedError("Sem trilha de áudio legível.");
    if (!(await track.canDecode())) throw new StreamUnsupportedError("Codec de áudio sem decodificador.");
    const rate = await track.getSampleRate();
    const total = await track.computeDuration();
    if (!(rate > 0) || !(total > 0)) throw new StreamUnsupportedError("Duração do áudio desconhecida.");
    const range = decodeRange(total, options.from ?? 0, options.length, rate);
    const resampler = new StreamResampler(rate, range.outputLength);
    const windowFrames = Math.max(1024, Math.round(DECODE_WINDOW_SECONDS * rate));
    const stage = new Float32Array(Math.min(windowFrames, range.frames));
    let filled = 0;
    let cursor = range.first;
    let windows = 0;
    const flush = async () => {
      if (!filled) return;
      resampler.push(stage.subarray(0, filled));
      filled = 0;
      windows++;
      options.onProgress?.(Math.min(1, (cursor - range.first) / range.frames));
      // Respira entre janelas: a interface continua viva e o cancelamento entra.
      await breathe();
      if (options.signal?.aborted) throw abortError();
    };
    const put = async (take: number, fill: (at: number, count: number, done: number) => void) => {
      let done = 0;
      while (done < take) {
        const count = Math.min(take - done, stage.length - filled);
        fill(filled, count, done);
        filled += count;
        done += count;
        if (filled === stage.length) await flush();
      }
    };

    const sink = new AudioBufferSink(track);
    const end = range.first / rate + range.frames / rate;
    for await (const wrapped of sink.buffers(range.first / rate, end)) {
      if (options.signal?.aborted) throw abortError();
      const { buffer } = wrapped;
      if (buffer.sampleRate !== rate) throw new StreamUnsupportedError("A taxa de amostragem mudou no meio do arquivo.");
      const bufferStart = Math.round(wrapped.timestamp * rate);
      const place = placeDecoded(cursor, bufferStart, buffer.length, range.last);
      if (place.pad) await put(place.pad, (at, count) => stage.fill(0, at, at + count));
      if (place.take) {
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
        await put(place.take, (at, count, done) => downmixInto(stage, at, channels, place.skip + done, count));
      }
      cursor += place.pad + place.take;
      if (cursor >= range.last) break;
    }
    // Arquivo mais curto que o declarado: o resto é silêncio (o reamostrador completa).
    await flush();
    const samples = resampler.finish();
    const stats: StreamDecodeStats = { path: "stream", windows, inputFrames: cursor - range.first, outputSamples: samples.length, windowFrames: stage.length };
    return { samples, stats };
  } finally {
    input.dispose();
  }
}

/**
 * Duração e presença de áudio lidas dos metadados/pacotes, sem decodificar nada. Devolve null quando
 * o leitor não consegue dizer (contêiner desconhecido, codec sem decodificador): quem chamou usa o
 * caminho antigo, que decodifica.
 */
export async function streamProbeAudio(blob: Blob) {
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) return null;
    const track = await input.getPrimaryAudioTrack();
    if (!track) return { hasAudio: false, duration: 0 };
    if (!(await track.canDecode())) return null;
    const duration = await track.computeDuration();
    return duration > 0 ? { hasAudio: true, duration } : null;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

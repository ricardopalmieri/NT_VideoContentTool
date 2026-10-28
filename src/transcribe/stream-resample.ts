// Contas da decodificação em partes (puras, testadas): reamostrador contínuo para 16 kHz, mistura em
// mono e posição dos pedaços decodificados no trecho pedido. Só stream-decode.ts usa; fica fora de
// audio-prep.ts para não pesar no pacote principal.
import { WHISPER_RATE, audioWindow, resampledLength } from "./audio-prep";

// ---- Decodificação em partes: o arquivo é lido em janelas e reamostrado aos poucos,
// então o pico de memória fica perto do resultado (16 kHz mono) mais uma janela.

/** Tamanho da janela de leitura, em segundos de áudio. */
export const DECODE_WINDOW_SECONDS = 30;

const KERNEL_ZEROS = 8;
const KERNEL_PHASES = 512;

/**
 * Reamostrador contínuo para 16 kHz (sinc com janela de Blackman, banco de fases): recebe o mono
 * em pedaços de qualquer tamanho e escreve direto num Float32Array do tamanho final. O corte fica
 * abaixo de Nyquist da saída para não dobrar frequências altas para dentro da fala.
 */
export class StreamResampler {
  readonly output: Float32Array;
  written = 0;
  private readonly ratio: number;
  private readonly taps: number;
  private readonly half: number;
  private readonly bank: Float32Array;
  private work = new Float32Array(0);
  private workLength = 0;
  /** Índice absoluto (no áudio de entrada) de work[0]. */
  private workStart: number;

  constructor(readonly fromRate: number, readonly outputLength: number, readonly toRate = WHISPER_RATE) {
    this.output = new Float32Array(outputLength);
    this.ratio = fromRate / toRate;
    const cutoff = .47 * Math.min(1, toRate / fromRate);
    const width = KERNEL_ZEROS / (2 * cutoff);
    this.half = Math.ceil(width);
    this.taps = this.half * 2;
    this.bank = new Float32Array(KERNEL_PHASES * this.taps);
    for (let phase = 0; phase < KERNEL_PHASES; phase++) {
      let sum = 0;
      for (let tap = 0; tap < this.taps; tap++) {
        const x = tap - this.half + 1 - phase / KERNEL_PHASES;
        const u = x / width;
        const arg = 2 * Math.PI * cutoff * x;
        const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(arg) / arg;
        const window = Math.abs(u) >= 1 ? 0 : .42 + .5 * Math.cos(Math.PI * u) + .08 * Math.cos(2 * Math.PI * u);
        const value = 2 * cutoff * sinc * window;
        this.bank[phase * this.taps + tap] = value;
        sum += value;
      }
      for (let tap = 0; tap < this.taps; tap++) this.bank[phase * this.taps + tap] /= sum;
    }
    // Antes do começo o áudio é silêncio.
    this.workStart = -(this.half - 1);
    this.work = new Float32Array(this.half - 1);
    this.workLength = this.half - 1;
  }

  /** Entrada mono (qualquer tamanho). */
  push(chunk: Float32Array) {
    if (!chunk.length || this.written >= this.outputLength) return;
    const needed = this.workLength + chunk.length;
    if (needed > this.work.length) {
      const grown = new Float32Array(needed);
      grown.set(this.work.subarray(0, this.workLength));
      this.work = grown;
    }
    this.work.set(chunk, this.workLength);
    this.workLength = needed;
    this.render();
  }

  /** Completa com silêncio até o tamanho previsto (decodificou menos que o declarado) e devolve o resultado. */
  finish() {
    const piece = new Float32Array(this.fromRate);
    // Cada volta empurra 1 s de silêncio; o limite evita laço infinito se algo der errado.
    for (let guard = 0; this.written < this.outputLength && guard < 100_000; guard++) this.push(piece);
    return this.output;
  }

  private render() {
    const { work, bank, taps, half, ratio, output, outputLength } = this;
    const end = this.workStart + this.workLength;
    let n = this.written;
    for (; n < outputLength; n++) {
      const t = n * ratio;
      let i0 = Math.floor(t);
      let phase = Math.round((t - i0) * KERNEL_PHASES);
      if (phase === KERNEL_PHASES) { phase = 0; i0++; }
      if (i0 + half >= end) break;
      const base = i0 - half + 1 - this.workStart;
      const row = phase * taps;
      let sum = 0;
      for (let tap = 0; tap < taps; tap++) sum += work[base + tap] * bank[row + tap];
      output[n] = sum;
    }
    this.written = n;
    // Guarda só o histórico que a próxima saída ainda usa.
    const next = n * ratio;
    let keep = Math.floor(next) - half + 1 - this.workStart;
    keep = Math.max(0, Math.min(this.workLength, keep));
    if (keep > 0) {
      work.copyWithin(0, keep, this.workLength);
      this.workStart += keep;
      this.workLength -= keep;
    }
  }
}

/**
 * Onde um pedaço decodificado cai no trecho pedido. Tudo em quadros do arquivo: `cursor` é o
 * próximo quadro esperado; o pedaço começa em `bufferStart` e tem `bufferLength` quadros. Devolve
 * quantos quadros de silêncio inserir antes (buraco no arquivo), quantos pular do começo do pedaço
 * (já passou) e quantos usar (o resto é cortado no fim do trecho).
 */
export function placeDecoded(cursor: number, bufferStart: number, bufferLength: number, rangeEnd: number) {
  const bufferEnd = bufferStart + bufferLength;
  if (bufferEnd <= cursor || cursor >= rangeEnd) return { pad: 0, skip: 0, take: 0 };
  const pad = Math.min(Math.max(0, bufferStart - cursor), rangeEnd - cursor);
  const at = cursor + pad;
  const skip = Math.max(0, at - bufferStart);
  const take = Math.max(0, Math.min(bufferLength - skip, rangeEnd - at));
  return { pad, skip, take };
}

/** Soma `take` quadros de todos os canais, a partir de `skip`, em `target[at...]` (média dos canais). */
export function downmixInto(target: Float32Array, at: number, channels: readonly Float32Array[], skip: number, take: number) {
  const count = channels.length;
  if (count === 1) { target.set(channels[0].subarray(skip, skip + take), at); return; }
  const gain = 1 / count;
  for (let index = 0; index < take; index++) {
    let sum = 0;
    for (let channel = 0; channel < count; channel++) sum += channels[channel][skip + index];
    target[at + index] = sum * gain;
  }
}

/** Trecho em quadros do arquivo: [first, last) e quantas amostras de 16 kHz ele vira. */
export function decodeRange(total: number, from: number, length: number | undefined, rate: number) {
  const { start, duration } = audioWindow(total, from, length);
  const first = Math.min(Math.round(start * rate), Math.max(0, Math.round(total * rate) - 1));
  const frames = Math.max(1, Math.round(duration * rate));
  return { start, duration, first, last: first + frames, frames, outputLength: resampledLength(frames, rate) };
}

import { describe, expect, it } from "vitest";
import { resampledLength } from "../../src/transcribe/audio-prep";
import { StreamResampler, decodeRange, downmixInto, placeDecoded } from "../../src/transcribe/stream-resample";

function tone(rate: number, seconds: number, hz: number, amplitude = .5) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let index = 0; index < out.length; index++) out[index] = amplitude * Math.sin(2 * Math.PI * hz * index / rate);
  return out;
}

function resample(input: Float32Array, rate: number, chunk = input.length) {
  const resampler = new StreamResampler(rate, resampledLength(input.length, rate));
  for (let at = 0; at < input.length; at += chunk) resampler.push(input.subarray(at, at + chunk));
  return resampler.finish();
}

/** Amplitude de pico no miolo (sem as pontas, onde o filtro ainda enche). */
function peak(samples: Float32Array) {
  let max = 0;
  for (let index = Math.floor(samples.length * .2); index < Math.floor(samples.length * .8); index++) max = Math.max(max, Math.abs(samples[index]));
  return max;
}

describe("reamostrador contínuo para 16 kHz", () => {
  it("devolve o tamanho previsto", () => {
    for (const rate of [8000, 16_000, 22_050, 44_100, 48_000]) {
      const out = resample(tone(rate, 1.37, 440), rate);
      expect(out.length).toBe(resampledLength(Math.round(rate * 1.37), rate));
    }
  });

  it("mantém o ganho de um tom dentro da banda e o nível contínuo", () => {
    for (const rate of [8000, 44_100, 48_000]) expect(peak(resample(tone(rate, 2, 440), rate))).toBeCloseTo(.5, 1);
    const dc = resample(new Float32Array(48_000).fill(.25), 48_000);
    for (let index = 200; index < dc.length - 200; index++) expect(dc[index]).toBeCloseTo(.25, 4);
  });

  it("derruba o que passaria de Nyquist da saída (sem dobrar para a fala)", () => {
    expect(peak(resample(tone(48_000, 2, 12_000), 48_000))).toBeLessThan(.02);
    expect(peak(resample(tone(44_100, 2, 15_000), 44_100))).toBeLessThan(.02);
  });

  it("dá o mesmo resultado em pedaços de qualquer tamanho", () => {
    const input = tone(44_100, 3, 1000);
    const whole = resample(input, 44_100);
    for (const chunk of [1, 777, 4410, 30 * 44_100]) {
      const parts = resample(input, 44_100, chunk);
      expect(parts.length).toBe(whole.length);
      let worst = 0;
      for (let index = 0; index < whole.length; index++) worst = Math.max(worst, Math.abs(whole[index] - parts[index]));
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it("completa com silêncio quando o arquivo traz menos que o declarado", () => {
    const resampler = new StreamResampler(16_000, 32_000);
    resampler.push(new Float32Array(16_000).fill(.5));
    const out = resampler.finish();
    expect(out.length).toBe(32_000);
    expect(out[8000]).toBeCloseTo(.5, 3);
    expect(Math.abs(out[24_000])).toBeLessThan(1e-6);
  });

  it("segue o tom no tempo certo (sem atraso)", () => {
    const rate = 48_000;
    const out = resample(tone(rate, 1, 200), rate);
    const reference = tone(16_000, 1, 200);
    let worst = 0;
    for (let index = 800; index < 15_000; index++) worst = Math.max(worst, Math.abs(out[index] - reference[index]));
    expect(worst).toBeLessThan(.01);
  });
});

describe("mistura em mono e trecho", () => {
  it("faz a média dos canais a partir de um deslocamento", () => {
    const target = new Float32Array(6);
    downmixInto(target, 2, [new Float32Array([9, 1, 1, 0, 9]), new Float32Array([9, 0, 1, 1, 9])], 1, 3);
    expect(Array.from(target)).toEqual([0, 0, .5, 1, .5, 0]);
    const mono = new Float32Array(3);
    downmixInto(mono, 0, [new Float32Array([1, 2, 3, 4])], 1, 3);
    expect(Array.from(mono)).toEqual([2, 3, 4]);
  });

  it("posiciona pedaços decodificados: pula o que passou, preenche buracos, corta o fim", () => {
    expect(placeDecoded(100, 100, 50, 1000)).toEqual({ pad: 0, skip: 0, take: 50 });
    expect(placeDecoded(100, 80, 50, 1000)).toEqual({ pad: 0, skip: 20, take: 30 });
    expect(placeDecoded(100, 60, 30, 1000)).toEqual({ pad: 0, skip: 0, take: 0 });
    expect(placeDecoded(100, 130, 50, 1000)).toEqual({ pad: 30, skip: 0, take: 50 });
    expect(placeDecoded(100, 120, 500, 200)).toEqual({ pad: 20, skip: 0, take: 80 });
    expect(placeDecoded(100, 5000, 50, 200)).toEqual({ pad: 100, skip: 0, take: 0 });
    expect(placeDecoded(200, 150, 100, 200)).toEqual({ pad: 0, skip: 0, take: 0 });
  });

  it("converte o trecho em quadros do arquivo e em amostras de 16 kHz", () => {
    expect(decodeRange(600, 0, undefined, 44_100)).toMatchObject({ first: 0, frames: 600 * 44_100, outputLength: 600 * 16_000 });
    expect(decodeRange(600, 120, 30, 48_000)).toMatchObject({ first: 120 * 48_000, last: 150 * 48_000, outputLength: 30 * 16_000 });
    // Além do fim: limitado ao que existe.
    const tail = decodeRange(10, 8, 5, 8000);
    expect(tail.duration).toBeCloseTo(2, 5);
    expect(tail.frames).toBe(16_000);
    expect(tail.outputLength).toBe(32_000);
    expect(decodeRange(10, 99, undefined, 8000).first).toBeLessThan(10 * 8000);
  });
});

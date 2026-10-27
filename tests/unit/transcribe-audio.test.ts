import { describe, expect, it } from "vitest";
import { audioWindow, chunkCount, mixToMono, resampledLength } from "../../src/transcribe/audio-prep";

describe("áudio para o Whisper", () => {
  it("calcula o tamanho em 16 kHz", () => {
    expect(resampledLength(48_000, 48_000)).toBe(16_000);
    expect(resampledLength(44_100, 44_100)).toBe(16_000);
    expect(resampledLength(441_000, 44_100)).toBe(160_000);
    expect(resampledLength(1, 48_000)).toBe(1);
    expect(resampledLength(0, 48_000)).toBe(1);
  });

  it("mistura os canais em mono pela média", () => {
    const mono = mixToMono([new Float32Array([1, 0, -1, .5]), new Float32Array([0, 1, -1, .5])]);
    expect(Array.from(mono)).toEqual([.5, .5, -1, .5]);
    const single = new Float32Array([.25, .75]);
    expect(mixToMono([single])).toBe(single);
  });

  it("limita o trecho ao que existe", () => {
    expect(audioWindow(10, 2, 3)).toEqual({ start: 2, duration: 3 });
    expect(audioWindow(10, 8, 5)).toEqual({ start: 8, duration: 2 });
    expect(audioWindow(10, -4)).toEqual({ start: 0, duration: 10 });
    expect(audioWindow(10, 99).start).toBeLessThan(10);
  });

  it("conta os pedaços de 30 s com 5 s de sobreposição", () => {
    const seconds = (value: number) => value * 16_000;
    expect(chunkCount(seconds(5))).toBe(1);
    expect(chunkCount(seconds(30))).toBe(1);
    // Cada passo avança 20 s: 30 s + 20 s = 50 s.
    expect(chunkCount(seconds(30.1))).toBe(2);
    expect(chunkCount(seconds(50))).toBe(2);
    expect(chunkCount(seconds(50.1))).toBe(3);
    expect(chunkCount(seconds(600))).toBe(30);
  });
});

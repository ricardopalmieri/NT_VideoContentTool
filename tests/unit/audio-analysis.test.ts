import { describe, expect, it } from "vitest";
import { detectOnsets, estimateTempo, levelProfile, sections, toDb } from "../../src/audio/audio-analysis";

const rate = 8000;

function clicks(bpm: number, seconds: number, offset = 0) {
  const data = new Float32Array(rate * seconds);
  const beat = 60 / bpm;
  for (let time = offset; time < seconds; time += beat) {
    const start = Math.floor(time * rate);
    for (let index = 0; index < 200 && start + index < data.length; index++) data[start + index] = Math.sin(index / 3) * Math.exp(-index / 60) * .8;
  }
  return data;
}

describe("audio analysis", () => {
  it("measures level per window and flags silence", () => {
    const data = new Float32Array(rate * 2);
    data.fill(.5, rate, rate * 2);
    const points = levelProfile([data], rate, 0, 2, .5);
    expect(points.map((point) => +point.rms.toFixed(2))).toEqual([0, 0, .5, .5]);
    expect(points[3].peak).toBe(.5);
    expect(sections(points, .5).map((section) => section.level)).toEqual(["silêncio", "alto"]);
    expect(Math.round(toDb(.5))).toBe(-6);
  });

  it("finds onsets and tempo of a click track", () => {
    const { onsets, flux, hop } = detectOnsets([clicks(120, 8, .25)], rate);
    expect(onsets.length).toBeGreaterThanOrEqual(14);
    expect(onsets[0]).toBeCloseTo(.25, 1);
    const tempo = estimateTempo(flux, hop, onsets)!;
    expect(Math.abs(tempo.bpm - 120)).toBeLessThan(3);
    expect(Math.abs(tempo.offset - .25)).toBeLessThan(.05);
  });
  it("ignora a ondulação de um grave contínuo e acha o golpe em 0 s", () => {
    // Cliques a 120 BPM a partir de 0 s sobre um drone de 110 Hz (achado na revisão no navegador).
    const length = rate * 8;
    const signal = new Float32Array(length);
    for (let index = 0; index < length; index++) {
      const time = index / rate;
      const beat = time % .5;
      signal[index] = (beat < .05 ? Math.sin(2 * Math.PI * 880 * time) * (1 - beat / .05) * .8 : 0) + Math.sin(2 * Math.PI * 110 * time) * .15;
    }
    const { onsets, flux, hop } = detectOnsets([signal], rate);
    expect(onsets).toHaveLength(16);
    expect(onsets[0]).toBeLessThan(.02);
    const tempo = estimateTempo(flux, hop, onsets)!;
    expect(Math.abs(tempo.bpm - 120)).toBeLessThan(3);
    expect(Math.min(tempo.offset, .5 - tempo.offset)).toBeLessThan(.03);
    expect(tempo.confidence).toBeGreaterThan(.8);
  });
});

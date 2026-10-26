import { expect, it } from 'vitest';
import { equalPowerGain, fadeGainCurve } from '../../src/audio/audio-engine';
import { fadeInEnvelope, fadeOutEnvelope } from '../../src/timeline/timing';

const fades = { fadeInStart: 0, fadeInEnd: 2, fadeOutStart: 8, fadeOutEnd: 10 };

it('fade de áudio usa curva equal-power em vez de rampa linear de amplitude', () => {
  expect(equalPowerGain(0)).toBe(0);
  expect(equalPowerGain(1)).toBe(1);
  expect(equalPowerGain(.5)).toBeCloseTo(Math.SQRT1_2, 6);
  expect(equalPowerGain(-1)).toBe(0);
  expect(equalPowerGain(2)).toBe(1);
});

it('curva do fade cobre o trecho inteiro, do silêncio ao volume cheio e de volta', () => {
  const fadeIn = fadeGainCurve(fades as never, fadeInEnvelope, 0, 2, 5);
  expect(fadeIn[0]).toBe(0);
  expect(fadeIn[4]).toBe(1);
  expect(fadeIn[2]).toBeCloseTo(Math.SQRT1_2, 5);
  const fadeOut = fadeGainCurve(fades as never, fadeOutEnvelope, 8, 10, 5);
  expect(fadeOut[0]).toBe(1);
  expect(fadeOut[4]).toBe(0);
});

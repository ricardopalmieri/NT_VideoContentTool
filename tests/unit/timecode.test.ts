import { expect, it } from 'vitest';
import { formatDurationValue, formatTimecode, parseDurationValue, parseTimecode } from '../../src/timeline/timecode';

it('formata timecode HH:MM:SS:FF pelo fps do projeto', () => {
  expect(formatTimecode(10, 30)).toBe('00:00:10:00');
  expect(formatTimecode(10.5, 30)).toBe('00:00:10:15');
  expect(formatTimecode(3725 + 2 / 24, 24)).toBe('01:02:05:02');
});

it('lê timecode completo, parcial e recusa frames fora do fps', () => {
  expect(parseTimecode('00:00:10:15', 30)).toBe(10.5);
  expect(parseTimecode('01:30', 30)).toBe(90);
  expect(parseTimecode('1:05:12', 24)).toBe(65.5);
  expect(parseTimecode('12', 30)).toBe(12);
  expect(parseTimecode('00:00:01:30', 30)).toBeNull();
  expect(parseTimecode('abc', 30)).toBeNull();
  expect(parseTimecode('', 30)).toBeNull();
});

it('duração em frames converte nos dois sentidos', () => {
  expect(formatDurationValue(10, 30, 'frames')).toBe('300');
  expect(parseDurationValue('450', 30, 'frames')).toBe(15);
  expect(parseDurationValue('4.5', 30, 'frames')).toBeNull();
  expect(formatDurationValue(15, 30, 'tc')).toBe('00:00:15:00');
  expect(parseDurationValue('00:00:15:00', 30, 'tc')).toBe(15);
});

import { expect, it } from "vitest";
import { exportRange } from "../../src/export/export-range";
import { gridTimes, tapTempo } from "../../src/timeline/snapping";

it("grid times follow bpm and offset", () => {
  expect(gridTimes({ duration: 2, grid: { bpm: 120, offset: .25, beatsPerBar: 4 } })).toEqual([.25, .75, 1.25, 1.75]);
  expect(gridTimes({ duration: 2 })).toEqual([]);
});

it("tap tempo uses the median interval", () => {
  expect(tapTempo([0, 500, 1000, 1500, 2010])).toBe(120);
  expect(tapTempo([0, 500])).toBeNull();
});

it("export range uses the work area", () => {
  expect(exportRange({ fps: 30, duration: 30 })).toMatchObject({ firstFrame: 0, frameCount: 900 });
  expect(exportRange({ fps: 30, duration: 30, workArea: { in: 2, out: 4 } })).toMatchObject({ firstFrame: 60, frameCount: 60, start: 2, duration: 2 });
});

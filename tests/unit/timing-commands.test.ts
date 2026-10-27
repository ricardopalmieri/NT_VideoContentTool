import { describe, expect, it } from "vitest";
import { runProjectCommands } from "../../src/model/commands";
import { resolveMusicalTime } from "../../src/model/musical-time";
import { createLayer, createProject, type ProjectDocument } from "../../src/model/types";

const settings = { name: "Grid", width: 320, height: 180, fps: 30, duration: 30, background: "#000000", transparent: false };
const run = (project: ProjectDocument, commands: unknown[]) => runProjectCommands(project, commands, 1 / 60);

function fixture() {
  const project = createProject(settings);
  project.layers.push(createLayer("text", settings, { id: "t", name: "T", startTime: 4, endTime: 8 }));
  return project;
}

describe("work area", () => {
  it("sets, validates and clears the work area", () => {
    let { project } = run(fixture(), [{ type: "composition.set", props: { workArea: { in: 2, out: 10 } } }]);
    expect(project.settings.workArea).toEqual({ in: 2, out: 10 });
    expect(() => run(project, [{ type: "composition.set", props: { workArea: { in: 5, out: 5 } } }])).toThrow("maior que");
    expect(() => run(project, [{ type: "composition.set", props: { workArea: { in: 0, out: 40 } } }])).toThrow();
    project = run(project, [{ type: "composition.set", props: { workArea: null } }]).project;
    expect(project.settings.workArea).toBeUndefined();
  });
});

describe("musical grid", () => {
  const grid = { fps: 30, grid: { bpm: 120, offset: .25, beatsPerBar: 4 } };

  it("converts bar:beat, beat and lengths to frame-aligned seconds", () => {
    expect(resolveMusicalTime("bar:1.1", grid, "time")).toBeCloseTo(8 / 30, 6);
    expect(resolveMusicalTime("bar:3.2", grid, "time")).toBeCloseTo(.25 + 9 * .5, 1);
    expect(resolveMusicalTime("beat:4", grid, "time")).toBeCloseTo(68 / 30, 6);
    expect(resolveMusicalTime("bars:2", grid, "duration")).toBe(4);
    expect(() => resolveMusicalTime("bar:0.1", grid, "time")).toThrow("a partir de 1");
    expect(() => resolveMusicalTime("bar:2", { fps: 30 }, "time")).toThrow("grade musical");
  });

  it("accepts musical times in commands, with the grid set in the same batch", () => {
    const { project } = run(fixture(), [
      { type: "composition.set", props: { grid: { bpm: 120 } } },
      { type: "clip.move", layerId: "t", startTime: "bar:2.1" },
      { type: "layer.set", layerId: "t", props: { endTime: "bar:4.1" } },
    ]);
    expect(project.settings.grid).toEqual({ bpm: 120, offset: 0, beatsPerBar: 4 });
    expect(project.layers[0]).toMatchObject({ startTime: 2, endTime: 6 });
  });

  it("accepts musical times inside fx.strobe times (found in the agent review)", () => {
    const { project } = run(fixture(), [
      { type: "composition.set", props: { grid: { bpm: 120 } } },
      { type: "fx.strobe", times: ["beat:1", "beat:3", 2.5], frames: 2 },
    ]);
    const flashes = project.layers.filter((layer) => layer.id !== "t").map((layer) => layer.startTime).sort((a, b) => a - b);
    expect(flashes).toEqual([.5, 1.5, 2.5]);
  });
});

describe("keyframes relative to the clip and bezier strength", () => {
  it("adds clip start to times with timeBase clip and stores curve", () => {
    const { project } = run(fixture(), [
      { type: "keyframe.upsert", layerId: "t", property: "opacity", time: 0, value: 0, timeBase: "clip" },
      { type: "keyframe.upsert", layerId: "t", property: "opacity", time: 1, value: 1, easing: "bezier", curve: .3, timeBase: "clip" },
    ]);
    expect(project.layers[0].keyframes.opacity).toEqual([
      { time: 4, value: 0, easing: "easeInOut" },
      { time: 5, value: 1, easing: "bezier", curve: .3 },
    ]);
    const set = run(fixture(), [{ type: "keyframe.set", layerId: "t", property: "x", keys: [{ time: .5, value: 1 }], timeBase: "clip" }]).project;
    expect(set.layers[0].keyframes.x[0].time).toBe(4.5);
  });
});

import { expect, it } from "vitest";
import { audioLanes } from "../../src/model/clip-tracks";
import { runProjectCommands } from "../../src/model/commands";
import { createAudioTrack, createLayer, createProject, type ProjectDocument } from "../../src/model/types";

const settings = { name: "R", width: 320, height: 180, fps: 30, duration: 10, background: "#000000", transparent: false };
const run = (project: ProjectDocument, commands: unknown[]) => runProjectCommands(project, commands, 1 / 60);

function fixture() {
  const project = createProject(settings);
  project.layers.push(
    createLayer("geometry", settings, { id: "a", name: "A", startTime: 0, endTime: 2 }),
    createLayer("geometry", settings, { id: "b", name: "B", startTime: 2, endTime: 4, trackId: "a" }),
  );
  project.audioTracks.push(createAudioTrack("1", "media/1.wav", 4, { id: "a1" }), createAudioTrack("2", "media/2.wav", 4, { id: "a2" }));
  return project;
}

it("keyframe.set checks value ranges", () => {
  expect(() => run(fixture(), [{ type: "keyframe.set", layerId: "a", property: "opacity", keys: [{ time: 0, value: 5 }] }])).toThrow("value");
  expect(() => run(fixture(), [{ type: "keyframe.set", layerId: "a", property: "fillColor", keys: [{ time: 0, value: 1.5 }] }])).toThrow("inteiro");
});

it("layer.set refuses overlaps unless allowed", () => {
  expect(() => run(fixture(), [{ type: "layer.set", layerId: "b", props: { startTime: 1 } }])).toThrow("sobrepõe");
  expect(run(fixture(), [{ type: "layer.set", layerId: "b", props: { startTime: 1 }, allowOverlap: true }]).project.layers[1].startTime).toBe(1);
});

it("audio lanes reorder with named tracks", () => {
  const { project } = run(fixture(), [{ type: "track.create", trackId: "vid", kind: "video" }, { type: "audio.reorderLane", laneId: "a2", index: 0 }]);
  expect(audioLanes(project).map((lane) => lane.id)).toEqual(["a2", "a1"]);
});

it("default track names stay unique", () => {
  const { project } = run(fixture(), [
    { type: "track.create", trackId: "t1", kind: "video" }, { type: "track.create", trackId: "t2", kind: "video" },
    { type: "track.remove", trackId: "t1" }, { type: "track.create", trackId: "t3", kind: "video" },
  ]);
  const names = project.tracks!.filter((track) => track.kind === "video").map((track) => track.name);
  expect(new Set(names).size).toBe(names.length);
});

it("overlapping SRT cues are clamped instead of failing", () => {
  const { project } = run(fixture(), [{ type: "text.fromSrt", srt: "1\n00:00:01,000 --> 00:00:04,000\nUm\n\n2\n00:00:03,000 --> 00:00:05,000\nDois" }]);
  expect(project.layers.filter((layer) => layer.kind === "text").map((layer) => [layer.startTime, layer.endTime])).toEqual([[1, 3], [3, 5]]);
});

it("fx.spike at time 0 has no duplicate key times", () => {
  const { project } = run(fixture(), [{ type: "fx.spike", effect: "glitch", at: 0, dur: .5 }]);
  const times = project.postEffects[0].keyframes.mix.map((key) => key.time);
  expect(new Set(times).size).toBe(times.length);
});

it("bar:beat checks the beat inside the bar and uses the grid only after it is set", () => {
  expect(() => run(fixture(), [{ type: "composition.set", props: { grid: { bpm: 120 } } }, { type: "clip.move", layerId: "a", startTime: "bar:2.5" }])).toThrow("de 1 a 4");
  expect(() => run(fixture(), [{ type: "clip.move", layerId: "a", startTime: "bar:2.1" }, { type: "composition.set", props: { grid: { bpm: 120 } } }])).toThrow("grade musical");
});

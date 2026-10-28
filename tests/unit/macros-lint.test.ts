import { describe, expect, it, vi } from "vitest";
import { createVctApi } from "../../src/automation/window-vct";
import { visualTracks } from "../../src/model/clip-tracks";
import { runProjectCommands } from "../../src/model/commands";
import { lintProject } from "../../src/model/lint";
import { createAudioTrack, createProject, type ProjectDocument } from "../../src/model/types";

const settings = { name: "Loop", width: 1080, height: 1920, fps: 30, duration: 10, background: "#000000", transparent: false };
const run = (project: ProjectDocument, commands: unknown[]) => runProjectCommands(project, commands, 1 / 60);

function fixture() {
  const project = createProject(settings);
  project.assetMetadata = { "media/torre.mp4": { originalName: "torre.mp4", size: 1, lastModified: 1, mimeType: "video/mp4", kind: "video", duration: 40, width: 1080, height: 1920, hasAudio: false } };
  return run(project, [
    { type: "clip.place", layerId: "a", asset: "media/torre.mp4", startTime: 0, endTime: 10, sourceIn: 5, fit: "cover" },
  ]).project;
}

describe("macros", () => {
  it("loop.seam fades a copy of the opening shot into the loop point", () => {
    const { project, results } = run(fixture(), [{ type: "loop.seam", fade: .5 }]);
    expect((results[0] as { expanded: unknown[] }).expanded).toHaveLength(1);
    const seam = project.layers.find((layer) => layer.id === "a_seam")!;
    expect(seam).toMatchObject({ startTime: 9.5, endTime: 10, sourceIn: 4.5, sourceOut: 5, fadeInStart: 9.5, fadeInEnd: 10 });
  });

  it("fx.stutter repeats the slice on a new top track with flips", () => {
    const { project } = run(fixture(), [
      { type: "composition.set", props: { grid: { bpm: 120 } } },
      { type: "fx.stutter", layerId: "a", at: 2, pattern: "1/2 1/2 flip 1/4" },
    ]);
    const steps = project.layers.filter((layer) => layer.id.startsWith("a_st"));
    expect(steps.map((layer) => [layer.startTime, +layer.endTime.toFixed(3), layer.sourceIn, Math.sign(layer.scaleX)])).toEqual([[2, 2.267, 7, 1], [2.2666666666666666, 2.5, 7, 1], [2.5, 2.633, 7, -1]]);
    expect(visualTracks(project)[0].id).toBe("a_stutter");
  });

  it("fx.spike keyframes an effect up and back to zero", () => {
    const { project } = run(fixture(), [{ type: "fx.spike", effect: "glitch", at: 3, dur: .5, intensity: .8 }]);
    expect(project.postEffects[0].keyframes.mix.map((key) => [key.time, key.value])).toEqual([[2.9666666666666668, 0], [3, .8], [3.5, 0]]);
    expect(() => run(fixture(), [{ type: "fx.spike", effect: "blur", at: 3 }])).toThrow("ownerId");
  });

  it("text.animate and text.fromSrt create keyframes and subtitles", () => {
    let { project } = run(fixture(), [{ type: "text.fromSrt", srt: "1\n00:00:01,000 --> 00:00:03,500\nOlá mundo\n\n2\n00:00:04,000 --> 00:00:06,000\nSegunda" }]);
    expect(project.layers.filter((layer) => layer.kind === "text").map((layer) => [layer.text, layer.startTime, layer.endTime])).toEqual([["Olá mundo", 1, 3.5], ["Segunda", 4, 6]]);
    project = run(project, [{ type: "text.animate", layerId: "legenda1", in: "slide-up", out: "fade", duration: .4 }]).project;
    const layer = project.layers.find((item) => item.id === "legenda1")!;
    expect(layer.keyframes.opacity.map((key) => key.time)).toEqual([1, 1.4, 3.1, 3.5]);
    expect(layer.keyframes.y).toHaveLength(2);
  });
});

describe("lint", () => {
  it("flags strobes above 3 per second, audio overlap, unsafe text and gaps", () => {
    let project = run(fixture(), [
      { type: "fx.strobe", times: [1, 1.2, 1.4, 1.6, 1.8], frames: 2 },
      { type: "layer.create", layerId: "t", kind: "text", name: "T", startTime: 0, endTime: .5, props: { text: "texto longo demais aqui", y: 100 } },
      { type: "layer.set", layerId: "a", props: { endTime: 8, sourceOut: 13 } },
    ]).project;
    project.audioTracks.push(createAudioTrack("m1", "media/m1.wav", 10, { id: "m1" }), createAudioTrack("m2", "media/m2.wav", 10, { id: "m2", startTime: 2 }));
    const codes = lintProject(project).map((issue) => `${issue.level}:${issue.code}`);
    expect(codes).toContain("erro:flash");
    expect(codes).toContain("aviso:area-segura");
    expect(codes).toContain("aviso:texto-rapido");
    expect(codes).toContain("aviso:audio-sobreposto");
    expect(codes).toContain("aviso:buraco");
  });

  it("a clean project has no issues", () => {
    expect(lintProject(fixture())).toEqual([]);
  });
});

describe("plan", () => {
  it("runs batches in sequence and commits once, or only simulates", () => {
    let project = fixture();
    const commit = vi.fn((next: ProjectDocument) => { project = next; });
    const api = createVctApi({ getProject: () => project, keyframeTolerance: () => 1 / 60, commitProject: commit, confirmConsequential: () => true });
    const batches = [
      [{ type: "track.create", trackId: "over", kind: "video" }],
      [{ type: "layer.create", layerId: "t", kind: "text", name: "T", startTime: 0, endTime: 4, trackId: "over" }],
    ] as never;
    expect(api.plan(batches, { dryRun: true })).toMatch(/^ok \(simulação\) · 2 lotes · 2 comandos/);
    expect(commit).not.toHaveBeenCalled();
    expect(api.plan(batches, { label: "Montagem" })).toContain("desfazer: Montagem");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(project.layers.some((layer) => layer.id === "t")).toBe(true);
    expect(api.summary()).toContain("[over]: 0-4 t");
    expect(api.plan([[{ type: "clip.move", layerId: "nada", startTime: 0 }]] as never)).toMatch(/^erro no lote 1, comando 1 \(clip\.move\)/);
    expect(api.plan([[{ type: "clip.move", layerId: "nada", startTime: 0 }]] as never, { format: "json" })).toMatchObject({ ok: false, results: [] });
  });
});


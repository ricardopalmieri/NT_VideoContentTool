import { describe, expect, it } from "vitest";
import { createVctApi } from "../../src/automation/window-vct";
import { visualTracks } from "../../src/model/clip-tracks";
import { runProjectCommands } from "../../src/model/commands";
import { fitFrame } from "../../src/model/media-assets";
import { createProject, type ProjectDocument } from "../../src/model/types";

const settings = { name: "Loop", width: 1080, height: 1920, fps: 30, duration: 30, background: "#000000", transparent: false };
const meta = (name: string, extra: Record<string, unknown>) => ({ originalName: name, size: 48 * 1048576, lastModified: 1, mimeType: "video/mp4", ...extra });

function binProject(): ProjectDocument {
  const project = createProject(settings);
  project.assetMetadata = {
    "media/torre.mp4": meta("torre.mp4", { kind: "video", duration: 42.1, width: 1080, height: 1920, hasAudio: true }),
    "media/selva.mov": meta("selva.mov", { kind: "video", duration: 70, width: 1920, height: 1080, hasAudio: false }),
    "media/logo.png": meta("logo.png", { kind: "image", width: 500, height: 500, mimeType: "image/png" }),
  };
  return project;
}

const run = (project: ProjectDocument, commands: unknown[]) => runProjectCommands(project, commands, 1 / 60);

describe("clip.place", () => {
  it("places a bin asset with source range, framing and linked audio in one command", () => {
    const { project, results } = run(binProject(), [
      { type: "clip.place", layerId: "t1", asset: "media/torre.mp4", startTime: 0, duration: 2.5, sourceIn: 4, fit: "cover" },
    ]);
    expect(results[0]).toMatchObject({ layerId: "t1", startTime: 0, endTime: 2.5, audioIds: ["t1:audio"] });
    expect(project.layers[0]).toMatchObject({ kind: "video", sourceIn: 4, sourceOut: 6.5, loop: false, width: 1080, height: 1920 });
    expect(project.audioTracks[0]).toMatchObject({ linked: true, linkedLayerId: "t1", sourceIn: 4, sourceOut: 6.5 });
  });

  it("uses the rest of the file when no end is given, and skips audio for silent files", () => {
    const { project } = run(binProject(), [{ type: "clip.place", layerId: "s", asset: "media/selva.mov", startTime: 0, sourceIn: 50, fit: "cover" }]);
    expect(project.layers[0].endTime).toBe(20);
    expect(project.audioTracks).toHaveLength(0);
    expect(project.layers[0].height).toBeCloseTo(1920);
  });

  it("explains timing errors in terms the agent can fix", () => {
    expect(() => run(binProject(), [{ type: "clip.place", layerId: "t", asset: "media/torre.mp4", startTime: 0, duration: 40 }])).toThrow("depois da composição");
    expect(() => run(binProject(), [{ type: "clip.place", layerId: "t", asset: "media/torre.mp4", startTime: 0, duration: 10, sourceIn: 40 }])).toThrow("passa do fim da mídia");
    expect(() => run(binProject(), [{ type: "clip.place", layerId: "t", asset: "media/nada.mp4", startTime: 0, duration: 1 }])).toThrow("vct.assets()");
    expect(() => run(binProject(), [{ type: "clip.place", layerId: "t", asset: "media/torre.mp4", startTime: .01, duration: 1 }])).toThrow("frame");
  });

  it("fills named empty tracks and keeps them when emptied", () => {
    let { project } = run(binProject(), [
      { type: "track.create", trackId: "base", kind: "video", name: "Base" },
      { type: "track.create", trackId: "over", kind: "video", name: "Overlay", index: 0 },
      { type: "clip.place", layerId: "a", asset: "media/torre.mp4", startTime: 0, duration: 2, trackId: "base", audio: "none" },
      { type: "clip.place", layerId: "b", asset: "media/logo.png", startTime: 0, duration: 2, trackId: "over" },
    ]);
    expect(visualTracks(project).map((track) => [track.id, track.clips.map((clip) => clip.id)])).toEqual([["over", ["b"]], ["base", ["a"]]]);
    project = run(project, [{ type: "clip.remove", layerId: "b" }]).project;
    expect(visualTracks(project).map((track) => track.id)).toEqual(["over", "base"]);
    expect(project.tracks?.find((track) => track.id === "over")?.name).toBe("Overlay");
    expect(() => run(project, [{ type: "track.remove", trackId: "base" }])).toThrow("tem clipes");
    project = run(project, [{ type: "clip.move", layerId: "a", startTime: 0, trackId: "over" }]).project;
    expect(visualTracks(project).map((track) => [track.id, track.clips.length])).toEqual([["over", 1], ["base", 0]]);
    expect(run(project, [{ type: "track.remove", trackId: "base" }]).project.tracks?.map((track) => track.id)).toEqual(["over"]);
  });
});

describe("framing", () => {
  it("computes contain, cover and rotate-cover", () => {
    expect(fitFrame(1920, 1080, settings, "contain")).toMatchObject({ width: 1080, rotation: 0 });
    expect(fitFrame(1920, 1080, settings, "cover").height).toBeCloseTo(1920);
    const rotated = fitFrame(1920, 1080, settings, "rotate-cover");
    expect(rotated.rotation).toBe(90);
    expect(rotated.width).toBeCloseTo(1920);
  });
});

describe("bin and text views", () => {
  it("assets() and summary() are short and safe for the browser agent", () => {
    let project = binProject();
    project = run(project, [
      { type: "clip.place", layerId: "t1", asset: "media/torre.mp4", startTime: 0, duration: 2.5, fit: "cover" },
      { type: "layer.create", layerId: "tit", kind: "text", name: "T", startTime: 0, endTime: 2, props: { text: "Quem? Eu & você = nós" } },
    ]).project;
    const api = createVctApi({ getProject: () => project, keyframeTolerance: () => 1 / 60, commitProject: () => {}, confirmConsequential: () => true });
    const assets = api.assets();
    expect(assets).toContain("media/torre.mp4 | video | 42.1s | 1080x1920 vertical | com áudio | 48MB | em uso: t1");
    expect(assets).toContain("media/selva.mov | video | 70s | 1920x1080 horizontal | mudo");
    const summary = api.summary();
    expect(summary.split("\n")[0]).toBe("Loop · 1080x1920 · 30 fps · 30 s");
    expect(summary).toContain("0-2.5 t1");
    expect(`${assets}${summary}`).not.toMatch(/[?&=]/);
  });

  it("asset.remove refuses media in use", () => {
    const project = run(binProject(), [{ type: "clip.place", layerId: "l", asset: "media/logo.png", startTime: 0, duration: 1 }]).project;
    expect(() => run(project, [{ type: "asset.remove", asset: "media/logo.png" }])).toThrow("em uso");
    expect(Object.keys(run(project, [{ type: "asset.remove", asset: "media/selva.mov" }]).project.assetMetadata!)).not.toContain("media/selva.mov");
  });
});

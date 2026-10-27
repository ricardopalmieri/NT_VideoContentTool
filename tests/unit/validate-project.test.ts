import { describe, expect, it } from "vitest";
import { validateProjectDocument } from "../../src/model/validate-project";
import { createEffect, createLayer, createProject } from "../../src/model/types";

const settings = { name: "Validated", width: 320, height: 180, fps: 30, duration: 10, background: "#000000", transparent: true };

describe("project document validation", () => {
  it("accepts current v2 projects and their known optional media metadata", () => {
    const project = createProject(settings);
    project.layers.push(createLayer("geometry", settings, { id: "shape" }));
    project.layers[0].effects.push(createEffect("levels"));
    project.assetMetadata = {
      "media/asset.png": { originalName: "asset.png", size: 12, lastModified: 1, mimeType: "image/png" },
    };

    expect(validateProjectDocument(project)).toEqual({ valid: true, issues: [] });
  });

  it("accepts valid track, lane, and transition metadata", () => {
    const project = createProject(settings);
    project.layers.push(createLayer("geometry", settings, {
      id: "shape",
      trackId: "video-main",
      transition: { type: "dissolve", duration: .5 },
    }));
    project.audioTracks.push({
      id: "audio",
      laneId: "audio-main",
      name: "Audio",
      asset: "media/audio.wav",
      linked: false,
      muted: false,
      volume: 1,
      startTime: 0,
      endTime: 1,
      sourceIn: 0,
      sourceOut: 1,
      playbackRate: 1,
      reverse: false,
      loop: false,
      fadeInStart: 0,
      fadeInEnd: 0,
      fadeOutStart: 1,
      fadeOutEnd: 1,
      effects: [],
    });

    expect(validateProjectDocument(project)).toEqual({ valid: true, issues: [] });
  });

  it.each([
    ["trackId vazio", { trackId: "" }],
    ["trackId não textual", { trackId: 1 }],
    ["transição desconhecida", { transition: { type: "zoom", duration: .5 } }],
    ["duração de transição negativa", { transition: { type: "dissolve", duration: -1 } }],
    ["duração de transição não finita", { transition: { type: "dissolve", duration: Number.NaN } }],
  ])("rejects %s", (_case, invalidMetadata) => {
    const project = createProject(settings);
    project.layers.push(createLayer("geometry", settings, { id: "shape" }));
    Object.assign(project.layers[0], invalidMetadata);
    expect(validateProjectDocument(project).valid).toBe(false);
  });

  it("rejects invalid audio lane metadata", () => {
    const project = createProject(settings);
    project.audioTracks.push({
      id: "audio",
      laneId: "",
      name: "Audio",
      asset: "media/audio.wav",
      linked: false,
      muted: false,
      volume: 1,
      startTime: 0,
      endTime: 1,
      sourceIn: 0,
      sourceOut: 1,
      playbackRate: 1,
      reverse: false,
      loop: false,
      fadeInStart: 0,
      fadeInEnd: 0,
      fadeOutStart: 1,
      fadeOutEnd: 1,
      effects: [],
    });

    expect(validateProjectDocument(project).valid).toBe(false);
  });

  it.each([
    ["unbounded frame rate", { ...settings, fps: 241 }],
    ["oversized dimensions", { ...settings, width: 9000 }],
    ["invalid duration", { ...settings, duration: 7201 }],
    ["invalid color", { ...settings, background: "transparent" }],
  ])("rejects %s", (_case, invalidSettings) => {
    expect(validateProjectDocument(createProject(invalidSettings)).valid).toBe(false);
  });

  it("reports invalid timing, non-finite parameters, and duplicate IDs", () => {
    const project = createProject(settings);
    project.layers.push(
      createLayer("geometry", settings, { id: "duplicate", endTime: 0 }),
      createLayer("text", settings, { id: "duplicate" }),
    );
    project.postEffects.push(createEffect("levels"));
    project.postEffects[0].params.brightness = Number.NaN;

    const result = validateProjectDocument(project);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toContain("endTime");
    expect(result.issues.join(" ")).toContain("duplicado");
    expect(result.issues.join(" ")).toContain("params");
  });
});

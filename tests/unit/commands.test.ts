import { describe, expect, it, vi } from "vitest";
import { createVctApi } from "../../src/automation/window-vct";
import { runProjectCommands } from "../../src/model/commands";
import { validateProjectDocument } from "../../src/model/validate-project";
import { createAudioTrack, createLayer, createProject, type ProjectDocument } from "../../src/model/types";

const settings = { name: "Automation", width: 320, height: 180, fps: 30, duration: 10, background: "#000000", transparent: true };

function projectWithLayer() {
  const project = createProject(settings);
  project.layers.push(createLayer("geometry", settings, { id: "shape", name: "Shape" }));
  return project;
}

describe("deterministic project commands", () => {
  it("applies edits to a copy and returns the normalized commands", () => {
    const source = projectWithLayer();
    const result = runProjectCommands(source, [
      { type: "layer.setNumeric", layerId: "shape", property: "x", value: 100 },
      { type: "keyframe.upsert", layerId: "shape", property: "x", time: 2, value: 150 },
    ], 1 / 60);

    expect(source.layers[0].x).not.toBe(100);
    expect(result.project.layers[0].x).toBe(100);
    expect(result.project.layers[0].keyframes.x).toEqual([
      { time: 2, value: 150, easing: "easeInOut" },
    ]);
    expect(result.commands).toHaveLength(2);
    expect(validateProjectDocument(result.project).valid).toBe(true);
  });

  it("rejects a failed batch atomically and leaves the input unchanged", () => {
    const source = projectWithLayer();

    expect(() => runProjectCommands(source, [
      { type: "layer.setNumeric", layerId: "shape", property: "x", value: 200 },
      { type: "effect.setParam", effectId: "missing", parameter: "amount", value: 1 },
    ], 1 / 60)).toThrow("Efeito não encontrado");
    expect(source.layers[0].x).not.toBe(200);
  });

  it("only accepts known numeric fields and project-valid timing", () => {
    const source = projectWithLayer();
    expect(() => runProjectCommands(source, [
      { type: "layer.setNumeric", layerId: "shape", property: "visible", value: 1 },
    ], 1 / 60)).toThrow("Propriedade numérica não permitida");

    expect(() => runProjectCommands(source, [
      { type: "layer.setNumeric", layerId: "shape", property: "endTime", value: 0 },
    ], 1 / 60)).toThrow("endTime");
  });

  it("creates effects with stable IDs from the shared catalog", () => {
    const result = runProjectCommands(projectWithLayer(), [
      { type: "effect.add", kind: "levels", ownerId: "shape", effectId: "levels-1" },
    ], 1 / 60);

    expect(result.project.layers[0].effects[0]).toMatchObject({
      id: "levels-1",
      kind: "levels",
      params: { brightness: 0, contrast: 1, mix: 1 },
    });
  });

  it("adds and edits audio effects from the same public command contract", () => {
    const project = projectWithLayer();
    project.audioTracks.push(createAudioTrack("Music", "media/music.wav", 10, { id: "music" }));
    const result = runProjectCommands(project, [
      { type: "audioEffect.add", trackId: "music", kind: "lowpass", effectId: "filter-1" },
      { type: "audioEffect.setParam", effectId: "filter-1", parameter: "frequency", value: 8000 },
    ], 1 / 60);

    expect(result.project.audioTracks[0].effects[0].params.frequency).toBe(8000);
    expect(project.audioTracks[0].effects).toHaveLength(0);
  });

  it("keeps linked audio timing aligned when a video layer is edited", () => {
    const project = projectWithLayer();
    const video = createLayer("video", settings, { id: "video", asset: "media/clip.mp4" });
    const audio = createAudioTrack("Linked", "media/clip.mp4", 10, {
      id: "audio", linked: true, linkedLayerId: video.id,
    });
    project.layers.push(video);
    project.audioTracks.push(audio);

    const result = runProjectCommands(project, [
      { type: "layer.setNumeric", layerId: "video", property: "startTime", value: 2 },
    ], 1 / 60);

    expect(result.project.audioTracks[0].startTime).toBe(2);
    expect(project.audioTracks[0].startTime).toBe(0);
  });
});

describe("window.vct API", () => {
  it("commits one undoable batch, exposes copies and emits a change event", () => {
    let active: ProjectDocument | null = projectWithLayer();
    const commit = vi.fn((next: ProjectDocument) => {
      Object.assign(active!, next);
    });
    const api = createVctApi({
      getProject: () => active,
      commitProject: commit,
      keyframeTolerance: () => 1 / 60,
      confirmConsequential: () => true,
    });
    const listener = vi.fn();
    api.onChange(listener);

    const copy = api.getProject();
    copy.layers[0].x = 999;
    expect(active.layers[0].x).not.toBe(999);

    api.batch([
      { type: "layer.setNumeric", layerId: "shape", property: "x", value: 200 },
      { type: "layer.setName", layerId: "shape", name: "Agent layer" },
    ], { label: "Arrange scene" });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(active.layers[0]).toMatchObject({ x: 200, name: "Agent layer" });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      revision: 1,
      label: "Arrange scene",
      commands: expect.arrayContaining([expect.objectContaining({ type: "layer.setNumeric" })]),
    }));
    expect(api.validate().valid).toBe(true);
    expect(api.query({ layerId: "shape" })).toMatchObject({ id: "shape", x: 200 });
  });

  it("does not commit or notify for no-ops and rejects calls without an open project", () => {
    let active: ProjectDocument | null = projectWithLayer();
    const commit = vi.fn();
    const api = createVctApi({
      getProject: () => active,
      commitProject: commit,
      keyframeTolerance: () => .01,
      confirmConsequential: () => true,
    });
    const listener = vi.fn();
    api.onChange(listener);

    api.dispatch({ type: "layer.setNumeric", layerId: "shape", property: "x", value: active.layers[0].x });
    expect(commit).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    active = null;
    expect(() => api.getProject()).toThrow("Nenhum projeto está aberto");
  });

  it("requires confirmation before destructive effect removal", () => {
    const active = projectWithLayer();
    active.layers[0].effects.push({
      id: "levels-1", kind: "levels", name: "levels", enabled: true,
      params: { mix: 1, brightness: 0, contrast: 1, saturation: 1, gamma: 1 }, keyframes: {},
    });
    const commit = vi.fn();
    const confirmConsequential = vi.fn(() => false);
    const api = createVctApi({
      getProject: () => active,
      commitProject: commit,
      keyframeTolerance: () => .01,
      confirmConsequential,
    });

    expect(() => api.dispatch({ type: "effect.remove", effectId: "levels-1" })).toThrow("cancelado");
    expect(confirmConsequential).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(active.layers[0].effects).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { createVctApi } from "../../src/automation/window-vct";
import { COMMANDS, describeCommandsText } from "../../src/model/command-registry";
import { runProjectCommands } from "../../src/model/commands";
import { clipboardFor } from "../../src/model/commands";
import { visualTracks } from "../../src/model/clip-tracks";
import { createAudioTrack, createEffect, createLayer, createProject, type ProjectDocument } from "../../src/model/types";

const settings = { name: "Reg", width: 320, height: 180, fps: 30, duration: 10, background: "#000000", transparent: false };

function fixture(): ProjectDocument {
  const project = createProject(settings);
  project.layers.push(
    createLayer("text", settings, { id: "titulo", name: "Título", startTime: 0, endTime: 3 }),
    createLayer("video", settings, { id: "v", name: "Vídeo", asset: "media/v.mp4", startTime: 0, endTime: 4, sourceOut: 4, loop: false }),
  );
  project.audioTracks.push(createAudioTrack("Áudio", "media/v.mp4", 4, { id: "va", linked: true, linkedLayerId: "v" }));
  return project;
}

const run = (project: ProjectDocument, commands: unknown[]) => runProjectCommands(project, commands, 1 / 60);

describe("command registry", () => {
  it("describe text covers every command and avoids characters Chrome blocks", () => {
    const text = describeCommandsText();
    for (const type of Object.keys(COMMANDS)) expect(text).toContain(`${type} `);
    expect(text).not.toMatch(/[?&=]/);
    const api = createVctApi({ getProject: fixture, keyframeTolerance: () => 1 / 60, commitProject: () => {}, confirmConsequential: () => true });
    let full = api.describe() as string;
    for (let page = 0; page < 20 && full.includes("[continua: vct.more()]"); page++) {
      full = full.replace("\n[continua: vct.more()]", "") + api.more();
    }
    expect(full).not.toMatch(/[?&=]/);
    expect(full).toContain("composition.set");
    expect(full).toContain("hold segura o valor");
  });

  it("every command example parses (dryRun reaches execution, not field errors)", () => {
    for (const [type, spec] of Object.entries(COMMANDS)) {
      try {
        run(fixture(), [spec.example]);
      } catch (error) {
        expect(String(error), type).not.toMatch(/Campo desconhecido|Campo obrigatório|deve ser|precisa ser/);
      }
    }
  });

  it("rejects unknown fields on every command, including the former lenient ones", () => {
    expect(() => run(fixture(), [{ type: "layer.setNumeric", layerId: "titulo", property: "x", value: 1, param: 2 }])).toThrow("Campo desconhecido");
    expect(() => run(fixture(), [{ type: "effect.setParam", effectId: "x", param: "mix", value: 1 }])).toThrow("Campo desconhecido");
    expect(() => run(fixture(), [{ type: "layer.setName", layerId: "titulo", name: "x".repeat(201) }])).toThrow("1–200");
  });

  it("accepts batches up to 500 commands", () => {
    const commands = Array.from({ length: 500 }, (_, index) => ({ type: "layer.set", layerId: "titulo", props: { x: index } }));
    expect(run(fixture(), commands).project.layers[0].x).toBe(499);
    expect(() => run(fixture(), [...commands, commands[0]])).toThrow("entre 1 e 500");
  });
});

describe("layer.set and timing checks", () => {
  it("sets several typed properties at once", () => {
    const { project } = run(fixture(), [{ type: "layer.set", layerId: "titulo", props: { opacity: .5, blendMode: "screen", fill: "#ffcc00", visible: false } }]);
    expect(project.layers[0]).toMatchObject({ opacity: .5, blendMode: "screen", fill: "#ffcc00", visible: false });
  });

  it("validates values and keeps clips inside the composition", () => {
    expect(() => run(fixture(), [{ type: "layer.set", layerId: "titulo", props: { blendMode: "overlay" } }])).toThrow("blendMode");
    expect(() => run(fixture(), [{ type: "layer.set", layerId: "titulo", props: { fill: "red" } }])).toThrow("#rrggbb");
    expect(() => run(fixture(), [{ type: "layer.set", layerId: "titulo", props: { endTime: 11 } }])).toThrow("duração da composição");
    expect(() => run(fixture(), [{ type: "layer.setNumeric", layerId: "titulo", property: "endTime", value: 11 }])).toThrow("duração da composição");
    expect(() => run(fixture(), [{ type: "layer.set", layerId: "titulo", props: { startTime: 3 } }])).toThrow("maior que startTime");
  });

  it("syncs linked audio when video timing changes", () => {
    const { project } = run(fixture(), [{ type: "layer.set", layerId: "v", props: { endTime: 2, sourceOut: 2 } }]);
    expect(project.audioTracks[0]).toMatchObject({ endTime: 2, sourceOut: 2 });
  });

  it("a locked layer can be unlocked or hidden but not edited", () => {
    const project = fixture();
    project.layers[0].locked = true;
    expect(() => run(project, [{ type: "layer.set", layerId: "titulo", props: { x: 1 } }])).toThrow("bloqueada");
    expect(run(project, [{ type: "layer.set", layerId: "titulo", props: { locked: false, visible: false } }]).project.layers[0].locked).toBe(false);
  });
});

describe("layer.create with media and tracks", () => {
  it("places media on an existing free track with initial props", () => {
    const { project, results } = run(fixture(), [
      { type: "layer.create", layerId: "img", kind: "image", name: "Img", asset: "media/a.png", startTime: 5, endTime: 6, trackId: "v", props: { opacity: .3 } },
    ]);
    expect(results[0]).toEqual({ layerId: "img", trackId: "v" });
    expect(project.layers.find((layer) => layer.id === "img")).toMatchObject({ asset: "media/a.png", trackId: "v", opacity: .3 });
    expect(() => run(fixture(), [{ type: "layer.create", layerId: "img", kind: "image", name: "Img", startTime: 0, endTime: 1 }])).toThrow("asset");
    expect(() => run(fixture(), [{ type: "layer.create", layerId: "img", kind: "image", name: "Img", asset: "media/a.png", startTime: 1, endTime: 2, trackId: "v" }])).toThrow("ocupada");
  });
});

describe("audio commands", () => {
  it("sets volume and mute, unlinks and relinks", () => {
    let { project } = run(fixture(), [{ type: "audio.set", trackId: "va", props: { volume: .4, muted: true } }, { type: "audio.unlink", trackId: "va" }]);
    expect(project.audioTracks[0]).toMatchObject({ volume: .4, muted: true, linked: false });
    project = run(project, [{ type: "layer.set", layerId: "v", props: { endTime: 2 } }]).project;
    expect(project.audioTracks[0].endTime).toBe(4);
    project = run(project, [{ type: "audio.link", trackId: "va" }]).project;
    expect(project.audioTracks[0]).toMatchObject({ linked: true, endTime: 2 });
    expect(() => run(fixture(), [{ type: "audio.set", trackId: "va", props: { volume: 3 } }])).toThrow("volume");
  });

  it("creates, moves and removes standalone audio", () => {
    let { project } = run(fixture(), [{ type: "audio.create", trackId: "trilha", asset: "media/t.wav", name: "Trilha", startTime: 0, endTime: 8 }]);
    project = run(project, [{ type: "audio.move", trackId: "trilha", startTime: 1 }]).project;
    expect(project.audioTracks.find((track) => track.id === "trilha")).toMatchObject({ startTime: 1, endTime: 9 });
    expect(() => run(project, [{ type: "audio.move", trackId: "trilha", startTime: 3 }])).toThrow("duração da composição");
    expect(run(project, [{ type: "audio.remove", trackId: "trilha" }]).project.audioTracks).toHaveLength(1);
  });
});

describe("composition.set", () => {
  it("sets duration and refuses to cut clips silently", () => {
    expect(run(fixture(), [{ type: "composition.set", props: { duration: 30 } }]).project.settings.duration).toBe(30);
    expect(() => run(fixture(), [{ type: "composition.set", props: { duration: 3.5 } }])).toThrow("termina depois");
  });

  it("adapts layers proportionally on resize", () => {
    const { project } = run(fixture(), [{ type: "composition.set", props: { width: 640, height: 360 }, resize: "adapt" }]);
    expect(project.layers[0].x).toBe(320);
    expect(project.settings.width).toBe(640);
  });
});

describe("effects, keyframe tracks, track order and paste", () => {
  it("toggles and reorders effects", () => {
    const project = fixture();
    project.layers[0].effects.push({ ...createEffect("blur"), id: "b1" }, { ...createEffect("mirror"), id: "m1" });
    const result = run(project, [{ type: "effect.set", effectId: "b1", enabled: false }, { type: "effect.reorder", effectId: "m1", index: 0 }]).project;
    expect(result.layers[0].effects.map((effect) => effect.id)).toEqual(["m1", "b1"]);
    expect(result.layers[0].effects[1].enabled).toBe(false);
  });

  it("replaces and clears keyframe tracks", () => {
    let { project } = run(fixture(), [{ type: "keyframe.set", layerId: "titulo", property: "x", keys: [{ time: 2, value: 5 }, { time: 1, value: 1, easing: "hold" }] }]);
    expect(project.layers[0].keyframes.x.map((key) => key.time)).toEqual([1, 2]);
    project = run(project, [{ type: "keyframe.set", layerId: "titulo", property: "x", keys: [] }]).project;
    expect(project.layers[0].keyframes.x).toBeUndefined();
  });

  it("reorders tracks and pastes clips", () => {
    const moved = run(fixture(), [{ type: "track.reorder", trackId: "v", index: 0 }]).project;
    expect(visualTracks(moved)[0].id).toBe("v");
    const project = fixture();
    const pasted = run(project, [{ type: "clip.paste", clipboard: clipboardFor(project, ["titulo"]), startTime: 5 }]);
    expect(pasted.project.layers.filter((layer) => layer.kind === "text")).toHaveLength(2);
  });
});

it("the agent guide text avoids characters Chrome blocks", async () => {
  const { AGENT_GUIDE } = await import("../../src/automation/agent-guide");
  expect(AGENT_GUIDE).not.toMatch(/[?&=]/);
});

it("composition resize remaps locked layers too", () => {
  const project = fixture();
  project.layers[0].locked = true;
  const { project: resized } = run(project, [{ type: "composition.set", props: { width: 640, height: 360 }, resize: "adapt" }]);
  expect(resized.layers[0].x).toBe(320);
  expect(() => run(project, [{ type: "layer.set", layerId: "titulo", props: { x: 1 } }])).toThrow("bloqueada");
});

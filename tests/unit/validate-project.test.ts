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

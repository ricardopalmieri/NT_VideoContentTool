import { describe, expect, it, vi } from "vitest";
import { collectProjectFonts, fontLoadQuery, loadProjectFonts } from "../../src/export/export-fonts";
import { evenDown, exportScaleLabel, exportSize, parseExportScale } from "../../src/export/export-size";
import { createLayer, createProject } from "../../src/model/types";

const settings = { name: "Export", width: 1081, height: 607, fps: 30, duration: 4, background: "#000000", transparent: false };

describe("tamanho de saída do export", () => {
  it("arredonda para baixo até um número par, com mínimo de 2", () => {
    expect(evenDown(1081)).toBe(1080);
    expect(evenDown(1080)).toBe(1080);
    expect(evenDown(3)).toBe(2);
    expect(evenDown(1)).toBe(2);
  });

  it("aplica a escala e deixa o MP4 par, mas a sequência PNG exata", () => {
    expect(exportSize(settings, 1, "mp4-h264")).toEqual({ width: 1080, height: 606 });
    expect(exportSize(settings, 1, "png-sequence")).toEqual({ width: 1081, height: 607 });
    expect(exportSize({ width: 1920, height: 1080 }, .75, "mp4-h264")).toEqual({ width: 1440, height: 810 });
    expect(exportSize({ width: 1920, height: 1080 }, .25, "png-sequence")).toEqual({ width: 480, height: 270 });
    expect(exportSize(settings, .5, "mp4-h264")).toEqual({ width: 540, height: 304 });
    expect(exportSize(settings, .5, "png-sequence")).toEqual({ width: 541, height: 304 });
  });

  it("não passa de 16 px no lado menor, como a superfície do renderer", () => {
    expect(exportSize({ width: 40, height: 20 }, .25, "png-sequence")).toEqual({ width: 16, height: 16 });
    expect(exportSize({ width: 40, height: 20 }, .25, "mp4-h264")).toEqual({ width: 16, height: 16 });
  });

  it("monta o rótulo com porcentagem e tamanho final", () => {
    expect(exportScaleLabel({ width: 1920, height: 1080 }, .75, "mp4-h264")).toBe("75% · 1440×810");
    expect(exportScaleLabel(settings, 1, "mp4-h264")).toBe("100% · 1080×606");
    expect(exportScaleLabel(settings, 1, "png-sequence")).toBe("100% · 1081×607");
  });

  it("aceita só as escalas oferecidas e volta para 100%", () => {
    expect(parseExportScale("0.5")).toBe(.5);
    expect(parseExportScale(.75)).toBe(.75);
    expect(parseExportScale("0.33")).toBe(1);
    expect(parseExportScale(null)).toBe(1);
    expect(parseExportScale("abc")).toBe(1);
  });
});

describe("fontes usadas pelas camadas de texto", () => {
  function textLayer(id: string, props: Record<string, unknown> = {}) {
    return createLayer("text", settings, { id, ...props });
  }

  it("junta famílias e pesos sem repetir e ignora camadas que não são texto", () => {
    const project = createProject(settings);
    project.layers.push(
      textLayer("a", { fontFamily: "Inter", fontWeight: 400 }),
      textLayer("b", { fontFamily: "Inter", fontWeight: 400 }),
      textLayer("c", { fontFamily: "Syne", fontWeight: 700 }),
      createLayer("geometry", settings, { id: "g", fontFamily: "Space Grotesk" }),
    );
    expect(collectProjectFonts(project)).toEqual([
      { family: "Inter", weight: 400 },
      { family: "Syne", weight: 700 },
    ]);
  });

  it("usa a fonte e o peso padrão do renderer quando faltam", () => {
    const project = createProject(settings);
    project.layers.push(textLayer("a", { fontFamily: undefined, fontWeight: undefined }));
    expect(collectProjectFonts(project)).toEqual([{ family: "IBM Plex Sans", weight: 500 }]);
  });

  it("inclui os pesos animados por keyframe", () => {
    const project = createProject(settings);
    project.layers.push(textLayer("a", {
      fontFamily: "Inter",
      fontWeight: 400,
      keyframes: { fontWeight: [{ time: 0, value: 400, easing: "linear" }, { time: 2, value: 800, easing: "linear" }] },
    }));
    expect(collectProjectFonts(project).map((font) => font.weight)).toEqual([400, 800]);
  });

  it("escapa aspas no nome da família", () => {
    expect(fontLoadQuery({ family: "IBM Plex Sans", weight: 500 })).toBe('500 48px "IBM Plex Sans"');
    expect(fontLoadQuery({ family: 'Odd"Name', weight: 300 })).toBe('300 48px "Odd\\"Name"');
  });

  it("carrega cada fonte e espera fonts.ready antes de seguir", async () => {
    const project = createProject(settings);
    project.layers.push(textLayer("a", { fontFamily: "Inter", fontWeight: 400 }), textLayer("b", { fontFamily: "Syne", fontWeight: 700 }));
    const order: string[] = [];
    const fonts = {
      load: vi.fn(async (font: string) => { order.push(`load ${font}`); }),
      ready: Promise.resolve().then(() => { order.push("ready"); }),
    };
    await loadProjectFonts(project, fonts);
    expect(fonts.load).toHaveBeenCalledWith('400 48px "Inter"');
    expect(fonts.load).toHaveBeenCalledWith('700 48px "Syne"');
    expect(order).toContain("ready");
  });

  it("não trava o export quando uma fonte falha ao carregar", async () => {
    const project = createProject(settings);
    project.layers.push(textLayer("a", { fontFamily: "Missing" }));
    const fonts = { load: () => Promise.reject(new Error("fail")), ready: Promise.resolve() };
    await expect(loadProjectFonts(project, fonts)).resolves.toBeUndefined();
  });
});

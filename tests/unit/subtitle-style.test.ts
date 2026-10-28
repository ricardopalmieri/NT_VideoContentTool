import { describe, expect, it } from "vitest";
import { runProjectCommands } from "../../src/model/commands";
import { createProject } from "../../src/model/types";
import { buildCues } from "../../src/transcribe/cues";
import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_SIZE_RATIO, subtitleMaxChars, subtitleStyleProps } from "../../src/transcribe/subtitle-style";

const settings = { width: 1920, height: 1080 };

describe("estilo da legenda automática", () => {
  it("P 4,5% · M 5,5% · G 7% da altura, com sombra ligada por padrão", () => {
    expect(SUBTITLE_SIZE_RATIO).toEqual({ small: .045, medium: .055, large: .07 });
    expect(DEFAULT_SUBTITLE_STYLE).toEqual({ size: "medium", position: "bottom", shadow: true });
    expect(subtitleStyleProps(settings, { size: "small", position: "bottom", shadow: true }).fontSize).toBe(49);
    expect(subtitleStyleProps(settings, { size: "medium", position: "bottom", shadow: true }).fontSize).toBe(59);
    expect(subtitleStyleProps(settings, { size: "large", position: "bottom", shadow: true }).fontSize).toBe(76);
  });

  it("posição embaixo, no meio e em cima; a caixa cresce com a fonte", () => {
    const at = (position: "bottom" | "middle" | "top") => subtitleStyleProps(settings, { size: "large", position, shadow: true });
    expect(at("middle").y).toBe(540);
    expect(at("top").y as number).toBeLessThan(540);
    expect(at("bottom").y as number).toBeGreaterThan(540);
    expect(at("bottom").height as number).toBeGreaterThanOrEqual(76 * 2.4);
  });

  it("sombra desligada não manda propriedades de sombra", () => {
    const props = subtitleStyleProps(settings, { size: "medium", position: "bottom", shadow: false });
    expect(Object.keys(props).filter((key) => key.startsWith("shadow"))).toEqual([]);
    expect(subtitleStyleProps(settings, DEFAULT_SUBTITLE_STYLE).shadowOpacity).toBeGreaterThan(0);
  });

  it("os props passam por text.fromSrt e valem para todas as legendas", () => {
    const project = createProject({ name: "t", ...settings, fps: 10, duration: 10, background: "#000000", transparent: false });
    const props = subtitleStyleProps(settings, { size: "large", position: "top", shadow: true });
    const { project: next } = runProjectCommands(project, [{ type: "text.fromSrt", srt: "1\n00:00:01,000 --> 00:00:02,000\nOi\n\n2\n00:00:03,000 --> 00:00:04,000\nTchau", props }], 1 / 10);
    expect(next.layers).toHaveLength(2);
    for (const layer of next.layers) expect(layer).toMatchObject({ fontSize: 76, y: props.y, shadowOpacity: .8 });
  });
});

// Tamanho pelo lado MENOR e linhas que cabem na caixa, em 16:9, 9:16 e 1:1.
const formats = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
} as const;
const SRT = "1\n00:00:01,000 --> 00:00:03,000\nOi";
const LONG_TEXT = "Esta é uma frase bem comprida para conferir que nenhuma linha passa da largura da caixa da legenda em nenhum formato de vídeo, mesmo com a fonte grande";

describe("legendas em 16:9, 9:16 e 1:1", () => {
  const make = (size: { width: number; height: number }) => createProject({ name: "t", ...size, fps: 10, duration: 10, background: "#000000", transparent: false });
  const expand = (size: { width: number; height: number }, props?: Record<string, unknown>) =>
    runProjectCommands(make(size), [{ type: "text.fromSrt", srt: SRT, ...(props ? { props } : {}) }], 1 / 10).project.layers[0];

  it("o padrão do text.fromSrt é 5,5% do lado menor e a caixa tem 86% da largura", () => {
    for (const [name, size] of Object.entries(formats)) {
      const layer = expand(size);
      expect(layer.fontSize, name).toBe(Math.round(Math.min(size.width, size.height) * .055));
      expect(layer.width, name).toBeCloseTo(size.width * .86, 0);
      expect(layer.y, name).toBeLessThan(size.height);
    }
    // Antes a fonte saía de 5,5% da altura: 106 px em 1080x1920, quase o dobro do tamanho certo.
    expect(expand(formats["9:16"]).fontSize).toBe(59);
    expect(expand(formats["16:9"]).fontSize).toBe(59);
  });

  it("P, M e G acompanham o lado menor; a largura da caixa acompanha a largura", () => {
    for (const [name, size] of Object.entries(formats)) {
      const min = Math.min(size.width, size.height);
      for (const choice of ["small", "medium", "large"] as const) {
        const props = subtitleStyleProps(size, { size: choice, position: "bottom", shadow: true });
        expect(props.fontSize, `${name} ${choice}`).toBe(Math.round(min * SUBTITLE_SIZE_RATIO[choice]));
        expect(props.width, `${name} ${choice}`).toBe(Math.round(size.width * .86));
      }
    }
    expect(subtitleStyleProps(formats["9:16"], { size: "large", position: "bottom", shadow: true }).fontSize).toBe(76);
  });

  it("as legendas saem dentro da área segura e os props passam por text.fromSrt", () => {
    const size = formats["9:16"];
    const props = subtitleStyleProps(size, DEFAULT_SUBTITLE_STYLE);
    const layer = expand(size, props);
    expect(layer).toMatchObject({ fontSize: 59, y: props.y, width: Math.round(1080 * .86) });
    // Em 9:16 a base da área segura é 380 px acima da borda de baixo.
    expect(layer.y + (layer.height as number) / 2).toBeLessThanOrEqual(size.height - 380);
  });

  it("máximo de caracteres por linha vem da largura da caixa e do tamanho da fonte (cerca de 0,55 em por letra)", () => {
    const mediumWide = subtitleMaxChars(formats["16:9"], DEFAULT_SUBTITLE_STYLE);
    const mediumTall = subtitleMaxChars(formats["9:16"], DEFAULT_SUBTITLE_STYLE);
    const mediumSquare = subtitleMaxChars(formats["1:1"], DEFAULT_SUBTITLE_STYLE);
    expect(mediumWide).toBe(42);
    expect(mediumTall).toBeLessThan(mediumWide);
    expect(mediumSquare).toBeLessThan(mediumTall + 1);
    expect(mediumTall).toBeGreaterThanOrEqual(24);
    expect(mediumTall).toBeLessThanOrEqual(30);
    // Fonte maior, menos letras por linha.
    const sizeOf = (size: "small" | "medium" | "large") => subtitleMaxChars(formats["9:16"], { size, position: "bottom", shadow: true });
    expect(sizeOf("small")).toBeGreaterThan(sizeOf("medium"));
    expect(sizeOf("medium")).toBeGreaterThan(sizeOf("large"));
  });

  it("nenhuma linha do construtor de legendas passa da largura da caixa, em nenhum formato e tamanho", () => {
    for (const [name, size] of Object.entries(formats)) {
      for (const choice of ["small", "medium", "large"] as const) {
        const style = { size: choice, position: "bottom" as const, shadow: true };
        const { fontSize, width } = subtitleStyleProps(size, style) as { fontSize: number; width: number };
        const maxChars = subtitleMaxChars(size, style);
        const cues = buildCues([{ start: 0, end: 12, text: LONG_TEXT }], { fps: 10, maxChars });
        expect(cues.length, `${name} ${choice}`).toBeGreaterThan(0);
        for (const cue of cues) {
          const lines = cue.text.split("\n");
          expect(lines.length, `${name} ${choice}`).toBeLessThanOrEqual(2);
          for (const line of lines) {
            expect(line.length, `${name} ${choice}: ${line}`).toBeLessThanOrEqual(maxChars);
            // 0,55 em por letra: a linha cabe na caixa descontado o respiro de cada lado.
            expect(line.length * fontSize * .55, `${name} ${choice}: ${line}`).toBeLessThanOrEqual(width - fontSize * .08);
          }
        }
      }
    }
  });
});

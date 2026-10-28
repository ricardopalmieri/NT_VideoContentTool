import { describe, expect, it } from "vitest";
import { runProjectCommands } from "../../src/model/commands";
import { createProject, type ProjectDocument } from "../../src/model/types";
import { isOnTimeline, mediaPlacementCommands } from "../../src/transcribe/insert-media";

const meta = (name: string, extra: Record<string, unknown>) => ({ originalName: name, size: 1, lastModified: 1, mimeType: "video/mp4", ...extra });

function binProject(duration = 30): ProjectDocument {
  const project = createProject({ name: "t", width: 1080, height: 1920, fps: 30, duration, background: "#000000", transparent: false });
  project.assetMetadata = {
    "media/aula.mp4": meta("aula.mp4", { kind: "video", duration: 20, width: 1920, height: 1080, hasAudio: true }),
    "media/fala.wav": meta("fala.wav", { kind: "audio", duration: 12, mimeType: "audio/wav" }),
    "media/logo.png": meta("logo.png", { kind: "image", width: 500, height: 500, mimeType: "image/png" }),
  } as never;
  return project;
}

const SRT = "1\n00:00:03,000 --> 00:00:04,000\nOlá\n\n2\n00:00:05,000 --> 00:00:06,000\nTchau";

describe("Inserir na timeline com a mídia transcrita", () => {
  it("vídeo do bin fora da timeline entra no tamanho original, com o áudio vinculado, no mesmo lote das legendas", () => {
    const project = binProject();
    const place = mediaPlacementCommands(project, { asset: "media/aula.mp4", from: 2, length: 10 });
    expect(place).toEqual([{ type: "clip.place", layerId: "transcrito", asset: "media/aula.mp4", startTime: 2, endTime: 12, sourceIn: 2, audio: "linked" }]);
    const { project: next } = runProjectCommands(project, [...place, { type: "text.fromSrt", srt: SRT }] as never, 1 / 30);
    const video = next.layers.find((layer) => layer.id === "transcrito")!;
    // Tamanho do arquivo (1920x1080), não enquadrado na composição 1080x1920.
    expect(video).toMatchObject({ kind: "video", startTime: 2, endTime: 12, sourceIn: 2, width: 1920, height: 1080 });
    expect(next.audioTracks).toHaveLength(1);
    expect(next.audioTracks[0]).toMatchObject({ linked: true, linkedLayerId: "transcrito", startTime: 2, endTime: 12, sourceIn: 2 });
    // As legendas ficam por cima do vídeo (primeiro da lista) e continuam alinhadas ao tempo do arquivo.
    const texts = next.layers.filter((layer) => layer.kind === "text");
    expect(texts).toHaveLength(2);
    expect(next.layers.indexOf(texts[0])).toBeLessThan(next.layers.indexOf(video));
    expect(texts[0]).toMatchObject({ startTime: 3, endTime: 4 });
  });

  it("começa no início do trecho e termina no fim dele, do arquivo ou da composição", () => {
    const project = binProject(30);
    expect(mediaPlacementCommands(project, { asset: "media/aula.mp4", from: 0 })).toMatchObject([{ startTime: 0, endTime: 20 }]);
    expect(mediaPlacementCommands(project, { asset: "media/aula.mp4", from: 5, length: 60 })).toMatchObject([{ startTime: 5, endTime: 20, sourceIn: 5 }]);
    expect(mediaPlacementCommands(binProject(8), { asset: "media/aula.mp4", from: 2 })).toMatchObject([{ startTime: 2, endTime: 8 }]);
    // Tempos fora do quadro viram quadros inteiros (30 fps).
    expect(mediaPlacementCommands(project, { asset: "media/aula.mp4", from: 1.01, length: 3.1 })).toMatchObject([{ startTime: 1.0, endTime: 4.1 }]);
    // Trecho depois do fim da composição ou do arquivo: nada a colocar.
    expect(mediaPlacementCommands(binProject(8), { asset: "media/aula.mp4", from: 9 })).toEqual([]);
    expect(mediaPlacementCommands(project, { asset: "media/aula.mp4", from: 25 })).toEqual([]);
  });

  it("áudio do bin entra como clipe de áudio, com o trecho certo do arquivo", () => {
    const project = binProject();
    const place = mediaPlacementCommands(project, { asset: "media/fala.wav", from: 1, length: 6 });
    expect(place).toEqual([{ type: "audio.create", trackId: "transcrito_audio", asset: "media/fala.wav", name: "fala.wav", startTime: 1, endTime: 7, props: { sourceIn: 1, sourceOut: 7 } }]);
    const { project: next } = runProjectCommands(project, [...place, { type: "text.fromSrt", srt: SRT }] as never, 1 / 30);
    expect(next.audioTracks).toHaveLength(1);
    expect(next.audioTracks[0]).toMatchObject({ asset: "media/fala.wav", startTime: 1, endTime: 7, sourceIn: 1, sourceOut: 7 });
    expect(next.layers.filter((layer) => layer.kind === "text")).toHaveLength(2);
  });

  it("não coloca de novo o que já está na timeline, nem imagem, nem mídia desconhecida, nem a fonte nula", () => {
    const project = binProject();
    const { project: placed } = runProjectCommands(project, [{ type: "clip.place", layerId: "a", asset: "media/aula.mp4", startTime: 0, duration: 2 }], 1 / 30);
    expect(isOnTimeline(placed, "media/aula.mp4")).toBe(true);
    expect(mediaPlacementCommands(placed, { asset: "media/aula.mp4", from: 0 })).toEqual([]);
    expect(mediaPlacementCommands(project, { asset: "media/logo.png", from: 0 })).toEqual([]);
    expect(mediaPlacementCommands(project, { asset: "media/nao-existe.mp4", from: 0 })).toEqual([]);
    expect(mediaPlacementCommands(project, null)).toEqual([]);
  });

  it("escolhe um identificador livre", () => {
    const project = binProject();
    const { project: busy } = runProjectCommands(project, [{ type: "layer.create", layerId: "transcrito", kind: "text", name: "x", startTime: 0, endTime: 1 }], 1 / 30);
    expect(mediaPlacementCommands(busy, { asset: "media/aula.mp4", from: 0, length: 5 })).toMatchObject([{ layerId: "transcrito2" }]);
  });

  it("um só passo de desfazer cobre vídeo, áudio e legendas (o lote é um comando de projeto)", () => {
    const project = binProject();
    const place = mediaPlacementCommands(project, { asset: "media/aula.mp4", from: 0, length: 8 });
    const { project: next } = runProjectCommands(project, [...place, { type: "text.fromSrt", srt: SRT }] as never, 1 / 30);
    expect(next.layers.map((layer) => layer.kind).sort()).toEqual(["text", "text", "video"]);
    expect(project.layers).toHaveLength(0);
  });
});

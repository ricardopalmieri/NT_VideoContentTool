import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { createAudioTrack, createLayer, createProject } from "../../src/model/types";
import {
  assetSourceMetadata,
  clearWebAssets,
  createCollectedMediaArchive,
  findRelinkFile,
  hasWebAsset,
  openWebProjectFile,
  registerWebAsset,
} from "../../src/io/web-platform";

const settings = { name: "Teste", width: 320, height: 180, fps: 10, duration: 10, background: "#000000", transparent: true };

afterEach(() => clearWebAssets());

describe("abertura transacional de projeto web", () => {
  it.each([
    ["JSON inválido", new File(["{"], "invalido.ntvct")],
    ["formato inválido", new File([JSON.stringify({ format: "outro" })], "invalido.ntvct")],
    ["estrutura inválida", new File([JSON.stringify({ format: "noisetupi-video-content-tool", layers: [] })], "invalido.ntvct")],
    ["camada inválida", new File([JSON.stringify({
      format: "noisetupi-video-content-tool",
      settings,
      layers: [{}],
    })], "invalido.ntvct")],
    ["dados inválidos", new File([JSON.stringify({
      format: "noisetupi-video-content-tool",
      settings,
      layers: [null],
    })], "invalido.ntvct")],
    ["metadados de mídia inválidos", new File([JSON.stringify({
      ...createProject(settings),
      assetMetadata: { "media/a.wav": { originalName: "a.wav", size: -1, lastModified: 0, mimeType: "audio/wav" } },
    })], "invalido.ntvct")],
  ])("mantém a mídia atual quando recebe %s", async (_case, file) => {
    registerWebAsset("media/atual.png", new Blob(["imagem"]));

    await expect(openWebProjectFile(file)).rejects.toThrow();

    expect(hasWebAsset("media/atual.png")).toBe(true);
  });

  it("só substitui mídias depois de validar um pacote de projeto", async () => {
    const project = createProject(settings);
    project.assetMetadata = {
      "assets/foto.png": {
        originalName: "foto.png",
        sourcePath: "Projeto/Imagens/foto.png",
        size: 6,
        lastModified: 1234,
        mimeType: "image/png",
      },
    };
    const archive = zipSync({
      "project.json": strToU8(JSON.stringify(project)),
      "assets/foto.png": strToU8("imagem"),
    });
    const file = new File([archive], "projeto.ntvct");
    registerWebAsset("media/atual.png", new Blob(["imagem atual"]));

    const result = await openWebProjectFile(file);

    expect(result.project.version).toBe(2);
    expect(result.project.assetMetadata?.["assets/foto.png"].sourcePath).toBe("Projeto/Imagens/foto.png");
    expect(hasWebAsset("media/atual.png")).toBe(false);
    expect(hasWebAsset("assets/foto.png")).toBe(true);
  });

  it("persiste metadados de origem e só relinka arquivo não ambíguo", () => {
    const original = new File(["midi"], "trilha.wav", { type: "audio/wav", lastModified: 1234 });
    Object.defineProperty(original, "webkitRelativePath", { value: "Projeto/Audio/trilha.wav" });
    const metadata = assetSourceMetadata(original);
    const wrongSize = new File(["outro"], "trilha.wav", { type: "audio/wav", lastModified: 1234 });
    const matching = new File(["midi"], "trilha.wav", { type: "audio/wav", lastModified: 1234 });
    Object.defineProperty(matching, "webkitRelativePath", { value: "Projeto/Audio/trilha.wav" });

    expect(metadata).toEqual({
      originalName: "trilha.wav",
      sourcePath: "Projeto/Audio/trilha.wav",
      size: 4,
      lastModified: 1234,
      mimeType: "audio/wav",
    });
    expect(findRelinkFile("media/trilha.wav", metadata, [wrongSize, matching])).toBe(matching);
    expect(findRelinkFile("media/trilha.wav", { ...metadata, sourcePath: undefined }, [
      matching,
      new File(["midi"], "trilha.wav", { type: "audio/wav", lastModified: 1234 }),
    ])).toBeNull();
    expect(findRelinkFile("media/legada.wav", undefined, [
      new File(["legado"], "legada.wav"),
    ])?.name).toBe("legada.wav");
  });

  it("coleta assets compartilhados em ZIP e reescreve referências sem alterar o projeto aberto", async () => {
    const project = createProject(settings);
    const imageLayer = createLayer("image", settings, { asset: "media/original.png" });
    const videoLayer = createLayer("video", settings, { asset: "media/shared.mov" });
    const duplicateImageLayer = createLayer("image", settings, { asset: "media/duplicate.png" });
    const audioTrack = createAudioTrack("Áudio", "media/shared.mov", 10);
    project.layers.push(imageLayer, videoLayer, duplicateImageLayer);
    project.audioTracks.push(audioTrack);
    project.assetMetadata = {
      "media/original.png": {
        originalName: "still.png",
        size: 5,
        lastModified: 1,
        mimeType: "image/png",
      },
      "media/shared.mov": {
        originalName: "clip.mov",
        sourcePath: "Projeto/clip.mov",
        size: 6,
        lastModified: 2,
        mimeType: "video/quicktime",
      },
      "media/duplicate.png": {
        originalName: "still.png",
        size: 9,
        lastModified: 3,
        mimeType: "image/png",
      },
    };
    registerWebAsset("media/original.png", new Blob(["image"]));
    registerWebAsset("media/shared.mov", new Blob(["video"]));
    registerWebAsset("media/duplicate.png", new Blob(["duplicate"]));

    const archiveBlob = await createCollectedMediaArchive(project);
    const archive = unzipSync(new Uint8Array(await archiveBlob.arrayBuffer()));
    const packed = JSON.parse(strFromU8(archive["project.json"])) as typeof project;

    expect(Object.keys(archive).sort()).toEqual(["assets/clip.mov", "assets/still-2.png", "assets/still.png", "project.json"]);
    expect(packed.layers.map((layer) => layer.asset)).toEqual(["assets/still.png", "assets/clip.mov", "assets/still-2.png"]);
    expect(packed.audioTracks[0].asset).toBe("assets/clip.mov");
    expect(packed.assetMetadata?.["assets/clip.mov"].sourcePath).toBe("Projeto/clip.mov");
    expect(imageLayer.asset).toBe("media/original.png");
    expect(videoLayer.asset).toBe("media/shared.mov");
    expect(duplicateImageLayer.asset).toBe("media/duplicate.png");
    expect(audioTrack.asset).toBe("media/shared.mov");
    expect(strFromU8(archive["assets/clip.mov"])).toBe("video");
    const reopened = await openWebProjectFile(new File([archiveBlob], "Teste-media.zip"));
    expect(reopened.project.layers.map((layer) => layer.asset)).toEqual(["assets/still.png", "assets/clip.mov", "assets/still-2.png"]);
    expect(hasWebAsset("assets/clip.mov")).toBe(true);
  });

  it("não cria pacote parcial quando uma mídia está ausente", async () => {
    const project = createProject(settings);
    project.layers.push(createLayer("image", settings, { asset: "media/missing.png" }));

    await expect(createCollectedMediaArchive(project)).rejects.toThrow("media/missing.png");
  });
});

describe("relink por conteúdo", () => {
  it("acha o arquivo renomeado pela impressão digital", async () => {
    const { fileFingerprint, findRelinkFileByFingerprint } = await import("../../src/io/web-platform");
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
    const original = new File([bytes], "selva.mov", { type: "video/quicktime" });
    const fingerprint = await fileFingerprint(original);
    const renamed = new File([bytes], "selva-final.mov", { type: "video/quicktime" });
    const other = new File([bytes.map((value) => 255 - value)], "outro.mov");
    const metadata = { ...assetSourceMetadata(original), fingerprint };
    expect(await findRelinkFileByFingerprint(metadata, [other, renamed])).toBe(renamed);
    expect(await findRelinkFileByFingerprint({ ...metadata, fingerprint: undefined }, [renamed])).toBeNull();
  });
});

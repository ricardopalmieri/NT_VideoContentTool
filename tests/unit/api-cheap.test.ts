import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVctApi, type VctApi, type VctApiHost } from "../../src/automation/window-vct";
import { COMMANDS } from "../../src/model/command-registry";
import { LAYER_PROPERTIES } from "../../src/model/property-tables";
import { lintProject } from "../../src/model/lint";
import { runProjectCommands } from "../../src/model/commands";
import { createAudioTrack, createLayer, createProject, type ProjectDocument } from "../../src/model/types";

// Batch 11: a API da IA mais barata (índice, texto curto, props por tipo, comandos em massa, vista de diagnóstico).
const settings = { name: "Teste", width: 1080, height: 1920, fps: 30, duration: 20, background: "#000000", transparent: false };
const meta = (name: string, extra: Record<string, unknown>) => ({ originalName: name, size: 1048576, lastModified: 1, mimeType: "video/mp4", ...extra });

function fixture(): ProjectDocument {
  const project = createProject(settings);
  project.assetMetadata = {
    "media/ampla.mp4": meta("ampla?.mp4", { kind: "video", duration: 10, width: 1920, height: 1080, hasAudio: true }),
    "media/logo.png": meta("logo.png", { kind: "image", width: 500, height: 300, mimeType: "image/png" }),
  } as never;
  return project;
}

function setup(project: ProjectDocument = fixture(), extra: Partial<VctApiHost> = {}) {
  let current = project;
  const commit = vi.fn((next: ProjectDocument, _label: string) => { current = next; });
  const api = createVctApi({ getProject: () => current, keyframeTolerance: () => 1 / 60, commitProject: commit, confirmConsequential: () => true, ...extra });
  return { api, commit, project: () => current };
}

const showFrame = vi.hoisted(() => vi.fn(async (_frame?: unknown) => undefined));
vi.mock("../../src/automation/contact-sheet", () => ({
  showFrame,
  hideSheet: () => undefined,
  composeSheet: () => ({ width: 10, height: 10, toDataURL: () => "data:image/jpeg;base64,AAA=" }),
  showSheet: () => undefined,
  assetFrames: async () => [{ image: {}, width: 1, height: 1, label: "a?b", warning: false }],
}));
vi.mock("../../src/automation/agent-analysis", () => ({
  analyzeMixText: async () => "mix? a&b c=d",
  analyzeAudioText: async () => "áudio? a&b c=d",
  analyzeVideoText: async () => "vídeo? a&b c=d",
}));

const subtitles = "1\n00:00:01,000 --> 00:00:03,000\nOlá mundo\n\n2\n00:00:04,000 --> 00:00:06,000\nSegunda";

describe("describe: índice, tipo, props e regras", () => {
  it("o índice é curto (a primeira página já aponta para o detalhe) e lista todos os comandos", () => {
    const { api } = setup();
    const first = api.describe();
    expect(first.split("\n[continua")[0].length).toBeLessThanOrEqual(900);
    expect(first).toContain("describe('props texto");
    expect(first).toContain("describe('regras')");
    expect(first).toContain("describe('tudo')");
    const index = first.replace("\n[continua: vct.more()]", "") + api.more();
    expect(index.length).toBeLessThanOrEqual(1300);
    for (const type of Object.keys(COMMANDS)) expect(index, type).toContain(type.includes(".") ? type.slice(type.lastIndexOf(".")) : type);
    expect(index).toContain("clip.place!asset,startTime");
    expect(index).not.toContain("layerId!");
    expect(index).not.toMatch(/[?&=]/);
  });

  it("describe('tipo') devolve texto com campos, limites e exemplo; json devolve o objeto", () => {
    const { api } = setup();
    const text = api.describe("clip.move");
    expect(typeof text).toBe("string");
    expect(text).toContain("layerId!:id");
    expect(text).toContain("startTime!:number 0..7200");
    expect(text).toMatch(/exemplo: \{"type":"clip.move"/);
    expect(text).not.toContain("[object Object]");
    expect(`${api.describe("clip.remove")}`).toContain("Pede confirmação");
    const json = api.describe("clip.move", { format: "json" });
    expect(json).toMatchObject({ type: "clip.move", fields: { layerId: { required: true } }, example: { type: "clip.move" } });
    expect(api.describe({ format: "json" })).toMatchObject({ version: "1", groups: { clipe: expect.any(Array) } });
    expect(() => api.describe("nada.disso")).toThrow("não suportado");
    expect(() => api.describe("clip.move", { format: "xml" as never })).toThrow("format");
  });

  it("describe('props texto') lista fonte, tamanho, peso, cor, contorno, sombra e alinhamento", () => {
    const { api } = setup();
    let text = api.describe("props texto");
    while (text.includes("[continua")) text = text.replace(/\n\[continua: vct.more\(\)\]/, "") + api.more();
    for (const key of ["fontFamily", "fontSize", "fontWeight", "fill", "stroke", "strokeWidth", "shadowColor", "shadowOpacity", "shadowBlur", "shadowX", "shadowY", "align"]) {
      expect(text, key).toContain(`${key}:`);
    }
    expect(text).not.toContain("sourceIn");
    expect(text).toContain("layer.setMany");
    for (const alias of ["props text", "props Texto", "props forma", "props geometry", "props imagem", "props vídeo", "props guia", "props áudio", "props composição", "props camada"]) {
      expect(() => api.describe(alias), alias).not.toThrow();
    }
    expect(api.describe("props video")).toContain("sourceIn");
    expect(api.describe("props forma")).toContain("geometry:");
    expect(api.describe("props audio")).toContain("volume:number 0..2");
    expect(api.describe("props composicao")).toContain("fps:int");
    expect(api.describe("props")).toContain("describe('props <tipo>')");
    expect(() => api.describe("props nada")).toThrow("Tipo de props desconhecido");
    expect(api.describe("props texto", { format: "json" })).toMatchObject({ kind: "text", properties: { shadowColor: { type: "color" } } });
  });

  it("'props camada' cobre toda a tabela do layer.set", () => {
    const { api } = setup();
    const all = api.describe("props camada", { format: "json" }) as { properties: Record<string, unknown> };
    expect(Object.keys(all.properties).sort()).toEqual(Object.keys(LAYER_PROPERTIES).sort());
  });

  it("'regras' e 'tudo' ficam acessíveis; tudo traz todos os comandos em páginas", () => {
    const { api } = setup();
    expect(api.describe("regras")).toContain("Tempos em segundos");
    let full = api.describe("tudo");
    for (let page = 0; page < 30 && full.includes("[continua"); page++) full = full.replace(/\n\[continua: vct.more\(\)\]/, "") + api.more();
    for (const type of Object.keys(COMMANDS)) expect(full).toContain(`${type} `);
    expect(full).toContain("hold segura o valor");
  });
});

describe("batch, plan, dryRun e dispatch: texto curto e sem lançar", () => {
  const create = { type: "layer.create", layerId: "titulo", kind: "text", name: "Título", startTime: 0, endTime: 3 } as never;

  it("batch devolve ok com contagem, desfazer e ids criados", () => {
    const { api, commit } = setup();
    expect(api.batch([create], { label: "Título" })).toMatch(/^ok · 1 comando · desfazer: Título · criados: titulo/);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(api.batch([{ type: "layer.set", layerId: "titulo", props: { opacity: 1 } }] as never)).toBe("ok · 1 comando · sem mudanças");
  });

  it("falha vira texto com o número e o tipo do comando, sem mudar o projeto", () => {
    const { api, commit } = setup();
    const bad = [create, { type: "layer.set", layerId: "titulo", props: { blendMode: "zzz" } }] as never;
    const text = api.batch(bad);
    expect(text).toMatch(/^erro no comando 2 \(layer\.set\): blendMode deve ser/);
    expect(api.batch([{ type: "nada" }] as never)).toMatch(/^erro no comando 1 \(nada\)/);
    expect(commit).not.toHaveBeenCalled();
    expect(api.dryRun(bad)).toMatch(/^erro no comando 2/);
    expect(api.dispatch({ type: "clip.move", layerId: "x", startTime: 0 } as never)).toMatch(/^erro no comando 1 \(clip\.move\)/);
  });

  it("format json: { ok, errors, warnings, results }", () => {
    const { api } = setup();
    expect(api.batch([create], { format: "json" })).toMatchObject({ ok: true, errors: [], results: [{ layerId: "titulo", trackId: "titulo" }], created: ["titulo"], undo: "VCT automation" });
    const failed = api.batch([{ type: "clip.move", layerId: "x", startTime: 0 }] as never, { format: "json" });
    expect(failed).toEqual({ ok: false, errors: [expect.stringMatching(/^erro no comando 1 \(clip\.move\)/)], warnings: [], results: [] });
    expect(api.dispatch(create, { format: "json" })).toMatchObject({ ok: false });
  });

  it("dryRun diz simulação e plan conta lotes", () => {
    const { api, commit } = setup();
    expect(api.dryRun([create])).toMatch(/^ok \(simulação\) · 1 comando · criados: titulo/);
    expect(commit).not.toHaveBeenCalled();
    expect(api.plan([[create], [{ type: "layer.setText", layerId: "titulo", text: "Oi" }]] as never, { label: "Plano" })).toContain("2 lotes · 2 comandos · desfazer: Plano");
  });

  it("só avisa de problemas que o lote criou", () => {
    const { api } = setup();
    expect(api.batch([create], { label: "A" })).toContain("avisos: Nada visível");
    const json = api.batch([{ type: "layer.set", layerId: "titulo", props: { y: 100 } }] as never, { format: "json" });
    expect(json).toMatchObject({ ok: true, warnings: [expect.stringContaining("área segura")] });
    expect(api.batch([{ type: "layer.set", layerId: "titulo", props: { x: 200 } }] as never)).not.toContain("avisos");
  });

  it("mostra poucos ids criados e só a contagem quando são muitos", () => {
    const { api } = setup();
    const text = api.batch([{ type: "text.fromSrt", srt: subtitles }] as never);
    expect(text).toContain("criados: legenda1 legenda2 legenda_track");
    const many = Array.from({ length: 8 }, (_, index) => ({ type: "layer.create", layerId: `l${index}`, kind: "geometry", name: "Q", startTime: index, endTime: index + 1 }));
    expect(api.dryRun(many as never)).toContain("criados: 8");
  });

  it("opções inválidas continuam lançando", () => {
    const { api } = setup();
    expect(() => api.batch("x" as never)).toThrow("lista");
    expect(() => api.batch([create], { label: 5 as never })).toThrow("texto");
    expect(() => api.batch([create], { format: "yaml" as never })).toThrow("format");
  });
});

describe("layer.setMany", () => {
  function withSubtitles() {
    const context = setup();
    context.api.batch([{ type: "text.fromSrt", srt: subtitles }] as never);
    context.commit.mockClear();
    return context;
  }

  it("multiplica o tamanho de todas as legendas num passo de desfazer", () => {
    const { api, commit, project } = withSubtitles();
    const before = project().layers.filter((layer) => layer.kind === "text").map((layer) => layer.fontSize!);
    expect(api.batch([{ type: "layer.setMany", trackId: "legenda_track", multiply: { fontSize: 1.4 } }] as never, { label: "Maiores" })).toBe("ok · 1 comando · desfazer: Maiores");
    expect(commit).toHaveBeenCalledTimes(1);
    const after = project().layers.filter((layer) => layer.kind === "text").map((layer) => layer.fontSize!);
    expect(after).toEqual(before.map((size) => Math.round(size * 1.4 * 1000) / 1000));
  });

  it("aplica props iguais por kind, por layerIds e combina filtros", () => {
    const { api, project } = withSubtitles();
    api.batch([{ type: "layer.setMany", kind: "text", props: { fill: "#ffcc00", shadowColor: "#000000", shadowOpacity: .8 } }] as never);
    expect(project().layers.every((layer) => layer.fill === "#ffcc00" && layer.shadowOpacity === .8)).toBe(true);
    api.batch([{ type: "layer.setMany", layerIds: ["legenda1"], trackId: "legenda_track", props: { opacity: .5 } }] as never);
    expect(project().layers.map((layer) => [layer.id, layer.opacity])).toEqual([["legenda1", .5], ["legenda2", 1]]);
    api.batch([{ type: "layer.setMany", layerIds: ["legenda1", "legenda2"], kind: "geometry", props: { opacity: 0 } }] as never).includes("erro");
    expect(project().layers.map((layer) => layer.opacity)).toEqual([.5, 1]);
  });

  it("valida como layer.set e é tudo ou nada", () => {
    const { api, commit, project } = withSubtitles();
    expect(api.batch([{ type: "layer.setMany", kind: "text", multiply: { fontSize: 50 } }] as never)).toMatch(/^erro no comando 1 \(layer\.setMany\): legenda1: fontSize deve estar entre 4 e 2000/);
    expect(api.batch([{ type: "layer.setMany", kind: "text", props: { blendMode: "zzz" } }] as never)).toContain("blendMode");
    expect(api.batch([{ type: "layer.setMany", props: { opacity: 1 } }] as never)).toContain("layerIds, trackId e/ou kind");
    expect(api.batch([{ type: "layer.setMany", kind: "text" }] as never)).toContain("props e/ou multiply");
    expect(api.batch([{ type: "layer.setMany", kind: "text", props: { fontSize: 20 }, multiply: { fontSize: 2 } }] as never)).toContain("props e em multiply");
    expect(api.batch([{ type: "layer.setMany", kind: "text", multiply: { fill: 2 } }] as never)).toContain("numéricas");
    expect(api.batch([{ type: "layer.setMany", kind: "text", multiply: { fontSize: 0 } }] as never)).toContain("fator");
    expect(api.batch([{ type: "layer.setMany", trackId: "nada", props: { opacity: 1 } }] as never)).toContain("Nenhuma camada");
    expect(api.batch([{ type: "layer.setMany", layerIds: ["legenda1", "fantasma"], props: { opacity: .1 } }] as never)).toContain("fantasma");
    expect(commit).not.toHaveBeenCalled();
    expect(project().layers[0].opacity).toBe(1);
    const locked = structuredClone(project());
    locked.layers[1].locked = true;
    expect(() => runProjectCommands(locked, [{ type: "layer.setMany", kind: "text", props: { opacity: .2 } }], 1 / 60)).toThrow("bloqueada");
  });
});

describe("clip.fade", () => {
  function withVideo() {
    const context = setup();
    context.api.batch([{ type: "clip.place", layerId: "v", asset: "media/ampla.mp4", startTime: 0, duration: 4 }] as never);
    return context;
  }

  it("liga os fades do vídeo e do áudio vinculado", () => {
    const { api, project } = withVideo();
    expect(api.batch([{ type: "clip.fade", layerId: "v", in: .5, out: 1 }] as never, { format: "json" })).toMatchObject({ ok: true, results: [{ fadeIn: .5, fadeOut: 1, audioIds: ["v:audio"] }] });
    const video = project().layers[0];
    const audio = project().audioTracks[0];
    expect([video.fadeInStart, video.fadeInEnd, video.fadeOutStart, video.fadeOutEnd]).toEqual([0, .5, 3, 4]);
    expect([audio.fadeInStart, audio.fadeInEnd, audio.fadeOutStart, audio.fadeOutEnd]).toEqual([0, .5, 3, 4]);
    api.batch([{ type: "clip.fade", layerId: "v", in: 0 }] as never);
    expect(project().layers[0].fadeInEnd).toBe(0);
    expect(project().layers[0].fadeOutStart).toBe(3);
    expect(project().audioTracks[0].fadeInEnd).toBe(0);
  });

  it("recusa fades maiores que o clipe e chamadas sem in nem out", () => {
    const { api } = withVideo();
    expect(api.batch([{ type: "clip.fade", layerId: "v", in: 3, out: 2 }] as never)).toContain("mais que o clipe");
    expect(api.batch([{ type: "clip.fade", layerId: "v" }] as never)).toContain("in e/ou out");
  });
});

describe("legenda automática e mídia no tamanho original", () => {
  it("text.fromSrt usa 5,5% do lado menor, caixa de duas linhas e fica na área segura", () => {
    for (const [width, height] of [[1080, 1920], [1920, 1080], [1080, 1080]]) {
      const project = createProject({ ...settings, width, height });
      const { project: result } = runProjectCommands(project, [{ type: "text.fromSrt", srt: subtitles }], 1 / 60);
      const layer = result.layers.find((item) => item.id === "legenda1")!;
      expect(layer.fontSize).toBe(Math.round(Math.min(width, height) * .055));
      expect(layer.height).toBeGreaterThanOrEqual(layer.fontSize! * 1.2 * 2);
      expect(lintProject(result).filter((issue) => issue.code === "area-segura"), `${width}x${height}`).toEqual([]);
    }
  });

  it("props continuam mandando sobre o padrão da legenda", () => {
    const { project } = runProjectCommands(fixture(), [{ type: "text.fromSrt", srt: subtitles, props: { fontSize: 40 } }], 1 / 60);
    expect(project.layers.find((item) => item.id === "legenda1")!.fontSize).toBe(40);
  });

  it("clip.place sem fit entra no tamanho original, centralizado, para vídeo e imagem", () => {
    const { project } = runProjectCommands(fixture(), [
      { type: "clip.place", layerId: "v", asset: "media/ampla.mp4", startTime: 0, duration: 2 },
      { type: "clip.place", layerId: "i", asset: "media/logo.png", startTime: 2, duration: 2 },
    ], 1 / 60);
    for (const [id, width, height] of [["v", 1920, 1080], ["i", 500, 300]] as const) {
      expect(project.layers.find((layer) => layer.id === id), id).toMatchObject({ width, height, x: 540, y: 960, scaleX: 1, scaleY: 1, rotation: 0 });
    }
  });

  it("fit explícito continua enquadrando", () => {
    const { project } = runProjectCommands(fixture(), [{ type: "clip.place", layerId: "v", asset: "media/ampla.mp4", startTime: 0, duration: 2, fit: "contain" }], 1 / 60);
    expect(project.layers[0].width).toBeCloseTo(1080);
  });
});

describe("vct.view e captureFrame show", () => {
  it("solo e bypassEffects só chamam o host: nada de commit nem desfazer", () => {
    const setDiagnostics = vi.fn();
    const { api, commit } = setup(fixture(), { setDiagnostics });
    api.batch([{ type: "layer.create", layerId: "a", kind: "text", name: "A", startTime: 0, endTime: 2 }] as never);
    commit.mockClear();
    expect(api.view()).toBe("vista: normal");
    expect(api.view({ solo: "a" })).toContain("solo a");
    expect(setDiagnostics).toHaveBeenLastCalledWith({ soloLayerId: "a", bypassEffects: false });
    expect(api.view({ bypassEffects: true })).toContain("solo a, efeitos desligados");
    expect(setDiagnostics).toHaveBeenLastCalledWith({ soloLayerId: "a", bypassEffects: true });
    expect(api.view({ solo: null })).toBe("vista: efeitos desligados. Só a tela muda; view({}) volta ao normal.");
    expect(api.view({})).toBe("vista: normal");
    expect(setDiagnostics).toHaveBeenLastCalledWith({ soloLayerId: null, bypassEffects: false });
    expect(commit).not.toHaveBeenCalled();
    expect(() => api.view({ solo: "fantasma" })).toThrow("solo precisa ser o id de uma camada");
    expect(() => api.view({ cor: 1 } as never)).toThrow("view espera");
  });

  it("volta ao normal quando a camada isolada some e não chama o host à toa", () => {
    const setDiagnostics = vi.fn();
    const { api } = setup(fixture(), { setDiagnostics });
    api.batch([{ type: "layer.create", layerId: "a", kind: "text", name: "A", startTime: 0, endTime: 2 }] as never);
    api.view({});
    expect(setDiagnostics).not.toHaveBeenCalled();
    api.view({ solo: "a" });
    api.batch([{ type: "clip.remove", layerId: "a" }] as never);
    expect(setDiagnostics).toHaveBeenLastCalledWith({ soloLayerId: null, bypassEffects: false });
    expect(api.view()).toBe("vista: normal");
  });

  it("sem suporte do host a vista avisa", () => {
    const { api } = setup();
    expect(api.view({})).toBe("vista: normal");
    expect(() => api.view({ bypassEffects: true })).toThrow("indisponível");
  });
});

describe("captureFrame com show", () => {
  beforeEach(() => { showFrame.mockClear(); });
  const frame = { time: 1.5, width: 480, height: 270, dataUrl: "data:image/jpeg;base64,QUJD=" };

  it("mostra o quadro na tela e devolve só a nota para chamar hideSheet", async () => {
    const { api } = setup(fixture(), { captureFrame: async () => frame });
    const shown = await api.captureFrame({ time: 1.5, show: true });
    expect(showFrame).toHaveBeenCalledWith(frame);
    expect(shown).toEqual({ time: 1.5, width: 480, height: 270, note: expect.stringContaining("hideSheet()") });
    expect("dataUrl" in shown).toBe(false);
  });

  it("sem show devolve a imagem intacta, inclusive o preenchimento = do base64", async () => {
    const { api } = setup(fixture(), { captureFrame: async () => frame });
    expect(await api.captureFrame({ time: 1 })).toEqual(frame);
    expect(showFrame).not.toHaveBeenCalled();
  });
});

describe("filtro de ? & = em toda a saída da API", () => {
  const hostile = "Quem? Eu & você = nós";

  function hostileProject() {
    const project = fixture();
    project.settings.name = hostile;
    project.layers.push(
      createLayer("text", settings, { id: "titulo", name: hostile, text: hostile, startTime: 0, endTime: 3, y: 100 }),
      createLayer("video", settings, { id: "v", name: hostile, asset: "media/ampla.mp4", startTime: 0, endTime: 4, sourceOut: 4, loop: false }),
    );
    project.audioTracks.push(createAudioTrack(hostile, "media/ampla.mp4", 4, { id: "va", linked: true, linkedLayerId: "v" }));
    return project;
  }

  const strings = (value: unknown, found: string[] = []): string[] => {
    if (typeof value === "string") found.push(value);
    else if (Array.isArray(value)) value.forEach((item) => strings(item, found));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) if (key !== "dataUrl") strings(item, found);
    return found;
  };
  const clean = (label: string, value: unknown) => {
    const found = strings(value);
    if (label !== "validate") expect(found.length, label).toBeGreaterThan(0);
    for (const text of found) expect(text, label).not.toMatch(/[?&=]/);
  };

  it("percorre todos os métodos públicos", async () => {
    const { api } = setup(hostileProject(), {
      captureFrame: async () => ({ time: 1, width: 4, height: 4, dataUrl: "data:image/jpeg;base64,QUJD=", notReady: ["a?b"] }),
      stillFrame: async () => ({ canvas: { width: 4, height: 4 } as HTMLCanvasElement, notReady: [] }),
      runRequest: async () => "arquivo?.mp4",
      startTranscribe: async () => "Transcrição? iniciada = ok",
      setDiagnostics: () => undefined,
      projectName: () => hostile,
      undoLabel: () => hostile,
    });
    const bad = [{ type: "layer.set", layerId: "titulo", props: { blendMode: "x?y" } }] as never;
    const good = [{ type: "layer.setText", layerId: "titulo", text: hostile }] as never;
    const cases: Record<keyof VctApi, () => unknown> = {
      version: () => "1",
      getProject: () => api.getProject(),
      guide: () => api.guide(),
      describe: () => [api.describe(), api.describe("props texto"), api.describe("clip.place"), api.describe("tudo"), api.describe({ format: "json" }), api.describe("layer.set", { format: "json" })],
      more: () => api.more(),
      assets: () => api.assets(),
      summary: () => api.summary(),
      lint: () => api.lint(),
      plan: () => [api.plan([good], { dryRun: true }), api.plan([bad], { dryRun: true }), api.plan([good], { format: "json", dryRun: true })],
      contactSheet: async () => api.contactSheet({ times: [0, 1] }),
      assetSheet: async () => api.assetSheet("media/ampla.mp4", { times: [0] }),
      hideSheet: () => { api.hideSheet(); return "oculto"; },
      analyzeMix: async () => api.analyzeMix(),
      analyzeAudio: async () => api.analyzeAudio("media/ampla.mp4"),
      analyzeVideo: async () => api.analyzeVideo("media/ampla.mp4"),
      getTimeline: () => api.getTimeline(),
      query: () => [api.query("layers"), api.query({ layerId: "titulo" })],
      validate: () => api.validate(),
      listCatalog: () => api.listCatalog(),
      dryRun: () => [api.dryRun(good), api.dryRun(bad), api.dryRun(bad, { format: "json" }), api.dryRun(good, { format: "json" })],
      dispatch: () => [api.dispatch(bad[0]), api.dispatch(good[0], { format: "json" })],
      batch: () => [api.batch(bad), api.batch(good, { label: hostile }), api.batch(bad, { format: "json" })],
      undo: () => String(api.undo()),
      redo: () => String(api.redo()),
      captureFrame: async () => [await api.captureFrame(), await api.captureFrame({ show: true })],
      view: () => api.view({ solo: "titulo" }),
      request: () => api.request("save"),
      status: () => api.status(),
      transcribe: async () => api.transcribe(),
      cancelTranscribe: () => api.cancelTranscribe(),
      transcript: () => api.transcript(),
      onChange: () => "ouvinte",
    };
    expect(Object.keys(api).sort()).toEqual(Object.keys(cases).sort());
    for (const [name, run] of Object.entries(cases)) {
      let value: unknown;
      try { value = await run(); } catch (error) { value = (error as Error).message; }
      clean(name, value);
    }
  });

  it("mensagens de erro lançadas também passam pelo filtro", () => {
    const { api } = setup(hostileProject());
    for (const call of [() => api.query({ layerId: "nada?&=" }), () => api.describe("x?y"), () => api.view({ solo: "a?b" })]) {
      expect(call).toThrow();
      try { call(); } catch (error) { expect((error as Error).message).not.toMatch(/[?&=]/); }
    }
  });
});

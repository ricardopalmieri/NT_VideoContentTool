import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVctApi } from "../../src/automation/window-vct";
import { WHISPER_MODELS, formatMegabytes, modelCacheKey, whisperLanguageName } from "../../src/transcribe/model-catalog";
import { missingFromBrowserCache, storeModelFiles } from "../../src/transcribe/model-store";
import { createTranscribeStore, transcribeStatusText, transcribeStore } from "../../src/transcribe/transcribe-state";
import { createProject } from "../../src/model/types";

// Cache Storage mínimo para o Node.
function installFakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    const entries = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, entries);
    return {
      match: async (key: string) => entries.get(key)?.clone(),
      put: async (key: string, response: Response) => { entries.set(key, response); },
      delete: async (key: string) => entries.delete(key),
    };
  };
  vi.stubGlobal("caches", { open });
  return stores;
}

const fileOf = (name: string, size: number) => new File([new Uint8Array(size)], name);

describe("catálogo de modelos", () => {
  it("tem os tamanhos anunciados", () => {
    expect(formatMegabytes(WHISPER_MODELS.base.bytes)).toBe("80 MB");
    expect(formatMegabytes(WHISPER_MODELS.small.bytes)).toBe("252 MB");
    expect(modelCacheKey(WHISPER_MODELS.base, "config.json")).toBe("https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json");
    expect(whisperLanguageName("pt")).toBe("portuguese");
    expect(whisperLanguageName("auto")).toBeUndefined();
  });
});

describe("script models:whisper", () => {
  it("usa os mesmos arquivos e tamanhos do catálogo", () => {
    const script = readFileSync("scripts/fetch-whisper-model.mjs", "utf8");
    for (const model of Object.values(WHISPER_MODELS)) {
      const listed = model.files.map((file) => `["${file.path}", ${file.bytes}]`).join(", ");
      expect(script).toContain(`${model.size}: [${listed}]`);
    }
  });
});

describe("modelo importado à mão", () => {
  beforeEach(() => { installFakeCaches(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("guarda nas chaves que o Transformers.js consulta e passa a contar como disponível", async () => {
    const model = WHISPER_MODELS.base;
    expect(await missingFromBrowserCache(model)).toHaveLength(model.files.length);
    // Pasta escolhida: nomes de arquivo com tamanhos do modelo.
    const files = model.files.map((file) => fileOf(file.path.split("/").pop()!, file.bytes > 1e6 ? 1000 : file.bytes));
    // Os .onnx de verdade têm dezenas de MB: aqui só vale conferir a regra de tamanho com arquivos pequenos.
    const report = await storeModelFiles("base", files);
    expect(report.rejected).toEqual(["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]);
    expect(report.stored).toContain("config.json");
    expect(await missingFromBrowserCache(model)).toEqual(["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]);
  });

  it("aceita o conjunto completo e recusa o modelo de outro tamanho", async () => {
    const model = WHISPER_MODELS.base;
    // Arquivo com o tamanho declarado, sem alocar dezenas de MB.
    const fake = (name: string, size: number) => Object.defineProperty(new File([""], name), "size", { value: size });
    const complete = model.files.map((file) => fake(file.path.split("/").pop()!, file.bytes));
    const report = await storeModelFiles("base", complete);
    expect(report.missing).toEqual([]);
    expect(report.rejected).toEqual([]);
    expect(await missingFromBrowserCache(model)).toEqual([]);
    const wrong = await storeModelFiles("small", [fake("encoder_model_quantized.onnx", WHISPER_MODELS.base.files[1].bytes)]);
    expect(wrong.rejected).toEqual(["onnx/encoder_model_quantized.onnx"]);
    expect(wrong.missing).toContain("config.json");
  });
});

describe("estado da legenda automática no agente", () => {
  it("resume cada fase em texto curto sem ? & =", () => {
    const store = createTranscribeStore();
    const phases = ["waiting", "preparing", "download", "loading", "transcribing", "review", "inserted", "cancelled", "failed"] as const;
    for (const phase of phases) {
      store.set({ phase, loaded: 40_000_000, total: 80_000_000, chunksDone: 1, chunksTotal: 3, cues: 7, startedAt: 1000, error: "falhou" });
      const text = transcribeStatusText(store.get(), 6000);
      expect(text).toMatch(/^Legenda automática:/);
      expect(text).not.toMatch(/[?&=]/);
    }
    store.set({ phase: "download" });
    expect(transcribeStatusText(store.get())).toContain("50%");
    store.set({ phase: "transcribing" });
    expect(transcribeStatusText(store.get(), 6000)).toContain("1 de 3 trechos, há 5 s");
  });
});

describe("window.vct.transcribe", () => {
  const project = createProject({ name: "T", width: 320, height: 180, fps: 10, duration: 10, background: "#000", transparent: false });
  project.assetMetadata = { "media/fala.wav": { originalName: "fala.wav", duration: 4, size: 1, kind: "audio" } as never };
  const started: unknown[] = [];
  const api = createVctApi({
    getProject: () => project, keyframeTolerance: () => .05, confirmConsequential: () => true, commitProject: () => {},
    startTranscribe: async (choices) => { started.push(choices); return "Transcrição iniciada. Confira vct.status()."; },
  });

  it("valida opções e devolve na hora", async () => {
    transcribeStore.reset();
    started.length = 0;
    expect(await api.transcribe()).toContain("Transcrição iniciada");
    expect(started[0]).toMatchObject({ source: "mix" });
    expect(await api.transcribe({ source: "media/fala.wav", language: "pt", model: "small" })).toContain("iniciada");
    expect(started[1]).toMatchObject({ source: "asset:media/fala.wav", language: "pt", model: "small" });
    await expect(api.transcribe({ source: "media/nao-existe.wav" })).rejects.toThrow(/source/);
    await expect(api.transcribe({ language: "fr" as never })).rejects.toThrow(/language/);
    await expect(api.transcribe({ model: "large" as never })).rejects.toThrow(/model/);
  });

  it("recusa um segundo pedido enquanto o primeiro roda; status e transcript refletem o estado", async () => {
    transcribeStore.reset({ phase: "transcribing", chunksDone: 1, chunksTotal: 4, startedAt: Date.now() });
    await expect(api.transcribe()).rejects.toThrow(/andamento/);
    expect(api.status()).toContain("Legenda automática: transcrevendo, 1 de 4");
    expect(api.transcript()).toContain("Nenhuma legenda automática pronta");
    transcribeStore.reset({ phase: "review", cues: 1, srt: "1\n00:00:00,000 --> 00:00:01,000\nO que é isso? Sim & não = fim\n" });
    const text = api.transcript();
    expect(text).toContain("00:00:00,000 --> 00:00:01,000");
    expect(text).not.toMatch(/[?&=]/);
    expect(api.status()).toContain("pronta, 1 legendas");
    transcribeStore.reset();
    expect(api.status()).not.toContain("Legenda automática");
  });
});

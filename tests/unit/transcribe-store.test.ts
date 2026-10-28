import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVctApi } from "../../src/automation/window-vct";
import { MODEL_PROFILES, PROFILE_DTYPES, WHISPER_MODELS, WHISPER_SIZES, formatMegabytes, modelCacheKey, whisperLanguageName, whisperModel } from "../../src/transcribe/model-catalog";
import { profileForAdapter } from "../../src/transcribe/gpu";
import { missingFromBrowserCache, storeModelFiles } from "../../src/transcribe/model-store";
import { cancelTranscribeJob, createTranscribeStore, registerTranscribeCanceller, transcribeStatusText, transcribeStore } from "../../src/transcribe/transcribe-state";
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

  it("cada perfil de dispositivo usa os arquivos do dtype certo (q8 só no WASM; WebGPU: encoder fp32/fp16 e decoder q4)", () => {
    expect(PROFILE_DTYPES.wasm).toEqual({ encoder_model: "q8", decoder_model_merged: "q8" });
    expect(PROFILE_DTYPES.webgpu).toEqual({ encoder_model: "fp32", decoder_model_merged: "q4" });
    expect(PROFILE_DTYPES["webgpu-f16"]).toEqual({ encoder_model: "fp16", decoder_model_merged: "q4" });
    const onnx = (size: "base" | "small", profile: "wasm" | "webgpu" | "webgpu-f16") => whisperModel(size, profile).files.map((file) => file.path).filter((path) => path.endsWith(".onnx"));
    expect(onnx("base", "wasm")).toEqual(["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]);
    expect(onnx("base", "webgpu")).toEqual(["onnx/encoder_model.onnx", "onnx/decoder_model_merged_q4.onnx"]);
    expect(onnx("small", "webgpu-f16")).toEqual(["onnx/encoder_model_fp16.onnx", "onnx/decoder_model_merged_q4.onnx"]);
    // O aviso de download fala do tamanho do perfil: WebGPU baixa mais que WASM (medidos em huggingface.co).
    expect(formatMegabytes(whisperModel("base", "webgpu-f16").bytes)).toBe("168 MB");
    expect(formatMegabytes(whisperModel("base", "webgpu").bytes)).toBe("209 MB");
    expect(formatMegabytes(whisperModel("small", "webgpu-f16").bytes)).toBe("413 MB");
    expect(formatMegabytes(whisperModel("small", "webgpu").bytes)).toBe("589 MB");
    for (const size of WHISPER_SIZES) for (const profile of MODEL_PROFILES) expect(whisperModel(size, profile).files).toHaveLength(7);
  });

  it("o perfil vem do adaptador: sem WebGPU wasm, com shader-f16 webgpu-f16", () => {
    expect(profileForAdapter(null)).toBe("wasm");
    expect(profileForAdapter({ features: new Set<string>() })).toBe("webgpu");
    expect(profileForAdapter({ features: new Set(["shader-f16"]) })).toBe("webgpu-f16");
  });
});

describe("script models:whisper", () => {
  it("usa os mesmos arquivos e tamanhos do catálogo", () => {
    const script = readFileSync("scripts/fetch-whisper-model.mjs", "utf8");
    for (const size of WHISPER_SIZES) {
      const unique = new Map<string, number>();
      for (const profile of MODEL_PROFILES) for (const file of whisperModel(size, profile).files) unique.set(file.path, file.bytes);
      for (const [path, bytes] of unique) expect(script).toContain(`["${path}", ${bytes}]`);
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
    const report = await storeModelFiles("base", files, "wasm");
    expect(report.rejected).toEqual(["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]);
    expect(report.stored).toContain("config.json");
    expect(await missingFromBrowserCache(model)).toEqual(["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]);
  });

  it("aceita o conjunto completo e recusa o modelo de outro tamanho", async () => {
    const model = WHISPER_MODELS.base;
    // Arquivo com o tamanho declarado, sem alocar dezenas de MB.
    const fake = (name: string, size: number) => Object.defineProperty(new File([""], name), "size", { value: size });
    const complete = model.files.map((file) => fake(file.path.split("/").pop()!, file.bytes));
    const report = await storeModelFiles("base", complete, "wasm");
    expect(report.missing).toEqual([]);
    expect(report.rejected).toEqual([]);
    expect(await missingFromBrowserCache(model)).toEqual([]);
    const wrong = await storeModelFiles("small", [fake("encoder_model_quantized.onnx", WHISPER_MODELS.base.files[1].bytes)], "wasm");
    expect(wrong.rejected).toEqual(["onnx/encoder_model_quantized.onnx"]);
    expect(wrong.missing).toContain("config.json");
  });

  it("cada perfil guarda e confere os próprios arquivos (uma pasta com todos os perfis serve)", async () => {
    const fake = (name: string, size: number) => Object.defineProperty(new File([""], name), "size", { value: size });
    const gpu = whisperModel("base", "webgpu-f16");
    const wasm = whisperModel("base", "wasm");
    // Pasta completa do Hugging Face: todos os arquivos dos dois perfis.
    const everything = [...new Map([...gpu.files, ...wasm.files].map((file) => [file.path, file])).values()].map((file) => fake(file.path.split("/").pop()!, file.bytes));
    const report = await storeModelFiles("base", everything, "webgpu-f16");
    expect(report.missing).toEqual([]);
    expect(report.rejected).toEqual([]);
    expect(await missingFromBrowserCache(gpu)).toEqual([]);
    // Só o perfil pedido foi guardado: o q8 do WASM ainda falta.
    expect(await missingFromBrowserCache(wasm)).toEqual(["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"]);
    // O encoder q8 não vale como o fp16 (nome certo só pelo perfil, tamanho de outro arquivo).
    const wrong = await storeModelFiles("base", [fake("encoder_model_fp16.onnx", wasm.files[1].bytes)], "webgpu-f16");
    expect(wrong.rejected).toEqual(["onnx/encoder_model_fp16.onnx"]);
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
    expect(transcribeStatusText(store.get(), 6000)).toContain("bloco 2 de 3, há 5 s");
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

  it("aceita trecho (start, end) e words, e recusa valores inválidos", async () => {
    transcribeStore.reset();
    started.length = 0;
    await api.transcribe({ start: 30, end: 90, words: true });
    expect(started[0]).toMatchObject({ source: "mix", range: { start: 30, end: 90 }, words: true });
    await api.transcribe({ start: 12 });
    expect(started[1]).toMatchObject({ range: { start: 12, end: undefined } });
    await api.transcribe({ end: 5 });
    expect(started[2]).toMatchObject({ range: { start: 0, end: 5 } });
    await api.transcribe();
    expect((started[3] as { range?: unknown }).range).toBeUndefined();
    await expect(api.transcribe({ start: -1 })).rejects.toThrow(/start/);
    await expect(api.transcribe({ start: 10, end: 5 })).rejects.toThrow(/end/);
    await expect(api.transcribe({ end: Number.NaN })).rejects.toThrow(/end/);
    await expect(api.transcribe({ words: "sim" as never })).rejects.toThrow(/words/);
  });

  it("cancelTranscribe cancela quem está rodando e avisa quando não há nada", () => {
    transcribeStore.reset();
    registerTranscribeCanceller(null);
    expect(api.cancelTranscribe()).toContain("Nenhuma legenda automática em andamento");
    let cancelled = 0;
    registerTranscribeCanceller(() => { cancelled++; transcribeStore.set({ phase: "cancelled" }); return true; });
    transcribeStore.reset({ phase: "transcribing", cues: 5, srt: "1\n00:00:00,000 --> 00:00:01,000\nOi\n" });
    const text = api.cancelTranscribe();
    expect(cancelled).toBe(1);
    expect(text).toContain("cancelada");
    expect(text).toContain("5 legendas");
    expect(text).not.toMatch(/[?&=]/);
    expect(api.transcript()).toContain("-->");
    expect(api.status()).toContain("cancelada");
    registerTranscribeCanceller(null);
    expect(cancelTranscribeJob()).toBe(false);
  });

  it("recusa um segundo pedido enquanto o primeiro roda; status e transcript refletem o estado", async () => {
    transcribeStore.reset({ phase: "transcribing", chunksDone: 1, chunksTotal: 4, startedAt: Date.now() });
    await expect(api.transcribe()).rejects.toThrow(/andamento/);
    expect(api.status()).toContain("Legenda automática: transcrevendo, bloco 2 de 4");
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

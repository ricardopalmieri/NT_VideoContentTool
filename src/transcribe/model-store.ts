// De onde o modelo vem, sem carregar o Transformers.js: confere o Cache Storage
// do navegador e a pasta models/ do servidor, e guarda arquivos de modelo
// importados à mão nas mesmas chaves que a biblioteca consulta (o endereço
// remoto em huggingface.co), para o modelo carregar sem rede.
import { MODEL_CACHE_NAME, WHISPER_MODELS, modelCacheKey, type ModelSource, type WhisperModel, type WhisperSize } from "./model-catalog";
import type { ImportReport } from "./protocol";

/** Pasta do app, com barra no fim (a página pode estar num subcaminho). */
export function appBaseUrl() {
  return new URL("./", document.baseURI).href;
}

export function serverModelsUrl() {
  return `${appBaseUrl()}models/`;
}

async function openCache() {
  try {
    return typeof caches === "undefined" ? null : await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

/** Arquivos do modelo que faltam no Cache Storage. */
export async function missingFromBrowserCache(model: WhisperModel) {
  const cache = await openCache();
  if (!cache) return model.files.map((file) => file.path);
  const missing: string[] = [];
  for (const file of model.files) {
    if (!await cache.match(modelCacheKey(model, file.path))) missing.push(file.path);
  }
  return missing;
}

const serverProbes = new Map<string, Promise<boolean>>();

/** A pasta models/ responde com os arquivos reais (servidores com fallback para o index.html não contam). Uma consulta por modelo e página: um 404 é só ruído no console. */
export function isOnServer(model: WhisperModel) {
  let probe = serverProbes.get(model.id);
  if (!probe) {
    probe = probeServer(model);
    serverProbes.set(model.id, probe);
  }
  return probe;
}

async function probeServer(model: WhisperModel) {
  const base = `${serverModelsUrl()}${model.id}/`;
  try {
    const config = await fetch(`${base}config.json`, { cache: "no-store" });
    if (!config.ok || /html/i.test(config.headers.get("content-type") || "")) return false;
    if ((await config.json())?.model_type !== "whisper") return false;
    for (const file of model.files.filter((item) => item.path.endsWith(".onnx"))) {
      const head = await fetch(`${base}${file.path}`, { method: "HEAD", cache: "no-store" });
      if (!head.ok || /html/i.test(head.headers.get("content-type") || "")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Ordem de preferência: cache do navegador, pasta models/ do servidor, internet. */
export async function modelSource(size: WhisperSize): Promise<ModelSource> {
  const model = WHISPER_MODELS[size];
  if (!(await missingFromBrowserCache(model)).length) return "cache";
  if (await isOnServer(model)) return "server";
  return "download";
}

const MIME: Record<string, string> = { json: "application/json", onnx: "application/octet-stream" };

/**
 * Guarda no Cache Storage os arquivos que a pessoa escolheu (arquivos soltos ou
 * uma pasta inteira). Casa pelo nome do arquivo; os .onnx precisam ter o tamanho
 * do modelo escolhido, para um modelo "small" não entrar como "base". O que entrou fica
 * guardado mesmo se faltarem arquivos: a pessoa pode escolher o resto depois.
 */
export async function storeModelFiles(size: WhisperSize, files: readonly File[]): Promise<ImportReport> {
  const model = WHISPER_MODELS[size];
  const cache = await openCache();
  if (!cache) throw new Error("O navegador não permite guardar arquivos (Cache Storage indisponível).");
  const report: ImportReport = { stored: [], missing: [], rejected: [] };
  for (const expected of model.files) {
    const name = expected.path.split("/").pop()!.toLowerCase();
    const matches = files.filter((file) => file.name.toLowerCase() === name);
    // Se a pasta tem o mesmo arquivo em vários lugares, vale o que tem o tamanho esperado.
    const file = matches.find((item) => Math.abs(item.size - expected.bytes) <= expected.bytes * .02) ?? matches[0];
    if (!file) { report.missing.push(expected.path); continue; }
    if (expected.path.endsWith(".onnx") && Math.abs(file.size - expected.bytes) > expected.bytes * .02) { report.rejected.push(expected.path); continue; }
    const type = MIME[name.split(".").pop() || ""] || "application/octet-stream";
    await cache.put(modelCacheKey(model, expected.path), new Response(file, { status: 200, headers: { "content-length": String(file.size), "content-type": type } }));
    report.stored.push(expected.path);
  }
  return report;
}

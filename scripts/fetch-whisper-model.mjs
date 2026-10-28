// Baixa os arquivos de um modelo Whisper do Hugging Face para dist/models/, a pasta
// que o app lê antes de tentar a internet (legenda automática).
//   npm run models:whisper -- base                 (Rápido; perfis wasm e webgpu-f16)
//   npm run models:whisper -- small webgpu-f16     (Preciso, só a versão para placa de vídeo com fp16)
//   npm run models:whisper -- small all            (Preciso, todas as versões: cerca de 1 GB)
// Perfis (os arquivos mudam conforme o dispositivo; o app escolhe sozinho):
//   wasm        encoder e decoder q8: processador (sem WebGPU). Base ~80 MB, small ~252 MB.
//   webgpu-f16  encoder fp16 e decoder q4: placa de vídeo com shader-f16 (a maioria). Base ~168 MB, small ~413 MB.
//   webgpu      encoder fp32 e decoder q4: placa de vídeo sem shader-f16 (rara). Base ~209 MB, small ~588 MB.
//   recomendado wasm + webgpu-f16 (padrão)      all   os três
// Rode depois de `npm run build` (o build apaga dist/) e envie dist/models/ ao servidor,
// ao lado do index.html. Terceiro argumento opcional: outra pasta de destino.
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Mantenha igual a src/transcribe/model-catalog.ts (tests/unit/transcribe-store.test.ts confere).
const SIZES = {
  base: {
    shared: [["config.json", 2243], ["generation_config.json", 3832], ["tokenizer.json", 2480466], ["tokenizer_config.json", 282682], ["preprocessor_config.json", 339]],
    encoder: { q8: ["onnx/encoder_model_quantized.onnx", 23201314], fp32: ["onnx/encoder_model.onnx", 82468078], fp16: ["onnx/encoder_model_fp16.onnx", 41332612] },
    decoder: { q8: ["onnx/decoder_model_merged_quantized.onnx", 53693315], q4: ["onnx/decoder_model_merged_q4.onnx", 123602419] },
  },
  small: {
    shared: [["config.json", 2227], ["generation_config.json", 3893], ["tokenizer.json", 2480466], ["tokenizer_config.json", 282683], ["preprocessor_config.json", 339]],
    encoder: { q8: ["onnx/encoder_model_quantized.onnx", 92326160], fp32: ["onnx/encoder_model.onnx", 352825870], fp16: ["onnx/encoder_model_fp16.onnx", 176607756] },
    decoder: { q8: ["onnx/decoder_model_merged_quantized.onnx", 156750845], q4: ["onnx/decoder_model_merged_q4.onnx", 233149327] },
  },
};
const PROFILES = { wasm: ["q8", "q8"], "webgpu-f16": ["fp16", "q4"], webgpu: ["fp32", "q4"] };
const GROUPS = { recomendado: ["wasm", "webgpu-f16"], all: ["wasm", "webgpu-f16", "webgpu"] };

const size = process.argv[2];
const which = process.argv[3] || "recomendado";
const profiles = GROUPS[which] ?? (PROFILES[which] ? [which] : null);
if (!SIZES[size] || !profiles) {
  console.error("Uso: npm run models:whisper -- base|small [wasm|webgpu-f16|webgpu|recomendado|all] [pasta-de-destino]");
  process.exit(1);
}
const id = `onnx-community/whisper-${size}`;
const root = resolve(process.argv[4] || "dist/models");
const table = SIZES[size];
// Arquivos de todos os perfis pedidos, sem repetir (config e tokenizer são comuns a todos).
const files = new Map(table.shared);
for (const profile of profiles) {
  const [encoder, decoder] = PROFILES[profile];
  for (const [path, bytes] of [table.encoder[encoder], table.decoder[decoder]]) files.set(path, bytes);
}
const total = [...files.values()].reduce((sum, bytes) => sum + bytes, 0);
console.log(`Whisper ${size} (${profiles.join(" + ")}): ${files.size} arquivos, ${(total / 1e6).toFixed(0)} MB, de huggingface.co para ${join(root, id)}`);

for (const [path, expected] of files) {
  const target = join(root, id, ...path.split("/"));
  const existing = await stat(target).catch(() => null);
  if (existing?.size === expected) { console.log(`  já existe  ${path}`); continue; }
  await mkdir(dirname(target), { recursive: true });
  const response = await fetch(`https://huggingface.co/${id}/resolve/main/${path}`);
  if (!response.ok || !response.body) throw new Error(`${path}: HTTP ${response.status}`);
  const partial = `${target}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const written = (await stat(partial)).size;
  if (written !== expected) {
    await rm(partial, { force: true });
    throw new Error(`${path}: ${written} bytes, esperado ${expected}. O modelo mudou no Hugging Face? Atualize model-catalog.ts e este script.`);
  }
  await rename(partial, target);
  console.log(`  baixado    ${path} (${(written / 1e6).toFixed(1)} MB)`);
}
console.log(`Pronto. Envie a pasta ${root} para o servidor, ao lado do index.html (ex.: public_html/models/).`);

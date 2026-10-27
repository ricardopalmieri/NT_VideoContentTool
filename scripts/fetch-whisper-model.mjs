// Baixa os arquivos de um modelo Whisper (q8) do Hugging Face para dist/models/,
// a pasta que o app lê antes de tentar a internet (legenda automática).
//   npm run models:whisper -- base      (Rápido, cerca de 80 MB)
//   npm run models:whisper -- small     (Preciso, cerca de 252 MB)
// Rode depois de `npm run build` (o build apaga dist/) e envie dist/models/ ao servidor,
// ao lado do index.html. Segundo argumento opcional: outra pasta de destino.
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Mantenha igual a src/transcribe/model-catalog.ts (tests/unit/transcribe-store.test.ts confere).
const MODELS = {
  base: [["config.json", 2243], ["onnx/encoder_model_quantized.onnx", 23201314], ["onnx/decoder_model_merged_quantized.onnx", 53693315], ["generation_config.json", 3832], ["tokenizer.json", 2480466], ["tokenizer_config.json", 282682], ["preprocessor_config.json", 339]],
  small: [["config.json", 2227], ["onnx/encoder_model_quantized.onnx", 92326160], ["onnx/decoder_model_merged_quantized.onnx", 156750845], ["generation_config.json", 3893], ["tokenizer.json", 2480466], ["tokenizer_config.json", 282683], ["preprocessor_config.json", 339]],
};

const size = process.argv[2];
if (!MODELS[size]) {
  console.error("Uso: npm run models:whisper -- base|small [pasta-de-destino]");
  process.exit(1);
}
const id = `onnx-community/whisper-${size}`;
const root = resolve(process.argv[3] || "dist/models");
const total = MODELS[size].reduce((sum, [, bytes]) => sum + bytes, 0);
console.log(`Whisper ${size}: ${MODELS[size].length} arquivos, ${(total / 1e6).toFixed(0)} MB, de huggingface.co para ${join(root, id)}`);

for (const [path, expected] of MODELS[size]) {
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

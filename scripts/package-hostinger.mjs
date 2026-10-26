import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const sourceUrl = new URL("../dist/", import.meta.url);
const source = fileURLToPath(sourceUrl);
const outputDirectory = new URL("../release/", import.meta.url);
const files = {};

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files[relative(source, path).replaceAll("\\", "/")] = new Uint8Array(await readFile(path));
  }
}

await collect(source);
await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL("NoisetupiVideoContentToolWeb-Hostinger-0.6.2.zip", outputDirectory), zipSync(files, { level: 6 }));
console.log("Created release/NoisetupiVideoContentToolWeb-Hostinger-0.6.2.zip");

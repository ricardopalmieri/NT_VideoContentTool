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

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const archiveName = `NoisetupiVideoContentToolWeb-Hostinger-${version}.zip`;

await collect(source);
await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL(archiveName, outputDirectory), zipSync(files, { level: 6 }));
console.log(`Created release/${archiveName}`);

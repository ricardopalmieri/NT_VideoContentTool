import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('docs/BASELINE-0.6.2.json', 'utf8'));
for (const entry of [...manifest.files.map((file) => ({ ...file, path: `legacy/0.6.2/${file.path}` })), { path: manifest.sourceArchive, sha256: manifest.sourceSha256 }]) {
  const hash = createHash('sha256').update(await readFile(entry.path)).digest('hex');
  if (hash !== entry.sha256) throw new Error(`Referência modificada: ${entry.path}`);
}
console.log('Legado e ZIP original íntegros (SHA-256).');

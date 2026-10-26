// Confere a reprodução integral do pacote original antes da modularização.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve('legacy/0.6.2');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const entries = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else {
      const name = relative(root, path).replaceAll('\\', '/');
      if (name === 'README.md') continue;
      const expected = digest(await readFile(path));
      const actual = digest(await readFile(resolve('dist', name)));
      if (expected !== actual) throw new Error(`Build divergente: ${name}`);
      entries.push({ path: name, sha256: expected });
    }
  }
}
await visit(root);
const evidence = {
  description: 'Build do fonte original, antes de qualquer modularização ou alteração de configuração.',
  sourceArchive: 'archives/0.6.2/NoisetupiVideoContentToolWeb-Source-0.6.2.zip',
  sourceSha256: digest(await readFile('archives/0.6.2/NoisetupiVideoContentToolWeb-Source-0.6.2.zip')),
  referenceCommit: '41af6f6',
  node: process.version,
  files: entries.sort((a, b) => a.path.localeCompare(b.path)),
};
if (process.argv.includes('--record')) {
  await writeFile('docs/BASELINE-0.6.2.json', JSON.stringify(evidence, null, 2) + '\n');
}
console.log(`${entries.length} arquivos reproduzidos byte a byte (SHA-256).`);

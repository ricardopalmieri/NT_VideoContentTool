// Gera o pacote do servidor MCP para quem usa só o site: um arquivo único
// (servidor + dependências + guia/skills embutidos) empacotado em .tgz, servido
// em dist/mcp/. Qualquer cliente MCP instala com: npx -y <url>/mcp/noisetupi-vct-mcp.tgz
import { execSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile, copyFile, readdir } from "node:fs/promises";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const work = new URL(".work/mcp-package/", root);
const out = new URL("dist/mcp/", root);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const read = (path) => readFile(new URL(path, root), "utf8");
const guides = {
  "PROMPT.md": await read("agents/PROMPT.md"),
  "skills/vct-edit/SKILL.md": await read("agents/skills/vct-edit/SKILL.md"),
  "skills/vct-critique/SKILL.md": await read("agents/skills/vct-critique/SKILL.md"),
};

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
await build({
  entryPoints: [new URL("mcp/vct-mcp-server.mjs", root).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  outfile: new URL("vct-mcp.mjs", work).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["bufferutil", "utf-8-validate"],
  define: { __VCT_GUIDES__: JSON.stringify(guides), __VCT_VERSION__: JSON.stringify(version) },
  banner: { js: "import { createRequire as __vctRequire } from 'node:module'; const require = __vctRequire(import.meta.url);" },
  legalComments: "eof",
  logLevel: "warning",
});
await writeFile(new URL("package.json", work), `${JSON.stringify({
  name: "noisetupi-vct-mcp",
  version,
  description: "Servidor MCP local do Noisetupi Video Content Tool (edição de vídeo com IA no navegador).",
  type: "module",
  bin: { "noisetupi-vct-mcp": "vct-mcp.mjs" },
  engines: { node: ">=20" },
  license: "MPL-2.0",
}, null, 2)}\n`);
await copyFile(new URL("LICENSE", root), new URL("LICENSE", work));
execSync("npm pack --silent", { cwd: work, stdio: ["ignore", "ignore", "inherit"] });
const tarball = (await readdir(work)).find((name) => name.endsWith(".tgz"));
await mkdir(out, { recursive: true });
await copyFile(new URL(tarball, work), new URL("noisetupi-vct-mcp.tgz", out));
console.log(`MCP: dist/mcp/noisetupi-vct-mcp.tgz (${tarball})`);

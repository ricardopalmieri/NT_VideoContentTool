import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createVctApi } from "../../src/automation/window-vct";
import { createProject } from "../../src/model/types";

// docs/API-AGENTE.md is generated from the command registry. Regenerate with:
// DOCS_WRITE=1 npx vitest run tests/unit/api-docs.test.ts
it("docs/API-AGENTE.md matches the command registry", () => {
  const project = createProject({ name: "Docs", width: 1080, height: 1920, fps: 30, duration: 10, background: "#000000", transparent: false });
  const api = createVctApi({ getProject: () => project, keyframeTolerance: () => 1 / 60, commitProject: () => {}, confirmConsequential: () => true });
  let text = api.describe('tudo');
  while (text.endsWith("[continua: vct.more()]")) text = text.replace("\n[continua: vct.more()]", "") + api.more();
  const doc = `# API do agente (window.vct)\n\nGerado do registro de comandos (\`src/model/command-registry.ts\`). É o mesmo texto que\n\`window.vct.describe('tudo')\` devolve ao agente (\`describe()\` sem argumento é só o índice de uma página). Não edite à mão: rode\n\`DOCS_WRITE=1 npx vitest run tests/unit/api-docs.test.ts\`.\n\n\`\`\`text\n${text}\n\`\`\`\n`;
  if (process.env.DOCS_WRITE) writeFileSync("docs/API-AGENTE.md", doc);
  expect(existsSync("docs/API-AGENTE.md") ? readFileSync("docs/API-AGENTE.md", "utf8").replaceAll("\r\n", "\n") : "").toBe(doc);
});

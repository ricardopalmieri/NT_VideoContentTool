// Diálogo "Editar com IA": passo a passo para usar um agente que roda no navegador
// (Claude in Chrome e similares) e edita o projeto pela API window.vct, mais o
// registro das mesmas ferramentas via WebMCP quando o navegador oferece essa API.
import { BRIDGE_METHODS, handleBridgeRequest, type BridgeMethod } from "./agent-bridge";
import { agentStarterPrompt } from "./agent-guide";
import type { VctApi } from "./window-vct";

type Language = "pt-BR" | "en";

let currentLanguage: () => Language = () => "pt-BR";
const text = (pt: string, en: string) => (currentLanguage() === "pt-BR" ? pt : en);

function dialog() {
  let element = document.getElementById("agent-dialog") as HTMLDialogElement | null;
  if (element) return element;
  const created = document.createElement("dialog");
  created.id = "agent-dialog";
  created.className = "agent-dialog";
  created.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <ol class="agent-steps"></ol>
      <label><span data-role="prompt-label"></span><textarea data-role="prompt" rows="5" readonly></textarea></label>
      <p class="agent-note"></p>
      <footer><button value="close" data-role="close"></button><button type="button" class="primary" data-role="copy"></button></footer>
    </form>`;
  document.body.append(created);
  created.querySelector<HTMLButtonElement>("[data-role=copy]")!.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const prompt = created.querySelector<HTMLTextAreaElement>("[data-role=prompt]")!;
    try {
      await navigator.clipboard.writeText(prompt.value);
    } catch {
      prompt.select();
      document.execCommand("copy");
    }
    button.textContent = text("Copiado ✓", "Copied ✓");
    window.setTimeout(() => { button.textContent = text("Copiar instruções", "Copy instructions"); }, 1800);
  });
  return created;
}

export function openAgentPanel() {
  const element = dialog();
  const steps: Array<[string, string]> = [
    ["Use o Chrome (ou Edge) com a extensão <b>Claude in Chrome</b> instalada. Outros agentes que executam JavaScript na página também servem.",
      "Use Chrome (or Edge) with the <b>Claude in Chrome</b> extension. Other agents that run JavaScript in the page also work."],
    ["Abra ou crie o projeto aqui e traga o material (pode arrastar vários arquivos de uma vez).",
      "Open or create the project here and bring the media (you can drop several files at once)."],
    ["Abra o painel do Claude nesta aba, cole as instruções abaixo e complete com o seu pedido.",
      "Open the Claude panel in this tab, paste the instructions below and add your request."],
    ["Acompanhe as mudanças na timeline. Cada lote do agente é um passo de desfazer (Ctrl+Z).",
      "Watch the timeline. Each agent batch is one undo step (Ctrl+Z)."],
  ];
  element.querySelector("h2")!.textContent = text("Editar com IA no navegador", "Edit with AI in the browser");
  element.querySelector(".agent-steps")!.innerHTML = steps.map(([pt, en]) => `<li>${text(pt, en)}</li>`).join("");
  element.querySelector("[data-role=prompt-label]")!.textContent = text("Instruções para o agente", "Instructions for the agent");
  element.querySelector<HTMLTextAreaElement>("[data-role=prompt]")!.value = agentStarterPrompt(currentLanguage());
  element.querySelector(".agent-note")!.textContent = text(
    "O agente edita só o projeto aberto, pela API window.vct (com o guia em window.vct.guide()). Nada é enviado para servidores da Noisetupi.",
    "The agent only edits the open project through the window.vct API (guide at window.vct.guide()). Nothing is sent to Noisetupi servers.");
  element.querySelector("[data-role=close]")!.textContent = text("Fechar", "Close");
  element.querySelector("[data-role=copy]")!.textContent = text("Copiar instruções", "Copy instructions");
  element.showModal();
}

export function installAgentAutomation(api: VctApi, language: () => Language) {
  currentLanguage = language;
  registerWebMcpTools(api);
}

// WebMCP (em teste no Chrome): o próprio site registra as ferramentas e um agente
// do navegador pode chamá-las diretamente. Só ativa se a API existir.
interface ModelContextLike {
  registerTool(tool: { name: string; description: string; inputSchema: object; execute(input: Record<string, unknown>): Promise<unknown> }): unknown;
}

const WEBMCP_DESCRIPTIONS: Record<BridgeMethod, string> = {
  describe: "One-page index of VCT commands. Input: {type?} a command, 'props texto' (or forma, imagem, video, guia, audio, composicao), 'regras' or 'tudo'; {format?: 'json'}.",
  more: "Next page of a long text returned by describe, assets or summary.",
  assets: "Media bin as short text: id, kind, duration, resolution, orientation, audio, usage.",
  summary: "Timeline as short text, one line per track.",
  lint: "Quality issues: flashes, safe area, gaps, overlapping audio, reading time.",
  plan: "Several command batches simulated in sequence and applied as one undo step. Input: {batches, label, dryRun?, format?}. Returns short text (ok or error at batch and command).",
  getTimeline: "Compact timeline: tracks, clips (times in seconds), transitions and audio lanes.",
  getProject: "Full project JSON (large; prefer getTimeline).",
  validate: "Validate the open project.",
  listCatalog: "Effect and audio effect catalog with parameter ranges.",
  dryRun: "Simulate a command batch without changing the project. Input: {commands, format?}. Returns short text.",
  batch: "Apply 1–500 commands atomically as one undo step. Input: {commands, label, format?}. Returns short text (ok or error at command N).",
  undo: "Undo the last edit.",
  redo: "Redo the last undone edit.",
  captureFrame: "Render one frame as a small JPEG data URL. Input: {time?, maxWidth?}.",
};

export function registerWebMcpTools(api: VctApi) {
  const context = ((navigator as unknown as { modelContext?: ModelContextLike }).modelContext
    || (document as unknown as { modelContext?: ModelContextLike }).modelContext);
  if (!context || typeof context.registerTool !== "function") return false;
  for (const method of BRIDGE_METHODS) {
    context.registerTool({
      name: `vct_${method}`,
      description: WEBMCP_DESCRIPTIONS[method],
      inputSchema: { type: "object", additionalProperties: true },
      async execute(input) {
        const response = await handleBridgeRequest(api, { type: "request", id: method, method, params: input || {} });
        if (!response?.ok) throw new Error(response?.error || "Falha no comando VCT.");
        return response.result;
      },
    });
  }
  return true;
}

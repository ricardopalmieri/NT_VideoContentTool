// Interface da conexão com o agente: diálogo (endereço + código), faixa visível
// enquanto o agente está conectado (com botão para desconectar) e registro das
// mesmas ferramentas via WebMCP quando o navegador oferece essa API.
import { BRIDGE_METHODS, connectAgentBridge, handleBridgeRequest, type BridgeConnection, type BridgeMethod } from "./agent-bridge";
import type { VctApi } from "./window-vct";

type Language = "pt-BR" | "en";

const DEFAULT_URL = "ws://127.0.0.1:47811";
let connection: BridgeConnection | null = null;
let currentApi: VctApi | null = null;
let currentLanguage: () => Language = () => "pt-BR";

const text = (pt: string, en: string) => (currentLanguage() === "pt-BR" ? pt : en);

function banner() {
  let element = document.getElementById("agent-banner");
  if (!element) {
    element = document.createElement("div");
    element.id = "agent-banner";
    element.className = "agent-banner";
    element.setAttribute("role", "status");
    element.hidden = true;
    document.body.append(element);
  }
  return element;
}

function showBanner(message: string, connected: boolean) {
  const element = banner();
  element.hidden = false;
  element.classList.toggle("is-connected", connected);
  element.replaceChildren();
  const label = document.createElement("span");
  label.textContent = message;
  element.append(label);
  if (connected) {
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = text("Desconectar", "Disconnect");
    stop.addEventListener("click", disconnectAgent);
    element.append(stop);
  }
}

function hideBanner() {
  banner().hidden = true;
}

export function disconnectAgent() {
  connection?.close();
  connection = null;
  hideBanner();
  document.querySelector("#agent-panel-button")?.classList.remove("is-active");
}

function dialog() {
  let element = document.getElementById("agent-dialog") as HTMLDialogElement | null;
  if (element) return element;
  const created = document.createElement("dialog");
  created.id = "agent-dialog";
  created.className = "agent-dialog";
  created.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p class="agent-intro"></p>
      <label><span data-i18n="url"></span><input name="url" autocomplete="off" spellcheck="false"></label>
      <label><span data-i18n="token"></span><input name="token" autocomplete="off" spellcheck="false"></label>
      <p class="agent-error" role="alert" hidden></p>
      <footer><button value="cancel" data-i18n="cancel"></button><button value="connect" class="primary" data-i18n="connect"></button></footer>
    </form>`;
  document.body.append(created);
  created.querySelector("form")!.addEventListener("submit", (event) => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== "connect") return;
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const url = (form.elements.namedItem("url") as HTMLInputElement).value.trim();
    const token = (form.elements.namedItem("token") as HTMLInputElement).value.trim();
    try {
      startConnection(url, token);
      created.close();
    } catch (error) {
      const message = created.querySelector<HTMLElement>(".agent-error")!;
      message.hidden = false;
      message.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  return created;
}

function startConnection(url: string, token: string) {
  if (!currentApi) throw new Error(text("Abra um projeto antes de conectar o agente.", "Open a project before connecting the agent."));
  connection?.close();
  connection = connectAgentBridge(currentApi, url, token, {
    onStatus(status, detail) {
      const button = document.querySelector("#agent-panel-button");
      if (status === "connecting") showBanner(text("CONECTANDO AO AGENTE…", "CONNECTING TO AGENT…"), false);
      if (status === "connected") {
        button?.classList.add("is-active");
        showBanner(text("AGENTE CONECTADO · as edições dele entram no histórico (Ctrl+Z desfaz)", "AGENT CONNECTED · its edits go to history (Ctrl+Z undoes)"), true);
      }
      if (status === "closed") {
        button?.classList.remove("is-active");
        connection = null;
        if (detail) showBanner(`${text("AGENTE DESCONECTADO", "AGENT DISCONNECTED")} · ${detail}`, false);
        else hideBanner();
      }
    },
    onActivity(method: BridgeMethod, label?: string) {
      if (method !== "batch" && method !== "undo" && method !== "redo") return;
      showBanner(`${text("AGENTE", "AGENT")} · ${label || method}`, true);
    },
  });
}

// Pré-preenche a partir de #agent=ws://127.0.0.1:47811&token=…, mas a conexão
// sempre depende do clique do usuário.
function hashDefaults() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return { url: hash.get("agent") || DEFAULT_URL, token: hash.get("token") || "" };
}

export function openAgentPanel() {
  const element = dialog();
  const defaults = hashDefaults();
  element.querySelector("h2")!.textContent = text("Conectar agente de IA", "Connect AI agent");
  element.querySelector(".agent-intro")!.textContent = text(
    "Rode o servidor MCP do VCT neste computador (npm run mcp) e cole o endereço e o código que ele mostrar. O agente só edita o projeto aberto, nada sai do seu computador e você pode desconectar a qualquer momento.",
    "Run the VCT MCP server on this computer (npm run mcp) and paste the address and code it shows. The agent only edits the open project, nothing leaves your computer and you can disconnect at any time.");
  const labels: Record<string, [string, string]> = {
    url: ["Endereço", "Address"], token: ["Código", "Code"], cancel: ["Cancelar", "Cancel"], connect: ["Conectar", "Connect"],
  };
  element.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    const [pt, en] = labels[node.dataset.i18n!];
    node.textContent = text(pt, en);
  });
  const form = element.querySelector("form")!;
  (form.elements.namedItem("url") as HTMLInputElement).value = defaults.url;
  const tokenInput = form.elements.namedItem("token") as HTMLInputElement;
  if (defaults.token) tokenInput.value = defaults.token;
  element.querySelector<HTMLElement>(".agent-error")!.hidden = true;
  element.showModal();
  tokenInput.focus();
}

export function installAgentAutomation(api: VctApi, language: () => Language) {
  currentApi = api;
  currentLanguage = language;
  registerWebMcpTools(api);
}

// WebMCP (em teste no Chrome): o próprio site registra as ferramentas e um agente
// do navegador pode chamá-las sem servidor local. Só ativa se a API existir.
interface ModelContextLike {
  registerTool(tool: { name: string; description: string; inputSchema: object; execute(input: Record<string, unknown>): Promise<unknown> }): unknown;
}

const WEBMCP_DESCRIPTIONS: Record<BridgeMethod, string> = {
  describe: "Describe the VCT automation API, commands and limitations.",
  getTimeline: "Compact timeline: tracks, clips (times in seconds), transitions and audio lanes.",
  getProject: "Full project JSON (large; prefer getTimeline).",
  validate: "Validate the open project.",
  listCatalog: "Effect and audio effect catalog with parameter ranges.",
  dryRun: "Simulate a command batch without changing the project. Input: {commands}.",
  batch: "Apply 1–100 commands atomically as one undo step. Input: {commands, label}.",
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

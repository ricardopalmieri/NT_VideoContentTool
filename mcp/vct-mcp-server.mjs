#!/usr/bin/env node
// Servidor MCP local do Noisetupi Video Content Tool.
//
// O agente (Claude Code, Claude Desktop ou qualquer cliente MCP) fala com este
// processo por stdio. A página do editor, aberta no navegador do usuário,
// conecta aqui por WebSocket local (127.0.0.1) quando o usuário clica em
// "Agente" e cola o código. Cada ferramenta vct_* repassa o pedido para
// window.vct na página. Nada sai do computador; sem a página conectada, as
// ferramentas respondem com instruções de conexão.
//
// Variáveis: VCT_BRIDGE_PORT (47811), VCT_BRIDGE_TOKEN (aleatório),
// VCT_EDITOR_URL, VCT_ALLOWED_ORIGINS (lista separada por vírgula).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { z } from "zod";

const PROTOCOL = "vct-bridge-1";
const PORT = Number(process.env.VCT_BRIDGE_PORT || 47811);
const TOKEN = process.env.VCT_BRIDGE_TOKEN || randomBytes(9).toString("base64url");
const EDITOR_URL = process.env.VCT_EDITOR_URL || "https://noisetupi.com.br/laboratorio/ntVideoContentTool/";
const ALLOWED_ORIGINS = (process.env.VCT_ALLOWED_ORIGINS || "https://noisetupi.com.br")
  .split(",").map((item) => item.trim()).filter(Boolean);
const REQUEST_TIMEOUT_MS = 30_000;
const log = (...args) => console.error("[vct-mcp]", ...args);

function originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function sameToken(candidate) {
  const a = Buffer.from(String(candidate || ""));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- Ponte com a página -------------------------------------------------------
let page = null;
let nextId = 1;
const pending = new Map();

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: PORT,
  maxPayload: 8 * 1024 * 1024,
  handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  verifyClient: ({ origin }, done) => (originAllowed(origin) ? done(true) : done(false, 403, "Origin not allowed")),
});

wss.on("listening", () => log(`ponte em ws://127.0.0.1:${PORT} · código ${TOKEN}`));
wss.on("error", (error) => log("erro na ponte:", error.message));
wss.on("connection", (socket) => {
  let authenticated = false;
  const helloTimer = setTimeout(() => socket.close(4401, "Sem código"), 5000);
  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!authenticated) {
      clearTimeout(helloTimer);
      if (message?.type !== "hello" || !sameToken(message.token)) return socket.close(4401, "Código inválido");
      authenticated = true;
      if (page && page !== socket) page.close(4000, "Outra aba conectou");
      page = socket;
      socket.send(JSON.stringify({ type: "welcome", server: "vct-mcp" }));
      log("página conectada");
      return;
    }
    if (message?.type !== "response") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.ok) waiter.resolve(message.result);
    else waiter.reject(new Error(message.error || "Falha na página."));
  });
  socket.on("close", () => {
    clearTimeout(helloTimer);
    if (page !== socket) return;
    page = null;
    log("página desconectada");
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("A página desconectou."));
      pending.delete(id);
    }
  });
});

function connectionHelp() {
  return `O editor não está conectado. Peça ao usuário para abrir ${EDITOR_URL}#agent=ws://127.0.0.1:${PORT}&token=${TOKEN} `
    + `(ou o editor local), abrir um projeto, clicar no botão "Agente" da barra superior e confirmar. Endereço: ws://127.0.0.1:${PORT} · código: ${TOKEN}.`;
}

function callPage(method, params = {}) {
  if (!page || page.readyState !== page.OPEN) return Promise.reject(new Error(connectionHelp()));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`A página não respondeu em ${REQUEST_TIMEOUT_MS / 1000} s (${method}).`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    page.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

// ---- Guia e skills ------------------------------------------------------------
// No pacote publicado (npx) os textos vêm embutidos pelo build; no repositório,
// são lidos de agents/. Assim qualquer cliente MCP recebe a skill do VCT.
/* global __VCT_GUIDES__ */
async function guide(name) {
  if (typeof __VCT_GUIDES__ !== "undefined") return __VCT_GUIDES__[name] || "";
  return readFile(new URL(`../agents/${name}`, import.meta.url), "utf8").catch(() => "");
}
const stripFrontMatter = (text) => text.replace(/^---[\s\S]*?---\s*/, "");

// ---- Ferramentas MCP ----------------------------------------------------------
// Respostas em JSON compacto: menos tokens para o agente.
const asText = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
const asError = (error) => ({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] });
const forward = (method, params) => callPage(method, params).then(asText, asError);

const commandSchema = z.array(z.record(z.string(), z.unknown())).min(1).max(500)
  .describe("Comandos VCT (veja vct_describe). Tempos em segundos, alinhados a frames.");

/* global __VCT_VERSION__ */
const VERSION = typeof __VCT_VERSION__ !== "undefined"
  ? __VCT_VERSION__
  : JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;

const server = new McpServer({ name: "noisetupi-vct", version: VERSION }, {
  instructions: "Edite vídeos no Noisetupi Video Content Tool aberto no navegador do usuário. "
    + "Fluxo: vct_describe (uma vez) → vct_get_timeline → planeje → vct_dry_run → vct_apply (um lote por intenção, com label) "
    + "→ vct_capture_frame para conferir → ajuste. Prefira vct_get_timeline a vct_get_project. "
    + "Remoções pedem confirmação na página. Nunca invente ids: leia da timeline. "
    + "Guia completo (motion design, VJ, safe areas): ferramenta vct_guide ou recurso vct://guia.",
});

server.registerResource("guia", "vct://guia", {
  title: "Guia do Noisetupi VCT para agentes",
  description: "Fluxo econômico em tokens, regras do editor e vocabulário de motion design e VJ.",
  mimeType: "text/markdown",
}, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: await guide("PROMPT.md") }] }));

server.registerPrompt("vct-edit", {
  title: "Editar vídeo no VCT",
  description: "Edita o projeto aberto no Noisetupi VCT (cortes, faixas, transições, textos).",
  argsSchema: { pedido: z.string().describe("O que editar, em linguagem natural.") },
}, async ({ pedido }) => ({ messages: [{ role: "user", content: { type: "text",
  text: `${stripFrontMatter(await guide("skills/vct-edit/SKILL.md"))}\n\n${await guide("PROMPT.md")}\n\nPedido do usuário: ${pedido}` } }] }));

server.registerPrompt("vct-critique", {
  title: "Revisar a edição no VCT",
  description: "Revisa ritmo, hierarquia, legibilidade e transições e propõe ajustes sem aplicar.",
}, async () => ({ messages: [{ role: "user", content: { type: "text",
  text: `${stripFrontMatter(await guide("skills/vct-critique/SKILL.md"))}\n\n${await guide("PROMPT.md")}` } }] }));

server.registerTool("vct_guide", {
  description: "Guia do VCT para agentes (fluxo, regras, motion design e VJ). Leia antes da primeira edição se o cliente não carregou o recurso vct://guia.",
  annotations: { readOnlyHint: true },
}, async () => asText(await guide("PROMPT.md")));

server.registerTool("vct_connection_info", {
  title: "Conexão com o editor",
  description: "Mostra se o editor está conectado e como conectar (endereço, código e link).",
  annotations: { readOnlyHint: true },
}, async () => asText({ connected: Boolean(page), bridge: `ws://127.0.0.1:${PORT}`, token: TOKEN, link: `${EDITOR_URL}#agent=ws://127.0.0.1:${PORT}&token=${TOKEN}`, help: page ? undefined : connectionHelp() }));

for (const [name, method, description] of [
  ["vct_describe", "describe", "Contrato da API em texto curto: todos os comandos, campos, limites e regras de tempo."],
  ["vct_get_timeline", "getTimeline", "Timeline compacta: faixas, clipes (id, nome, tipo, início/fim em s), transições e faixas de áudio."],
  ["vct_get_project", "getProject", "Projeto completo em JSON (grande; use só se a timeline não bastar)."],
  ["vct_validate", "validate", "Valida o projeto aberto."],
  ["vct_list_catalog", "listCatalog", "Catálogo de efeitos e efeitos de áudio com limites dos parâmetros."],
]) {
  server.registerTool(name, { description, annotations: { readOnlyHint: true } }, async () => forward(method, {}));
}

server.registerTool("vct_dry_run", {
  description: "Simula um lote de comandos sem alterar o projeto e devolve resultados e a timeline resultante.",
  inputSchema: { commands: commandSchema },
  annotations: { readOnlyHint: true },
}, async ({ commands }) => forward("dryRun", { commands }));

server.registerTool("vct_apply", {
  description: "Aplica 1–100 comandos numa transação (tudo ou nada) e cria um único passo de desfazer no editor.",
  inputSchema: { commands: commandSchema, label: z.string().min(1).max(120).describe("Nome curto do passo no histórico.") },
  annotations: { destructiveHint: false, idempotentHint: false },
}, async ({ commands, label }) => forward("batch", { commands, label }));

server.registerTool("vct_undo", { description: "Desfaz a última edição no editor." }, async () => forward("undo", {}));
server.registerTool("vct_redo", { description: "Refaz a última edição desfeita." }, async () => forward("redo", {}));

server.registerTool("vct_capture_frame", {
  description: "Renderiza um quadro da composição (JPEG pequeno) para conferir o resultado. Mova o playhead se time for dado.",
  inputSchema: {
    time: z.number().min(0).max(7200).optional().describe("Tempo em segundos."),
    maxWidth: z.number().int().min(64).max(1280).optional().describe("Largura máxima em px (padrão 480)."),
  },
  annotations: { readOnlyHint: true },
}, async ({ time, maxWidth }) => {
  try {
    const frame = await callPage("captureFrame", { time, maxWidth });
    const data = String(frame.dataUrl || "").replace(/^data:image\/jpeg;base64,/, "");
    return { content: [
      { type: "image", data, mimeType: "image/jpeg" },
      { type: "text", text: JSON.stringify({ time: frame.time, width: frame.width, height: frame.height }) },
    ] };
  } catch (error) {
    return asError(error);
  }
});

await server.connect(new StdioServerTransport());
log(`MCP pronto. Para conectar o editor: ${connectionHelp()}`);

const shutdown = () => {
  wss.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

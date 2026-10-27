// Ponte entre a página e um agente de IA fora do navegador (servidor MCP local).
// A página conecta por WebSocket só quando o usuário pede, envia o token que o
// servidor mostrou e passa a responder pedidos com métodos de `window.vct`.
// Nada roda sem a página aberta e a conexão ativa; desconectar encerra tudo.
import type { VctApi } from "./window-vct";

export const BRIDGE_PROTOCOL = "vct-bridge-1";

// Métodos que o agente pode chamar. Leitura, simulação, lote transacional,
// desfazer/refazer e captura de quadro. Nada de arquivos, salvar ou exportar.
export const BRIDGE_METHODS = [
  "describe", "getTimeline", "getProject", "validate", "listCatalog",
  "dryRun", "batch", "undo", "redo", "captureFrame",
] as const;
export type BridgeMethod = typeof BRIDGE_METHODS[number];

export interface BridgeResponse {
  type: "response";
  id: number | string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function isBridgeMethod(value: unknown): value is BridgeMethod {
  return typeof value === "string" && (BRIDGE_METHODS as readonly string[]).includes(value);
}

function commandList(params: Record<string, unknown>) {
  if (!Array.isArray(params.commands)) throw new Error("params.commands deve ser uma lista de comandos.");
  return params.commands;
}

// Executa um pedido do agente. Independe do transporte: recebe a API e o pedido
// já decodificado e devolve a resposta (nunca lança).
export async function handleBridgeRequest(api: VctApi, request: unknown): Promise<BridgeResponse | null> {
  if (!isRecord(request) || request.type !== "request") return null;
  const id = typeof request.id === "number" || typeof request.id === "string" ? request.id : "";
  const fail = (error: string): BridgeResponse => ({ type: "response", id, ok: false, error });
  if (id === "") return fail("Pedido sem id.");
  if (!isBridgeMethod(request.method)) return fail(`Método não permitido: ${String(request.method)}.`);
  const params = isRecord(request.params) ? request.params : {};
  try {
    let result: unknown;
    switch (request.method) {
      case "describe": result = api.describe(); break;
      case "getTimeline": result = api.getTimeline(); break;
      case "getProject": result = api.getProject(); break;
      case "validate": result = api.validate(); break;
      case "listCatalog": result = api.listCatalog(); break;
      case "dryRun": result = api.dryRun(commandList(params)); break;
      case "batch": result = api.batch(commandList(params), { label: typeof params.label === "string" ? params.label : "Agente" }); break;
      case "undo": result = api.undo(); break;
      case "redo": result = api.redo(); break;
      case "captureFrame": result = await api.captureFrame({
        time: typeof params.time === "number" ? params.time : undefined,
        maxWidth: typeof params.maxWidth === "number" ? params.maxWidth : undefined,
      }); break;
    }
    return { type: "response", id, ok: true, result };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

// Limite simples de pedidos por segundo, para um agente em loop não travar a página.
export function createRateLimiter(maxPerSecond: number, now: () => number = () => Date.now()) {
  let windowStart = now();
  let count = 0;
  return () => {
    const time = now();
    if (time - windowStart >= 1000) {
      windowStart = time;
      count = 0;
    }
    count++;
    return count <= maxPerSecond;
  };
}

// Só aceita servidor local: o token e o projeto nunca saem do computador.
export function isLocalBridgeUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "ws:" || url.protocol === "wss:")
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export interface BridgeConnectionCallbacks {
  onStatus(status: "connecting" | "connected" | "closed", detail?: string): void;
  onActivity?(method: BridgeMethod, label?: string): void;
}

export interface BridgeConnection {
  close(): void;
}

export function connectAgentBridge(api: VctApi, url: string, token: string, callbacks: BridgeConnectionCallbacks): BridgeConnection {
  if (!isLocalBridgeUrl(url)) throw new Error("O agente precisa rodar neste computador (ws://127.0.0.1:porta).");
  if (!token.trim()) throw new Error("Informe o código mostrado pelo servidor do agente.");
  const socket = new WebSocket(url, BRIDGE_PROTOCOL);
  const allow = createRateLimiter(20);
  let closedByUser = false;
  let failed = false;
  callbacks.onStatus("connecting");
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "hello", token: token.trim(), client: "vct-web", version: api.version }));
  });
  socket.addEventListener("message", async (event) => {
    let message: unknown;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (isRecord(message) && message.type === "welcome") {
      callbacks.onStatus("connected");
      return;
    }
    if (!isRecord(message) || message.type !== "request") return;
    if (!allow()) {
      socket.send(JSON.stringify({ type: "response", id: message.id, ok: false, error: "Muitos pedidos por segundo." }));
      return;
    }
    if (isBridgeMethod(message.method)) {
      const params = isRecord(message.params) ? message.params : {};
      callbacks.onActivity?.(message.method, typeof params.label === "string" ? params.label : undefined);
    }
    const response = await handleBridgeRequest(api, message);
    if (response && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(response));
  });
  socket.addEventListener("error", () => {
    failed = true;
  });
  socket.addEventListener("close", (event) => {
    if (closedByUser) return callbacks.onStatus("closed");
    const detail = event.code === 4401 ? "Código inválido."
      : failed ? "Não foi possível conectar. O servidor do agente está rodando?"
        : event.reason || "Conexão encerrada.";
    callbacks.onStatus("closed", detail);
  });
  return {
    close() {
      closedByUser = true;
      socket.close(1000, "Desconectado pelo usuário");
    },
  };
}

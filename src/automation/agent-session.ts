// Estado da sessão do agente de IA: pausa, pedidos que dependem da pessoa e
// confiança por tipo. Sem DOM: a faixa "IA editando" (agent-strip.ts) lê e
// comanda este estado, e window.vct só consulta. Nenhuma chamada da API espera
// um clique (o agente tem ~45 s por chamada): pedir devolve na hora e a
// resposta aparece em status().
export type AgentRequestKind = "save" | "export" | "import" | "open";
export const AGENT_REQUEST_KINDS: readonly AgentRequestKind[] = ["save", "export", "import", "open"];
/** Só salvar e exportar podem ser liberados "sempre": importar e abrir precisam do clique da pessoa (seletor de arquivos). */
const TRUSTABLE: readonly AgentRequestKind[] = ["save", "export"];

export interface AgentRequestOptions {
  format?: "mp4-h264" | "png-sequence";
  scale?: 1 | .75 | .5 | .25;
  message?: string;
}

export interface AgentRequest {
  kind: AgentRequestKind;
  options: AgentRequestOptions;
  /** Nome do projeto no momento do pedido (texto do usuário: escapar ao exibir). */
  subject: string;
  at: number;
}

export type AgentOutcome = "allowed" | "refused" | "done" | "failed";
export type AgentDecision = "allow" | "always" | "refuse";

export interface AgentLastResult {
  kind: AgentRequestKind;
  outcome: AgentOutcome;
  detail: string;
}

export interface AgentSessionView {
  paused: boolean;
  /** Rótulo da última chamada que muda o projeto. */
  label: string;
  /** Houve chamada nos últimos 20 s. */
  recent: boolean;
  /** A faixa fica visível: chamada recente, pausa ou pedido pendente. */
  visible: boolean;
  /** Tempo até a faixa de status se esconder (ms); 0 se já está escondida. */
  hideIn: number;
  request: (AgentRequest & { ageMs: number; trustable: boolean }) | null;
  last: AgentLastResult | null;
}

export const PAUSED_MESSAGE = "Pausado pelo usuário. Peça para ele clicar em Retomar.";
export const STRIP_IDLE_MS = 20000;
const MESSAGE_LIMIT = 200;

export type AgentRunner = (request: AgentRequest) => Promise<string | void>;

export interface AgentSession {
  readonly paused: boolean;
  setPaused(value: boolean): void;
  /** Lança se a pessoa pausou o agente. Chamar antes de qualquer chamada que muda o projeto. */
  assertRunning(): void;
  /** Marca uma chamada que muda o projeto (mostra a faixa). */
  touch(label: string): void;
  /** Registra um pedido; executa na hora só se a pessoa liberou "sempre" esse tipo. Devolve texto curto. */
  submit(kind: unknown, options: unknown, subject: string, run: AgentRunner): string;
  /** Resposta da pessoa ao pedido pendente. Chamar dentro do clique (o runner abre seletores de arquivo). */
  decide(decision: AgentDecision): void;
  view(): AgentSessionView;
  subscribe(listener: () => void): () => void;
}

function cleanOptions(kind: AgentRequestKind, raw: unknown): AgentRequestOptions {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("As opções do pedido devem ser um objeto.");
  const input = raw as Record<string, unknown>;
  const options: AgentRequestOptions = {};
  if (input.message !== undefined) {
    if (typeof input.message !== "string") throw new Error("message deve ser texto.");
    // Texto da IA mostrado à pessoa: sem quebras e curto.
    options.message = input.message.replace(/\s+/g, " ").trim().slice(0, MESSAGE_LIMIT);
  }
  if (kind === "export") {
    if (input.format !== undefined) {
      if (input.format !== "mp4-h264" && input.format !== "png-sequence") throw new Error("format deve ser mp4-h264 ou png-sequence.");
      options.format = input.format;
    }
    if (input.scale !== undefined) {
      if (input.scale !== 1 && input.scale !== .75 && input.scale !== .5 && input.scale !== .25) throw new Error("scale deve ser 1, 0.75, 0.5 ou 0.25.");
      options.scale = input.scale;
    }
  }
  return options;
}

export function createAgentSession(now: () => number = () => Date.now()): AgentSession {
  const listeners = new Set<() => void>();
  const trusted = new Set<AgentRequestKind>();
  let paused = false;
  let label = "";
  let lastCallAt = -Infinity;
  let pending: { request: AgentRequest; run: AgentRunner } | null = null;
  let last: AgentLastResult | null = null;
  const emit = () => { for (const listener of listeners) listener(); };

  const execute = (request: AgentRequest, run: AgentRunner) => {
    last = { kind: request.kind, outcome: "allowed", detail: "em andamento" };
    const settle = (outcome: AgentOutcome, detail: string) => {
      last = { kind: request.kind, outcome, detail };
      emit();
    };
    try {
      run(request).then(
        (detail) => settle("done", detail || "ok"),
        (error) => settle("failed", error instanceof Error ? error.message : String(error)),
      );
    } catch (error) {
      settle("failed", error instanceof Error ? error.message : String(error));
    }
  };

  return {
    get paused() { return paused; },
    setPaused(value) {
      if (paused === value) return;
      paused = value;
      emit();
    },
    assertRunning() {
      if (paused) throw new Error(PAUSED_MESSAGE);
    },
    touch(next) {
      label = next;
      lastCallAt = now();
      emit();
    },
    submit(kind, options, subject, run) {
      if (typeof kind !== "string" || !AGENT_REQUEST_KINDS.includes(kind as AgentRequestKind)) {
        throw new Error(`Tipo de pedido inválido. Use ${AGENT_REQUEST_KINDS.join(", ")}.`);
      }
      const requestKind = kind as AgentRequestKind;
      const request: AgentRequest = { kind: requestKind, options: cleanOptions(requestKind, options), subject: subject.slice(0, 120), at: now() };
      if (pending) throw new Error(`Já existe um pedido pendente (${pending.request.kind}). Confira vct.status().`);
      label = `Pedido: ${requestKind}`;
      lastCallAt = request.at;
      if (TRUSTABLE.includes(requestKind) && trusted.has(requestKind)) {
        execute(request, run);
        emit();
        return `Liberado pela pessoa nesta sessão: ${requestKind} em andamento. Confira vct.status().`;
      }
      pending = { request, run };
      emit();
      return `Pedido ${requestKind} enviado à pessoa. Não espere: confira vct.status().`;
    },
    decide(decision) {
      if (!pending) return;
      const { request, run } = pending;
      pending = null;
      if (decision === "refuse") {
        last = { kind: request.kind, outcome: "refused", detail: "a pessoa recusou" };
        emit();
        return;
      }
      if (decision === "always" && TRUSTABLE.includes(request.kind)) trusted.add(request.kind);
      execute(request, run);
      emit();
    },
    view() {
      const at = now();
      const age = at - lastCallAt;
      const recent = age < STRIP_IDLE_MS;
      return {
        paused,
        label,
        recent,
        visible: recent || paused || Boolean(pending),
        hideIn: recent ? STRIP_IDLE_MS - age : 0,
        request: pending ? { ...pending.request, ageMs: at - pending.request.at, trustable: TRUSTABLE.includes(pending.request.kind) } : null,
        last,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Bloco curto de status para o agente: pausa, pedido pendente, último resultado e passo de desfazer. */
export function agentStatusText(view: AgentSessionView, undoLabel: string) {
  return [
    `Pausado: ${view.paused ? "sim (mudanças bloqueadas até a pessoa clicar em Retomar)" : "não"}`,
    `Pedido pendente: ${view.request ? `${view.request.kind} há ${Math.round(view.request.ageMs / 1000)} s` : "nenhum"}`,
    `Último pedido: ${view.last ? `${view.last.kind} ${view.last.outcome} · ${view.last.detail}` : "nenhum"}`,
    `Desfazer: ${undoLabel || "nada"}`,
  ].join("\n");
}

// Faixa "IA editando" no topo do editor: mostra que o agente está mexendo no
// projeto, deixa a pessoa pausá-lo e pede a confirmação de salvar, exportar,
// importar e abrir. Tudo que vem do agente passa por escapeHtml.
import { escapeHtml } from "../ui/escape-html";
import type { AgentDecision, AgentRequestKind, AgentSession, AgentSessionView } from "./agent-session";

type Language = "pt-BR" | "en";

const FORMAT_LABEL = { "mp4-h264": "MP4 H.264", "png-sequence": "PNG + alpha (.zip)" } as const;

function requestText(request: NonNullable<AgentSessionView["request"]>, language: Language) {
  const pt = language === "pt-BR";
  const name = `<strong>${escapeHtml(request.subject)}</strong>`;
  const kinds: Record<AgentRequestKind, string> = {
    save: pt ? `A IA quer salvar o projeto ${name}.` : `The AI wants to save the project ${name}.`,
    export: pt
      ? `A IA quer exportar o projeto ${name}${request.options.format ? ` em ${FORMAT_LABEL[request.options.format]}` : ""}${request.options.scale ? ` a ${Math.round(request.options.scale * 100)}%` : ""}.`
      : `The AI wants to export the project ${name}${request.options.format ? ` as ${FORMAT_LABEL[request.options.format]}` : ""}${request.options.scale ? ` at ${Math.round(request.options.scale * 100)}%` : ""}.`,
    import: pt ? "A IA pede que você importe mídia para o projeto." : "The AI asks you to import media into the project.",
    open: pt ? "A IA pede que você abra um projeto." : "The AI asks you to open a project.",
  };
  const message = request.options.message
    ? `<span class="agent-strip-message">${pt ? "A IA diz" : "The AI says"}: “${escapeHtml(request.options.message)}”</span>`
    : "";
  return `<span class="agent-strip-text">${kinds[request.kind]}</span>${message}`;
}

function requestButtons(request: NonNullable<AgentSessionView["request"]>, language: Language) {
  const pt = language === "pt-BR";
  const button = (action: AgentDecision, label: string, primary = false) =>
    `<button type="button" data-agent-action="${action}"${primary ? ' class="primary"' : ""}>${label}</button>`;
  if (request.kind === "import" || request.kind === "open") {
    const run = request.kind === "import" ? (pt ? "Importar mídia" : "Import media") : (pt ? "Abrir projeto" : "Open project");
    return button("allow", run, true) + button("refuse", pt ? "Agora não" : "Not now");
  }
  return button("allow", pt ? "Permitir" : "Allow", true)
    + button("always", pt ? "Permitir sempre nesta sessão" : "Always allow this session")
    + button("refuse", pt ? "Recusar" : "Decline");
}

/** HTML da faixa (vazio quando não há nada a mostrar). Puro: o estado vem de session.view(). */
export function agentStripHtml(view: AgentSessionView, language: Language) {
  const pt = language === "pt-BR";
  const rows: string[] = [];
  if (view.paused || view.recent) {
    const text = view.paused
      ? `<strong>${pt ? "IA pausada" : "AI paused"}</strong>${view.label ? ` · ${escapeHtml(view.label)}` : ""}`
      : `<strong>${pt ? "IA editando" : "AI editing"}</strong>${view.label ? ` · ${escapeHtml(view.label)}` : ""}`;
    const action = view.paused
      ? `<button type="button" class="primary" data-agent-action="resume">${pt ? "Retomar" : "Resume"}</button>`
      : `<button type="button" data-agent-action="stop">${pt ? "Parar" : "Stop"}</button>`;
    rows.push(`<div class="agent-strip-row${view.paused ? " is-paused" : ""}" role="status"><span class="agent-strip-dot" aria-hidden="true"></span><span class="agent-strip-text">${text}</span>${action}</div>`);
  }
  if (view.request) {
    rows.push(`<div class="agent-strip-row is-request" role="alert">${requestText(view.request, language)}<span class="agent-strip-actions">${requestButtons(view.request, language)}</span></div>`);
  }
  return rows.join("");
}

export function installAgentStrip(session: AgentSession, language: () => Language) {
  const strip = document.createElement("div");
  strip.id = "agent-strip";
  strip.className = "agent-strip";
  strip.hidden = true;
  strip.setAttribute("aria-label", language() === "pt-BR" ? "Agente de IA" : "AI agent");
  document.body.insertBefore(strip, document.getElementById("app"));
  let shown = "";
  let timer = 0;

  const render = () => {
    window.clearTimeout(timer);
    const view = session.view();
    const html = view.visible ? agentStripHtml(view, language()) : "";
    if (view.hideIn > 0) timer = window.setTimeout(render, view.hideIn + 30);
    if (html === shown) return;
    const focused = (document.activeElement as HTMLElement | null)?.closest?.("#agent-strip") ? (document.activeElement as HTMLElement).dataset.agentAction : undefined;
    const resized = Boolean(html) !== Boolean(shown) || html.split("agent-strip-row").length !== shown.split("agent-strip-row").length;
    shown = html;
    strip.innerHTML = html;
    strip.hidden = !html;
    document.body.classList.toggle("has-agent-strip", Boolean(html));
    // Mantém o foco do teclado no botão que a pessoa estava usando (Parar vira Retomar).
    if (focused) (strip.querySelector<HTMLElement>(`[data-agent-action="${focused}"]`) ?? (focused === "stop" ? strip.querySelector<HTMLElement>('[data-agent-action="resume"]') : null))?.focus();
    // A área do editor muda de altura: o auto-ajuste do canvas escuta o resize.
    if (resized) window.dispatchEvent(new Event("resize"));
  };

  strip.addEventListener("click", (event) => {
    // Só clique ou teclado reais da pessoa: um script na página (o próprio agente) não pode se autorizar.
    if (!event.isTrusted) return;
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-agent-action]")?.dataset.agentAction;
    if (action === "stop") session.setPaused(true);
    else if (action === "resume") session.setPaused(false);
    else if (action === "allow" || action === "always" || action === "refuse") session.decide(action);
  });
  session.subscribe(render);
  render();
}

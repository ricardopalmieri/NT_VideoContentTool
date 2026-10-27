import { describe, expect, it } from "vitest";
import { agentStripHtml } from "../../src/automation/agent-strip";
import { createAgentSession, PAUSED_MESSAGE, STRIP_IDLE_MS, type AgentRequest } from "../../src/automation/agent-session";
import { createVctApi } from "../../src/automation/window-vct";
import { createProject, type ProjectDocument } from "../../src/model/types";

const settings = { name: "Teste", width: 320, height: 180, fps: 10, duration: 10, background: "#000000", transparent: false };

function setup() {
  let project: ProjectDocument = createProject(settings);
  let clock = 1000;
  const session = createAgentSession(() => clock);
  const ran: AgentRequest[] = [];
  let finish: (detail: string) => void = () => {};
  const api = createVctApi({
    getProject: () => project,
    keyframeTolerance: () => .05,
    confirmConsequential: () => true,
    commitProject: (next) => { project = next; },
    undoLabel: () => "Mover título",
    projectName: () => project.settings.name,
    runRequest: (request) => { ran.push(request); return new Promise<string>((resolve) => { finish = resolve; }); },
  }, session);
  return { api, session, ran, finish: (detail: string) => finish(detail), advance: (ms: number) => { clock += ms; } };
}

const place = [{ type: "layer.create", layerId: "titulo", kind: "text", name: "Título", startTime: 0, endTime: 3 }] as never;

describe("pausa do agente", () => {
  it("bloqueia mudanças mas não leituras", () => {
    const { api, session } = setup();
    session.setPaused(true);
    for (const call of [
      () => api.batch(place, { label: "x" }),
      () => api.dispatch(place[0]),
      () => api.plan([place], { label: "x" }),
      () => api.undo(),
      () => api.redo(),
      () => api.request("save"),
    ]) expect(call).toThrow(PAUSED_MESSAGE);
    // Leituras e simulações continuam.
    expect(() => { api.describe(); api.summary(); api.assets(); api.lint(); api.getTimeline(); api.status(); api.dryRun(place); api.plan([place], { dryRun: true }); }).not.toThrow();
    expect(api.status()).toContain("Pausado: sim");
    session.setPaused(false);
    expect(() => api.batch(place, { label: "ok" })).not.toThrow();
  });

  it("mostra a faixa por 20 s depois da última chamada e fica visível em pausa", () => {
    const { api, session, advance } = setup();
    expect(session.view().visible).toBe(false);
    api.batch(place, { label: "Cortes no ritmo" });
    expect(session.view()).toMatchObject({ visible: true, label: "Cortes no ritmo" });
    advance(STRIP_IDLE_MS - 1);
    expect(session.view().visible).toBe(true);
    advance(2);
    expect(session.view().visible).toBe(false);
    session.setPaused(true);
    expect(session.view().visible).toBe(true);
  });
});

describe("vct.request", () => {
  it("devolve na hora e o status mostra pendente, recusado e permitido", async () => {
    const { api, session, ran, finish, advance } = setup();
    const text = api.request("save");
    expect(text).toContain("vct.status()");
    expect(ran).toHaveLength(0);
    advance(5000);
    expect(api.status()).toContain("Pedido pendente: save há 5 s");

    session.decide("refuse");
    expect(ran).toHaveLength(0);
    expect(api.status()).toContain("Pedido pendente: nenhum");
    expect(api.status()).toContain("save refused");

    api.request("export", { format: "png-sequence", scale: .5 });
    session.decide("allow");
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ kind: "export", options: { format: "png-sequence", scale: .5 }, subject: "Teste" });
    expect(api.status()).toContain("export allowed");
    finish("video.mp4 · 3.2 MB");
    await Promise.resolve();
    expect(api.status()).toContain("export done · video.mp4 · 3.2 MB");
    expect(api.status()).toContain("Desfazer: Mover título");
  });

  it("registra falha do runner e rejeita pedido duplicado ou inválido", async () => {
    const { api, session } = setup();
    api.request("import", { message: "Preciso do vídeo da entrevista" });
    expect(() => api.request("save")).toThrow(/pendente/);
    session.decide("allow");
    expect(session.view().last?.outcome).toBe("allowed");
    expect(() => api.request("delete" as never)).toThrow(/inválido/);
    expect(() => api.request("export", { scale: 2 as never })).toThrow(/scale/);
    expect(() => api.request("export", { format: "gif" as never })).toThrow(/format/);
    expect(() => api.request("open", { message: 5 as never })).toThrow(/message/);
  });

  it("confiança é por tipo, só para salvar e exportar, e dura a sessão", () => {
    const { api, session, ran } = setup();
    api.request("save");
    session.decide("always");
    expect(ran).toHaveLength(1);
    // Salvar liberado: roda sem pedir de novo.
    expect(api.request("save")).toContain("Liberado");
    expect(ran).toHaveLength(2);
    expect(session.view().request).toBeNull();
    // Exportar continua pedindo.
    api.request("export");
    expect(ran).toHaveLength(2);
    expect(session.view().request?.kind).toBe("export");
    session.decide("refuse");
    // Importar e abrir nunca ficam liberados.
    api.request("import");
    session.decide("always");
    expect(ran).toHaveLength(3);
    api.request("import");
    expect(ran).toHaveLength(3);
    expect(session.view().request?.kind).toBe("import");
    // Outra sessão (recarregar a página) começa sem confiança.
    const fresh = setup();
    fresh.api.request("save");
    expect(fresh.ran).toHaveLength(0);
  });

  it("não devolve ? & = nos textos", () => {
    const { api, session } = setup();
    api.request("export", { scale: .5 });
    session.decide("allow");
    expect(api.status()).not.toMatch(/[?&=]/);
  });
});

describe("faixa do agente", () => {
  const view = (message: string) => {
    const { api, session, advance } = setup();
    api.request("import", { message });
    advance(1);
    return session.view();
  };

  it("mostra a mensagem do agente como texto, nunca como HTML", () => {
    const html = agentStripHtml(view("<img src=x onerror=alert(1)>"), "pt-BR");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Importar mídia");
    expect(html).toContain("Agora não");
  });

  it("escapa rótulo do lote e nome do projeto", () => {
    const { api, session } = setup();
    api.batch(place, { label: "<b>x</b>" });
    api.request("save");
    const html = agentStripHtml(session.view(), "pt-BR");
    expect(html).not.toContain("<b>");
    expect(html).toContain("IA editando");
    expect(html).toContain("Parar");
    expect(html).toContain("A IA quer salvar o projeto");
    expect(html).toContain("Permitir sempre nesta sessão");
    expect(html).toContain("Recusar");
  });

  it("em pausa oferece Retomar", () => {
    const { session } = setup();
    session.setPaused(true);
    const html = agentStripHtml(session.view(), "pt-BR");
    expect(html).toContain("IA pausada");
    expect(html).toContain('data-agent-action="resume"');
    expect(html).not.toContain('data-agent-action="stop"');
  });
});

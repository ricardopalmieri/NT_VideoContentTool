// Small overlay panels: quality warnings (same rules as window.vct.lint) and the
// keyboard shortcut list. Rendering and events only.
import { lintProject, type LintIssue } from "../model/lint";
import type { Language, ProjectDocument } from "../model/types";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);

export function warningCount(project: ProjectDocument) {
  const issues = lintProject(project);
  return { total: issues.length, errors: issues.filter((issue) => issue.level === "erro").length, issues };
}

/** Status bar button; hidden when there is nothing to report. */
export function renderWarningsButton(project: ProjectDocument, language: Language) {
  const { total, errors } = warningCount(project);
  if (!total) return "";
  const label = language === "pt-BR" ? `${total} aviso${total > 1 ? "s" : ""}` : `${total} warning${total > 1 ? "s" : ""}`;
  return `<button type="button" class="warnings-button ${errors ? "has-errors" : ""}" id="open-warnings" aria-haspopup="dialog">${label}</button>`;
}

const openers = new Map<string, HTMLElement | null>();

function closePanel(id: string) {
  document.getElementById(id)?.remove();
  const opener = openers.get(id);
  openers.delete(id);
  // O foco volta ao botão que abriu a janela (se ele ainda existir).
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}

function openPanel(id: string, title: string, body: string, language: Language) {
  const opener = document.activeElement instanceof HTMLElement && !document.getElementById(id)?.contains(document.activeElement) ? document.activeElement : openers.get(id) ?? null;
  closePanel(id);
  openers.set(id, opener);
  const panel = document.createElement("div");
  panel.id = id;
  panel.className = "info-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", title);
  panel.innerHTML = `<div class="info-panel-box"><header><strong>${escape(title)}</strong>
    <button type="button" data-close-panel aria-label="${language === "pt-BR" ? "Fechar" : "Close"}">×</button></header>${body}</div>`;
  panel.addEventListener("click", (event) => {
    if (event.target === panel || (event.target as HTMLElement).closest("[data-close-panel]")) closePanel(id);
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePanel(id);
    } else if (event.key === "Tab") {
      // Tab fica dentro da janela.
      const items = [...panel.querySelectorAll<HTMLElement>("button, [tabindex]")].filter((item) => !item.matches(":disabled, [tabindex='-1']"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.body.append(panel);
  panel.querySelector<HTMLElement>("[data-close-panel]")?.focus();
  return panel;
}

export function openWarningsPanel(project: ProjectDocument, language: Language, onPick: (issue: LintIssue) => void) {
  const pt = language === "pt-BR";
  const issues = lintProject(project);
  const items = issues.map((issue, index) => `<li><button type="button" data-issue="${index}" class="is-${issue.level === "erro" ? "error" : "warning"}">
    <span>${issue.level === "erro" ? (pt ? "Erro" : "Error") : (pt ? "Aviso" : "Warning")}</span>${escape(issue.message)}</button></li>`).join("");
  const panel = openPanel("warnings-panel", pt ? "Avisos do projeto" : "Project warnings",
    items ? `<ul class="info-list">${items}</ul>` : `<p>${pt ? "Nenhum problema encontrado." : "No issues found."}</p>`, language);
  panel.querySelectorAll<HTMLElement>("[data-issue]").forEach((button) => button.addEventListener("click", () => {
    onPick(issues[Number(button.dataset.issue)]);
    closePanel("warnings-panel");
  }));
}

export const SHORTCUTS: Array<[string, { "pt-BR": string; en: string }]> = [
  ["Espaço / K", { "pt-BR": "Tocar / pausar", en: "Play / pause" }],
  ["J / L", { "pt-BR": "J volta 1 s; L toca", en: "J steps back 1 s; L plays" }],
  [", / .", { "pt-BR": "Frame anterior / próximo", en: "Previous / next frame" }],
  ["Shift + , / .", { "pt-BR": "10 frames", en: "10 frames" }],
  ["Home / End", { "pt-BR": "Início / fim", en: "Start / end" }],
  ["I / O", { "pt-BR": "Início / fim da região de trabalho", en: "Work area in / out" }],
  ["Alt + X", { "pt-BR": "Limpar região de trabalho", en: "Clear work area" }],
  ["S / Ctrl + B", { "pt-BR": "Cortar no playhead", en: "Split at playhead" }],
  ["Ctrl + X / C / V", { "pt-BR": "Recortar / copiar / colar clipes", en: "Cut / copy / paste clips" }],
  ["Ctrl + D", { "pt-BR": "Duplicar camada", en: "Duplicate layer" }],
  ["Delete / Shift + Delete", { "pt-BR": "Apagar / apagar fechando o espaço (com um keyframe selecionado, apaga o keyframe)", en: "Delete / ripple delete (with a keyframe selected, deletes the keyframe)" }],
  ["Ctrl + Z / Ctrl + Shift + Z", { "pt-BR": "Desfazer / refazer", en: "Undo / redo" }],
  ["Ctrl + roda / pinça", { "pt-BR": "Zoom da timeline em torno do ponteiro", en: "Timeline zoom around the pointer" }],
  ["Alt ao arrastar", { "pt-BR": "Sem snap; em clipe, duplica", en: "No snap; on a clip, duplicates" }],
  ["Setas", { "pt-BR": "Mover camada 1 px (Shift: 10 px)", en: "Nudge layer 1 px (Shift: 10 px)" }],
  ["Ctrl + S", { "pt-BR": "Salvar", en: "Save" }],
  ["?", { "pt-BR": "Esta lista", en: "This list" }],
];

export function openShortcutsPanel(language: Language) {
  const rows = SHORTCUTS.map(([keys, label]) => `<tr><th scope="row"><kbd>${escape(keys)}</kbd></th><td>${escape(label[language])}</td></tr>`).join("");
  openPanel("shortcuts-panel", language === "pt-BR" ? "Atalhos" : "Shortcuts", `<table class="shortcut-table">${rows}</table>`, language);
}

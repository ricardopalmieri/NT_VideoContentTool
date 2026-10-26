import { listAudioEffectCatalog, listEffectCatalog } from "../model/effect-catalog";
import { runProjectCommands, type VctCommand } from "../model/commands";
import { validateProjectDocument } from "../model/validate-project";
import type { ProjectDocument } from "../model/types";

export interface VctChangeEvent {
  revision: number;
  label: string;
  commands: readonly VctCommand[];
}

export interface VctApi {
  readonly version: "1";
  getProject(): ProjectDocument;
  validate(): ReturnType<typeof validateProjectDocument>;
  listCatalog(): { effects: ReturnType<typeof listEffectCatalog>; audioEffects: ReturnType<typeof listAudioEffectCatalog> };
  query(selector: "project"): ProjectDocument;
  query(selector: "layers"): ProjectDocument["layers"];
  query(selector: { layerId: string }): ProjectDocument["layers"][number];
  dispatch(command: VctCommand): unknown;
  batch(commands: readonly VctCommand[], options?: { label?: string }): readonly unknown[];
  onChange(listener: (event: VctChangeEvent) => void): () => void;
}

export interface VctApiHost {
  getProject(): ProjectDocument | null;
  commitProject(next: ProjectDocument, label: string): void;
  keyframeTolerance(): number;
  confirmConsequential(message: string): boolean;
}

declare global {
  interface Window {
    readonly vct: VctApi;
  }
}

function activeProject(host: VctApiHost) {
  const project = host.getProject();
  if (!project) throw new Error("Nenhum projeto está aberto.");
  return project;
}

function queryProject(host: VctApiHost, selector: "project"): ProjectDocument;
function queryProject(host: VctApiHost, selector: "layers"): ProjectDocument["layers"];
function queryProject(host: VctApiHost, selector: { layerId: string }): ProjectDocument["layers"][number];
function queryProject(
  host: VctApiHost,
  selector: "project" | "layers" | { layerId: string },
): ProjectDocument | ProjectDocument["layers"] | ProjectDocument["layers"][number];
function queryProject(host: VctApiHost, selector: unknown) {
  const project = activeProject(host);
  if (selector === "project") return structuredClone(project);
  if (selector === "layers") return structuredClone(project.layers);
  if (!selector || typeof selector !== "object" || !("layerId" in selector) || typeof selector.layerId !== "string") {
    throw new Error("Seletor de consulta VCT inválido.");
  }
  const layer = project.layers.find((item) => item.id === selector.layerId);
  if (!layer) throw new Error(`Camada não encontrada: ${selector.layerId}.`);
  return structuredClone(layer);
}

export function createVctApi(host: VctApiHost): VctApi {
  const listeners = new Set<(event: VctChangeEvent) => void>();
  let revision = 0;
  const api: VctApi = {
    version: "1",
    getProject: () => structuredClone(activeProject(host)),
    validate: () => validateProjectDocument(activeProject(host)),
    listCatalog: () => structuredClone({
      effects: listEffectCatalog(),
      audioEffects: listAudioEffectCatalog(),
    }),
    query: ((selector) => queryProject(host, selector)) as VctApi["query"],
    dispatch: (command) => {
      const label = command && typeof command === "object" && "type" in command && typeof command.type === "string"
        ? command.type
        : "command";
      return api.batch([command], { label })[0];
    },
    batch: (commands, options = {}) => {
      const project = activeProject(host);
      if (!Array.isArray(commands)) throw new Error("commands deve ser uma lista.");
      const labelValue = options && typeof options === "object" ? options.label : undefined;
      if (labelValue !== undefined && typeof labelValue !== "string") throw new Error("O nome do lote deve ser texto.");
      const label = labelValue?.trim() || "VCT automation";
      if (label.length > 120) throw new Error("O nome do lote deve ter até 120 caracteres.");
      const result = runProjectCommands(project, commands, host.keyframeTolerance());
      const before = JSON.stringify(project);
      if (JSON.stringify(result.project) === before) return result.results;
      if (result.commands.some((command) => command.type === "effect.remove" || command.type === "audioEffect.remove")) {
        if (!host.confirmConsequential(`Confirmar remoção de efeito no lote "${label}"?`)) {
          throw new Error("Lote cancelado pelo usuário.");
        }
      }
      host.commitProject(result.project, label);
      revision++;
      const event = { revision, label, commands: result.commands };
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("A VCT change listener failed.", error);
        }
      }
      return result.results;
    },
    onChange: (listener) => {
      if (typeof listener !== "function") throw new Error("O listener de mudanças precisa ser uma função.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return api;
}

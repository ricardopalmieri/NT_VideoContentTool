import { listAudioEffectCatalog, listEffectCatalog } from "../model/effect-catalog";
import { runProjectCommands, type VctCommand } from "../model/commands";
import { validateProjectDocument } from "../model/validate-project";
import type { ProjectDocument } from "../model/types";
import { audioLanes, visualTracks } from "../model/clip-tracks";
import { EDITING_COMMANDS } from "../model/editing-commands";
import { AGENT_GUIDE } from "./agent-guide";

function timelineSummary(project: ProjectDocument) {
  return structuredClone({
    settings: project.settings,
    tracks: visualTracks(project).map(track => ({ id: track.id, clips: track.clips.map(layer => ({
      id: layer.id, name: layer.name, kind: layer.kind, startTime: layer.startTime, endTime: layer.endTime,
      locked: layer.locked, asset: layer.asset, text: layer.kind === 'text' ? layer.text : undefined,
      transition: layer.transition, effectIds: layer.effects.map(effect => effect.id),
    })) })),
    audio: audioLanes(project).map(lane => ({ id: lane.id, clips: lane.clips.map(track => ({
      id: track.id, name: track.name, startTime: track.startTime, endTime: track.endTime,
      linked: track.linked, linkedLayerId: track.linkedLayerId, effectIds: track.effects.map(effect => effect.id),
    })) })),
  });
}

function requiresConfirmation(commands: readonly VctCommand[]) {
  return commands.some(command => ['clip.remove', 'effect.remove', 'audioEffect.remove'].includes(command.type));
}

export interface VctChangeEvent {
  revision: number;
  label: string;
  commands: readonly VctCommand[];
}

export interface VctApi {
  readonly version: "1";
  getProject(): ProjectDocument;
  /** Guia para agentes de IA: fluxo, regras do editor, motion design e VJ. */
  guide(): string;
  describe(): { version: string; timeUnit: string; maxBatchSize: number; editingCommands: typeof EDITING_COMMANDS; methods: string[]; limitations: string[] };
  getTimeline(): ReturnType<typeof timelineSummary>;
  dryRun(commands: readonly VctCommand[]): { results: readonly unknown[]; timeline: ReturnType<typeof timelineSummary>; requiresConfirmation: boolean };
  undo(): boolean;
  redo(): boolean;
  /** Quadro renderizado da composição (JPEG pequeno) para o agente conferir o resultado. */
  captureFrame(options?: { time?: number; maxWidth?: number }): Promise<VctFrame>;
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
  assertCanEdit?(): void;
  undo?(): boolean;
  redo?(): boolean;
  captureFrame?(time: number | undefined, maxWidth: number): Promise<VctFrame>;
}

export interface VctFrame {
  time: number;
  width: number;
  height: number;
  /** data:image/jpeg;base64,… */
  dataUrl: string;
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
    guide: () => AGENT_GUIDE,
    describe: () => structuredClone({
      version: '1', timeUnit: 'seconds', maxBatchSize: 100, editingCommands: EDITING_COMMANDS,
      methods: ['guide', 'getTimeline', 'getProject', 'query', 'validate', 'listCatalog', 'dryRun', 'dispatch', 'batch', 'undo', 'redo', 'captureFrame', 'onChange'],
      limitations: ['Existing open project required', 'Runs inside the page: agents execute JavaScript in this tab (e.g. Claude in Chrome)', 'No file access/import/export', 'New clip timings must fit composition and align to frames', 'Split video requires explicit sourceOut and loop disabled', 'Deletion requires confirmation in page'],
    }),
    getTimeline: () => timelineSummary(activeProject(host)),
    dryRun: commands => {
      const result = runProjectCommands(activeProject(host), commands, host.keyframeTolerance());
      return { results: result.results, timeline: timelineSummary(result.project), requiresConfirmation: requiresConfirmation(result.commands) };
    },
    undo: () => {
      activeProject(host); host.assertCanEdit?.();
      if (!host.undo) throw new Error('Undo indisponível neste host.');
      return host.undo();
    },
    redo: () => {
      activeProject(host); host.assertCanEdit?.();
      if (!host.redo) throw new Error('Redo indisponível neste host.');
      return host.redo();
    },
    captureFrame: async (options = {}) => {
      activeProject(host);
      if (!host.captureFrame) throw new Error('Captura de quadro indisponível neste host.');
      const time = options && typeof options.time === 'number' ? options.time : undefined;
      if (time !== undefined && (!Number.isFinite(time) || time < 0 || time > 7200)) throw new Error('time deve estar entre 0 e 7200 segundos.');
      const requested = options && typeof options.maxWidth === 'number' ? options.maxWidth : 480;
      const maxWidth = Math.max(64, Math.min(1280, Math.round(Number.isFinite(requested) ? requested : 480)));
      return host.captureFrame(time, maxWidth);
    },
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
      host.assertCanEdit?.();
      const project = activeProject(host);
      if (!Array.isArray(commands)) throw new Error("commands deve ser uma lista.");
      const labelValue = options && typeof options === "object" ? options.label : undefined;
      if (labelValue !== undefined && typeof labelValue !== "string") throw new Error("O nome do lote deve ser texto.");
      const label = labelValue?.trim() || "VCT automation";
      if (label.length > 120) throw new Error("O nome do lote deve ter até 120 caracteres.");
      const result = runProjectCommands(project, commands, host.keyframeTolerance());
      const before = JSON.stringify(project);
      if (JSON.stringify(result.project) === before) return result.results;
      if (requiresConfirmation(result.commands)) {
        if (!host.confirmConsequential(`Confirmar remoção de clipe/efeito no lote "${label}"?`)) {
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

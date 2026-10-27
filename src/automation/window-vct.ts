import { listAudioEffectCatalog, listEffectCatalog } from "../model/effect-catalog";
import { MAX_COMMANDS_PER_BATCH, runProjectCommands, type VctCommand } from "../model/commands";
import { describeCommand, describeCommandsText, isConsequential } from "../model/command-registry";
import { validateProjectDocument } from "../model/validate-project";
import type { ProjectDocument } from "../model/types";
import { audioLanes, trackName, visualTracks } from "../model/clip-tracks";
import { assetsText, listAssets } from "../model/media-assets";
import { timelineText } from "../model/timeline-text";
import { lintText } from "../model/lint";
import { AGENT_GUIDE } from "./agent-guide";
import { isTranscribeLanguage, isWhisperSize, type TranscribeLanguage, type WhisperSize } from "../transcribe/model-catalog";
import { BUSY_PHASES, transcribeStatusText, transcribeStore } from "../transcribe/transcribe-state";
import { agentStatusText, createAgentSession, type AgentRequest, type AgentRequestKind, type AgentRequestOptions, type AgentSession } from "./agent-session";

function timelineSummary(project: ProjectDocument) {
  return structuredClone({
    settings: project.settings,
    tracks: visualTracks(project).map(track => ({ id: track.id, name: trackName(project, track.id), clips: track.clips.map(layer => ({
      id: layer.id, name: layer.name, kind: layer.kind, startTime: layer.startTime, endTime: layer.endTime,
      locked: layer.locked, asset: layer.asset, text: layer.kind === 'text' ? layer.text : undefined,
      transition: layer.transition, effectIds: layer.effects.map(effect => effect.id),
    })) })),
    audio: audioLanes(project).map(lane => ({ id: lane.id, name: trackName(project, lane.id), clips: lane.clips.map(track => ({
      id: track.id, name: track.name, startTime: track.startTime, endTime: track.endTime,
      linked: track.linked, linkedLayerId: track.linkedLayerId, effectIds: track.effects.map(effect => effect.id),
    })) })),
  });
}

function requiresConfirmation(commands: readonly VctCommand[]) {
  return commands.some(command => isConsequential(command.type));
}

// Rules that are not obvious from field names. Text only, without ? & or =
// (Claude in Chrome blocks those characters in returned values).
const SEMANTICS = [
  "Tempos em segundos da composição, alinhados a frames (frame dividido por fps).",
  "Fluxo curto: assets() e summary() para ler; clip.place para montar; dryRun ou plan com dryRun; batch ou plan; lint(); captureFrame para conferir.",
  "Keyframe: time em s da composição; com timeBase clip conta do início do clipe. O easing de um keyframe vale do key até o próximo; hold segura o valor e salta no próximo key.",
  "Tempos musicais: com grid definido (composition.set grid bpm), startTime endTime time duration e at aceitam bar:3.2, beat:14, bars:2 e beats:4.",
  "Efeitos de pós (rgbDelay noise glitch vhs cameraShake glow) usam ownerId __post__; os demais vão numa camada.",
  "Faixa visual: id da faixa é trackId do clipe ou o id do primeiro clipe. Índice 0 é o topo (desenhado por cima).",
  "Remoções pedem confirmação ao usuário no commit. dryRun não pede.",
  "Ids novos: curtos e legíveis. Ids derivados de corte e duplicação: novoId:audio:N e novoId:fx:N.",
];

const PAGE = 900;
let pending = "";

/** User text (clip names, titles) may contain ? & =; full-width forms read the same. */
function safeText(raw: string) {
  return raw.replace(/[?&=]/g, (character) => ({ "?": "？", "&": "＆", "=": "＝" })[character]!);
}

/** Long text comes back in pages of 900 characters; call more() for the rest. */
function paged(raw: string) {
  const text = safeText(raw);
  if (text.length <= PAGE) { pending = ""; return text; }
  pending = text.slice(PAGE);
  return `${text.slice(0, PAGE)}\n[continua: vct.more()]`;
}

const METHODS = ['guide', 'describe', 'more', 'assets', 'summary', 'lint', 'plan', 'contactSheet', 'assetSheet', 'hideSheet', 'analyzeMix', 'analyzeAudio', 'analyzeVideo', 'getTimeline', 'getProject', 'query', 'validate', 'listCatalog', 'dryRun', 'dispatch', 'batch', 'undo', 'redo', 'captureFrame', 'request', 'status', 'transcribe', 'transcript', 'onChange'];

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
  /** Sem argumento: texto curto com todos os comandos e regras. Com um tipo: campos, limites e exemplo desse comando. */
  describe(type?: string): string | ReturnType<typeof describeCommand>;
  /** Próxima página de um texto longo devolvido por describe/guide. */
  more(): string;
  /** Mídias do bin, uma por linha: id, tipo, duração, resolução, orientação, áudio, uso. */
  assets(): string;
  /** Timeline em texto curto: uma linha por faixa. */
  summary(): string;
  /** Problemas de qualidade em texto: flashes, área segura, buracos, áudio sobreposto, tempo de leitura. */
  lint(): string;
  /** Vários lotes simulados em sequência e aplicados como um passo de desfazer (ou só simulados com dryRun). */
  plan(batches: ReadonlyArray<readonly VctCommand[]>, options?: { label?: string; dryRun?: boolean }): { results: unknown[][]; summary: string; lint: string };
  /** Folha de contato da composição: vários quadros numa imagem, com o tempo em cada célula. show cobre a aba para um screenshot. */
  contactSheet(options?: SheetOptions & { times?: number[]; every?: number }): Promise<SheetResult>;
  /** Folha de contato de uma mídia do bin, sem pôr na timeline. */
  assetSheet(asset: string, options?: SheetOptions & { count?: number; times?: number[] }): Promise<SheetResult>;
  hideSheet(): void;
  /** Nível da mixagem final por trecho, fontes que soam e alerta de clipping. */
  analyzeMix(options?: { start?: number; end?: number; step?: number }): Promise<string>;
  /** BPM, offset da grade, onsets e seções de volume de uma mídia do bin. */
  analyzeAudio(asset: string): Promise<string>;
  /** Cortes de cena, brilho, cor e movimento de um vídeo do bin. */
  analyzeVideo(asset: string, options?: { step?: number }): Promise<string>;
  getTimeline(): ReturnType<typeof timelineSummary>;
  dryRun(commands: readonly VctCommand[]): { results: readonly unknown[]; timeline: ReturnType<typeof timelineSummary>; requiresConfirmation: boolean };
  undo(): boolean;
  redo(): boolean;
  /**
   * Pede algo que depende da pessoa: salvar, exportar ({ format, scale }), importar ou abrir
   * ({ message }). Devolve na hora; a pessoa responde na tela. Confira o resultado em status().
   */
  request(kind: AgentRequestKind, options?: AgentRequestOptions): string;
  /** Pausa, pedido pendente, resultado do último pedido, legenda automática e passo de desfazer, em poucas linhas. */
  status(): string;
  /**
   * Legenda automática (Whisper local no navegador): transcreve a mixagem ("mix", padrão) ou uma mídia do bin
   * (caminho de assets()). Devolve na hora; sem o modelo no navegador a pessoa vê o aviso de download e decide.
   * Acompanhe em status(); o SRT sai em transcript().
   */
  transcribe(options?: { source?: "mix" | string; language?: TranscribeLanguage; model?: WhisperSize }): Promise<string>;
  /** SRT da última legenda automática, em páginas (more()). */
  transcript(): string;
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
  /** Nome do passo que o próximo desfazer reverte ("" se não houver). */
  undoLabel?(): string;
  projectName?(): string;
  /** Começa a legenda automática (source: "mix" ou "asset:<caminho>"); devolve texto curto sem esperar a pessoa. */
  startTranscribe?(choices: { source: string; language?: TranscribeLanguage; model?: WhisperSize }): Promise<string>;
  /** Executa um pedido depois que a pessoa permitiu; devolve um detalhe curto (nome do arquivo). */
  runRequest?(request: AgentRequest): Promise<string | void>;
  captureFrame?(time: number | undefined, maxWidth: number): Promise<VctFrame>;
  /** Renders a still that waits for decode; returns a canvas copy and layers that failed. */
  stillFrame?(time: number, maxWidth: number): Promise<{ canvas: HTMLCanvasElement; notReady: string[] }>;
}

export interface SheetOptions {
  cols?: number;
  /** Largura de cada célula em px (padrão 240). */
  size?: number;
  /** true: mostra a folha sobre o editor (um screenshot basta) e não devolve dataUrl. */
  show?: boolean;
}

export interface SheetResult {
  width: number;
  height: number;
  frames: number;
  /** Quadros em que alguma camada não decodificou (marcados em vermelho). */
  notReady: string[];
  dataUrl?: string;
  note: string;
}

export interface VctFrame {
  time: number;
  width: number;
  height: number;
  /** data:image/jpeg;base64,… */
  dataUrl: string;
  /** Ids de camadas que não decodificaram a tempo e ficaram fora do quadro. */
  notReady?: string[];
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

async function sheetResult(frames: Array<{ image: CanvasImageSource; width: number; height: number; label: string; warning?: boolean }>, options: SheetOptions, size: number, notReady: string[], caption: string): Promise<SheetResult> {
  const { composeSheet, showSheet } = await import('./contact-sheet');
  const canvas = composeSheet(frames, options.cols ?? Math.min(6, Math.ceil(Math.sqrt(frames.length * 1.5))), size);
  const base = { width: canvas.width, height: canvas.height, frames: frames.length, notReady };
  if (options.show) {
    showSheet(canvas, caption);
    return { ...base, note: 'Folha na tela: tire um screenshot e depois chame hideSheet().' };
  }
  return { ...base, dataUrl: canvas.toDataURL('image/jpeg', .8), note: caption };
}

export function createVctApi(host: VctApiHost, session: AgentSession = createAgentSession()): VctApi {
  const listeners = new Set<(event: VctChangeEvent) => void>();
  let revision = 0;
  const api: VctApi = {
    version: "1",
    getProject: () => structuredClone(activeProject(host)),
    guide: () => paged(AGENT_GUIDE),
    describe: (type) => {
      if (type !== undefined) return describeCommand(type);
      return paged([
        `VCT API 1 · lote 1 a ${MAX_COMMANDS_PER_BATCH} comandos, tudo ou nada, um passo de desfazer`,
        `Métodos: ${METHODS.join(" ")}`,
        "Campos com ! são obrigatórios. Detalhe e exemplo: describe(tipo).",
        ...SEMANTICS.map((line) => `- ${line}`),
        describeCommandsText(),
        "Legenda automática: vct.transcribe começa na hora (Whisper local; o áudio não sai da máquina). Sem o modelo no navegador a pessoa vê o aviso de download. Confira status, leia o SRT com vct.transcript e aplique com text.fromSrt.",
        "Limites: projeto aberto pela pessoa. Salvar, exportar, importar e abrir só com vct.request (a pessoa confirma na tela); depois confira vct.status().",
        "Se a pessoa pausar o agente, batch plan dispatch undo redo e request falham até ela clicar em Retomar; leituras seguem.",
      ].join("\n"));
    },
    more: () => paged(pending),
    assets: () => paged(assetsText(activeProject(host))),
    summary: () => paged(timelineText(activeProject(host))),
    lint: () => paged(lintText(activeProject(host))),
    contactSheet: async (options = {}) => {
      const project = activeProject(host);
      if (!host.stillFrame) throw new Error('Folha de contato indisponível neste host.');
      const start = project.settings.workArea?.in ?? 0;
      const end = project.settings.workArea?.out ?? project.settings.duration;
      if (options.times !== undefined && !Array.isArray(options.times)) throw new Error('times deve ser uma lista de segundos.');
      if (options.every !== undefined && !(options.every > 0)) throw new Error('every deve ser maior que zero.');
      const last = end - 1 / project.settings.fps;
      const every = options.every ?? Math.max(1 / project.settings.fps, (last - start) / 11);
      const requested = Math.floor((last - start) / every + 1e-9) + 1;
      // Acima de 48 quadros a folha se espalha pelo trecho todo em vez de parar no meio.
      const spread = !options.times?.length && requested > 48;
      const step = spread ? (last - start) / 47 : every;
      const times = (options.times?.length ? options.times : Array.from({ length: Math.min(48, requested) }, (_, index) => Math.min(last, start + index * step)))
        .filter((time) => Number.isFinite(time) && time >= 0 && time <= project.settings.duration).slice(0, 48);
      if (!times.length) throw new Error('Nenhum tempo válido para a folha.');
      const size = Math.max(80, Math.min(480, Math.round(options.size ?? 240)));
      const frames = [];
      const notReady: string[] = [];
      for (const time of times) {
        const still = await host.stillFrame(time, size);
        if (still.notReady.length) notReady.push(`${time.toFixed(2)} s: ${still.notReady.join(' ')}`);
        frames.push({ image: still.canvas, width: still.canvas.width, height: still.canvas.height, label: `${time.toFixed(2)} s`, warning: still.notReady.length > 0 });
      }
      return sheetResult(frames, options, size, notReady, `Composição: ${times.length} quadros${spread ? ` a cada ${step.toFixed(2)} s (limite de 48; pedido: ${requested})` : ''}`);
    },
    assetSheet: async (asset, options = {}) => {
      const project = activeProject(host);
      const { assetFrames } = await import('./contact-sheet');
      const size = Math.max(80, Math.min(480, Math.round(options.size ?? 240)));
      const frames = await assetFrames(asset, { count: options.count, times: options.times, duration: project.assetMetadata?.[asset]?.duration });
      return sheetResult(frames, options, size, frames.filter((frame) => frame.warning).map((frame) => frame.label), `${asset}: ${frames.length} quadros`);
    },
    hideSheet: () => {
      void import('./contact-sheet').then(({ hideSheet }) => hideSheet());
    },
    analyzeMix: async (options = {}) => {
      const { analyzeMixText } = await import('./agent-analysis');
      const project = activeProject(host);
      return paged(await analyzeMixText(project, options.start ?? 0, options.end ?? project.settings.duration, Math.max(.1, options.step ?? .5)));
    },
    analyzeVideo: async (asset, options = {}) => {
      activeProject(host);
      const { analyzeVideoText } = await import("./agent-analysis");
      return paged(await analyzeVideoText(asset, Math.max(.1, Math.min(10, options.step ?? .5))));
    },
    analyzeAudio: async (asset) => {
      activeProject(host);
      const { analyzeAudioText } = await import('./agent-analysis');
      return paged(await analyzeAudioText(asset));
    },
    plan: (batches, options = {}) => {
      if (!Array.isArray(batches) || !batches.length || batches.length > 50) throw new Error("plan espera de 1 a 50 lotes.");
      const source = activeProject(host);
      let draft = source;
      const results: unknown[][] = [];
      const commands: VctCommand[] = [];
      batches.forEach((batch, index) => {
        try {
          const step = runProjectCommands(draft, batch, host.keyframeTolerance());
          draft = step.project;
          results.push(step.results as unknown[]);
          commands.push(...step.commands);
        } catch (error) {
          throw new Error(`Lote ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      const report = { results, summary: paged(timelineText(draft)), lint: lintText(draft) };
      if (options.dryRun) return report;
      session.assertRunning();
      host.assertCanEdit?.();
      const label = options.label?.trim() || "Plano do agente";
      session.touch(label);
      if (requiresConfirmation(commands) && !host.confirmConsequential(`Confirmar remoção de clipe/efeito no plano "${label}"?`)) {
        throw new Error("Plano cancelado pelo usuário.");
      }
      if (JSON.stringify(draft) !== JSON.stringify(source)) {
        host.commitProject(draft, label);
        revision++;
        const event = { revision, label, commands };
        for (const listener of listeners) {
          try { listener(event); } catch (error) { console.error("A VCT change listener failed.", error); }
        }
      }
      return report;
    },
    getTimeline: () => timelineSummary(activeProject(host)),
    dryRun: commands => {
      const result = runProjectCommands(activeProject(host), commands, host.keyframeTolerance());
      return { results: result.results, timeline: timelineSummary(result.project), requiresConfirmation: requiresConfirmation(result.commands) };
    },
    undo: () => {
      session.assertRunning();
      activeProject(host); host.assertCanEdit?.();
      session.touch("Desfazer");
      if (!host.undo) throw new Error('Undo indisponível neste host.');
      return host.undo();
    },
    redo: () => {
      session.assertRunning();
      activeProject(host); host.assertCanEdit?.();
      session.touch("Refazer");
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
      session.assertRunning();
      host.assertCanEdit?.();
      const project = activeProject(host);
      if (!Array.isArray(commands)) throw new Error("commands deve ser uma lista.");
      const labelValue = options && typeof options === "object" ? options.label : undefined;
      if (labelValue !== undefined && typeof labelValue !== "string") throw new Error("O nome do lote deve ser texto.");
      const label = labelValue?.trim() || "VCT automation";
      if (label.length > 120) throw new Error("O nome do lote deve ter até 120 caracteres.");
      session.touch(label);
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
    request: (kind, options) => {
      session.assertRunning();
      if (!host.runRequest) throw new Error("Pedidos indisponíveis neste host.");
      // Salvar, exportar e importar precisam de projeto; abrir funciona sem ele.
      if (kind !== "open") activeProject(host);
      const run = host.runRequest.bind(host);
      return safeText(session.submit(kind, options, host.projectName?.() ?? "", run));
    },
    status: () => {
      const job = transcribeStore.get();
      return safeText([agentStatusText(session.view(), host.undoLabel?.() ?? ""), job.phase === "idle" ? "" : transcribeStatusText(job)].filter(Boolean).join("\n"));
    },
    transcribe: async (options = {}) => {
      session.assertRunning();
      const project = activeProject(host);
      if (!host.startTranscribe) throw new Error("Legenda automática indisponível neste host.");
      if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("As opções devem ser um objeto.");
      const { source = "mix", language, model } = options;
      if (typeof source !== "string") throw new Error("source deve ser mix ou o caminho de uma mídia (veja assets()).");
      if (source !== "mix" && !listAssets(project).some((entry) => entry.id === source && (entry.kind === "audio" || entry.kind === "video"))) {
        throw new Error("source deve ser mix ou o caminho de um áudio ou vídeo do bin (veja assets()).");
      }
      if (language !== undefined && !isTranscribeLanguage(language)) throw new Error("language deve ser pt, en, es ou auto.");
      if (model !== undefined && !isWhisperSize(model)) throw new Error("model deve ser base (rápido, 80 MB) ou small (preciso, 252 MB).");
      if (BUSY_PHASES.includes(transcribeStore.get().phase)) throw new Error("Já existe uma legenda automática em andamento. Confira vct.status().");
      session.touch("Legenda automática");
      return safeText(await host.startTranscribe({ source: source === "mix" ? "mix" : `asset:${source}`, language, model }));
    },
    transcript: () => {
      const { srt } = transcribeStore.get();
      return srt ? paged(srt) : "Nenhuma legenda automática pronta. Chame vct.transcribe() e confira vct.status().";
    },
    onChange: (listener) => {
      if (typeof listener !== "function") throw new Error("O listener de mudanças precisa ser uma função.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return api;
}

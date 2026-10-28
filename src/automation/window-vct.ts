import { listAudioEffectCatalog, listEffectCatalog } from "../model/effect-catalog";
import { runProjectCommands, type VctCommand } from "../model/commands";
import { isConsequential } from "../model/command-registry";
import { validateProjectDocument } from "../model/validate-project";
import type { ProjectDocument } from "../model/types";
import { audioLanes, trackName, visualTracks } from "../model/clip-tracks";
import { assetsText, listAssets } from "../model/media-assets";
import { timelineText } from "../model/timeline-text";
import { lintText } from "../model/lint";
import { AGENT_GUIDE } from "./agent-guide";
import { describeTopic, type DescribeFormat, type DescribeJson } from "./describe";
import { safeDeep, safeText } from "./safe-text";
import { failureMessage, failureReport, newIds, newWarnings, reportText, type RunFormat, type VctRunReport } from "./run-report";
import { isTranscribeLanguage, isWhisperSize, type TranscribeLanguage, type WhisperSize } from "../transcribe/model-catalog";
import { BUSY_PHASES, cancelTranscribeJob, transcribeStatusText, transcribeStore } from "../transcribe/transcribe-state";
import { agentStatusText, createAgentSession, type AgentRequest, type AgentRequestKind, type AgentRequestOptions, type AgentSession } from "./agent-session";

export type { RunFormat, VctRunReport } from "./run-report";

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

const PAGE = 900;
let pending = "";

/** Long text comes back in pages of 900 characters; call more() for the rest. */
function paged(raw: string) {
  const text = safeText(raw);
  if (text.length <= PAGE) { pending = ""; return text; }
  pending = text.slice(PAGE);
  return `${text.slice(0, PAGE)}\n[continua: vct.more()]`;
}

const METHODS = ['guide', 'describe', 'more', 'assets', 'summary', 'lint', 'plan', 'contactSheet', 'assetSheet', 'hideSheet', 'analyzeMix', 'analyzeAudio', 'analyzeVideo', 'getTimeline', 'getProject', 'query', 'validate', 'listCatalog', 'dryRun', 'dispatch', 'batch', 'undo', 'redo', 'captureFrame', 'view', 'request', 'status', 'transcribe', 'cancelTranscribe', 'transcript', 'onChange'];

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
  /**
   * Sem argumento: índice de uma página (grupos, comandos, campos obrigatórios). Com um tipo de comando: campos, limites e
   * exemplo em texto. 'props texto' (forma, imagem, video, guia, audio, composicao): propriedades que layer.set aceita.
   * 'regras' e 'tudo' (texto completo, em páginas). { format: 'json' } devolve objeto em vez de texto.
   */
  describe(topic?: string, options?: { format?: "text" }): string;
  describe(topic: string | undefined, options: { format: "json" }): DescribeJson;
  describe(options: { format: "json" }): DescribeJson;
  /** Próxima página de um texto longo devolvido por describe/guide. */
  more(): string;
  /** Mídias do bin, uma por linha: id, tipo, duração, resolução, orientação, áudio, uso. */
  assets(): string;
  /** Timeline em texto curto: uma linha por faixa. */
  summary(): string;
  /** Problemas de qualidade em texto: flashes, área segura, buracos, áudio sobreposto, tempo de leitura. */
  lint(): string;
  /**
   * Vários lotes simulados em sequência e aplicados como um passo de desfazer (ou só simulados com dryRun).
   * Devolve texto curto (ok · N comandos · desfazer: nome · avisos) ou "erro no lote 2, comando 3 (tipo): causa"; nunca lança por comando
   * inválido. { format: 'json' }: { ok, errors, warnings, results }.
   */
  plan(batches: ReadonlyArray<readonly VctCommand[]>, options?: { label?: string; dryRun?: boolean; format?: "text" }): string;
  plan(batches: ReadonlyArray<readonly VctCommand[]>, options: { label?: string; dryRun?: boolean; format: "json" }): VctRunReport;
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
  /** Simula sem mudar o projeto: "ok (simulação) · N comandos" ou o erro. { format: 'json' } soma timeline e requiresConfirmation. */
  dryRun(commands: readonly VctCommand[], options?: { format?: "text" }): string;
  dryRun(commands: readonly VctCommand[], options: { format: "json" }): VctRunReport & { timeline?: ReturnType<typeof timelineSummary> };
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
   * start e end (segundos da mixagem ou do arquivo) limitam o trecho; words liga os tempos por palavra
   * (padrão: só em mídia de até 5 min). O áudio vai em blocos de cerca de 5 min, sem áudio inteiro no motor.
   * Acompanhe em status() (bloco N de M e tempo restante); o SRT sai em transcript(), já com os blocos prontos.
   */
  transcribe(options?: { source?: "mix" | string; language?: TranscribeLanguage; model?: WhisperSize; start?: number; end?: number; words?: boolean }): Promise<string>;
  /** Cancela a legenda automática em andamento (ou parada); o que já foi transcrito continua em transcript(). */
  cancelTranscribe(): string;
  /** SRT da última legenda automática (parcial enquanto roda), em páginas (more()). */
  transcript(): string;
  /** Quadro renderizado da composição (JPEG pequeno) para o agente conferir o resultado. show: mostra o quadro na tela (screenshot) e devolve só uma nota. */
  captureFrame(options?: { time?: number; maxWidth?: number; show?: false }): Promise<VctFrame>;
  captureFrame(options: { time?: number; maxWidth?: number; show: true }): Promise<Omit<VctFrame, "dataUrl"> & { note: string }>;
  /**
   * Vista de diagnóstico, só na tela (não muda o projeto nem o desfazer): solo mostra uma camada (null volta), bypassEffects
   * desliga os efeitos. view({}) volta ao normal; view() só informa. Devolve o estado em texto.
   */
  view(options?: { solo?: string | null; bypassEffects?: boolean }): string;
  validate(): ReturnType<typeof validateProjectDocument>;
  listCatalog(): { effects: ReturnType<typeof listEffectCatalog>; audioEffects: ReturnType<typeof listAudioEffectCatalog> };
  query(selector: "project"): ProjectDocument;
  query(selector: "layers"): ProjectDocument["layers"];
  query(selector: { layerId: string }): ProjectDocument["layers"][number];
  dispatch(command: VctCommand, options?: { format?: "text" }): string;
  dispatch(command: VctCommand, options: { format: "json" }): VctRunReport;
  /** Lote de 1 a 500 comandos, tudo ou nada, um passo de desfazer. Texto curto por padrão; { format: 'json' } devolve { ok, errors, warnings, results }. */
  batch(commands: readonly VctCommand[], options?: { label?: string; format?: "text" }): string;
  batch(commands: readonly VctCommand[], options: { label?: string; format: "json" }): VctRunReport;
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
  startTranscribe?(choices: { source: string; language?: TranscribeLanguage; model?: WhisperSize; range?: { start: number; end?: number }; words?: boolean }): Promise<string>;
  /** Executa um pedido depois que a pessoa permitiu; devolve um detalhe curto (nome do arquivo). */
  runRequest?(request: AgentRequest): Promise<string | void>;
  captureFrame?(time: number | undefined, maxWidth: number): Promise<VctFrame>;
  /** Vista de diagnóstico no preview (camada isolada, efeitos desligados); não altera o projeto. */
  setDiagnostics?(state: { soloLayerId: string | null; bypassEffects: boolean }): void;
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
  const NORMAL_VIEW = { soloLayerId: null as string | null, bypassEffects: false };
  let view = NORMAL_VIEW;
  const viewText = () => view.soloLayerId === null && !view.bypassEffects
    ? "vista: normal"
    : `vista: ${[view.soloLayerId ? `solo ${view.soloLayerId}` : "", view.bypassEffects ? "efeitos desligados" : ""].filter(Boolean).join(", ")}. Só a tela muda; view({}) volta ao normal.`;
  function applyView(next: typeof NORMAL_VIEW) {
    if (next.soloLayerId === view.soloLayerId && next.bypassEffects === view.bypassEffects) return;
    if (!host.setDiagnostics) throw new Error("Vista de diagnóstico indisponível neste host.");
    host.setDiagnostics({ soloLayerId: next.soloLayerId, bypassEffects: next.bypassEffects });
    view = next;
  }

  function notify(label: string, commands: readonly VctCommand[]) {
    revision++;
    const event = { revision, label, commands };
    for (const listener of listeners) {
      try { listener(event); } catch (error) { console.error("A VCT change listener failed.", error); }
    }
  }

  /** Runs one or more batches against a draft; commits (all or nothing) unless dry. Command failures come back as text or json, never thrown. */
  function execute(batches: ReadonlyArray<readonly unknown[]>, run: { dry: boolean; plan: boolean; label: string; format: RunFormat }): string | (VctRunReport & { timeline?: ReturnType<typeof timelineSummary> }) {
    const source = activeProject(host);
    if (!run.dry) {
      session.assertRunning();
      host.assertCanEdit?.();
      session.touch(run.label);
    }
    const fail = (message: string) => run.format === "json" ? failureReport(message) : message;
    let draft = source;
    const results: unknown[] = [];
    const commands: VctCommand[] = [];
    let batchIndex = 0;
    try {
      for (; batchIndex < batches.length; batchIndex++) {
        const step = runProjectCommands(draft, batches[batchIndex], host.keyframeTolerance());
        draft = step.project;
        if (run.plan) results.push(step.results); else results.push(...step.results);
        commands.push(...step.commands);
      }
    } catch (error) {
      return fail(failureMessage(error, run.plan ? batchIndex : undefined));
    }
    const confirms = requiresConfirmation(commands);
    const changed = JSON.stringify(draft) !== JSON.stringify(source);
    if (!run.dry && changed) {
      if (confirms && !host.confirmConsequential(`Confirmar remoção de clipe/efeito no ${run.plan ? "plano" : "lote"} "${run.label}"?`)) {
        return fail(`erro: ${run.plan ? "Plano" : "Lote"} cancelado pelo usuário.`);
      }
      host.commitProject(draft, run.label);
      // Um solo numa camada que sumiu deixaria a tela vazia.
      if (view.soloLayerId && !draft.layers.some((layer) => layer.id === view.soloLayerId)) applyView(NORMAL_VIEW);
      notify(run.label, commands);
    }
    const created = changed || run.dry ? newIds(source, draft) : [];
    const warnings = changed || run.dry ? newWarnings(source, draft) : [];
    if (run.format === "text") {
      return reportText({ dry: run.dry, commands: commands.length, batches: run.plan ? batches.length : undefined, changed, label: run.label, created, warnings, requiresConfirmation: confirms });
    }
    const report: VctRunReport & { timeline?: ReturnType<typeof timelineSummary> } = { ok: true, errors: [], warnings, results, created };
    if (!run.dry && changed) report.undo = run.label;
    if (run.dry) {
      report.requiresConfirmation = confirms;
      if (!run.plan) report.timeline = timelineSummary(draft);
    }
    return report;
  }

  const api: VctApi = {
    version: "1",
    getProject: () => structuredClone(activeProject(host)),
    guide: () => paged(AGENT_GUIDE),
    describe: ((topic?: unknown, options?: unknown) => {
      const asOptions = topic !== null && typeof topic === "object" ? topic : options;
      if (topic !== undefined && typeof topic !== "string" && asOptions !== topic) throw new Error("describe espera o nome de um comando ou tema.");
      const result = describeTopic(typeof topic === "string" ? topic : undefined, formatOf(asOptions) as DescribeFormat, METHODS);
      return typeof result === "string" ? paged(result) : result;
    }) as VctApi["describe"],
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
    plan: ((batches: ReadonlyArray<readonly VctCommand[]>, options: { label?: string; dryRun?: boolean; format?: string } = {}) => {
      if (!Array.isArray(batches) || !batches.length || batches.length > 50) throw new Error("plan espera de 1 a 50 lotes.");
      return execute(batches, { dry: options?.dryRun === true, plan: true, label: labelOf(options, "Plano do agente"), format: formatOf(options) });
    }) as VctApi["plan"],
    getTimeline: () => timelineSummary(activeProject(host)),
    dryRun: ((commands: readonly VctCommand[], options?: unknown) => {
      if (!Array.isArray(commands)) throw new Error("commands deve ser uma lista.");
      return execute([commands], { dry: true, plan: false, label: "", format: formatOf(options) });
    }) as VctApi["dryRun"],
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
    captureFrame: (async (options: { time?: number; maxWidth?: number; show?: boolean } = {}) => {
      activeProject(host);
      if (!host.captureFrame) throw new Error('Captura de quadro indisponível neste host.');
      const time = options && typeof options.time === 'number' ? options.time : undefined;
      if (time !== undefined && (!Number.isFinite(time) || time < 0 || time > 7200)) throw new Error('time deve estar entre 0 e 7200 segundos.');
      const show = options?.show === true;
      const requested = options && typeof options.maxWidth === 'number' ? options.maxWidth : show ? 960 : 480;
      const maxWidth = Math.max(64, Math.min(1280, Math.round(Number.isFinite(requested) ? requested : 480)));
      const frame = await host.captureFrame(time, maxWidth);
      if (!show) return frame;
      const { showFrame } = await import('./contact-sheet');
      await showFrame(frame);
      const { dataUrl: _image, ...shown } = frame;
      return { ...shown, note: 'Quadro na tela: tire um screenshot e depois chame hideSheet().' };
    }) as VctApi["captureFrame"],
    view: (options) => {
      activeProject(host);
      if (options === undefined) return viewText();
      if (options === null || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((key) => key !== "solo" && key !== "bypassEffects")) {
        throw new Error("view espera { solo, bypassEffects } ou {} para voltar ao normal.");
      }
      const next = Object.keys(options).length === 0 ? NORMAL_VIEW : {
        soloLayerId: "solo" in options ? options.solo ?? null : view.soloLayerId,
        bypassEffects: "bypassEffects" in options ? options.bypassEffects === true : view.bypassEffects,
      };
      if (next.soloLayerId !== null && (typeof next.soloLayerId !== "string" || !activeProject(host).layers.some((layer) => layer.id === next.soloLayerId))) {
        throw new Error(`solo precisa ser o id de uma camada (veja summary()): ${String(next.soloLayerId)}.`);
      }
      applyView(next);
      return viewText();
    },
    validate: () => validateProjectDocument(activeProject(host)),
    listCatalog: () => structuredClone({
      effects: listEffectCatalog(),
      audioEffects: listAudioEffectCatalog(),
    }),
    query: ((selector) => queryProject(host, selector)) as VctApi["query"],
    dispatch: ((command: VctCommand, options?: unknown) => {
      const label = command && typeof command === "object" && "type" in command && typeof command.type === "string" ? command.type : "command";
      return execute([[command]], { dry: false, plan: false, label, format: formatOf(options) });
    }) as VctApi["dispatch"],
    batch: ((commands: readonly VctCommand[], options?: { label?: string; format?: string }) => {
      if (!Array.isArray(commands)) throw new Error("commands deve ser uma lista.");
      return execute([commands], { dry: false, plan: false, label: labelOf(options, "VCT automation"), format: formatOf(options) });
    }) as VctApi["batch"],
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
      const { source = "mix", language, model, start, end, words } = options;
      if (typeof source !== "string") throw new Error("source deve ser mix ou o caminho de uma mídia (veja assets()).");
      if (source !== "mix" && !listAssets(project).some((entry) => entry.id === source && (entry.kind === "audio" || entry.kind === "video"))) {
        throw new Error("source deve ser mix ou o caminho de um áudio ou vídeo do bin (veja assets()).");
      }
      if (language !== undefined && !isTranscribeLanguage(language)) throw new Error("language deve ser pt, en, es ou auto.");
      if (model !== undefined && !isWhisperSize(model)) throw new Error("model deve ser base (rápido, 80 MB) ou small (preciso, 252 MB).");
      for (const [name, value] of [["start", start], ["end", end]] as const) {
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error(`${name} deve ser um número de segundos, zero ou mais.`);
      }
      if (end !== undefined && end <= (start ?? 0)) throw new Error("end deve ser maior que start.");
      if (words !== undefined && typeof words !== "boolean") throw new Error("words deve ser true ou false.");
      if (BUSY_PHASES.includes(transcribeStore.get().phase)) throw new Error("Já existe uma legenda automática em andamento. Confira vct.status() ou cancele com vct.cancelTranscribe().");
      session.touch("Legenda automática");
      const range = start !== undefined || end !== undefined ? { start: start ?? 0, end } : undefined;
      return safeText(await host.startTranscribe({ source: source === "mix" ? "mix" : `asset:${source}`, language, model, range, words }));
    },
    cancelTranscribe: () => {
      const had = transcribeStore.get().cues;
      if (!cancelTranscribeJob()) return "Nenhuma legenda automática em andamento.";
      return safeText(`Legenda automática cancelada.${had ? ` ${had} legendas dos blocos prontos continuam em vct.transcript().` : ""}`);
    },
    transcript: () => {
      // Só o SRT, sem cabeçalho: o agente aplica este texto com text.fromSrt. Se é parcial, status() diz.
      const { srt } = transcribeStore.get();
      return srt ? paged(srt) : "Nenhuma legenda automática pronta. Chame vct.transcribe() e confira vct.status().";
    },
    onChange: (listener) => {
      if (typeof listener !== "function") throw new Error("O listener de mudanças precisa ser uma função.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  // Tudo que sai de window.vct passa pelo filtro de ? & = (texto, objetos e mensagens de erro).
  for (const key of Object.keys(api) as Array<keyof VctApi>) {
    const method = api[key];
    if (typeof method !== "function" || key === "onChange") continue;
    (api as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => filtered(() => (method as (...parameters: unknown[]) => unknown)(...args));
  }
  return api;
}

function cleanError(error: unknown) {
  if (error instanceof Error) error.message = safeText(error.message);
  return error;
}

function filtered(call: () => unknown): unknown {
  try {
    const result = call();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(safeDeep, (error) => { throw cleanError(error); });
    }
    return safeDeep(result);
  } catch (error) {
    throw cleanError(error);
  }
}

function formatOf(options: unknown): RunFormat {
  const format = options !== null && typeof options === "object" ? (options as { format?: unknown }).format : undefined;
  if (format === undefined || format === "text" || format === "json") return format ?? "text";
  throw new Error("format deve ser text ou json.");
}

function labelOf(options: unknown, fallback: string) {
  const value = options !== null && typeof options === "object" ? (options as { label?: unknown }).label : undefined;
  if (value !== undefined && typeof value !== "string") throw new Error("O nome do lote deve ser texto.");
  const label = value?.trim() || fallback;
  if (label.length > 120) throw new Error("O nome do lote deve ter até 120 caracteres.");
  return label;
}

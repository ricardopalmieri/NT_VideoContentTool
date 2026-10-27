import { clamp } from "../model/math";
import { normalizeFades, setFadeHandle } from "../timeline/timing";
import { formatDurationValue, parseDurationValue, type DurationUnit } from "../timeline/timecode";
import { formatRulerTime, rulerTicks } from "../timeline/ruler";
import { exportRange } from "../export/export-range";
import { openShortcutsPanel, openWarningsPanel, renderWarningsButton } from "./info-panels";
import { sourceTimeFor } from "../renderer/source-time";
import { installAgentAutomation, openAgentPanel } from "../automation/agent-panel";
import { audioLanes, clipNeighbors, copyClips, laneIdOf, overlapsTrack, trackIdOf, trackName, visualTracks, type ClipboardClips } from "../model/clip-tracks";
import { assetKindOf, listAssets, type BinEntry } from "../model/media-assets";
import { BIN_DRAG_TYPE, IMPORT_ACCEPT, bindMediaBin, openImportProgress, renderMediaBin, type BinActions, type BinView } from "./media-bin";
import { binThumbnail, ensureThumbnail, probeMedia } from "./media-probe";
import { autoTransitionsForOverlap, DEFAULT_TRANSITION_DURATION, isTransitionType, syncTransitionAudioFades, transitionWindow, TRANSITION_TYPES, type TransitionType } from "../model/transitions";
import { gridTimes, tapTempo, timelineSnapCandidates as collectTimelineSnapCandidates, snapTimelineTime as calculateTimelineSnap } from "../timeline/snapping";
import { migrateProject } from "../model/migrate-project";
import { UndoHistory } from "../model/undo-history";
import {
  AUDIO_EFFECT_CATALOG,
  AUDIO_EFFECT_PARAMETERS,
  EFFECT_CATALOG,
  EFFECT_PARAMETERS,
  type EffectParameterDefinition,
} from "../model/effect-catalog";
import { createVctApi, type VctApi } from "../automation/window-vct";
import { runProjectCommands, type VctCommand } from "../model/commands";
import { keyframeAt as findKeyframeAt } from "../model/keyframes";
import { translate, type TranslationKey } from "../i18n";
import { ComposerRenderer } from "../renderer/composer-renderer";
import { AudioTimelineEngine, mixProjectAudio, probeAudio, sliceAudioBuffer } from "../audio/audio-engine";
import {
  chooseFile,
  chooseFiles,
  assetSourceMetadata,
  collectWebProject,
  clearProjectRecovery,
  createWebProject,
  discardProjectRecovery,
  findRelinkFile,
  hasWebAsset,
  importWebAsset,
  openWebProject,
  readProjectRecovery,
  registerWebAsset,
  resolveAssetUrl,
  saveProjectRecovery,
  saveWebProject,
} from "../io/web-platform";
import {
  copyFrame,
  createExportCanvas,
  Mp4BrowserExporter,
  PngSequenceBrowserExporter,
} from "../export/browser-export";
import {
  createProject,
  uid,
  type Easing,
  type AudioEffectKind,
  type AudioEffectNode,
  type AudioTrack,
  type EffectKind,
  type EffectNode,
  type InputKind,
  type Keyframe,
  type Language,
  type Layer,
  type OpenProjectResult,
  type ProjectDocument,
  type ProjectSettings,
} from "../model/types";

const app = document.querySelector<HTMLDivElement>("#app")!;
const APP_VERSION = __APP_VERSION__;
const COMPOSITION_PRESETS = [
  { group: "Instagram", label: "FEED SQUARE", width: 1080, height: 1080 },
  { group: "Instagram", label: "FEED PORTRAIT", width: 1080, height: 1350 },
  { group: "Instagram", label: "STORIES / REELS", width: 1080, height: 1920 },
  { group: "TikTok", label: "VERTICAL VIDEO", width: 1080, height: 1920 },
  { group: "YouTube", label: "VIDEO 16:9", width: 1920, height: 1080 },
  { group: "YouTube", label: "SHORTS", width: 1080, height: 1920 },
  { group: "Facebook", label: "FEED SQUARE", width: 1080, height: 1080 },
  { group: "Facebook", label: "LANDSCAPE", width: 1280, height: 720 },
  { group: "Facebook", label: "STORIES / REELS", width: 1080, height: 1920 },
  { group: "LinkedIn", label: "LANDSCAPE", width: 1920, height: 1080 },
  { group: "LinkedIn", label: "SQUARE", width: 1080, height: 1080 },
  { group: "X", label: "LANDSCAPE", width: 1280, height: 720 },
] as const;
document.addEventListener("contextmenu", (event) => event.preventDefault());
let language: Language = (localStorage.getItem("nt-vct-language") as Language) || "pt-BR";
let project: ProjectDocument | null = null;
let automationApi: VctApi;
let projectRoot = "";
let projectJsonPath = "";
let selectedLayerId = "";
let selectedAudioTrackId = "";
let selectedEffectId = "";
let currentTime = 0;
let playing = false;
let playbackStarted = 0;
let playbackOffset = 0;
let playbackGeneration = 0;
let lastPlaybackFrame = -1;
let playbackDroppedFrames = 0;
let previewQuality = localStorage.getItem("nt-vct-preview-quality") || "auto";
let adaptivePreviewScale = Number(localStorage.getItem("nt-vct-adaptive-preview-scale")) || .75;
let previewFastFrames = 0;
let previewSlowFrames = 0;
let lastPreviewScaleChangeAt = 0;
let timelineLoop = false;
let recordMode = false;
let timelineZoomX = Number(localStorage.getItem("nt-vct-timeline-zoom-x")) || 1;
// Tempo em que o último snap travou (guia vertical durante arrastos); null quando não travou.
let lastSnap: number | null = null;
let timelineZoomTimer = 0;
let durationUnit: DurationUnit = localStorage.getItem("nt-vct-duration-unit") === "frames" ? "frames" : "tc";
// Modo Sobrepor: clipes da mesma faixa podem se sobrepor; a sobreposição vira transição.
let overlapMode = localStorage.getItem("nt-vct-overlap-mode") === "1";
// Seleção múltipla de clipes (Ctrl/⌘/Shift+clique) para apagar, ripple e copiar.
const selectedClipIds = new Set<string>();
let clipClipboard: ClipboardClips | null = null;
let timelineZoomY = Number(localStorage.getItem("nt-vct-timeline-zoom-y")) || 1;
let videoTrackZoomY = Number(localStorage.getItem("nt-vct-video-track-zoom-y")) || 1;
let audioTrackZoomY = Number(localStorage.getItem("nt-vct-audio-track-zoom-y")) || 1;
let timelineSnap = localStorage.getItem("nt-vct-timeline-snap") !== "false";
let canvasSnap = localStorage.getItem("nt-vct-canvas-snap") !== "false";
let leftColumnWidth = Number(localStorage.getItem("nt-vct-left-width")) || 264;
let rightColumnWidth = Number(localStorage.getItem("nt-vct-right-width")) || 310;
let timelineHeight = Number(localStorage.getItem("nt-vct-timeline-height")) || 240;
const expandedTimelineLayers = new Set<string>();
let timelinePostExpanded = false;
let libraryAccordion: "effects" | "post" = "effects";
type LeftTab = "media" | "effects";
let leftTab: LeftTab = localStorage.getItem("nt-vct-left-tab") === "effects" ? "effects" : "media";
const binView: BinView = { filter: "all", query: "", selected: "" };
let binHtml = "";
let binRefreshTimer = 0;
let inspectedAsset = "";
let draggedBinAsset = "";
const thumbnailRequests = new Set<string>();
const metadataAttempts = new Set<string>();
let selectedKeyRef = "";
const recordedTracks = new Set<string>();
const recordedRanges = new Map<string, { min: number; max: number }>();
let autosaveTimer = 0;
let renderErrorActive = false;
let autosaveGeneration = 0;
let autosaveWrites = Promise.resolve();
let autosaveFingerprint = "";
let renderer: ComposerRenderer | null = null;
let zoom = 1;
let exportCancelled = false;
let exportInProgress = false;
let exportSessionId: string | null = null;
type ActiveExporter = {
  start(): Promise<void>;
  addFrame(index: number): Promise<void>;
  finish(): Promise<number>;
  cancel(): Promise<void> | void;
};
let activeExporter: ActiveExporter | null = null;
const history = new UndoHistory();
let renderInFlight = false;
let renderQueued = false;
let timelineRefreshTimer = 0;
let notificationAudio: AudioContext | null = null;
const audioEngine = new AudioTimelineEngine();
type ClipboardSection = "transform" | "appearance" | "timing" | "effects" | "audio";
let parameterClipboard: { section: ClipboardSection; data: unknown } | null = null;
// Quadros de cada arquivo de vídeo (chave = asset), cobrindo a mídia inteira.
// Cada clipe escolhe os quadros do próprio trecho de origem, então a faixa
// acompanha trim, corte, velocidade e reverse sem gerar thumbnails de novo.
const VIDEO_THUMBNAIL_FRAMES = 24;
const videoThumbnailCache = new Map<string, string[]>();
const videoThumbnailDuration = new Map<string, number>();
const audioWaveformCache = new Map<string, number[]>();
const audioWaveformDuration = new Map<string, number>();
let videoThumbnailQueue = Promise.resolve();
const logoSimple = new URL("logo-simple.png", document.baseURI).href;

const t = (key: TranslationKey) => translate(language, key);

const selectedLayer = () => project?.layers.find((layer) => layer.id === selectedLayerId);
const selectedAudioTrack = () => project?.audioTracks?.find((track) => track.id === selectedAudioTrackId);
const selectedEffect = () => {
  const layer = selectedLayer();
  return layer?.effects.find((effect) => effect.id === selectedEffectId)
    || project?.postEffects.find((effect) => effect.id === selectedEffectId);
};

function syncSelectionClasses() {
  app.querySelectorAll<HTMLElement>("[data-layer-id]").forEach((item) =>
    item.classList.toggle("is-selected", item.dataset.layerId === selectedLayerId));
  app.querySelectorAll<HTMLElement>("[data-label-layer], [data-track-layer], [data-clip-layer]").forEach((item) => {
    const members = item.dataset.trackMembers?.split(" ");
    const id = item.dataset.labelLayer || item.dataset.trackLayer || item.dataset.clipLayer;
    item.classList.toggle("is-selected", members && !item.dataset.clipLayer ? members.includes(selectedLayerId) : id === selectedLayerId);
  });
  app.querySelectorAll<HTMLElement>("[data-timeline-order-audio], [data-audio-track], [data-move-audio-clip]").forEach((item) => {
    const members = item.dataset.laneMembers?.split(" ");
    const id = item.dataset.timelineOrderAudio || item.dataset.audioTrack || item.dataset.moveAudioClip;
    item.classList.toggle("is-selected", members && !item.dataset.moveAudioClip ? members.includes(selectedAudioTrackId) : id === selectedAudioTrackId);
  });
}

function selectLayerById(layerId: string, refreshTimeline = true) {
  const layer = project?.layers.find((item) => item.id === layerId);
  if (!layer) return;
  selectedLayerId = layer.id;
  selectedAudioTrackId = "";
  selectedEffectId = "";
  selectedKeyRef = "";
  inspectedAsset = "";
  updateLayerStack();
  updateInspector();
  if (refreshTimeline) updateTimeline();
  else syncSelectionClasses();
  updateCurveTools();
  updateTransformBox();
  setStatus(`SELECT · ${layer.name}`);
}

function selectAudioTrackById(trackId: string, refreshTimeline = true) {
  const track = project?.audioTracks.find((item) => item.id === trackId);
  if (!track) return;
  selectedAudioTrackId = track.id;
  selectedLayerId = "";
  selectedEffectId = "";
  selectedKeyRef = "";
  inspectedAsset = "";
  updateLayerStack();
  updateInspector();
  if (refreshTimeline) updateTimeline();
  else syncSelectionClasses();
  updateCurveTools();
  updateTransformBox();
  setStatus(`SELECT · ${track.name}`);
}

function openNoisetupiSite() {
  window.open("https://noisetupi.com.br/", "_blank", "noopener,noreferrer");
}

function bindBrandLink() {
  app.querySelector("#brand-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    openNoisetupiSite();
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]!);
}

function snapshot(label = "") {
  if (!project) return;
  history.checkpoint(JSON.stringify(project), label);
}

// ---- Edits from the interface run through the VCT command registry, the same
// path window.vct uses: validation, one undo step per action, named steps.

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

let warningsTimer = 0;
let warningsRenderedAt = 0;

/** Redraws the status bar warnings button, at most once every 500 ms. */
function refreshWarnings() {
  if (warningsTimer) return;
  warningsTimer = window.setTimeout(() => {
    warningsTimer = 0;
    warningsRenderedAt = performance.now();
    renderWarningsSlot();
  }, Math.max(0, 500 - (performance.now() - warningsRenderedAt)));
}

function renderWarningsSlot() {
  const slot = app.querySelector<HTMLElement>("#warnings-slot");
  if (!slot || !project) return;
  const html = renderWarningsButton(project, language);
  if (slot.innerHTML === html) return;
  slot.innerHTML = html;
  slot.querySelector("#open-warnings")?.addEventListener("click", openWarnings);
}

function openWarnings() {
  if (!project) return;
  openWarningsPanel(project, language, (issue) => {
    const id = issue.ids[0];
    if (id && project?.layers.some((layer) => layer.id === id)) selectLayerById(id);
    else if (id && project?.audioTracks.some((track) => track.id === id)) selectAudioTrackById(id);
    if (issue.start !== undefined) setTime(issue.start);
  });
}

function refreshHistoryButtons() {
  if (!project) return;
  refreshWarnings();
  const serialized = JSON.stringify(project);
  const undoButton = app.querySelector<HTMLButtonElement>("#undo");
  const redoButton = app.querySelector<HTMLButtonElement>("#redo");
  undoButton?.toggleAttribute("disabled", !history.canUndo(serialized));
  redoButton?.toggleAttribute("disabled", !history.canRedo(serialized));
  const undoLabel = history.undoLabel(serialized);
  const redoLabel = history.redoLabel(serialized);
  undoButton?.setAttribute("title", undoLabel ? `${t("undo")}: ${undoLabel}` : t("undo"));
  redoButton?.setAttribute("title", redoLabel ? `${t("redo")}: ${redoLabel}` : t("redo"));
}

// A região de trabalho e a grade só mudam a timeline; o resto das configurações recria o editor.
const settingsLayoutKey = (settings: ProjectDocument["settings"]) => JSON.stringify({ ...settings, workArea: undefined, grid: undefined });

/** Replaces the open document with a command result and refreshes the editor. */
function commitDocument(next: ProjectDocument, options: { clipEdit?: boolean; panels?: boolean } = {}) {
  if (!project) return;
  const structureChanged = project.layers.map(layer => layer.id).join('|') !== next.layers.map(layer => layer.id).join('|')
    || project.audioTracks.map(track => track.id).join('|') !== next.audioTracks.map(track => track.id).join('|')
    || settingsLayoutKey(project.settings) !== settingsLayoutKey(next.settings);
  Object.assign(project, next);
  for (const id of [...selectedClipIds]) if (!project.layers.some(layer => layer.id === id)) selectedClipIds.delete(id);
  if (!project.layers.some(layer => layer.id === selectedLayerId)) selectedLayerId = project.layers[0]?.id || '';
  if (!project.audioTracks.some(track => track.id === selectedAudioTrackId)) selectedAudioTrackId = '';
  if (options.clipEdit) {
    if (overlapMode) autoTransitionsForOverlap(project);
    syncTransitionAudioFades(project);
  }
  markProjectModified(project);
  if (structureChanged) renderEditorPreservingCanvas();
  else if (options.panels !== false) updatePanels();
  updateTransformBox();
  refreshHistoryButtons();
  void renderFrame();
}

/**
 * Runs commands as one named undo step. Returns the command results, or null
 * when the edit was refused (the reason goes to the status bar).
 */
function applyCommands(commands: VctCommand[], label: string, options: { clipEdit?: boolean; panels?: boolean; select?: (results: unknown[]) => void } = {}) {
  if (!project || !commands.length) return null;
  endEditSession();
  if (exportInProgress) {
    setStatus(language === "pt-BR" ? "AGUARDE A EXPORTAÇÃO" : "WAIT FOR THE EXPORT");
    return null;
  }
  let result: ReturnType<typeof runProjectCommands>;
  try {
    result = runProjectCommands(project, commands, keyframeTolerance());
  } catch (error) {
    setStatus(`${label.toUpperCase()} · ${errorMessage(error)}`);
    return null;
  }
  if (JSON.stringify(result.project) === JSON.stringify(project)) return result.results;
  snapshot(label);
  options.select?.(result.results);
  commitDocument(result.project, options);
  return result.results;
}

interface Gesture {
  /** Re-runs the commands on the state from when the gesture began. False when refused. */
  preview(commands: VctCommand[]): boolean;
  /** Commits the last preview as one undo step. */
  end(options?: { clipEdit?: boolean }): void;
  /** Restores the state from when the gesture began. */
  cancel(): void;
}

/**
 * Continuous edits (drags, scrubs, typing): every move previews commands from
 * the starting state, so handlers never accumulate; end() makes one undo step.
 * Previews replace project.layers objects, so re-read layers by id after each.
 */
function beginGesture(label: string): Gesture {
  const base = structuredClone(project!);
  const baseJson = JSON.stringify(base);
  let changed = false;
  return {
    preview(commands) {
      if (!project || exportInProgress) return false;
      // Nothing to change (the pointer came back to the start): show the starting state.
      if (!commands.length) {
        Object.assign(project, structuredClone(base));
        changed = true;
        return true;
      }
      try {
        const result = runProjectCommands(base, commands, keyframeTolerance());
        Object.assign(project, result.project);
        changed = true;
        return true;
      } catch (error) {
        setStatus(`${label.toUpperCase()} · ${errorMessage(error)}`);
        return false;
      }
    },
    end(options = {}) {
      if (!project || !changed || JSON.stringify(project) === baseJson) return;
      history.checkpoint(baseJson, label);
      if (options.clipEdit) {
        if (overlapMode) autoTransitionsForOverlap(project);
        syncTransitionAudioFades(project);
      }
      markProjectModified(project);
      refreshHistoryButtons();
      void renderFrame();
    },
    cancel() {
      if (!project || !changed) return;
      Object.assign(project, structuredClone(base));
      changed = false;
      void renderFrame();
    },
  };
}

function markProjectModified(target: ProjectDocument | null = project) {
  if (!target) return;
  target.modifiedAt = new Date().toISOString();
  scheduleProjectAutosave(target);
}

function scheduleProjectAutosave(target: ProjectDocument) {
  window.clearTimeout(autosaveTimer);
  const generation = ++autosaveGeneration;
  autosaveTimer = window.setTimeout(() => {
    if (project !== target || generation !== autosaveGeneration) return;
    const snapshot = structuredClone(target);
    const fingerprint = JSON.stringify(snapshot);
    autosaveWrites = autosaveWrites.then(async () => {
      if (project !== target || generation !== autosaveGeneration) return;
      try {
        await saveProjectRecovery(snapshot);
        autosaveFingerprint = fingerprint;
        // A render error stays visible until a render succeeds again.
        if (project === target && !renderErrorActive) setStatus(language === "pt-BR" ? "RECUPERAÇÃO SALVA" : "RECOVERY SAVED");
      } catch (error) {
        console.error("Project recovery autosave failed.", error);
        if (project === target) setStatus(`${language === "pt-BR" ? "FALHA NA RECUPERAÇÃO" : "RECOVERY FAILED"} · ${String(error)}`);
      }
    });
  }, 1500);
}

function startProjectAutosaveTracking(target: ProjectDocument) {
  window.clearTimeout(autosaveTimer);
  autosaveGeneration++;
  autosaveFingerprint = JSON.stringify(target);
}

function clearRecoveryForProjectChange() {
  window.clearTimeout(autosaveTimer);
  autosaveGeneration++;
  autosaveWrites = autosaveWrites.then(() => clearProjectRecovery()).catch((error: unknown) => {
    console.error("Could not clear the previous recovery snapshot.", error);
    setStatus(`${language === "pt-BR" ? "FALHA AO LIMPAR RECUPERAÇÃO" : "COULD NOT CLEAR RECOVERY"} · ${String(error)}`);
  });
}

window.setInterval(() => {
  if (!project) return;
  const fingerprint = JSON.stringify(project);
  if (fingerprint !== autosaveFingerprint) scheduleProjectAutosave(project);
}, 2000);

function restore(value: string) {
  project = JSON.parse(value) as ProjectDocument;
  project.audioTracks ||= [];
  selectedLayerId = project.layers.some((layer) => layer.id === selectedLayerId) ? selectedLayerId : project.layers[0]?.id || "";
  selectedAudioTrackId = "";
  selectedEffectId = "";
  selectedKeyRef = "";
  renderer?.dispose();
  renderer = null;
  renderEditor();
  const canvas = app.querySelector<HTMLCanvasElement>("#composition-canvas")!;
  initializeRenderer(canvas);
  metadataAttempts.clear();
  refreshAssetMetadata();
}

function initializeRenderer(canvas: HTMLCanvasElement) {
  renderer?.dispose();
  const onContextRestored = () => {
    if (app.querySelector("#composition-canvas") !== canvas) return;
    renderErrorActive = false;
    initializeRenderer(canvas);
    setStatus("READY · PREVIEW FULL");
  };
  renderer = new ComposerRenderer(canvas, () => void renderFrame(), onContextRestored);
  renderer.setProject(project!, projectRoot);
  void renderFrame();
}

function compositionPresetOptions(width?: number, height?: number) {
  const groups = [...new Set(COMPOSITION_PRESETS.map((preset) => preset.group))];
  let selectedAssigned = false;
  const options = groups.map((group) => {
    const entries = COMPOSITION_PRESETS.filter((preset) => preset.group === group).map((preset) => {
      const selected = !selectedAssigned && preset.width === width && preset.height === height;
      if (selected) selectedAssigned = true;
      return `<option value="${preset.width},${preset.height}" ${selected ? "selected" : ""}>${preset.label} · ${preset.width}×${preset.height}</option>`;
    }).join("");
    return `<optgroup label="${group}">${entries}</optgroup>`;
  }).join("");
  return `<option value="custom" ${selectedAssigned ? "" : "selected"}>${language === "pt-BR" ? "PERSONALIZADO" : "CUSTOM"}</option>${options}`;
}

function applyPresetToInputs(select: HTMLSelectElement, width: HTMLInputElement, height: HTMLInputElement) {
  if (select.value === "custom") return;
  const [nextWidth, nextHeight] = select.value.split(",");
  width.value = nextWidth;
  height.value = nextHeight;
}

function undo() {
  if (!project) return;
  endEditSession();
  stopPlayback();
  const label = history.undoLabel(JSON.stringify(project));
  const previous = history.undo(JSON.stringify(project));
  if (previous === null) return;
  restore(previous);
  if (label) setStatus(`${language === "pt-BR" ? "DESFEITO" : "UNDONE"} · ${label}`);
}

function redo() {
  if (!project) return;
  endEditSession();
  stopPlayback();
  const label = history.redoLabel(JSON.stringify(project));
  const next = history.redo(JSON.stringify(project));
  if (next === null) return;
  restore(next);
  if (label) setStatus(`${language === "pt-BR" ? "REFEITO" : "REDONE"} · ${label}`);
}

function renderLanguage() {
  app.innerHTML = `
    <main class="language-screen">
      <button class="nt-link brand-corner" id="brand-link" title="noisetupi.com.br"><img class="brand-icon" src="${logoSimple}" alt="Noisetupi"></button>
      <section class="language-card">
        <span class="micro">NOISETUPI VIDEO CONTENT TOOL</span>
        <h1>${t("languageTitle")}</h1>
        <div class="language-options">
          <button data-language="pt-BR"><strong>PT</strong><span>${t("portuguese")}</span></button>
          <button data-language="en"><strong>EN</strong><span>${t("english")}</span></button>
        </div>
      </section>
    </main>`;
  bindBrandLink();
  app.querySelectorAll<HTMLButtonElement>("[data-language]").forEach((button) => button.addEventListener("click", () => {
    language = button.dataset.language as Language;
    localStorage.setItem("nt-vct-language", language);
    renderWelcome();
  }));
}

function renderWelcome() {
  app.innerHTML = `
    <main class="welcome-screen">
      <header class="welcome-header">
        <button class="nt-link brand-wide" id="brand-link" title="noisetupi.com.br"><img class="brand-icon" src="${logoSimple}" alt="Noisetupi"><span>NOISETUPI VIDEO CONTENT TOOL</span></button>
        <button class="text-button" id="change-language">${language === "pt-BR" ? "PT" : "EN"}</button>
      </header>
      <section class="welcome-copy">
        <p class="eyebrow">MOTION GRAPHICS / VIDEO MAPPING</p>
        <h1>${t("newProject")}.</h1>
        <p class="intro">Canvas transparente, animação por keyframes, shaders e exportação local.</p>
        <div class="welcome-actions">
          <button class="primary-button" id="new-project">${t("newProject")} <span>→</span></button>
          <button class="secondary-button" id="open-project">${t("openProject")}</button>
        </div>
      </section>
      <section class="recovery-prompt" id="recovery-prompt" hidden></section>
      <footer class="welcome-footer"><span>WEB APP ${APP_VERSION}</span><span>WEBGL2 + WEBCODECS</span><span>LOCAL PROCESSING</span></footer>
    </main>`;
  bindBrandLink();
  app.querySelector("#change-language")?.addEventListener("click", renderLanguage);
  app.querySelector("#new-project")?.addEventListener("click", renderProjectSetup);
  app.querySelector("#open-project")?.addEventListener("click", () => void chooseOpenProject());
  void updateRecoveryPrompt();
}

async function updateRecoveryPrompt() {
  const prompt = app.querySelector<HTMLElement>("#recovery-prompt");
  if (!prompt) return;
  try {
    const recovery = await readProjectRecovery();
    if (!recovery || !prompt.isConnected) return;
    const time = new Date(recovery.savedAt).toLocaleString(language === "pt-BR" ? "pt-BR" : "en");
    prompt.hidden = false;
    prompt.innerHTML = `<span class="eyebrow">${language === "pt-BR" ? "RECUPERAÇÃO DISPONÍVEL" : "RECOVERY AVAILABLE"}</span>
      <strong>${escapeHtml(recovery.project.settings.name)}</strong>
      <small>${language === "pt-BR" ? "Autos salvo em" : "Autosaved"} ${escapeHtml(time)}</small>
      <div><button class="primary-button" id="restore-recovery">${language === "pt-BR" ? "RECUPERAR PROJETO" : "RESTORE PROJECT"}</button>
      <button class="text-button" id="discard-recovery">${language === "pt-BR" ? "Descartar" : "Discard"}</button></div>`;
    prompt.querySelector("#restore-recovery")?.addEventListener("click", () => void restoreProjectRecovery().catch((error) => window.alert(String(error))));
    prompt.querySelector("#discard-recovery")?.addEventListener("click", () => void (async () => {
      try {
        await discardProjectRecovery();
        prompt.hidden = true;
      } catch (error) {
        window.alert(String(error));
      }
    })());
  } catch (error) {
    console.error("Could not check for a project recovery snapshot.", error);
    prompt.hidden = false;
    prompt.textContent = `${language === "pt-BR" ? "Não foi possível verificar a recuperação" : "Could not check project recovery"}: ${String(error)}`;
  }
}

async function restoreProjectRecovery() {
  const recovery = await readProjectRecovery();
  if (!recovery) return;
  for (const [reference, blob] of recovery.assets) registerWebAsset(reference, blob);
  loadProject({
    root: "web-project",
    jsonPath: `Recovery · ${recovery.project.settings.name}`,
    project: recovery.project,
  }, true);
  setStatus(language === "pt-BR" ? "PROJETO RECUPERADO" : "PROJECT RECOVERED");
  if (missingMediaReferences().length) window.setTimeout(showMissingMediaModal, 0);
}

function renderProjectSetup() {
  app.innerHTML = `
    <main class="setup-screen">
      <header class="setup-header"><button class="back-button" id="back">←</button><span>NOISETUPI VIDEO CONTENT TOOL</span></header>
      <form class="setup-form" id="setup-form">
        <p class="eyebrow">01 / ${t("newProject").toUpperCase()}</p>
        <h1>${t("dimensions")}.</h1>
        <div class="form-grid">
          <label class="field field-wide"><span>${t("projectName")}</span><input name="name" value="Mapping Project" maxlength="80" required></label>
          <label class="select-field field-wide"><span>${language === "pt-BR" ? "FORMATO PARA REDES SOCIAIS" : "SOCIAL MEDIA FORMAT"}</span><select id="setup-social-preset">${compositionPresetOptions(1920, 1080)}</select></label>
          <label class="field"><span>${t("width")} PX</span><input name="width" type="number" min="16" max="8192" value="1920" required></label>
          <label class="field"><span>${t("height")} PX</span><input name="height" type="number" min="16" max="8192" value="1080" required></label>
          <label class="field"><span>FPS</span><input name="fps" type="number" min="1" max="240" step="1" value="30" required></label>
          <label class="field"><span>${t("duration")} SEC</span><input name="duration" type="number" min=".1" max="7200" step=".1" value="10" required></label>
          <label class="field"><span>${t("background")}</span><input name="background" type="color" value="#000000"></label>
          <label class="toggle-field"><input name="transparent" type="checkbox" checked><span class="toggle"></span><span>${t("transparent")} / ALPHA</span></label>
        </div>
        <div class="preset-row">
          <button type="button" data-preset="1920,1080">HD 1920×1080</button>
          <button type="button" data-preset="1080,1080">SQUARE 1080×1080</button>
          <button type="button" data-preset="2160,1080">2:1 2160×1080</button>
          <button type="button" data-preset="3840,2160">4K 3840×2160</button>
          <button type="button" data-preset="3840,1080">ULTRAWIDE 3840×1080</button>
        </div>
        <button class="primary-button create-project" type="submit">${t("create")} <span>→</span></button>
        <p class="form-error" id="setup-error"></p>
      </form>
    </main>`;
  app.querySelector("#back")?.addEventListener("click", renderWelcome);
  const setupForm = app.querySelector<HTMLFormElement>("#setup-form")!;
  const setupPreset = app.querySelector<HTMLSelectElement>("#setup-social-preset")!;
  const setupWidth = setupForm.elements.namedItem("width") as HTMLInputElement;
  const setupHeight = setupForm.elements.namedItem("height") as HTMLInputElement;
  setupPreset.addEventListener("change", () => applyPresetToInputs(setupPreset, setupWidth, setupHeight));
  [setupWidth, setupHeight].forEach((input) => input.addEventListener("input", () => {
    if (setupPreset.value !== `${setupWidth.value},${setupHeight.value}`) setupPreset.value = "custom";
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    const [width, height] = button.dataset.preset!.split(",");
    const form = app.querySelector<HTMLFormElement>("#setup-form")!;
    (form.elements.namedItem("width") as HTMLInputElement).value = width;
    (form.elements.namedItem("height") as HTMLInputElement).value = height;
    setupPreset.value = `${width},${height}`;
    if (!setupPreset.value) setupPreset.value = "custom";
  }));
  app.querySelector<HTMLFormElement>("#setup-form")?.addEventListener("submit", (event) => void createNewProject(event));
}

async function createNewProject(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const settings: ProjectSettings = {
    name: String(data.get("name") || "Mapping Project").trim(),
    width: Number(data.get("width")),
    height: Number(data.get("height")),
    fps: Number(data.get("fps")),
    duration: Number(data.get("duration")),
    background: String(data.get("background") || "#000000"),
    transparent: data.get("transparent") === "on",
  };
  if (settings.width * settings.height > 33_554_432) {
    app.querySelector("#setup-error")!.textContent = language === "pt-BR"
      ? "O canvas excede o limite seguro de pixels para a GPU."
      : "The canvas exceeds the safe GPU pixel limit.";
    return;
  }
  const button = form.querySelector<HTMLButtonElement>(".create-project")!;
  button.disabled = true;
  try {
    loadProject(createWebProject(createProject(settings)));
  } catch (error) {
    app.querySelector("#setup-error")!.textContent = String(error);
    button.disabled = false;
  }
}

async function chooseOpenProject() {
  try {
    const result = await openWebProject();
    if (result) {
      loadProject(result);
      if (missingMediaReferences().length) window.setTimeout(showMissingMediaModal, 0);
    }
  } catch (error) {
    window.alert(String(error));
  }
}

function projectMediaReferences() {
  if (!project) return [];
  return [...new Set([
    ...project.layers.map((layer) => layer.asset).filter(Boolean),
    ...project.audioTracks.map((track) => track.asset).filter(Boolean),
  ] as string[])];
}

function missingMediaReferences() {
  return projectMediaReferences().filter((reference) => !hasWebAsset(reference));
}

function mediaBaseName(reference: string) {
  return reference.replaceAll("\\", "/").split("/").pop()?.toLowerCase() || reference.toLowerCase();
}

function rememberAssetSource(reference: string, metadata: NonNullable<ProjectDocument["assetMetadata"]>[string]) {
  if (!project) return;
  project.assetMetadata ||= {};
  project.assetMetadata[reference] = metadata;
}

function mediaAccept(reference: string) {
  const usedAsVideo = project?.layers.some((layer) => layer.asset === reference && layer.kind === "video");
  const usedAsImage = project?.layers.some((layer) => layer.asset === reference && (layer.kind === "image" || layer.kind === "guide"));
  if (usedAsVideo) return ".mp4,.webm,.mov,.m4v,video/*";
  if (usedAsImage) return ".png,.jpg,.jpeg,.webp,.bmp,.gif,image/*";
  return ".mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,audio/*";
}

function refreshRelinkedMedia() {
  if (!project) return;
  videoThumbnailCache.clear();
  audioWaveformCache.clear();
  renderEditorPreservingCanvas();
  for (const layer of project.layers) if (layer.kind === "video" && layer.asset && hasWebAsset(layer.asset)) void generateVideoThumbnails(layer);
  for (const track of project.audioTracks) if (hasWebAsset(track.asset)) void generateAudioWaveform(track.asset);
  refreshAssetMetadata();
}

function showMissingMediaModal() {
  const currentProject = project;
  if (!currentProject) return;
  const missing = missingMediaReferences();
  if (!missing.length) {
    app.querySelector("#modal-root")!.innerHTML = "";
    refreshRelinkedMedia();
    setStatus(language === "pt-BR" ? "TODAS AS MÍDIAS LOCALIZADAS" : "ALL MEDIA RELINKED");
    return;
  }
  const root = app.querySelector<HTMLDivElement>("#modal-root")!;
  root.innerHTML = `<div class="modal-backdrop"><section class="export-modal relink-modal">
    <header><div><span class="micro">MEDIA RELINK</span><h2>${language === "pt-BR" ? "Localizar mídias" : "Locate media"}</h2></div><button id="close-relink">×</button></header>
    <p class="relink-intro">${language === "pt-BR" ? "O navegador não fornece caminhos absolutos. O projeto guarda nome e metadados da mídia para ajudar a localizar os arquivos originais." : "Browsers do not provide absolute paths. The project stores media names and metadata to help locate the original files."}</p>
    <div class="relink-list">${missing.map((reference) => {
      const metadata = currentProject.assetMetadata?.[reference];
      return `<div><span><strong>${escapeHtml(metadata?.originalName || mediaBaseName(reference))}</strong><small>${escapeHtml(metadata?.sourcePath || reference)}${metadata ? ` · ${metadata.size} bytes` : ""}</small></span><button data-relink-one="${escapeHtml(reference)}">LOCALIZAR</button></div>`;
    }).join("")}</div>
    <footer><button id="close-relink-bottom">${language === "pt-BR" ? "ABRIR SEM MÍDIA" : "OPEN OFFLINE"}</button><button class="primary-button" id="relink-batch">${language === "pt-BR" ? "LOCALIZAR EM LOTE" : "LOCATE BATCH"} →</button></footer>
  </section></div>`;
  const close = () => root.innerHTML = "";
  root.querySelector("#close-relink")?.addEventListener("click", close);
  root.querySelector("#close-relink-bottom")?.addEventListener("click", close);
  root.querySelector("#relink-batch")?.addEventListener("click", async () => {
    const files = await chooseFiles("image/*,video/*,audio/*,.png,.jpg,.jpeg,.webp,.bmp,.gif,.mp4,.webm,.mov,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac");
    if (project !== currentProject) return;
    for (const reference of missingMediaReferences()) {
      const file = findRelinkFile(reference, currentProject.assetMetadata?.[reference], files);
      if (file) {
        registerWebAsset(reference, file);
        rememberAssetSource(reference, assetSourceMetadata(file));
      }
    }
    showMissingMediaModal();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-relink-one]").forEach((button) => button.addEventListener("click", async () => {
    const reference = button.dataset.relinkOne!;
    const file = await chooseFile(mediaAccept(reference));
    if (!file) return;
    if (project !== currentProject) return;
    registerWebAsset(reference, file);
    rememberAssetSource(reference, assetSourceMetadata(file));
    showMissingMediaModal();
  }));
}

function loadProject(result: OpenProjectResult, recovering = false) {
  if (!recovering) clearRecoveryForProjectChange();
  videoThumbnailCache.clear();
  audioWaveformCache.clear();
  thumbnailRequests.clear();
  metadataAttempts.clear();
  binView.selected = "";
  inspectedAsset = "";
  project = result.project;
  migrateProject(project);
  startProjectAutosaveTracking(project);
  projectRoot = result.root;
  projectJsonPath = result.jsonPath;
  selectedLayerId = project.layers[0]?.id || "";
  selectedAudioTrackId = "";
  selectedEffectId = "";
  selectedKeyRef = "";
  currentTime = 0;
  playing = false;
  history.reset();
  renderEditor();
  const canvas = app.querySelector<HTMLCanvasElement>("#composition-canvas")!;
  initializeRenderer(canvas);
  for (const layer of project.layers) if (layer.kind === "video") void generateVideoThumbnails(layer);
  for (const track of project.audioTracks) void generateAudioWaveform(track.asset);
  refreshAssetMetadata();
}





function layerIcon(layer: Layer) {
  return ({ image: "IMG", video: "VID", guide: "GDE", geometry: "GEO", text: "TXT" } as const)[layer.kind];
}

function layerGlyph(layer: Layer) {
  const glyphs: Record<InputKind, string> = {
    image: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="8" cy="9" r="2"/><path d="m4 18 5-5 3 3 3-4 5 6"/></svg>`,
    video: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="m10 9 6 3-6 3Z"/></svg>`,
    guide: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v16M20 4v16M4 8h16M4 16h16"/><path d="M9 12h6M12 9v6"/></svg>`,
    geometry: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 5v8l-8 5-8-5V8Z"/></svg>`,
    text: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14M12 5v14M8 19h8"/></svg>`,
  };
  return glyphs[layer.kind];
}

function renderEditor() {
  if (!project) return;
  const settings = project.settings;
  app.innerHTML = `
    <div class="editor-app ${playing || recordMode ? "is-live" : ""}" style="--left-width:${leftColumnWidth}px;--right-width:${rightColumnWidth}px;--timeline-height:${timelineHeight}px">
      <header class="editor-topbar">
        <button class="nt-link editor-brand" id="brand-link" title="noisetupi.com.br" aria-label="Noisetupi"><img class="brand-icon" src="${logoSimple}" alt=""></button>
        <div class="project-title"><strong>${escapeHtml(settings.name)}</strong><span>${settings.width}×${settings.height} / ${settings.fps} FPS</span></div>
        <div class="history-actions">
          <button id="undo" title="${t("undo")}" aria-label="${t("undo")}" ${project && history.canUndo(JSON.stringify(project)) ? "" : "disabled"}>↶</button>
          <button id="redo" title="${t("redo")}" aria-label="${t("redo")}" ${project && history.canRedo(JSON.stringify(project)) ? "" : "disabled"}>↷</button>
        </div>
        <div class="top-actions">
          <button id="toggle-library" class="tablet-panel-toggle" aria-label="${t("inputs")} / ${t("layers")}" aria-expanded="false" title="${t("inputs")} / ${t("layers")}">${uiIcon("library")}<span>${language === "pt-BR" ? "MÍDIA" : "MEDIA"}</span></button>
          <button id="toggle-inspector" class="tablet-panel-toggle" aria-label="${t("properties")}" aria-expanded="false" title="${t("properties")}">${uiIcon("inspector")}<span>${t("properties")}</span></button>
          <button id="new-project" aria-label="${t("newProject")}" title="${t("newProject")}">${uiIcon("new")}<span>${t("newProject")}</span></button>
          <button id="open-project" aria-label="${t("openProject")}" title="${t("openProject")}">${uiIcon("open")}<span>${t("openProject")}</span></button>
          <button id="save-project" aria-label="${t("save")}" title="${t("save")}">${uiIcon("save")}<span>${t("save")}</span></button>
          <button id="collect-media" title="${t("collectMedia")}" aria-label="${t("collectMedia")}">${uiIcon("collect")}<span>${t("collectMedia")}</span></button>
          ${missingMediaReferences().length ? `<button class="missing-media-button" id="missing-media" aria-label="${language === "pt-BR" ? "Localizar mídias ausentes" : "Locate missing media"}" title="${language === "pt-BR" ? "Localizar mídias ausentes" : "Locate missing media"}">${uiIcon("missing")}<span>MEDIA</span></button>` : ""}
          <button id="composition-settings" aria-label="${language === "pt-BR" ? "Composição" : "Composition"}" title="${language === "pt-BR" ? "Composição" : "Composition"}">${uiIcon("settings")}<span>${language === "pt-BR" ? "COMPOSIÇÃO" : "COMPOSITION"}</span></button>
          <button class="export-button" id="export-project" aria-label="${t("export")}" title="${t("export")}">${uiIcon("export")}<span>${t("export")}</span></button>
          <button id="agent-panel-button" aria-label="${language === "pt-BR" ? "Editar com IA" : "Edit with AI"}" title="${language === "pt-BR" ? "Editar com IA no navegador (Claude in Chrome)" : "Edit with AI in the browser (Claude in Chrome)"}"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="6" width="12" height="9" rx="2.5"/><path d="M10 6V3.5M7.5 10.5h.01M12.5 10.5h.01M2 10v2M18 10v2"/></svg></button>
          <button class="language-mini" id="language" aria-label="${language === "pt-BR" ? "Mudar idioma" : "Change language"}" title="${language === "pt-BR" ? "Mudar idioma" : "Change language"}">${uiIcon("language")}<span>${language === "pt-BR" ? "PT" : "EN"}</span></button>
        </div>
      </header>
      <aside class="left-panel has-tabs">
        ${renderLeftTop()}
        <section class="stack-section">
          <header><span>${t("layers")}</span><small>${project.layers.length}</small></header>
          <div class="layer-stack" id="layer-stack">${project.layers.map(renderLayerItem).join("") || `<p class="empty-stack">${language === "pt-BR" ? "Sem camadas ainda" : "No layers yet"}</p>`}</div>
        </section>
      </aside>
      <div class="column-resizer left-resizer" data-resize-column="left" title="Resize Layers"></div>
      <main class="stage-area">
        <div class="stage-toolbar">
          <span>${t("preview")}</span>
          <div class="stage-toolbar-actions">
            <label class="preview-quality-control"><span>PLAY QUALITY</span><select id="preview-quality">
              <option value="auto" ${previewQuality === "auto" ? "selected" : ""}>AUTO</option>
              <option value="1" ${previewQuality === "1" ? "selected" : ""}>FULL</option>
              <option value=".75" ${previewQuality === ".75" ? "selected" : ""}>75%</option>
              <option value=".5" ${previewQuality === ".5" ? "selected" : ""}>50%</option>
              <option value=".33" ${previewQuality === ".33" ? "selected" : ""}>33%</option>
              <option value=".25" ${previewQuality === ".25" ? "selected" : ""}>25%</option>
            </select><small id="preview-quality-state">${previewQualityState()}</small></label>
            <button class="snap-toggle ${canvasSnap ? "is-active" : ""}" id="canvas-snap" title="${language === "pt-BR" ? "Snap no centro, bordas e outras camadas" : "Snap to center, edges and other layers"}">SNAP</button>
            <div class="stage-zoom-controls">
            <button id="zoom-out" title="Zoom out" aria-label="Zoom out"><svg viewBox="0 0 20 20"><circle cx="8" cy="8" r="5"/><path d="M4.8 8h6.4M12 12l5 5"/></svg></button>
            <span id="zoom-value">${Math.round(zoom * 100)}%</span>
            <button id="zoom-in" title="Zoom in" aria-label="Zoom in"><svg viewBox="0 0 20 20"><circle cx="8" cy="8" r="5"/><path d="M4.8 8h6.4M8 4.8v6.4M12 12l5 5"/></svg></button>
            <button id="fit-canvas" class="fit-button">${t("fit")}</button>
            </div>
          </div>
        </div>
        <div class="canvas-viewport" id="canvas-viewport">
          <div class="canvas-shell ${settings.transparent ? "checkerboard" : ""}" id="canvas-shell" style="width:${settings.width * zoom}px;aspect-ratio:${settings.width}/${settings.height}">
            <canvas id="composition-canvas" width="${settings.width}" height="${settings.height}"></canvas>
            <i class="canvas-snap-guide is-x" id="canvas-snap-x"></i><i class="canvas-snap-guide is-y" id="canvas-snap-y"></i>
            <div class="transform-box" id="transform-box">
              ${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((handle) => `<button class="transform-handle is-${handle}" data-transform-handle="${handle}" aria-label="Resize ${handle}"></button>`).join("")}
              <i class="rotation-stem"></i><button class="transform-rotate" data-transform-handle="rotate" aria-label="Rotate"></button>
            </div>
          </div>
        </div>
      </main>
      <div class="column-resizer right-resizer" data-resize-column="right" title="Resize Properties"></div>
      <aside class="right-panel"><header class="panel-title">${t("properties")}</header><div id="inspector">${renderInspector()}</div></aside>
      <div class="timeline-resizer" id="timeline-resizer" title="Resize Timeline"></div>
      <section class="timeline-panel">${renderTimeline()}</section>
      <div class="statusbar"><span id="status-text">READY · BUILD ${APP_VERSION}</span><span class="statusbar-end"><span id="warnings-slot">${project ? renderWarningsButton(project, language) : ""}</span><span class="statusbar-path">${projectJsonPath}</span></span></div>
    </div>
    <div id="modal-root"></div>`;
  bindEditor();
}

function renderLeftTop() {
  const tabs: Array<[LeftTab, string]> = [["media", language === "pt-BR" ? "Mídia" : "Media"], ["effects", language === "pt-BR" ? "Efeitos" : "Effects"]];
  return `<div class="left-top">
    <div class="left-tabs" role="tablist" aria-label="${language === "pt-BR" ? "Biblioteca" : "Library"}">
      ${tabs.map(([id, label]) => `<button type="button" role="tab" id="left-tab-${id}" data-left-tab="${id}" aria-controls="left-tabpanel" aria-selected="${leftTab === id}" tabindex="${leftTab === id ? 0 : -1}">${label}</button>`).join("")}
    </div>
    <div class="left-tab-body" id="left-tabpanel" role="tabpanel" aria-labelledby="left-tab-${leftTab}">${renderLeftBody()}</div>
  </div>`;
}

function renderLeftBody() {
  if (leftTab === "media" && project) return binHtml = renderMediaBin(project, binView, language);
  return renderEffectsLibrary();
}

function renderEffectsLibrary() {
  const effects = (Object.keys(EFFECT_CATALOG) as EffectKind[]).filter((kind) => EFFECT_CATALOG[kind].category === "layer");
  const post = (Object.keys(EFFECT_CATALOG) as EffectKind[]).filter((kind) => EFFECT_CATALOG[kind].category === "post");
  return `
    <section class="library-section">
      <details ${libraryAccordion === "effects" ? "open" : ""} data-library-accordion="effects"><summary><span>${t("effects")}</span><b>+</b></summary><div class="tool-list">
        ${effects.map((kind) => `<button data-add-effect="${kind}"><span>＋</span>${effectLabel(kind)}</button>`).join("")}
      </div></details>
      <details ${libraryAccordion === "post" ? "open" : ""} data-library-accordion="post"><summary><span>${t("post")}</span><b>+</b></summary><div class="tool-list">
        ${post.map((kind) => `<button data-add-post="${kind}"><span>＋</span>${effectLabel(kind)}</button>`).join("")}
      </div><div class="library-post-chain">${renderEffectChain(project?.postEffects || [])}</div></details>
    </section>`;
}

function effectLabel(kind: EffectKind) {
  return EFFECT_CATALOG[kind].labels[language === "pt-BR" ? "pt-BR" : "en"];
}

function renderLayerItem(layer: Layer) {
  return `<article class="layer-item ${layer.id === selectedLayerId ? "is-selected" : ""}" data-layer-id="${layer.id}" data-select-layer-row="${layer.id}">
    <span class="layer-order"><button data-move-layer="${layer.id}" data-direction="-1" title="Move up">▲</button><button data-move-layer="${layer.id}" data-direction="1" title="Move down">▼</button></span>
    <button class="drag-handle" draggable="true" title="Drag layer">⠿</button>
    <span class="layer-type" title="${layerIcon(layer)}">${layerGlyph(layer)}<small>${layerIcon(layer)}</small></span>
    <button class="layer-name" data-select-layer="${layer.id}" data-rename-layer="${layer.id}" title="Double-click to rename">${escapeHtml(layer.name)}<small>${layer.effects.length ? `${layer.effects.length} FX` : layer.kind}</small></button>
    <button class="layer-fx ${layer.effects.length ? "has-fx" : ""}" data-open-layer-fx="${layer.id}" title="${layer.effects.length ? `${layer.effects.length} FX` : "No effects"}">FX<small>${layer.effects.length || "−"}</small></button>
    <button data-layer-visible="${layer.id}" title="Visible">${layer.visible ? "●" : "○"}</button>
    <button data-layer-lock="${layer.id}" title="Lock">${layer.locked ? "▣" : "□"}</button>
    <button class="layer-delete" data-delete-layer="${layer.id}" title="${t("delete")}">×</button>
  </article>`;
}

function keyframeTolerance() {
  return 1 / Math.max(1, project?.settings.fps || 30) / 2;
}

function keyframeAt(keys: Keyframe[] | undefined, time = currentTime) {
  return findKeyframeAt(keys, time, keyframeTolerance());
}

function keyframeFromRef(ref = selectedKeyRef) {
  if (!project || !ref) return undefined;
  const [layerId, property, timeText] = ref.split("|");
  const time = Number(timeText);
  if (property.startsWith("fx:")) {
    const [, effectId, parameter] = property.split(":");
    const effect = layerId === "__post__"
      ? project.postEffects.find((item) => item.id === effectId)
      : project.layers.find((item) => item.id === layerId)?.effects.find((item) => item.id === effectId);
    return effect?.keyframes?.[parameter]?.find((key) => Math.abs(key.time - time) <= keyframeTolerance());
  }
  return project.layers.find((item) => item.id === layerId)?.keyframes[property]?.find((key) => Math.abs(key.time - time) <= keyframeTolerance());
}

function renderCurveTools() {
  const keyframe = keyframeFromRef();
  if (!keyframe) return `<span class="curve-hint">SELECT KEYFRAME</span>`;
  const options: Array<[Easing, string]> = [
    ["linear", "LINEAR"],
    ["bezier", "BEZIER"],
    ["easeIn", "EASE IN"],
    ["easeOut", "EASE OUT"],
    ["easeInOut", "EASE IN/OUT"],
    ["hold", "HOLD"],
  ];
  return `<span>CURVE</span><select id="timeline-key-easing">${options.map(([value, label]) => `<option value="${value}" ${keyframe.easing === value ? "selected" : ""}>${label}</option>`).join("")}</select>${keyframe.easing === "bezier" ? `<label class="bezier-strength">TENSION <input id="timeline-bezier-strength" type="range" min="0" max="1" step=".01" value="${keyframe.curve ?? .75}"></label>` : ""}`;
}

function markRecordedTrack(token: string) {
  recordedTracks.add(token);
  const range = recordedRanges.get(token);
  if (range) {
    range.min = Math.min(range.min, currentTime);
    range.max = Math.max(range.max, currentTime);
  } else {
    recordedRanges.set(token, { min: currentTime, max: currentTime });
  }
}

// ---- Inspector edits. A control that changes continuously (typing, scrubbing,
// color picker) keeps one gesture open; its commands live in named slots so
// each preview is an absolute state rebuilt from where the gesture began.

type EditEntry = [slot: string, command: VctCommand];

interface EditSession {
  key: string;
  project: ProjectDocument;
  gesture: Gesture;
  slots: Map<string, VctCommand>;
  memo: Map<string, unknown>;
  rejected: boolean;
}

let editSession: EditSession | null = null;

function endEditSession() {
  const session = editSession;
  editSession = null;
  if (!session || session.project !== project) return;
  session.gesture.end();
  if (session.rejected) syncInspectorValues();
}

function openEditSession(key: string, label: string) {
  if (editSession?.key === key && editSession.project === project) return editSession;
  endEditSession();
  editSession = { key, project: project!, gesture: beginGesture(label), slots: new Map(), memo: new Map(), rejected: false };
  return editSession;
}

function previewEdit(session: EditSession, entries: EditEntry[]) {
  const previous = new Map(session.slots);
  for (const [slot, command] of entries) session.slots.set(slot, command);
  if (!session.gesture.preview([...session.slots.values()])) {
    session.slots = previous;
    session.rejected = true;
    return false;
  }
  session.rejected = false;
  // A recording that outgrows one command batch continues in a new undo step.
  if (session.slots.size > 400) endEditSession();
  return true;
}

function editLabel(pt: string, en: string) {
  return language === "pt-BR" ? pt : en;
}

const PROPERTY_LABELS: Record<string, [pt: string, en: string]> = {
  x: ["Posição X", "Position X"], y: ["Posição Y", "Position Y"],
  width: ["Largura", "Width"], height: ["Altura", "Height"],
  scaleX: ["Escala X", "Scale X"], scaleY: ["Escala Y", "Scale Y"],
  rotation: ["Rotação", "Rotation"], opacity: ["Opacidade", "Opacity"],
  fontSize: ["Tamanho da fonte", "Font size"], fontWeight: ["Peso da fonte", "Font weight"],
  fillOpacity: ["Opacidade do preenchimento", "Fill opacity"], strokeOpacity: ["Opacidade do traço", "Stroke opacity"],
  strokeWidth: ["Espessura do traço", "Stroke width"],
  startTime: ["Início", "Start"], endTime: ["Fim", "End"],
  sourceIn: ["Início da mídia", "Source in"], sourceOut: ["Fim da mídia", "Source out"],
  playbackRate: ["Velocidade", "Speed"], reverse: ["Reverso", "Reverse"], loop: ["Repetir", "Loop"],
  fadeInStart: ["Fade in", "Fade in"], fadeInEnd: ["Fade in", "Fade in"],
  fadeOutStart: ["Fade out", "Fade out"], fadeOutEnd: ["Fade out", "Fade out"],
  volume: ["Volume", "Volume"], muted: ["Mudo", "Mute"],
  name: ["Nome", "Name"], text: ["Texto", "Text"], fontFamily: ["Fonte", "Font"],
  blendMode: ["Mesclagem", "Blend mode"], geometry: ["Forma", "Shape"],
  fill: ["Cor", "Color"], stroke: ["Cor do traço", "Stroke color"],
  fillEnabled: ["Preenchimento", "Fill"], strokeEnabled: ["Traço", "Stroke"], exportable: ["Exportar guia", "Export guide"],
  scaleLocked: ["Proporção da escala", "Scale lock"], sizeLocked: ["Proporção do tamanho", "Size lock"],
};

function propertyLabel(property: string) {
  const entry = PROPERTY_LABELS[property];
  return entry ? editLabel(entry[0], entry[1]) : property;
}

function keyframeEditTime() {
  if (!project) return currentTime;
  const time = recordMode && playing ? Math.round(currentTime * project.settings.fps) / project.settings.fps : currentTime;
  return Math.min(time, project.settings.duration);
}

/** Commands that store a layer value: the property itself, plus a keyframe when it is animated or recording. */
function layerValueCommands(layer: Layer, property: string, value: number, props: Record<string, unknown> = { [property]: value }) {
  const recording = recordMode && playing && !TIMING_PROPERTIES.has(property);
  const keyed = Boolean(layer.keyframes[property]?.length) || recording;
  const entries: EditEntry[] = [[`set:${layer.id}`, { type: "layer.set", layerId: layer.id, props, ...(overlapMode ? { allowOverlap: true } : {}) }]];
  let created = false;
  if (keyed) {
    if (recording) markRecordedTrack(`layer:${layer.id}:${property}`);
    const time = keyframeEditTime();
    created = !keyframeAt(layer.keyframes[property], time);
    entries.push([`key:${layer.id}:${property}:${time}`, {
      type: "keyframe.upsert", layerId: layer.id, property, time, value, easing: recording ? "linear" : "easeInOut",
    }]);
  }
  return { entries, created };
}

/** Previews several layer values in one gesture; null when the edit was refused. */
function previewLayerValues(session: EditSession, layerId: string, values: Record<string, number>) {
  const layer = project?.layers.find((item) => item.id === layerId);
  if (!layer) return null;
  const entries: EditEntry[] = [];
  let created = false;
  for (const [property, value] of Object.entries(values)) {
    const result = layerValueCommands(layer, property, value);
    created = created || result.created;
    for (const [slot, command] of result.entries) entries.push([`${property}:${slot}`, command]);
  }
  return previewEdit(session, entries) ? { created } : null;
}

function effectValueCommands(effect: EffectNode, property: string, value: number) {
  const recording = recordMode && playing;
  const keyed = Boolean(effect.keyframes?.[property]?.length) || recording;
  const entries: EditEntry[] = [[`set:${effect.id}:${property}`, { type: "effect.setParam", effectId: effect.id, parameter: property, value }]];
  let created = false;
  if (keyed) {
    if (recording) markRecordedTrack(`effect:${effect.id}:${property}`);
    const time = keyframeEditTime();
    created = !keyframeAt(effect.keyframes?.[property], time);
    entries.push([`key:${effect.id}:${property}:${time}`, {
      type: "effect.keyframe.upsert", effectId: effect.id, property, time, value, easing: recording ? "linear" : "easeInOut",
    }]);
  }
  return { entries, created };
}

type KeyTarget = { layerId: string; property: string } | { effectId: string; property: string };

/** Rebuilds a keyframe track with one key changed (change returns null to delete it). */
function keyTrackCommand(target: KeyTarget, keys: readonly Keyframe[], time: number, change: (key: Keyframe) => Keyframe | null): VctCommand | null {
  const index = keys.findIndex((key) => Math.abs(key.time - time) <= keyframeTolerance());
  if (index < 0) return null;
  const next = keys.flatMap((key, position) => position === index ? change(key) ?? [] : [key]);
  return "effectId" in target
    ? { type: "effect.keyframe.set", effectId: target.effectId, property: target.property, keys: next }
    : { type: "keyframe.set", layerId: target.layerId, property: target.property, keys: next };
}

/** Resolves a timeline key reference ("layer|property|time" or "owner|fx:effect:parameter|time"). */
function keyRefTrack(ref: string) {
  if (!project || !ref) return undefined;
  const [layerId, property, timeText] = ref.split("|");
  const time = Number(timeText);
  if (property.startsWith("fx:")) {
    const [, effectId, parameter] = property.split(":");
    const effect = layerId === "__post__"
      ? project.postEffects.find((item) => item.id === effectId)
      : project.layers.find((item) => item.id === layerId)?.effects.find((item) => item.id === effectId);
    return { target: { effectId, property: parameter } as KeyTarget, keys: effect?.keyframes?.[parameter] ?? [], time };
  }
  return { target: { layerId, property } as KeyTarget, keys: project.layers.find((item) => item.id === layerId)?.keyframes[property] ?? [], time };
}

function withEasing(easing: Easing) {
  return (key: Keyframe): Keyframe => ({ ...key, easing, ...(easing === "bezier" ? { curve: key.curve ?? .75 } : {}) });
}



function syncLinkedAudioOrder(target: ProjectDocument | null = project) {
  if (!target) return;
  const layerOrder = new Map(target.layers.map((layer, index) => [layer.id, index]));
  const slots = target.audioTracks.map((track, index) => track.linked && track.linkedLayerId ? index : -1).filter((index) => index >= 0);
  const linked = target.audioTracks.filter((track) => track.linked && track.linkedLayerId)
    .sort((a, b) => (layerOrder.get(a.linkedLayerId!) ?? Number.MAX_SAFE_INTEGER) - (layerOrder.get(b.linkedLayerId!) ?? Number.MAX_SAFE_INTEGER));
  slots.forEach((slot, index) => target.audioTracks[slot] = linked[index]);
}

/** audio.reorderLane commands that make linked audio follow its layers' order, as syncLinkedAudioOrder does on a copy of the result. */
function linkedAudioOrderCommands(commands: VctCommand[]): VctCommand[] {
  if (!project) return [];
  let draft: ProjectDocument;
  try {
    draft = runProjectCommands(project, commands, keyframeTolerance()).project;
  } catch {
    return [];
  }
  const laneOrder = (doc: ProjectDocument) => [...new Set(doc.audioTracks.map(laneIdOf))];
  const current = laneOrder(draft);
  syncLinkedAudioOrder(draft);
  const extra: VctCommand[] = [];
  laneOrder(draft).forEach((laneId, index) => {
    if (current[index] === laneId) return;
    extra.push({ type: "audio.reorderLane", laneId, index });
    current.splice(current.indexOf(laneId), 1);
    current.splice(index, 0, laneId);
  });
  return extra;
}

/** Index a track takes when dropped before/after another one (for track.reorder). */
function trackDropIndex(trackId: string, targetTrackId: string, after: boolean) {
  if (!project || trackId === targetTrackId) return null;
  const others = visualTracks(project).map((track) => track.id).filter((id) => id !== trackId);
  const target = others.indexOf(targetTrackId);
  if (target < 0 || !visualTracks(project).some((track) => track.id === trackId)) return null;
  return target + (after ? 1 : 0);
}

function reorderLayerTracks(trackId: string, index: number) {
  const reorder: VctCommand[] = [{ type: "track.reorder", trackId, index }];
  return applyCommands([...reorder, ...linkedAudioOrderCommands(reorder)], editLabel("Ordem das camadas", "Layer order"));
}

// O renderer não anima tempo, fades, trechos de origem nem a sombra do texto; esses campos não mostram ◆.
const TIMING_PROPERTIES = new Set(["startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd", "sourceIn", "sourceOut", "shadowOpacity", "shadowBlur", "shadowX", "shadowY"]);

function numberField(label: string, property: keyof Layer, value: number, min: number, max: number, step: number) {
  const keys = selectedLayer()?.keyframes[String(property)] || [];
  const active = keyframeAt(keys);
  const layer = selectedLayer();
  const evaluated = layer && renderer ? renderer.layerValue(layer, property, currentTime) : value;
  const evaluatedValue = Number.isFinite(evaluated) ? evaluated : value;
  const displayedValue = property === "sourceOut" && layer && !layer.sourceOut ? value : evaluatedValue;
  const fill = clamp((displayedValue - min) / Math.max(step, max - min) * 100, 0, 100);
  const neutral = ({ scaleX: 1, scaleY: 1, opacity: 1, fillOpacity: 1, strokeOpacity: 1 } as Record<string, number>)[String(property)] ?? 0;
  return `<label class="numeric-field"><div class="param-scrub" data-param-scrub data-neutral="${neutral}" style="--value-fill:${fill}%;--value-ratio:${fill / 100}"><span>${label}</span><input type="number" readonly data-layer-property="${String(property)}" value="${Number(displayedValue.toFixed(4))}" min="${min}" max="${max}" step="${step}" title="Drag to adjust · Double-click to type"></div>${TIMING_PROPERTIES.has(String(property)) ? "" : `<button class="keyframe-button ${active ? "is-active" : ""}" data-keyframe="${String(property)}" title="${t("addKeyframe")}">◆</button>${active ? easingSelect("layer", String(property), active.easing) : ""}`}</label>`;
}

function easingSelect(scope: "layer" | "effect", property: string, value: Easing) {
  const options: Easing[] = ["linear", "bezier", "easeIn", "easeOut", "easeInOut", "hold"];
  return `<select class="easing-select" data-${scope}-easing="${property}">${options.map((item) => `<option value="${item}" ${item === value ? "selected" : ""}>${item}</option>`).join("")}</select>`;
}

function sectionTools(section: ClipboardSection) {
  return `<span class="section-tools"><button data-copy-section="${section}" title="Copy section">COPY</button><button data-paste-section="${section}" title="Paste section" ${parameterClipboard?.section === section ? "" : "disabled"}>PASTE</button></span>`;
}

function renderInspector() {
  if (!project) return "";
  const audioTrack = selectedAudioTrack();
  if (audioTrack) return renderAudioInspector(audioTrack);
  const layer = selectedLayer();
  const effect = selectedEffect();
  if (inspectedAsset) {
    const entry = listAssets(project).find((item) => item.id === inspectedAsset);
    if (entry) return renderAssetInspector(entry);
    inspectedAsset = "";
  }
  if (!layer) {
    if (project.postEffects.length) return `<div class="effect-chain global-chain"><h3>${t("post")}</h3>${renderEffectChain(project.postEffects)}</div>`;
    return `<p class="inspector-empty">${t("noSelection")}</p>`;
  }
  if (effect) return renderEffectInspector(layer, effect);
  const mediaDuration = layer.kind === "video"
    ? renderer?.mediaDuration(layer.id) || layer.sourceOut || project.settings.duration
    : 0;
  return `
    <div class="inspector-header"><input data-layer-text="name" value="${escapeHtml(layer.name)}"><span>${layerIcon(layer)}</span></div>
    <div class="inspector-scroll">
      <section class="property-group"><div class="property-group-title"><h3>${t("transform")}</h3>${sectionTools("transform")}</div>
        <div class="property-grid">
          ${numberField("X", "x", layer.x, -32768, 32768, 1)}
          ${numberField("Y", "y", layer.y, -32768, 32768, 1)}
          <div class="axis-lock-row"><button class="axis-lock ${layer.scaleLocked ? "is-active" : ""}" data-axis-lock="scaleLocked">${layer.scaleLocked ? "▣" : "□"} SCALE X/Y</button></div>
          ${numberField("SCALE X", "scaleX", layer.scaleX, -20, 20, .01)}
          ${numberField("SCALE Y", "scaleY", layer.scaleY, -20, 20, .01)}
          ${numberField("ROTATION", "rotation", layer.rotation, -3600, 3600, .1)}
          ${numberField("OPACITY", "opacity", layer.opacity, 0, 1, .01)}
          <div class="axis-lock-row"><button class="axis-lock ${layer.sizeLocked ? "is-active" : ""}" data-axis-lock="sizeLocked">${layer.sizeLocked ? "▣" : "□"} SIZE W/H</button></div>
          ${numberField("WIDTH", "width", layer.width, 1, 16384, 1)}
          ${numberField("HEIGHT", "height", layer.height, 1, 16384, 1)}
        </div>
      </section>
      ${renderContentProperties(layer)}
      <section class="property-group"><h3>${language === "pt-BR" ? "COMPOSIÇÃO" : "COMPOSITING"}</h3>
        <label class="select-field"><span>BLEND MODE</span><select data-layer-text="blendMode">${["normal", "add", "multiply", "screen", "lighten", "darken"].map((value) => `<option value="${value}" ${layer.blendMode === value ? "selected" : ""}>${value.toUpperCase()}</option>`).join("")}</select></label>
      </section>
      <section class="property-group"><div class="property-group-title"><h3>${t("timing")}</h3>${sectionTools("timing")}</div>
        <div class="property-grid">
          ${numberField("START", "startTime", layer.startTime, 0, project.settings.duration, .01)}
          ${numberField("END", "endTime", layer.endTime, 0, project.settings.duration, .01)}
        </div>
        ${layer.kind === "video" ? `
          <div class="video-transport-properties">
            <h4>VIDEO TRANSPORT</h4>
            <div class="property-grid">
              ${numberField("SPEED", "playbackRate", layer.playbackRate, .05, 8, .05)}
              ${numberField("SOURCE IN", "sourceIn", layer.sourceIn, 0, mediaDuration, .01)}
              ${numberField("SOURCE OUT", "sourceOut", layer.sourceOut || mediaDuration, 0, mediaDuration, .01)}
            </div>
            <div class="video-mode-row">
              <label class="check-row"><input type="checkbox" data-layer-check="reverse" ${layer.reverse ? "checked" : ""}><span>REVERSE</span></label>
              <label class="check-row"><input type="checkbox" data-layer-check="loop" ${layer.loop ? "checked" : ""}><span>LOOP SOURCE</span></label>
            </div>
          </div>` : ""}
        <h4 class="subsection-title">${layer.kind === "video" ? "VIDEO FADES" : "FADES"}</h4>
        <div class="property-grid fade-grid">
          ${numberField(language === "pt-BR" ? "FADE IN ATÉ" : "FADE IN UNTIL", "fadeInEnd", layer.fadeInEnd, 0, project.settings.duration, .01)}
          ${numberField(language === "pt-BR" ? "FADE OUT DESDE" : "FADE OUT FROM", "fadeOutStart", layer.fadeOutStart, 0, project.settings.duration, .01)}
        </div>
        ${renderTransitionControls(layer)}
        ${layer.kind === "guide" ? `<label class="check-row"><input type="checkbox" data-layer-check="exportable" ${layer.exportable ? "checked" : ""}><span>EXPORT GUIDE</span></label>` : ""}
      </section>
      <section class="property-group"><div class="property-group-title"><h3>${t("effects")}</h3>${sectionTools("effects")}</div>${renderEffectChain(layer.effects)}</section>
    </div>
    <div class="inspector-actions">${layer.asset ? `<button data-replace-layer-media="${layer.id}">${language === "pt-BR" ? "SUBSTITUIR MÍDIA" : "REPLACE MEDIA"}</button>` : ""}<button id="duplicate-layer">${t("duplicate")}</button><button class="danger" id="delete-layer">${t("delete")}</button></div>`;
}

function audioNumberField(label: string, property: keyof AudioTrack, value: number, min: number, max: number, step: number) {
  const fill = clamp((value - min) / Math.max(step, max - min) * 100, 0, 100);
  return `<label class="numeric-field"><div class="param-scrub" data-param-scrub data-neutral="${property === "volume" || property === "playbackRate" ? 1 : 0}" style="--value-fill:${fill}%;--value-ratio:${fill / 100}"><span>${label}</span><input type="number" readonly data-audio-property="${String(property)}" value="${Number(value.toFixed(4))}" min="${min}" max="${max}" step="${step}" title="Drag to adjust · Double-click to type"></div></label>`;
}

function renderAudioInspector(track: AudioTrack) {
  if (!project) return "";
  const mediaDuration = Math.max(track.sourceOut, track.endTime - track.startTime);
  return `<div class="inspector-header"><input data-audio-name value="${escapeHtml(track.name)}"><span>AUD</span></div>
    <div class="inspector-scroll">
      <section class="property-group"><div class="property-group-title"><h3>${language === "pt-BR" ? "ÁUDIO" : "AUDIO"}</h3>${sectionTools("audio")}</div>
        <div class="property-grid">
          ${audioNumberField("VOLUME", "volume", track.volume, 0, 2, .01)}
          ${audioNumberField("SPEED", "playbackRate", track.playbackRate, .05, 8, .05)}
          ${audioNumberField("START", "startTime", track.startTime, 0, project.settings.duration, .01)}
          ${audioNumberField("END", "endTime", track.endTime, 0, project.settings.duration, .01)}
          ${audioNumberField("SOURCE IN", "sourceIn", track.sourceIn, 0, mediaDuration, .01)}
          ${audioNumberField("SOURCE OUT", "sourceOut", track.sourceOut, 0, mediaDuration, .01)}
        </div>
        <h4 class="subsection-title">FADES</h4>
        <div class="property-grid fade-grid">
          ${audioNumberField(language === "pt-BR" ? "FADE IN ATÉ" : "FADE IN UNTIL", "fadeInEnd", track.fadeInEnd, 0, project.settings.duration, .01)}
          ${audioNumberField(language === "pt-BR" ? "FADE OUT DESDE" : "FADE OUT FROM", "fadeOutStart", track.fadeOutStart, 0, project.settings.duration, .01)}
        </div>
        <div class="property-grid audio-fade-lengths">
          <label class="field"><span>${language === "pt-BR" ? "FADE IN (s)" : "FADE IN (s)"}</span><input type="number" data-audio-fade="in" min="0" max="${Number((track.endTime - track.startTime).toFixed(3))}" step=".05" value="${Number((track.fadeInEnd - track.fadeInStart).toFixed(3))}"></label>
          <label class="field"><span>${language === "pt-BR" ? "FADE OUT (s)" : "FADE OUT (s)"}</span><input type="number" data-audio-fade="out" min="0" max="${Number((track.endTime - track.startTime).toFixed(3))}" step=".05" value="${Number((track.fadeOutEnd - track.fadeOutStart).toFixed(3))}"></label>
        </div>
        <div class="video-mode-row audio-mode-row">
          <label class="check-row"><input type="checkbox" data-audio-check="muted" ${track.muted ? "checked" : ""}><span>MUTE</span></label>
          <label class="check-row"><input type="checkbox" data-audio-check="reverse" ${track.reverse ? "checked" : ""}><span>REVERSE</span></label>
          <label class="check-row"><input type="checkbox" data-audio-check="loop" ${track.loop ? "checked" : ""}><span>LOOP</span></label>
          ${track.linkedLayerId ? `<button type="button" class="audio-link-button" data-audio-link-toggle aria-pressed="${track.linked}">${track.linked ? (language === "pt-BR" ? "Desvincular do vídeo" : "Unlink from video") : (language === "pt-BR" ? "Vincular ao vídeo" : "Link to video")}</button>` : ""}
        </div>
        <p class="asset-path ${hasWebAsset(track.asset) ? "" : "is-missing"}">${hasWebAsset(track.asset) ? "" : "MISSING MEDIA · "}${escapeHtml(track.asset)}</p>
      </section>
      <section class="property-group audio-fx-group"><div class="property-group-title"><h3>AUDIO FX</h3></div>
        <div class="audio-fx-add">${(["lowpass", "highpass", "eq3", "delay", "compressor", "reverb"] as AudioEffectKind[]).map((kind) => `<button data-add-audio-effect="${kind}">+ ${audioEffectLabel(kind)}</button>`).join("")}</div>
        <div class="audio-fx-chain">${track.effects.map((effect) => renderAudioEffect(effect)).join("") || `<p class="empty-effects">+ AUDIO FX</p>`}</div>
      </section>
    </div>
    <div class="inspector-actions"><button data-replace-audio-media="${track.id}">${track.linked && track.linkedLayerId ? (language === "pt-BR" ? "SUBSTITUIR VÍDEO + ÁUDIO" : "REPLACE VIDEO + AUDIO") : (language === "pt-BR" ? "SUBSTITUIR ÁUDIO" : "REPLACE AUDIO")}</button><button class="danger" id="delete-audio-track">${t("delete")}</button></div>`;
}

function audioEffectLabel(kind: AudioEffectKind) {
  return AUDIO_EFFECT_CATALOG[kind].label;
}

function audioEffectDefinitions(effect: AudioEffectNode): readonly EffectParameterDefinition[] {
  return AUDIO_EFFECT_PARAMETERS[effect.kind];
}

function renderAudioEffect(effect: AudioEffectNode) {
  return `<article class="audio-fx-item ${effect.enabled ? "" : "is-disabled"}">
    <header><button data-toggle-audio-effect="${effect.id}">${effect.enabled ? "●" : "○"}</button><strong>${audioEffectLabel(effect.kind)}</strong><span class="audio-fx-order"><button data-move-audio-effect="${effect.id}" data-direction="-1">▲</button><button data-move-audio-effect="${effect.id}" data-direction="1">▼</button></span><button data-remove-audio-effect="${effect.id}">×</button></header>
    <div class="property-grid">${audioEffectDefinitions(effect).map(([label, key, min, max, step]) => {
      const value = effect.params[key];
      const fill = clamp((value - min) / (max - min) * 100, 0, 100);
      return `<label class="numeric-field"><div class="param-scrub" data-param-scrub data-neutral="0" style="--value-fill:${fill}%;--value-ratio:${fill / 100}"><span>${label}</span><input type="number" readonly data-audio-effect-param="${key}" data-audio-effect-id="${effect.id}" value="${value}" min="${min}" max="${max}" step="${step}"></div></label>`;
    }).join("")}</div>
  </article>`;
}

function renderContentProperties(layer: Layer) {
  if (layer.kind === "geometry") return `
    <section class="property-group"><h3>${t("appearance")}</h3>
      <label class="select-field"><span>SHAPE</span><select data-layer-text="geometry">${["rectangle", "ellipse", "triangle", "polygon", "line"].map((value) => `<option ${layer.geometry === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      ${renderColorControls(layer)}
    </section>`;
  if (layer.kind === "text") return `
    <section class="property-group"><h3>${t("text")}</h3>
      <label class="text-area-field"><span>CONTENT</span><textarea data-layer-text="text">${escapeHtml(layer.text)}</textarea></label>
      <p class="text-overflow-warning" data-text-overflow role="status" hidden>${language === "pt-BR" ? "O texto não cabe na caixa. Aumente a altura ou reduza a fonte." : "The text does not fit the box. Increase the height or reduce the font size."}</p>
      <label class="select-field"><span>FONT</span><select data-layer-text="fontFamily">${["IBM Plex Sans", "IBM Plex Mono", "Inter", "Space Grotesk", "Syne"].map((value) => `<option value="${value}" ${layer.fontFamily === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      <div class="property-grid">${numberField("FONT SIZE", "fontSize", layer.fontSize || 80, 4, 2000, 1)}${numberField("WEIGHT", "fontWeight", layer.fontWeight || 500, 100, 900, 100)}</div>
      ${renderAlignButtons(layer)}
      ${renderColorControls(layer)}
    </section>
    ${renderTextShadow(layer)}
    ${renderTextStyles()}
    ${renderTextAnimation()}`;
  return `<section class="property-group"><h3>ASSET</h3><p class="asset-path ${layer.asset && !hasWebAsset(layer.asset) ? "is-missing" : ""}">${layer.asset && !hasWebAsset(layer.asset) ? "MISSING MEDIA · " : ""}${escapeHtml(layer.asset || "")}</p></section>`;
}

const TEXT_STYLES_KEY = "nt-vct-text-styles";
const TEXT_STYLE_FIELDS = ["fontFamily", "fontSize", "fontWeight", "align", "fill", "fillOpacity", "fillEnabled", "stroke", "strokeOpacity", "strokeWidth", "strokeEnabled", "shadowColor", "shadowOpacity", "shadowBlur", "shadowX", "shadowY"] as const;
interface TextStyle { name: string; props: Record<string, unknown> }

function loadTextStyles(): TextStyle[] {
  try {
    const stored = JSON.parse(localStorage.getItem(TEXT_STYLES_KEY) || "[]");
    return Array.isArray(stored) ? stored.filter((item): item is TextStyle => typeof item?.name === "string" && typeof item.props === "object" && item.props !== null) : [];
  } catch {
    return [];
  }
}

function saveTextStyles(styles: TextStyle[]) {
  try {
    localStorage.setItem(TEXT_STYLES_KEY, JSON.stringify(styles));
  } catch {
    setStatus(language === "pt-BR" ? "ESTILOS: ARMAZENAMENTO INDISPONÍVEL" : "STYLES: STORAGE UNAVAILABLE");
  }
}

function textStyleOf(layer: Layer): TextStyle["props"] {
  const props: Record<string, unknown> = {};
  for (const field of TEXT_STYLE_FIELDS) if (layer[field] !== undefined) props[field] = layer[field];
  return props;
}

function renderAlignButtons(layer: Layer) {
  const pt = language === "pt-BR";
  const current = layer.align || "center";
  const options: Array<[CanvasTextAlign, string, string]> = [
    ["left", pt ? "Alinhar à esquerda" : "Align left", "M3 5h14M3 9h9M3 13h14M3 17h9"],
    ["center", pt ? "Centralizar" : "Align center", "M3 5h14M6 9h8M3 13h14M6 17h8"],
    ["right", pt ? "Alinhar à direita" : "Align right", "M3 5h14M8 9h9M3 13h14M8 17h9"],
  ];
  return `<div class="align-row" role="group" aria-label="${pt ? "Alinhamento do texto" : "Text alignment"}">${options.map(([value, label, path]) =>
    `<button type="button" data-text-align="${value}" aria-pressed="${current === value}" aria-label="${label}" title="${label}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg></button>`).join("")}</div>`;
}

function textShadowOn(layer: Layer) {
  return Boolean(layer.shadowColor) && (layer.shadowOpacity ?? .6) > 0;
}

function renderTextShadow(layer: Layer) {
  const pt = language === "pt-BR";
  const on = textShadowOn(layer);
  return `<section class="property-group text-shadow-group"><h3>${pt ? "Sombra" : "Shadow"}</h3>
    <label class="check-field"><input type="checkbox" data-shadow-toggle ${on ? "checked" : ""}><span>${pt ? "Sombra no texto" : "Text shadow"}</span></label>
    <div class="shadow-fields" ${on ? "" : "hidden"}>
      <label class="color-field"><span>${pt ? "COR" : "COLOR"}</span><input type="color" data-shadow-color value="${layer.shadowColor || "#000000"}"></label>
      <div class="property-grid">${numberField(pt ? "OPACIDADE" : "OPACITY", "shadowOpacity", layer.shadowOpacity ?? .6, 0, 1, .01)}${numberField("BLUR", "shadowBlur", layer.shadowBlur ?? 12, 0, 200, 1)}</div>
      <div class="property-grid">${numberField("X", "shadowX", layer.shadowX ?? 0, -500, 500, 1)}${numberField("Y", "shadowY", layer.shadowY ?? 4, -500, 500, 1)}</div>
    </div>
  </section>`;
}

function renderTextStyles() {
  const pt = language === "pt-BR";
  const styles = loadTextStyles();
  const options = styles.length ? styles.map((style, index) => `<option value="${index}">${escapeHtml(style.name)}</option>`).join("") : `<option>${pt ? "Nenhum estilo salvo" : "No saved styles"}</option>`;
  return `<section class="property-group text-styles-group"><h3>${pt ? "Estilo" : "Style"}</h3>
    <div class="style-row">
      <label class="select-field"><span>${pt ? "SALVOS" : "SAVED"}</span><select data-text-style-list ${styles.length ? "" : "disabled"}>${options}</select></label>
      <button type="button" data-text-style-apply ${styles.length ? "" : "disabled"}>${pt ? "Aplicar" : "Apply"}</button>
      <button type="button" class="danger" data-text-style-delete ${styles.length ? "" : "disabled"}>${pt ? "Excluir" : "Delete"}</button>
    </div>
    <div class="style-row">
      <label class="text-field"><span>${pt ? "NOME" : "NAME"}</span><input type="text" data-text-style-name maxlength="40" autocomplete="off" placeholder="${pt ? "Nome do estilo" : "Style name"}"></label>
      <button type="button" data-text-style-save>${pt ? "Salvar estilo" : "Save style"}</button>
    </div>
  </section>`;
}

const TEXT_ANIMATIONS: Array<[string, string, string]> = [["fade", "Fade", "Fade"], ["slide-up", "Subir", "Slide up"], ["pop", "Pop", "Pop"], ["none", "Nenhuma", "None"]];

function renderTextAnimation() {
  const pt = language === "pt-BR";
  const options = (selected: string) => TEXT_ANIMATIONS.map(([value, ptLabel, enLabel]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${pt ? ptLabel : enLabel}</option>`).join("");
  return `<section class="property-group text-animation-group"><h3>${pt ? "Animação" : "Animation"}</h3>
    <div class="property-grid">
      <label class="select-field"><span>${pt ? "ENTRADA" : "IN"}</span><select data-anim-in>${options("fade")}</select></label>
      <label class="select-field"><span>${pt ? "SAÍDA" : "OUT"}</span><select data-anim-out>${options("fade")}</select></label>
    </div>
    <label class="text-field"><span>${pt ? "DURAÇÃO (s)" : "DURATION (s)"}</span><input type="number" data-anim-duration value="0.4" min="0.05" max="10" step="0.05"></label>
    <button type="button" class="wide-button" data-anim-apply>${pt ? "Aplicar" : "Apply"}</button>
  </section>`;
}

function renderColorControls(layer: Layer) {
  const fillActive = Boolean(keyframeAt(layer.keyframes.fillColor));
  const strokeActive = Boolean(keyframeAt(layer.keyframes.strokeColor));
  const fill = renderer?.layerColor(layer, "fill", currentTime) || layer.fill;
  const stroke = renderer?.layerColor(layer, "stroke", currentTime) || layer.stroke;
  return `<div class="color-row">
    <label><input type="checkbox" data-layer-check="fillEnabled" ${layer.fillEnabled ? "checked" : ""}>FILL<input type="color" data-layer-text="fill" value="${fill}"><button class="keyframe-button ${fillActive ? "is-active" : ""}" data-color-keyframe="fill">◆</button></label>
    <label><input type="checkbox" data-layer-check="strokeEnabled" ${layer.strokeEnabled ? "checked" : ""}>STROKE<input type="color" data-layer-text="stroke" value="${stroke}"><button class="keyframe-button ${strokeActive ? "is-active" : ""}" data-color-keyframe="stroke">◆</button></label>
  </div>
  <div class="property-grid color-alpha-grid">
    ${numberField("FILL ALPHA", "fillOpacity", layer.fillOpacity, 0, 1, .01)}
    ${numberField("STROKE ALPHA", "strokeOpacity", layer.strokeOpacity, 0, 1, .01)}
  </div>
  <div class="property-grid">${numberField("STROKE", "strokeWidth", layer.strokeWidth, 0, 1000, .5)}</div>`;
}

function renderEffectChain(effects: EffectNode[]) {
  if (!effects.length) return `<p class="empty-effects">+ FX</p>`;
  return `<div class="effect-chain">${effects.map((effect) => `<article class="effect-item ${effect.id === selectedEffectId ? "is-selected" : ""}" draggable="true" data-effect-id="${effect.id}">
    <span class="effect-order"><button data-move-effect="${effect.id}" data-direction="-1" title="Move up">▲</button><button data-move-effect="${effect.id}" data-direction="1" title="Move down">▼</button></span>
    <button class="effect-drag" title="Drag effect">⠿</button>
    <button data-toggle-effect="${effect.id}">${effect.enabled ? "●" : "○"}</button>
    <button class="effect-name" data-select-effect="${effect.id}">${effectLabel(effect.kind)}</button>
    <button data-remove-effect="${effect.id}">×</button>
  </article>`).join("")}</div>`;
}

function effectParamDefinition(effect: EffectNode, layer: Layer) {
  return EFFECT_PARAMETERS[effect.kind].map(([label, key, min, max, step]) => {
    if (effect.kind !== "animaTracer") return [label, key, min, max, step] as const;
    if (key === "sensitivity") return [layer.kind === "image" || layer.kind === "video" || layer.kind === "guide" ? "EDGE SENSITIVITY" : "LINE SENSITIVITY", key, min, max, step] as const;
    if (key === "thickness") return [layer.kind === "image" || layer.kind === "video" || layer.kind === "guide" ? "LINE THICKNESS" : "STROKE WIDTH", key, min, max, step] as const;
    return [label, key, min, max, step] as const;
  });
}

function renderEffectInspector(layer: Layer, effect: EffectNode) {
  return `<div class="inspector-header effect-inspector-header"><button id="back-to-layer">←</button><strong>${effectLabel(effect.kind)}</strong><button data-toggle-effect="${effect.id}">${effect.enabled ? "ON" : "OFF"}</button></div>
    <div class="inspector-scroll"><section class="property-group">
      <p class="effect-description">${effect.kind === "animaTracer" ? (layer.kind === "text" || layer.kind === "geometry" ? "Vector/alpha contour reveal" : "Raster edge detection and animated reveal") : effect.kind === "glow" ? "Multi-scale highlight bloom with soft threshold" : "GPU shader effect"}</p>
      <div class="effect-params">${[...effectParamDefinition(effect, layer), ["DRY / WET", "mix", 0, 1, .01] as [string, string, number, number, number]].map(([label, key, min, max, step]) => {
        const keyframe = keyframeAt(effect.keyframes?.[key]);
        const displayedValue = renderer?.effectValue(effect, key, currentTime) ?? effect.params[key];
        const center = min + Math.round((max - min) / step / 2) * step;
        const fill = clamp((displayedValue - min) / Math.max(step, max - min) * 100, 0, 100);
        return `<label class="effect-param-field"><div class="param-scrub" data-param-scrub data-neutral="${center}" style="--value-fill:${fill}%;--value-ratio:${fill / 100}"><span>${label}</span><input type="number" readonly data-effect-param="${key}" min="${min}" max="${max}" step="${step}" value="${Number(displayedValue.toFixed(4))}" title="Drag to adjust · Double-click to type"></div><button class="keyframe-button ${keyframe ? "is-active" : ""}" data-effect-keyframe="${key}" title="${t("addKeyframe")}">◆</button>${keyframe ? easingSelect("effect", key, keyframe.easing) : ""}</label>`;
      }).join("")}</div>
    </section></div>
    <div class="inspector-actions"><button class="danger" data-remove-effect="${effect.id}">${t("delete")}</button></div>`;
}

function renderTimeline() {
  if (!project) return "";
  const duration = project.settings.duration;
  const viewportWidth = app.querySelector<HTMLElement>(".timeline-scroll")?.clientWidth || 800;
  const ticks = rulerTicks(duration, project.settings.fps, viewportWidth * timelineZoomX);
  const rows = timelineRows();
  const area = project.settings.workArea;
  const areaBand = area ? `<i class="work-area-band" style="left:${area.in / duration * 100}%;width:${(area.out - area.in) / duration * 100}%"></i>` : "";
  return `
    <header class="timeline-header">
      <div class="transport">
        <button id="to-start" aria-label="${language === "pt-BR" ? "Ir ao início" : "Go to start"}">|◀</button><button class="play-button" id="play" aria-label="${language === "pt-BR" ? "Tocar / pausar" : "Play / pause"}">${playing ? "❚❚" : "▶"}</button><button id="to-end" aria-label="${language === "pt-BR" ? "Ir ao fim" : "Go to end"}">▶|</button>
        <button class="loop-button ${timelineLoop ? "is-active" : ""}" id="timeline-loop" title="Loop" aria-label="Loop" aria-pressed="${timelineLoop}">↻</button>
        <button class="record-button ${recordMode ? "is-active" : ""}" id="record-mode" title="Record automation" aria-pressed="${recordMode}"><i></i> REC</button>
        <span class="time-display">${formatTime(currentTime)} <small>/ ${formatTime(duration)}</small></span>
        <span class="level-meter" id="level-meter" title="${language === "pt-BR" ? "Nível do áudio" : "Audio level"}" role="img" aria-label="${language === "pt-BR" ? "Nível do áudio" : "Audio level"}"><i style="width:0%"></i></span>
        <button class="add-track-button" id="add-track" title="${language === "pt-BR" ? "Criar faixa de vídeo vazia no topo" : "Create an empty video track on top"}">+ ${language === "pt-BR" ? "faixa" : "track"}</button>
      </div>
      <div class="curve-tools" id="curve-tools">${renderCurveTools()}</div>
      <div class="timeline-zoom-controls">
        <span title="${language === "pt-BR" ? "Zoom horizontal" : "Horizontal zoom"}">H</span>
        <button data-timeline-zoom="x:-1" title="${language === "pt-BR" ? "Reduzir zoom horizontal" : "Zoom out horizontally"}" aria-label="${language === "pt-BR" ? "Reduzir zoom horizontal" : "Zoom out horizontally"}"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="M4.8 8h6.4M12 12l5 5"/></svg></button>
        <button data-timeline-zoom="x:1" title="${language === "pt-BR" ? "Ampliar zoom horizontal" : "Zoom in horizontally"}" aria-label="${language === "pt-BR" ? "Ampliar zoom horizontal" : "Zoom in horizontally"}"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="M4.8 8h6.4M8 4.8v6.4M12 12l5 5"/></svg></button>
        <span title="${language === "pt-BR" ? "Zoom vertical" : "Vertical zoom"}">V</span>
        <button data-timeline-zoom="y:-1" title="${language === "pt-BR" ? "Reduzir zoom vertical" : "Zoom out vertically"}" aria-label="${language === "pt-BR" ? "Reduzir zoom vertical" : "Zoom out vertically"}"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="M4.8 8h6.4M12 12l5 5"/></svg></button>
        <button data-timeline-zoom="y:1" title="${language === "pt-BR" ? "Ampliar zoom vertical" : "Zoom in vertically"}" aria-label="${language === "pt-BR" ? "Ampliar zoom vertical" : "Zoom in vertically"}"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="M4.8 8h6.4M8 4.8v6.4M12 12l5 5"/></svg></button>
      </div>
      <button class="split-button overlap-toggle ${overlapMode ? "is-active" : ""}" id="overlap-mode" aria-pressed="${overlapMode}" title="${language === "pt-BR" ? "Sobrepor: clipes da mesma faixa podem se sobrepor e a sobreposição vira transição" : "Overlap: clips on a track may overlap; the overlap becomes a transition"}" aria-label="${language === "pt-BR" ? "Modo Sobrepor" : "Overlap mode"}"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5" width="9" height="10" rx="1.5"/><rect x="8.5" y="5" width="9" height="10" rx="1.5"/></svg></button>
      <button class="split-button" id="split-clip" title="${language === "pt-BR" ? "Cortar no playhead (S)" : "Split at playhead (S)"}" aria-label="${language === "pt-BR" ? "Cortar no playhead" : "Split at playhead"}"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2.5"/><circle cx="5.5" cy="14.5" r="2.5"/><path d="M7.6 7l9.4 8M7.6 13l9.4-8"/></svg></button>
      <button class="snap-toggle ${timelineSnap ? "is-active" : ""}" id="timeline-snap" title="${language === "pt-BR" ? "Snap em frames, bordas, clipes e keyframes" : "Snap to frames, edges, clips and keyframes"}">SNAP</button>
      <label class="duration-field">${t("duration").toUpperCase()} <input id="duration-input" type="text" inputmode="numeric" spellcheck="false" autocomplete="off" value="${formatDurationValue(duration, project.settings.fps, durationUnit)}" title="${durationUnit === "frames" ? "Frames" : "HH:MM:SS:FF"}"><select id="duration-unit" aria-label="${language === "pt-BR" ? "Unidade da duração" : "Duration unit"}"><option value="tc" ${durationUnit === "tc" ? "selected" : ""}>HH:MM:SS:FF</option><option value="frames" ${durationUnit === "frames" ? "selected" : ""}>FRAMES</option></select></label>
      <span id="frame-value">${t("frame").toUpperCase()} ${Math.round(currentTime * project.settings.fps)}</span>
    </header>
    <div class="timeline-body" style="--track-height:${Math.round(25 * timelineZoomY)}px">
      <div class="timeline-corner area-tools">
        <button id="area-in" aria-label="${language === "pt-BR" ? "Início da região de trabalho" : "Work area in"}" title="${language === "pt-BR" ? "Início da região de trabalho no playhead (I)" : "Set work area in at playhead (I)"}">[</button>
        <button id="area-out" aria-label="${language === "pt-BR" ? "Fim da região de trabalho" : "Work area out"}" title="${language === "pt-BR" ? "Fim da região de trabalho no playhead (O)" : "Set work area out at playhead (O)"}">]</button>
        <button id="area-clear" ${area ? "" : "disabled"} title="${language === "pt-BR" ? "Limpar região de trabalho (Alt+X)" : "Clear work area (Alt+X)"}" aria-label="${language === "pt-BR" ? "Limpar região de trabalho" : "Clear work area"}">[×]</button>
        <button id="close-gaps" title="${language === "pt-BR" ? "Fechar espaços vazios da faixa selecionada" : "Close gaps on the selected track"}" aria-label="${language === "pt-BR" ? "Fechar espaços" : "Close gaps"}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4v12M17 4v12M6.5 10h2.5M13.5 10H11M8 8l-1.5 2L8 12M12 8l1.5 2-1.5 2"/></svg></button>
      </div>
      <div class="timeline-labels">${rows.map(renderTimelineLabel).join("")}</div>
      <div class="timeline-scroll">
        <div class="timeline-content" style="width:${timelineZoomX * 100}%">
          <div class="time-ruler">${areaBand}${ticks.map((tick) => `<span style="left:${tick.time / duration * 100}%">${tick.label}</span>`).join("")}</div>
          <div class="timeline-tracks" id="timeline-tracks">
            ${rows.map((row) => renderTimelineTrack(row, duration)).join("")}
            ${areaBand}${renderGridLines(viewportWidth * timelineZoomX)}
            <div class="timeline-cursor" id="timeline-cursor" style="left:${currentTime / duration * 100}%"><span></span></div>
          </div>
        </div>
      </div>
      ${renderMinimap()}
    </div>`;
}

/** Beat lines of the musical grid; omitted when beats would be closer than 6 px. */
function renderGridLines(contentPixels: number) {
  const grid = project?.settings.grid;
  if (!project || !grid) return "";
  const beat = 60 / grid.bpm;
  if (beat / project.settings.duration * contentPixels < 6) return "";
  const duration = project.settings.duration;
  return gridTimes(project.settings).map((time) => {
    const index = Math.round((time - grid.offset) / beat);
    const bar = ((index % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
    return `<i class="grid-line ${bar ? "is-bar" : ""}" style="left:${time / duration * 100}%"></i>`;
  }).join("");
}

function renderMinimap() {
  if (!project) return "";
  const duration = project.settings.duration;
  const marks = [...project.layers, ...project.audioTracks].slice(0, 400)
    .map((item) => `<i style="left:${item.startTime / duration * 100}%;width:${Math.max(.3, (item.endTime - item.startTime) / duration * 100)}%"></i>`).join("");
  return `<div class="timeline-minimap" id="timeline-minimap" aria-hidden="true">${marks}<b style="left:0;width:${100 / timelineZoomX}%"></b></div>`;
}

type TimelineRow =
  | { type: "videoHeader" }
  | { type: "layer"; layer: Layer; clips: Layer[]; trackId: string }
  | { type: "effect"; layer: Layer; effect: EffectNode }
  | { type: "post"; effects: EffectNode[] }
  | { type: "postEffect"; effect: EffectNode }
  | { type: "audioHeader" }
  | { type: "audio"; track: AudioTrack; clips: AudioTrack[]; laneId: string }
  | { type: "empty"; kind: "video" | "audio"; trackId: string };

function timelineRows(): TimelineRow[] {
  if (!project) return [];
  const rows: TimelineRow[] = [];
  rows.push({ type: "videoHeader" });
  // Uma linha por faixa; a faixa mostra todos os seus clipes. O clipe selecionado
  // (ou o primeiro) dá nome à linha.
  for (const track of visualTracks(project)) {
    if (!track.clips.length) {
      rows.push({ type: "empty", kind: "video", trackId: track.id });
      continue;
    }
    const layer = track.clips.find((clip) => clip.id === selectedLayerId) || track.clips[0];
    rows.push({ type: "layer", layer, clips: track.clips, trackId: track.id });
    for (const clip of track.clips) {
      if (!expandedTimelineLayers.has(clip.id)) continue;
      for (const effect of clip.effects) rows.push({ type: "effect", layer: clip, effect });
    }
  }
  rows.push({ type: "post", effects: project.postEffects });
  if (timelinePostExpanded) {
    for (const effect of project.postEffects) rows.push({ type: "postEffect", effect });
  }
  rows.push({ type: "audioHeader" });
  for (const lane of audioLanes(project)) {
    if (!lane.clips.length) {
      rows.push({ type: "empty", kind: "audio", trackId: lane.id });
      continue;
    }
    const track = lane.clips.find((clip) => clip.id === selectedAudioTrackId) || lane.clips[0];
    rows.push({ type: "audio", track, clips: lane.clips, laneId: lane.id });
  }
  return rows;
}

function timelineAssetUrl(layer: Layer) {
  if (!layer.asset) return "";
  return resolveAssetUrl(layer.asset);
}

function timelineThumbnail(layer: Layer) {
  if (layer.kind === "image" || layer.kind === "guide") {
    return `<span class="timeline-thumb"><img src="${timelineAssetUrl(layer)}" alt=""></span>`;
  }
  if (layer.kind === "video") {
    const thumbnail = clipThumbnailFrames(layer, 1)[0];
    return `<span class="timeline-thumb">${thumbnail ? `<img src="${thumbnail}" alt="">` : ""}<i>VID</i></span>`;
  }
  if (layer.kind === "text") return `<span class="timeline-thumb timeline-thumb-text">${escapeHtml((layer.text || "T").slice(0, 2))}</span>`;
  return `<span class="timeline-thumb timeline-thumb-shape"><i style="background:${escapeHtml(layer.fill)}"></i></span>`;
}

async function generateVideoThumbnails(layer: Layer) {
  const asset = layer.asset;
  if (!asset || videoThumbnailCache.has(asset)) return;
  videoThumbnailCache.set(asset, []);
  const previousJob = videoThumbnailQueue.catch(() => undefined);
  let releaseQueue!: () => void;
  const queueGate = new Promise<void>((resolve) => releaseQueue = resolve);
  videoThumbnailQueue = previousJob.then(() => queueGate);
  await previousJob;
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.src = resolveAssetUrl(asset);
  try {
    while (playing) await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("thumbnail metadata")), { once: true });
      video.load();
    });
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 68;
    const context = canvas.getContext("2d")!;
    const frames: string[] = [];
    for (let index = 0; index < VIDEO_THUMBNAIL_FRAMES; index++) {
      while (playing) await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
      video.currentTime = Math.min(Math.max(0, video.duration - .02), video.duration * (index + .5) / VIDEO_THUMBNAIL_FRAMES);
      await new Promise<void>((resolve) => video.addEventListener("seeked", () => resolve(), { once: true }));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", .62));
    }
    videoThumbnailCache.set(asset, frames);
    videoThumbnailDuration.set(asset, video.duration);
    requestTimelineRefresh();
  } catch {
    videoThumbnailCache.delete(asset);
  } finally {
    video.removeAttribute("src");
    video.load();
    releaseQueue();
  }
}

async function generateAudioWaveform(asset: string) {
  if (!asset || audioWaveformCache.has(asset)) return;
  audioWaveformCache.set(asset, []);
  try {
    const buffer = await probeAudio(asset);
    const data = buffer.getChannelData(0);
    const count = 720;
    const peaks = Array.from({ length: count }, (_, index) => {
      const start = Math.floor(index / count * data.length);
      const end = Math.max(start + 1, Math.floor((index + 1) / count * data.length));
      let peak = 0;
      for (let cursor = start; cursor < end; cursor += Math.max(1, Math.floor((end - start) / 64))) peak = Math.max(peak, Math.abs(data[cursor]));
      return peak;
    });
    const max = Math.max(.001, ...peaks);
    audioWaveformCache.set(asset, peaks.map((peak) => peak / max));
    audioWaveformDuration.set(asset, buffer.duration);
    requestTimelineRefresh();
  } catch {
    audioWaveformCache.delete(asset);
  }
}

// Quadros do trecho que o clipe realmente mostra (respeita trim, velocidade e reverse).
function clipThumbnailFrames(layer: Layer, count: number) {
  const frames = layer.asset ? videoThumbnailCache.get(layer.asset) || [] : [];
  const mediaDuration = layer.asset ? videoThumbnailDuration.get(layer.asset) || 0 : 0;
  if (!frames.length || mediaDuration <= 0) return frames.slice(0, count);
  const length = Math.max(.001, layer.endTime - layer.startTime);
  return Array.from({ length: count }, (_, index) => {
    const time = layer.startTime + length * (index + .5) / count;
    const source = sourceTimeFor(layer, time, mediaDuration, layer.playbackRate);
    const frame = Math.round(source / mediaDuration * frames.length - .5);
    return frames[Math.max(0, Math.min(frames.length - 1, frame))];
  });
}

function videoStrip(layer: Layer) {
  const frames = clipThumbnailFrames(layer, 6);
  return `<i class="clip-media-strip video-strip">${frames.map((source) => `<img src="${source}" alt="">`).join("")}</i>`;
}

// Onda só do trecho que o clipe toca (respeita trim, corte, velocidade e reverse).
function clipWaveformPeaks(track: AudioTrack, count = 180) {
  const peaks = audioWaveformCache.get(track.asset) || [];
  const mediaDuration = audioWaveformDuration.get(track.asset) || 0;
  if (!peaks.length || mediaDuration <= 0) return peaks;
  const sourceIn = Math.max(0, Math.min(mediaDuration, track.sourceIn));
  const sourceOut = track.sourceOut > sourceIn ? Math.min(mediaDuration, track.sourceOut) : mediaDuration;
  const played = Math.min(sourceOut - sourceIn, (track.endTime - track.startTime) * Math.max(.05, Math.abs(track.playbackRate || 1)));
  return Array.from({ length: count }, (_, index) => {
    const offset = played * (index + .5) / count;
    const source = track.reverse ? sourceOut - offset : sourceIn + offset;
    return peaks[Math.max(0, Math.min(peaks.length - 1, Math.floor(source / mediaDuration * peaks.length)))];
  });
}

function waveformSvg(track: AudioTrack) {
  const peaks = clipWaveformPeaks(track);
  if (!peaks.length) return `<i class="audio-waveform"></i>`;
  const waveform = peaks.map((peak, index) => {
    const x = index / Math.max(1, peaks.length - 1) * 100;
    const amplitude = Math.max(1.5, peak * 45);
    return `M${x.toFixed(3)} ${(50 - amplitude).toFixed(3)}V${(50 + amplitude).toFixed(3)}`;
  }).join(" ");
  return `<svg class="clip-media-strip audio-waveform-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${waveform}"/><line x1="0" y1="50" x2="100" y2="50"/></svg>`;
}

function timelineRowHeight(row: TimelineRow) {
  if (row.type === "videoHeader" || row.type === "audioHeader") return 25;
  return Math.round(25 * timelineZoomY * (row.type === "audio" || (row.type === "empty" && row.kind === "audio") ? audioTrackZoomY : videoTrackZoomY));
}

function layerClipMedia(layer: Layer) {
  if (layer.kind === "video") return videoStrip(layer);
  if ((layer.kind === "image" || layer.kind === "guide") && layer.asset) {
    return `<i class="clip-media-strip image-strip" style="background-image:url('${timelineAssetUrl(layer)}')"></i>`;
  }
  if (layer.kind === "text") return `<i class="clip-media-strip generated-strip text-clip-strip">${escapeHtml(layer.text || layer.name)}</i>`;
  return `<i class="clip-media-strip generated-strip geometry-clip-strip"><span style="background:${escapeHtml(layer.fill)}"></span>${escapeHtml(layer.geometry || "SHAPE")}</i>`;
}

function fadeHandles(item: Pick<Layer, "startTime" | "endTime" | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">, scope: "layer" | "audio", id: string) {
  const duration = Math.max(.001, item.endTime - item.startTime);
  const marker = (property: "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd", edge: "top" | "bottom") => {
    const left = (item[property] - item.startTime) / duration * 100;
    return `<button class="fade-handle ${edge} ${property.startsWith("fadeIn") ? "is-in" : "is-out"}" data-fade-handle data-fade-scope="${scope}" data-fade-id="${id}" data-fade-property="${property}" style="left:${left}%" title="${property}"></button>`;
  };
  // Uma alça por lado: o fade é ancorado na borda do clipe e a alça define a duração.
  return marker("fadeInEnd", "top") + marker("fadeOutStart", "top");
}

function fadeOverlayStyle(item: Pick<Layer, "startTime" | "endTime" | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">, side: "in" | "out") {
  const duration = Math.max(.001, item.endTime - item.startTime);
  if (side === "in") return `left:${(item.fadeInStart - item.startTime) / duration * 100}%;width:${Math.max(0, item.fadeInEnd - item.fadeInStart) / duration * 100}%`;
  return `right:${(item.endTime - item.fadeOutEnd) / duration * 100}%;width:${Math.max(0, item.fadeOutEnd - item.fadeOutStart) / duration * 100}%`;
}

function renderTrackName(trackId: string) {
  if (!project) return "";
  const hint = language === "pt-BR" ? "Clique duas vezes para renomear" : "Double-click to rename";
  return `<span class="track-name" data-track-name="${trackId}" title="${hint}">${escapeHtml(trackName(project, trackId))}</span>`;
}

function renderTimelineLabel(row: TimelineRow) {
  const style = `style="--row-height:${timelineRowHeight(row)}px"`;
  if (row.type === "videoHeader") return `<div class="timeline-label-row media-group-label video-group-label" ${style}><strong>VIDEO</strong><span>${project?.layers.length || 0}</span><span class="group-height-controls"><button data-group-height="video:-1" aria-label="${language === "pt-BR" ? "Reduzir altura das faixas" : "Shrink track height"}">−</button><button data-group-height="video:1" aria-label="${language === "pt-BR" ? "Aumentar altura das faixas" : "Grow track height"}">+</button></span></div>`;
  if (row.type === "audioHeader") return `<div class="timeline-label-row media-group-label audio-group-label" ${style}><strong>AUDIO</strong><span>${project?.audioTracks.length || 0}</span><span class="group-height-controls"><button data-group-height="audio:-1" aria-label="${language === "pt-BR" ? "Reduzir altura das faixas" : "Shrink track height"}">−</button><button data-group-height="audio:1" aria-label="${language === "pt-BR" ? "Aumentar altura das faixas" : "Grow track height"}">+</button></span></div>`;
  if (row.type === "empty") return `<div class="timeline-label-row empty-label is-${row.kind}" ${style} data-track-id="${row.trackId}">${renderTrackName(row.trackId)}<small>${language === "pt-BR" ? "vazia" : "empty"}</small></div>`;
  if (row.type === "audio") return `<div class="timeline-label-row audio-label ${row.clips.some((clip) => clip.id === selectedAudioTrackId) ? "is-selected" : ""}" ${style} draggable="true" data-timeline-order-audio="${row.track.id}" data-select-audio-row="${row.track.id}" data-lane-members="${row.clips.map((clip) => clip.id).join(" ")}">
    <span class="timeline-order"><button data-move-audio-order="${row.track.id}" data-direction="-1">▲</button><button data-move-audio-order="${row.track.id}" data-direction="1">▼</button></span>
    ${renderTrackName(row.laneId)}
    <button class="audio-kind" data-select-audio="${row.track.id}" title="Audio">AUD</button>
    <button class="timeline-label-name" data-select-audio="${row.track.id}">${escapeHtml(row.track.name)}</button>${row.clips.length > 1 ? `<span class="timeline-clip-count">${row.clips.length}</span>` : ""}
    ${row.track.linkedLayerId ? `<button class="audio-link ${row.track.linked ? "is-linked" : ""}" data-toggle-audio-link="${row.track.id}" title="${row.track.linked ? "Unlock audio" : "Link audio to video"}">${row.track.linked ? "▣" : "□"}</button>` : ""}
    <button class="audio-mute ${row.track.muted ? "is-muted" : ""}" data-toggle-audio-mute="${row.track.id}" title="Mute">${row.track.muted ? "M" : "A"}</button>
  </div>`;
  if (row.type === "layer") {
    const open = expandedTimelineLayers.has(row.layer.id);
    return `<div class="timeline-label-row layer-label ${row.clips.some((clip) => clip.id === selectedLayerId) ? "is-selected" : ""}" ${style} data-label-layer="${row.layer.id}" data-select-layer-row="${row.layer.id}" draggable="true" data-timeline-order-layer="${row.layer.id}" data-track-id="${row.trackId}" data-track-members="${row.clips.map((clip) => clip.id).join(" ")}">
      <span class="timeline-order"><button data-move-layer="${row.layer.id}" data-direction="-1">▲</button><button data-move-layer="${row.layer.id}" data-direction="1">▼</button></span>
      ${renderTrackName(row.trackId)}
      <button class="timeline-disclosure" data-toggle-timeline-layer="${row.layer.id}" ${row.layer.effects.length ? "" : "disabled"} title="Show effects">${row.layer.effects.length ? (open ? "▾" : "▸") : "·"}</button>
      ${timelineThumbnail(row.layer)}
      <button class="timeline-label-name" data-select-layer="${row.layer.id}">${escapeHtml(row.layer.name)}</button>${row.clips.length > 1 ? `<span class="timeline-clip-count" title="${row.clips.length} ${language === "pt-BR" ? "clipes nesta faixa" : "clips on this track"}">${row.clips.length}</span>` : ""}
      ${row.layer.effects.length ? `<span class="timeline-fx-count">${row.layer.effects.length} FX</span>` : ""}
    </div>`;
  }
  if (row.type === "effect") return `<div class="timeline-label-row effect-label ${row.effect.id === selectedEffectId ? "is-selected" : ""}" ${style}>
    <span class="timeline-branch">└</span><button data-select-timeline-effect="${row.effect.id}" data-effect-owner="${row.layer.id}">${effectLabel(row.effect.kind)}</button>
  </div>`;
  if (row.type === "post") return `<div class="timeline-label-row post-label" ${style}>
    <button class="timeline-disclosure" data-toggle-timeline-post ${row.effects.length ? "" : "disabled"}>${row.effects.length ? (timelinePostExpanded ? "▾" : "▸") : "·"}</button><strong>POST FX</strong><span>${row.effects.length}</span>
  </div>`;
  return `<div class="timeline-label-row effect-label post-effect-label ${row.effect.id === selectedEffectId ? "is-selected" : ""}" ${style}>
    <span class="timeline-branch">└</span><button data-select-timeline-effect="${row.effect.id}" data-effect-owner="__post__">${effectLabel(row.effect.kind)}</button>
  </div>`;
}

function timelineKeyDots(owner: string, effect: EffectNode) {
  if (!project) return "";
  return Object.entries(effect.keyframes || {}).flatMap(([property, keys]) => keys.map((key) => {
    const ref = `${owner}|fx:${effect.id}:${property}|${key.time}`;
    return `<button type="button" class="key-dot effect-key-dot ${selectedKeyRef === ref ? "is-selected" : ""}" data-key-ref="${ref}" title="${effectLabel(effect.kind)} / ${property}" style="left:${key.time / project!.settings.duration * 100}%">◆</button>`;
  })).join("");
}

function renderAudioClipSpan(track: AudioTrack, duration: number) {
  return `<span class="clip-range audio-clip-range ${track.id === selectedAudioTrackId ? "is-selected" : ""} ${track.linked ? "is-linked" : ""} ${track.muted ? "is-muted" : ""}" data-move-audio-clip="${track.id}" style="left:${track.startTime / duration * 100}%;width:${(track.endTime - track.startTime) / duration * 100}%">
      <button class="clip-trim-handle is-left" data-trim-audio="${track.id}" data-trim-edge="start" title="Trim audio start"></button>
      ${waveformSvg(track)}<i class="fade-overlay fade-in" style="${fadeOverlayStyle(track, "in")}"></i><i class="fade-overlay fade-out" style="${fadeOverlayStyle(track, "out")}"></i>${fadeHandles(track, "audio", track.id)}<small>${track.reverse ? "REV " : ""}${Number(track.playbackRate.toFixed(2))}×</small>
      <button class="clip-trim-handle is-right" data-trim-audio="${track.id}" data-trim-edge="end" title="Trim audio end"></button>
    </span>`;
}

function renderLayerClipSpan(layer: Layer, duration: number) {
  const window = project ? transitionWindow(project, layer) : null;
  const clipLength = Math.max(.001, layer.endTime - layer.startTime);
  const transitionZone = window
    ? `<i class="transition-zone ${window.partner ? "is-overlap" : ""}" style="width:${(window.end - window.start) / clipLength * 100}%" title="${transitionLabel(layer.transition!.type)} · ${(window.end - window.start).toFixed(2)} s"><b>${transitionGlyph(layer.transition!.type)}</b></i>`
    : "";
  return `<span class="clip-range visual-clip-range ${layer.id === selectedLayerId ? "is-selected" : ""} ${selectedClipIds.size > 1 && selectedClipIds.has(layer.id) ? "is-multi" : ""} ${layer.kind}-clip-range ${layer.kind === "video" ? "video-clip-range" : ""}" data-clip-layer="${layer.id}" data-move-layer-clip="${layer.id}" ${layer.kind === "video" ? `data-move-video-clip="${layer.id}"` : ""} style="left:${layer.startTime / duration * 100}%;width:${(layer.endTime - layer.startTime) / duration * 100}%">
      <button class="clip-trim-handle is-left" data-trim-clip="${layer.id}" data-trim-edge="start" title="Trim start"></button>${layerClipMedia(layer)}${transitionZone}<i class="fade-overlay fade-in" style="${fadeOverlayStyle(layer, "in")}"></i><i class="fade-overlay fade-out" style="${fadeOverlayStyle(layer, "out")}"></i>${fadeHandles(layer, "layer", layer.id)}<small>${layer.kind === "video" ? `${layer.reverse ? "REV " : ""}${Number(layer.playbackRate.toFixed(2))}×` : escapeHtml(layer.name)}</small><button class="clip-trim-handle is-right" data-trim-clip="${layer.id}" data-trim-edge="end" title="Trim end"></button>
    </span>${Object.entries(layer.keyframes).flatMap(([property, keys]) => keys.map((key) => {
      const ref = `${layer.id}|${property}|${key.time}`;
      return `<button type="button" class="key-dot ${selectedKeyRef === ref ? "is-selected" : ""}" data-key-ref="${ref}" title="${property} ${key.value}" style="left:${key.time / duration * 100}%">◆</button>`;
    })).join("")}`;
}

function renderTimelineTrack(row: TimelineRow, duration: number) {
  const style = `style="--row-height:${timelineRowHeight(row)}px"`;
  if (row.type === "videoHeader") return `<div class="timeline-track media-group-track video-group-track" ${style}></div>`;
  if (row.type === "audioHeader") return `<div class="timeline-track media-group-track audio-group-track" ${style}></div>`;
  if (row.type === "empty") return row.kind === "audio"
    ? `<div class="timeline-track audio-track-row empty-track" ${style} data-lane-id="${row.trackId}"></div>`
    : `<div class="timeline-track empty-track" ${style} data-track-id="${row.trackId}"></div>`;
  if (row.type === "audio") return `<div class="timeline-track audio-track-row ${row.clips.some((clip) => clip.id === selectedAudioTrackId) ? "is-selected" : ""}" ${style} data-audio-track="${row.track.id}" data-lane-id="${row.laneId}" data-lane-members="${row.clips.map((clip) => clip.id).join(" ")}">
    ${row.clips.map((clip) => renderAudioClipSpan(clip, duration)).join("")}
  </div>`;
  if (row.type === "layer") return `<div class="timeline-track ${row.clips.some((clip) => clip.id === selectedLayerId) ? "is-selected" : ""}" ${style} data-track-layer="${row.layer.id}" data-track-id="${row.trackId}" data-track-members="${row.clips.map((clip) => clip.id).join(" ")}">
    ${row.clips.map((clip) => renderLayerClipSpan(clip, duration)).join("")}
  </div>`;
  if (row.type === "effect") return `<div class="timeline-track effect-track" ${style}>${timelineKeyDots(row.layer.id, row.effect)}</div>`;
  if (row.type === "post") return `<div class="timeline-track post-track" ${style}></div>`;
  return `<div class="timeline-track effect-track post-track" ${style}>${timelineKeyDots("__post__", row.effect)}</div>`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function activePreviewScale() {
  if (!playing) return 1;
  return previewQuality === "auto"
    ? adaptivePreviewScale
    : clamp(Number(previewQuality) || 1, .25, 1);
}

function previewQualityState() {
  const scale = previewQuality === "auto" ? adaptivePreviewScale : Number(previewQuality) || 1;
  return previewQuality === "auto" ? `AUTO ${Math.round(scale * 100)}%` : `${Math.round(scale * 100)}%`;
}

function updatePreviewQualityState() {
  const target = app.querySelector("#preview-quality-state");
  if (target) target.textContent = previewQualityState();
}

function uiIcon(name: "library" | "inspector" | "new" | "open" | "save" | "collect" | "missing" | "settings" | "export" | "language") {
  const paths = {
    library: '<path d="M4 5h16M4 12h16M4 19h16"/><path d="M7 5v14"/>',
    inspector: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M10 4v16"/>',
    new: '<path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
    open: '<path d="M3 7V5h7l2 2h9v12H3z"/><path d="M3 10h18"/>',
    save: '<path d="M4 3h14l3 3v15H3V3z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    collect: '<path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3M8 12h8M8 16h5"/>',
    missing: '<path d="M12 3 2.8 20h18.4L12 3z"/><path d="M12 9v5M12 17h.01"/>',
    settings: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M9 9v11"/>',
    export: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v4h16v-4"/>',
    language: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  } as const;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function bindEditor() {
  bindBrandLink();
  app.querySelector("#open-warnings")?.addEventListener("click", openWarnings);
  bindLeftPanel();
  app.querySelector("#language")?.addEventListener("click", () => {
    language = language === "pt-BR" ? "en" : "pt-BR";
    localStorage.setItem("nt-vct-language", language);
    renderEditorPreservingCanvas();
  });
  app.querySelector("#new-project")?.addEventListener("click", () => void (async () => {
    if (!await offerSave(language === "pt-BR" ? "antes de criar um novo projeto" : "before creating a new project")) return;
    playing = false;
    playbackGeneration++;
    project = null;
    renderer?.dispose();
    renderer = null;
    renderProjectSetup();
  })());
  app.querySelector("#open-project")?.addEventListener("click", () => void (async () => {
    if (!await offerSave(language === "pt-BR" ? "antes de abrir outro projeto" : "before opening another project")) return;
    await chooseOpenProject();
  })());
  app.querySelector("#save-project")?.addEventListener("click", () => void saveProject());
  app.querySelector("#toggle-library")?.addEventListener("click", () => {
    const editor = app.querySelector<HTMLElement>(".editor-app");
    const open = editor?.classList.toggle("is-library-open") || false;
    editor?.classList.remove("is-inspector-open");
    app.querySelector("#toggle-library")?.setAttribute("aria-expanded", String(open));
    app.querySelector("#toggle-inspector")?.setAttribute("aria-expanded", "false");
  });
  app.querySelector("#toggle-inspector")?.addEventListener("click", () => {
    const editor = app.querySelector<HTMLElement>(".editor-app");
    const open = editor?.classList.toggle("is-inspector-open") || false;
    editor?.classList.remove("is-library-open");
    app.querySelector("#toggle-inspector")?.setAttribute("aria-expanded", String(open));
    app.querySelector("#toggle-library")?.setAttribute("aria-expanded", "false");
  });
  app.querySelector("#collect-media")?.addEventListener("click", () => void (async () => {
    if (!project) return;
    const button = app.querySelector<HTMLButtonElement>("#collect-media");
    if (button) button.disabled = true;
    try {
      const fileName = await collectWebProject(project);
      setStatus(`${language === "pt-BR" ? "MÍDIAS COLETADAS" : "MEDIA COLLECTED"} · ${fileName}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      window.alert(String(error));
    } finally {
      const currentButton = app.querySelector<HTMLButtonElement>("#collect-media");
      if (currentButton) currentButton.disabled = false;
    }
  })());
  app.querySelector("#missing-media")?.addEventListener("click", showMissingMediaModal);
  app.querySelector("#agent-panel-button")?.addEventListener("click", openAgentPanel);
  app.querySelector("#composition-settings")?.addEventListener("click", showCompositionModal);
  app.querySelector("#export-project")?.addEventListener("click", showExportModal);
  app.querySelector("#undo")?.addEventListener("click", undo);
  app.querySelector("#redo")?.addEventListener("click", redo);
  bindDynamicControls();
  bindTimeline();
  bindDragAndDrop();
  bindColumnResizers();
  bindTimelineResizer();
  app.querySelector<HTMLSelectElement>("#preview-quality")?.addEventListener("change", (event) => {
    previewQuality = (event.target as HTMLSelectElement).value;
    localStorage.setItem("nt-vct-preview-quality", previewQuality);
    previewFastFrames = 0;
    previewSlowFrames = 0;
    renderer?.setPreviewScale(activePreviewScale());
    updatePreviewQualityState();
    void renderFrame();
  });
  app.querySelector("#zoom-in")?.addEventListener("click", () => setZoom(zoom + .1));
  app.querySelector("#zoom-out")?.addEventListener("click", () => setZoom(zoom - .1));
  app.querySelector("#fit-canvas")?.addEventListener("click", fitCanvas);
  app.querySelector("#canvas-snap")?.addEventListener("click", () => {
    canvasSnap = !canvasSnap;
    localStorage.setItem("nt-vct-canvas-snap", String(canvasSnap));
    app.querySelector("#canvas-snap")?.classList.toggle("is-active", canvasSnap);
  });
  bindCanvasInteraction();
  bindTransformBoxInteraction();
  window.setTimeout(fitCanvas, 0);
}

function bindTextControls(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-text-align]").forEach((button) => button.addEventListener("click", () => {
    const layer = selectedLayer();
    if (!layer || layer.locked) return;
    applyCommands([{ type: "layer.set", layerId: layer.id, props: { align: button.dataset.textAlign } }], editLabel("Alinhamento do texto", "Text alignment"));
  }));
  root.querySelector<HTMLInputElement>("[data-shadow-toggle]")?.addEventListener("change", (event) => {
    const layer = selectedLayer();
    const input = event.target as HTMLInputElement;
    if (!layer || layer.locked) return;
    const props = input.checked
      ? { shadowColor: layer.shadowColor || "#000000", shadowOpacity: (layer.shadowOpacity ?? 0) > 0 ? layer.shadowOpacity : .6, shadowBlur: layer.shadowBlur ?? 12, shadowX: layer.shadowX ?? 0, shadowY: layer.shadowY ?? 4 }
      : { shadowOpacity: 0 };
    if (!applyCommands([{ type: "layer.set", layerId: layer.id, props }], editLabel("Sombra do texto", "Text shadow"))) input.checked = !input.checked;
  });
  const shadowColor = root.querySelector<HTMLInputElement>("[data-shadow-color]");
  shadowColor?.addEventListener("blur", endEditSession);
  shadowColor?.addEventListener("change", endEditSession);
  shadowColor?.addEventListener("input", () => {
    const layer = selectedLayer();
    if (!layer || layer.locked) return;
    const session = openEditSession(`layer:${layer.id}:shadowColor`, editLabel("Cor da sombra", "Shadow color"));
    if (previewEdit(session, [["set", { type: "layer.set", layerId: layer.id, props: { shadowColor: shadowColor.value } }]])) void renderFrame();
  });
  root.querySelector("[data-text-style-save]")?.addEventListener("click", () => {
    const layer = selectedLayer();
    const input = app.querySelector<HTMLInputElement>("[data-text-style-name]");
    const name = input?.value.trim();
    if (!layer || layer.kind !== "text") return;
    if (!name) {
      setStatus(editLabel("ESTILO · DÊ UM NOME", "STYLE · ENTER A NAME"));
      input?.focus();
      return;
    }
    const styles = loadTextStyles().filter((style) => style.name !== name);
    styles.push({ name, props: textStyleOf(layer) });
    saveTextStyles(styles);
    setStatus(`${editLabel("ESTILO SALVO", "STYLE SAVED")} · ${name}`);
    updateInspector();
  });
  root.querySelector("[data-text-style-apply]")?.addEventListener("click", () => {
    const layer = selectedLayer();
    const select = app.querySelector<HTMLSelectElement>("[data-text-style-list]");
    const style = loadTextStyles()[Number(select?.value)];
    if (!layer || layer.locked || !style) return;
    const props: Record<string, unknown> = { ...style.props };
    // Um estilo sem sombra tira a sombra atual do texto.
    if (!props.shadowColor) props.shadowOpacity = 0;
    const height = fittedTextHeight({ ...layer, ...props } as Layer);
    if (height !== undefined) props.height = height;
    applyCommands([{ type: "layer.set", layerId: layer.id, props }], `${editLabel("Aplicar estilo", "Apply style")}: ${style.name}`);
  });
  root.querySelector("[data-text-style-delete]")?.addEventListener("click", () => {
    const select = app.querySelector<HTMLSelectElement>("[data-text-style-list]");
    const styles = loadTextStyles();
    const [removed] = styles.splice(Number(select?.value), 1);
    if (!removed) return;
    saveTextStyles(styles);
    setStatus(`${editLabel("ESTILO EXCLUÍDO", "STYLE DELETED")} · ${removed.name}`);
    updateInspector();
  });
  root.querySelector("[data-anim-apply]")?.addEventListener("click", () => {
    const layer = selectedLayer();
    if (!layer || layer.locked) return;
    const read = (selector: string) => app.querySelector<HTMLSelectElement | HTMLInputElement>(selector)?.value || "";
    const duration = Number(read("[data-anim-duration]"));
    if (!(duration > 0)) {
      setStatus(editLabel("ANIMAÇÃO · DURAÇÃO INVÁLIDA", "ANIMATION · INVALID DURATION"));
      return;
    }
    applyCommands([{ type: "text.animate", layerId: layer.id, in: read("[data-anim-in]"), out: read("[data-anim-out]"), duration } as VctCommand],
      editLabel("Animar texto", "Animate text"));
  });
}

function bindDynamicControls(root: ParentNode = app) {
  root.querySelectorAll<HTMLSelectElement>("[data-asset-fit]").forEach((select) => select.addEventListener("change", () => {
    try {
      localStorage.setItem("nt-vct-default-fit", select.value);
    } catch {
      // Storage unavailable: the choice only lasts until the next placement.
    }
    setStatus(`${language === "pt-BR" ? "ENQUADRAMENTO AO COLOCAR" : "FIT WHEN PLACED"} · ${select.value.toUpperCase()}`);
  }));
  root.querySelectorAll<HTMLElement>("[data-select-layer]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    selectLayerById(button.dataset.selectLayer!);
  }));
  root.querySelectorAll<HTMLElement>("[data-select-audio]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    selectAudioTrackById(button.dataset.selectAudio!);
  }));
  root.querySelectorAll<HTMLElement>("[data-select-layer-row]").forEach((row) => row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button, input, select, textarea")) return;
    selectLayerById(row.dataset.selectLayerRow!);
  }));
  root.querySelectorAll<HTMLElement>("[data-select-audio-row]").forEach((row) => row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button, input, select, textarea")) return;
    selectAudioTrackById(row.dataset.selectAudioRow!);
  }));
  root.querySelectorAll<HTMLElement>("[data-toggle-audio-link]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const track = project?.audioTracks.find((item) => item.id === button.dataset.toggleAudioLink);
    if (!track) return;
    applyCommands([{ type: track.linked ? "audio.unlink" : "audio.link", trackId: track.id }],
      track.linked ? editLabel("Desvincular áudio", "Unlink audio") : editLabel("Vincular áudio", "Link audio"));
  }));
  root.querySelectorAll<HTMLElement>("[data-toggle-audio-mute]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const track = project?.audioTracks.find((item) => item.id === button.dataset.toggleAudioMute);
    if (!track) return;
    if (!applyCommands([{ type: "audio.set", trackId: track.id, props: { muted: !track.muted } }], propertyLabel("muted"))) return;
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-layer-visible]").forEach((button) => button.addEventListener("click", () => {
    const layer = project?.layers.find((item) => item.id === button.dataset.layerVisible);
    if (layer) applyCommands([{ type: "layer.set", layerId: layer.id, props: { visible: !layer.visible } }], editLabel("Visibilidade", "Visibility"));
  }));
  root.querySelectorAll<HTMLElement>("[data-layer-lock]").forEach((button) => button.addEventListener("click", () => {
    const layer = project?.layers.find((item) => item.id === button.dataset.layerLock);
    if (layer) applyCommands([{ type: "layer.set", layerId: layer.id, props: { locked: !layer.locked } }], editLabel("Bloqueio", "Lock"));
  }));
  root.querySelectorAll<HTMLElement>("[data-delete-layer]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteLayer(button.dataset.deleteLayer!);
  }));
  root.querySelectorAll<HTMLElement>("[data-move-layer]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    moveLayer(button.dataset.moveLayer!, Number(button.dataset.direction));
  }));
  root.querySelectorAll<HTMLElement>("[data-move-audio-order]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    moveAudioTrack(button.dataset.moveAudioOrder!, Number(button.dataset.direction));
  }));
  root.querySelectorAll<HTMLElement>("[data-rename-layer]").forEach((button) => button.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    beginLayerRename(button, button.dataset.renameLayer!);
  }));
  root.querySelectorAll<HTMLElement>("[data-open-layer-fx]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const layer = project?.layers.find((item) => item.id === button.dataset.openLayerFx);
    if (!layer) return;
    selectedLayerId = layer.id;
    selectedAudioTrackId = "";
    selectedEffectId = layer.effects[0]?.id || "";
    selectedKeyRef = "";
    updatePanels();
  }));
  root.querySelectorAll<HTMLElement>("[data-select-effect]").forEach((button) => button.addEventListener("click", () => {
    selectedAudioTrackId = "";
    selectedEffectId = button.dataset.selectEffect!;
    selectedKeyRef = "";
    updateInspector();
    syncSelectionClasses();
  }));
  root.querySelectorAll<HTMLElement>("[data-toggle-effect]").forEach((button) => button.addEventListener("click", () => {
    const effect = findEffect(button.dataset.toggleEffect!);
    if (!effect) return;
    applyCommands([{ type: "effect.set", effectId: effect.id, enabled: !effect.enabled }], `${editLabel("Efeito", "Effect")}: ${effect.kind}`);
  }));
  root.querySelectorAll<HTMLElement>("[data-remove-effect]").forEach((button) => button.addEventListener("click", () => removeEffect(button.dataset.removeEffect!)));
  root.querySelectorAll<HTMLElement>("[data-move-effect]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    moveEffect(button.dataset.moveEffect!, Number(button.dataset.direction));
  }));
  root.querySelector("#back-to-layer")?.addEventListener("click", () => {
    selectedEffectId = "";
    selectedKeyRef = "";
    updateInspector();
    updateCurveTools();
  });
  root.querySelectorAll<HTMLInputElement>("[data-layer-property]").forEach((input) => {
    input.addEventListener("blur", endEditSession);
    input.addEventListener("change", endEditSession);
    input.addEventListener("input", () => {
      const layer = selectedLayer();
      if (!layer || layer.locked || !Number.isFinite(input.valueAsNumber)) return;
      const property = input.dataset.layerProperty!;
      const value = input.valueAsNumber;
      const session = openEditSession(`layer:${layer.id}:${property}`, propertyLabel(property));
      if (!session.memo.has("layer")) session.memo.set("layer", { ...layer });
      const base = session.memo.get("layer") as unknown as Record<string, unknown> & Layer;
      const draft = { ...base } as unknown as Record<string, unknown> & Layer;
      draft[property] = value;
      const props: Record<string, unknown> = { [property]: value };
      const paired = property === "scaleX" && base.scaleLocked ? "scaleY"
        : property === "scaleY" && base.scaleLocked ? "scaleX"
          : property === "width" && base.sizeLocked ? "height"
            : property === "height" && base.sizeLocked ? "width" : "";
      if (paired) {
        const previous = Number(base[property]) || 0;
        const ratio = Math.abs(previous) > .000001 ? value / previous : 1;
        props[paired] = (Number(base[paired]) || 0) * ratio;
      }
      if (["startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"].includes(property)) {
        draft.endTime = Math.max(draft.startTime + 1 / project!.settings.fps, draft.endTime);
        normalizeFades(draft);
      }
      const videoTiming = layer.kind === "video" && ["playbackRate", "sourceIn", "sourceOut", "startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"].includes(property);
      if (videoTiming) {
        const duration = renderer?.mediaDuration(layer.id) || Math.max(draft.sourceOut, project!.settings.duration);
        draft.sourceIn = clamp(draft.sourceIn, 0, duration);
        if (draft.sourceOut > 0) draft.sourceOut = clamp(draft.sourceOut, draft.sourceIn + .001, duration);
      }
      for (const field of ["startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd", "sourceIn", "sourceOut"]) {
        if (draft[field] !== base[field]) props[field] = draft[field];
      }
      const main = layerValueCommands(layer, property, value, props);
      const entries = main.entries;
      let created = main.created;
      if (paired) {
        const pairedEdit = layerValueCommands(layer, paired, props[paired] as number, props);
        entries.push(...pairedEdit.entries.slice(1));
        created = pairedEdit.created || created;
      }
      if (!previewEdit(session, entries)) return;
      if (paired) syncInspectorValues();
      if (videoTiming) renderer?.setPlaybackState(playing, currentTime);
      updateParamScrub(input);
      void renderFrame();
      if (created) requestTimelineRefresh();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-param-scrub]").forEach((scrub) => {
    const input = scrub.querySelector<HTMLInputElement>("[data-layer-property], [data-effect-param], [data-audio-property], [data-audio-effect-param]");
    if (!input) return;
    scrub.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      input.dataset.editStart = input.value;
      input.readOnly = false;
      scrub.classList.add("is-editing");
      input.focus();
      input.select();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
      if (event.key === "Escape") {
        input.value = input.dataset.editStart || input.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      input.readOnly = true;
      scrub.classList.remove("is-editing");
    });
    scrub.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !input.readOnly) return;
      // Sem isso o arrasto seleciona o texto do campo; o duplo clique ainda abre a edição.
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      const startX = event.clientX;
      const startValue = input.valueAsNumber;
      const step = Number(input.step) || 1;
      const min = Number(input.min);
      const max = Number(input.max);
      const neutral = Number(scrub.dataset.neutral);
      let moved = false;
      const move = (moveEvent: PointerEvent) => {
        const distance = moveEvent.clientX - startX;
        if (!moved && Math.abs(distance) < 3) return;
        if (!moved) {
          moved = true;
          scrub.classList.add("is-scrubbing");
          scrub.setPointerCapture(event.pointerId);
        }
        const precision = moveEvent.shiftKey ? 0.1 : moveEvent.altKey ? 0.01 : 1;
        let next = clamp(startValue + distance * step * precision, min, max);
        if (Number.isFinite(neutral) && Math.abs(next - neutral) <= step * 3 * precision) next = neutral;
        input.value = String(Number(next.toFixed(6)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const stop = () => {
        scrub.removeEventListener("pointermove", move);
        scrub.removeEventListener("pointerup", stop);
        scrub.removeEventListener("pointercancel", stop);
        scrub.classList.remove("is-scrubbing");
        if (scrub.hasPointerCapture(event.pointerId)) scrub.releasePointerCapture(event.pointerId);
        if (moved) endEditSession();
      };
      scrub.addEventListener("pointermove", move);
      scrub.addEventListener("pointerup", stop);
      scrub.addEventListener("pointercancel", stop);
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-audio-property]").forEach((input) => {
    input.addEventListener("blur", endEditSession);
    input.addEventListener("change", endEditSession);
    input.addEventListener("input", () => {
      const track = selectedAudioTrack();
      if (!track || !Number.isFinite(input.valueAsNumber)) return;
      const property = input.dataset.audioProperty!;
      const value = input.valueAsNumber;
      const session = openEditSession(`audio:${track.id}:${property}`, propertyLabel(property));
      if (!session.memo.has("track")) session.memo.set("track", { ...track });
      const base = session.memo.get("track") as unknown as Record<string, unknown> & AudioTrack;
      const props: Record<string, unknown> = { [property]: value };
      if (["startTime", "endTime", "sourceIn", "sourceOut", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"].includes(property)) {
        const draft = { ...base, [property]: value } as unknown as Record<string, unknown> & AudioTrack;
        draft.endTime = Math.max(draft.startTime + 1 / project!.settings.fps, draft.endTime);
        draft.sourceOut = Math.max(draft.sourceIn + .001, draft.sourceOut);
        normalizeFades(draft);
        for (const field of ["startTime", "endTime", "sourceIn", "sourceOut", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"]) {
          if (draft[field] !== base[field]) props[field] = draft[field];
        }
      }
      if (!previewEdit(session, [["set", { type: "audio.set", trackId: track.id, props }]])) return;
      updateParamScrub(input);
      if (base.linked) {
        renderer?.setPlaybackState(playing, currentTime);
        void renderFrame();
      }
      if (playing) void audioEngine.play(project!, currentTime);
      requestTimelineRefresh();
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-audio-effect-param]").forEach((input) => {
    input.addEventListener("blur", endEditSession);
    input.addEventListener("change", endEditSession);
    input.addEventListener("input", () => {
      const track = selectedAudioTrack();
      const effect = track?.effects.find((item) => item.id === input.dataset.audioEffectId);
      if (!effect || !Number.isFinite(input.valueAsNumber)) return;
      const parameter = input.dataset.audioEffectParam!;
      const session = openEditSession(`audioFx:${effect.id}:${parameter}`, `${editLabel("Efeito de áudio", "Audio effect")}: ${effect.kind}`);
      if (!previewEdit(session, [["set", { type: "audioEffect.setParam", effectId: effect.id, parameter, value: input.valueAsNumber }]])) return;
      updateParamScrub(input);
      if (playing) void audioEngine.play(project!, currentTime);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-add-audio-effect]").forEach((button) => button.addEventListener("click", () => {
    const track = selectedAudioTrack();
    if (!track) return;
    const kind = button.dataset.addAudioEffect as AudioEffectKind;
    if (!applyCommands([{ type: "audioEffect.add", trackId: track.id, kind, effectId: uid("afx") }], `${editLabel("Efeito de áudio", "Audio effect")}: ${kind}`)) return;
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-toggle-audio-effect]").forEach((button) => button.addEventListener("click", () => {
    const track = selectedAudioTrack();
    const effect = track?.effects.find((item) => item.id === button.dataset.toggleAudioEffect);
    if (!effect) return;
    if (!applyCommands([{ type: "audioEffect.set", effectId: effect.id, enabled: !effect.enabled }], `${editLabel("Efeito de áudio", "Audio effect")}: ${effect.kind}`)) return;
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-remove-audio-effect]").forEach((button) => button.addEventListener("click", () => {
    const track = selectedAudioTrack();
    const effect = track?.effects.find((item) => item.id === button.dataset.removeAudioEffect);
    if (!effect) return;
    if (!applyCommands([{ type: "audioEffect.remove", effectId: effect.id }], `${editLabel("Remover efeito de áudio", "Remove audio effect")}: ${effect.kind}`)) return;
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-move-audio-effect]").forEach((button) => button.addEventListener("click", () => {
    const track = selectedAudioTrack();
    if (!track) return;
    const index = track.effects.findIndex((item) => item.id === button.dataset.moveAudioEffect);
    const target = clamp(index + Number(button.dataset.direction), 0, track.effects.length - 1);
    if (index < 0 || index === target) return;
    if (!applyCommands([{ type: "audioEffect.reorder", effectId: track.effects[index].id, index: target }], editLabel("Ordem dos efeitos", "Effect order"))) return;
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-axis-lock]").forEach((button) => button.addEventListener("click", () => {
    const layer = selectedLayer();
    if (!layer) return;
    const property = button.dataset.axisLock as "scaleLocked" | "sizeLocked";
    applyCommands([{ type: "layer.set", layerId: layer.id, props: { [property]: !layer[property] } }], propertyLabel(property));
  }));
  root.querySelectorAll<HTMLElement>("[data-copy-section]").forEach((button) => button.addEventListener("click", () => copyParameterSection(button.dataset.copySection as ClipboardSection)));
  root.querySelectorAll<HTMLElement>("[data-paste-section]").forEach((button) => button.addEventListener("click", () => pasteParameterSection(button.dataset.pasteSection as ClipboardSection)));
  root.querySelector<HTMLInputElement>("[data-audio-name]")?.addEventListener("change", (event) => {
    const track = selectedAudioTrack();
    const value = (event.target as HTMLInputElement).value.trim();
    if (track && value) applyCommands([{ type: "audio.set", trackId: track.id, props: { name: value } }], propertyLabel("name"));
  });
  root.querySelectorAll<HTMLInputElement>("[data-audio-check]").forEach((input) => input.addEventListener("change", () => {
    const track = selectedAudioTrack();
    if (!track) return;
    const property = input.dataset.audioCheck!;
    const command: VctCommand = property === "linked"
      ? { type: input.checked ? "audio.link" : "audio.unlink", trackId: track.id }
      : { type: "audio.set", trackId: track.id, props: { [property]: input.checked } };
    const label = property === "linked" ? (input.checked ? editLabel("Vincular áudio", "Link audio") : editLabel("Desvincular áudio", "Unlink audio")) : propertyLabel(property);
    if (!applyCommands([command], label)) {
      input.checked = !input.checked;
      return;
    }
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelector("[data-audio-link-toggle]")?.addEventListener("click", () => {
    const track = selectedAudioTrack();
    if (!track) return;
    if (!applyCommands([{ type: track.linked ? "audio.unlink" : "audio.link", trackId: track.id }],
      track.linked ? editLabel("Desvincular áudio", "Unlink audio") : editLabel("Vincular áudio", "Link audio"))) return;
    if (playing) void audioEngine.play(project!, currentTime);
  });
  root.querySelectorAll<HTMLInputElement>("[data-audio-fade]").forEach((input) => input.addEventListener("change", () => {
    const track = selectedAudioTrack();
    if (!track || !Number.isFinite(input.valueAsNumber)) return;
    const length = Math.max(0, track.endTime - track.startTime);
    const fade = clamp(input.valueAsNumber, 0, length);
    const draft = { ...track };
    if (input.dataset.audioFade === "in") {
      draft.fadeInStart = track.startTime;
      draft.fadeInEnd = track.startTime + fade;
    } else {
      draft.fadeOutEnd = track.endTime;
      draft.fadeOutStart = track.endTime - fade;
    }
    normalizeFades(draft);
    const props = changedProps(track, draft, FADE_FIELDS);
    if (!Object.keys(props).length) {
      input.value = String(Number(fade.toFixed(3)));
      return;
    }
    if (applyCommands([{ type: "audio.set", trackId: track.id, props }], editLabel("Fade de áudio", "Audio fade")) && playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelector("#delete-audio-track")?.addEventListener("click", () => deleteAudioTrack());
  bindTextControls(root);
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-layer-text]").forEach((input) => {
    input.addEventListener("blur", endEditSession);
    input.addEventListener("change", endEditSession);
    input.addEventListener("input", () => {
      const layer = selectedLayer();
      if (!layer || layer.locked) return;
      const property = input.dataset.layerText!;
      const value = input.value;
      if (property === "name" && !value.trim()) return;
      const session = openEditSession(`layer:${layer.id}:${property}`, propertyLabel(property));
      if (!session.memo.has("layer")) session.memo.set("layer", { ...layer });
      const base = session.memo.get("layer") as Layer;
      const props: Record<string, unknown> = { [property]: value };
      const fitsText = layer.kind === "text" && ["text", "fontFamily"].includes(property);
      if (fitsText) {
        const height = fittedTextHeight({ ...base, [property]: value });
        if (height !== undefined) props.height = height;
      }
      const entries: EditEntry[] = [["set", { type: "layer.set", layerId: layer.id, props, ...(overlapMode ? { allowOverlap: true } : {}) }]];
      let created = false;
      if (input instanceof HTMLInputElement && input.type === "color") {
        const track = `${property}Color`;
        const recording = recordMode && playing;
        if (layer.keyframes[track]?.length || recording) {
          if (recording) markRecordedTrack(`color:${layer.id}:${track}`);
          const time = keyframeEditTime();
          created = !keyframeAt(layer.keyframes[track], time);
          entries.push([`key:${track}:${time}`, {
            type: "keyframe.upsert", layerId: layer.id, property: track, time, value: parseInt(value.slice(1), 16), easing: recording ? "linear" : "easeInOut",
          }]);
        }
      }
      if (!previewEdit(session, entries)) return;
      if (fitsText) {
        const updated = selectedLayer();
        if (updated) {
          updateTextOverflowWarning(updated);
          const heightInput = app.querySelector<HTMLInputElement>('[data-layer-property="height"]');
          if (heightInput && !updated.keyframes.height?.length) {
            heightInput.value = String(updated.height);
            updateParamScrub(heightInput);
          }
        }
      }
      void renderFrame();
      if (created) requestTimelineRefresh();
      if (property === "name") updateLayerStack();
    });
  });
  root.querySelector<HTMLSelectElement>("[data-transition-type]")?.addEventListener("change", (event) => {
    const layer = selectedLayer();
    if (!layer || !project) return;
    const value = (event.target as HTMLSelectElement).value;
    const transition = isTransitionType(value) ? { type: value, duration: layer.transition?.duration || DEFAULT_TRANSITION_DURATION } : null;
    applyCommands([{ type: "clip.setTransition", layerId: layer.id, transition }], editLabel("Transição", "Transition"), { clipEdit: true });
  });
  root.querySelector<HTMLInputElement>("[data-transition-duration]")?.addEventListener("change", (event) => {
    const layer = selectedLayer();
    const value = Number((event.target as HTMLInputElement).value);
    if (!layer?.transition || !Number.isFinite(value)) return;
    const duration = clamp(value, 1 / project!.settings.fps, Math.max(.05, layer.endTime - layer.startTime));
    applyCommands([{ type: "clip.setTransition", layerId: layer.id, transition: { type: layer.transition.type, duration } }], editLabel("Transição", "Transition"), { clipEdit: true });
  });
  root.querySelectorAll<HTMLInputElement>("[data-layer-check]").forEach((input) => input.addEventListener("change", () => {
    const layer = selectedLayer();
    if (!layer || layer.locked) return;
    const property = input.dataset.layerCheck!;
    if (!applyCommands([{ type: "layer.set", layerId: layer.id, props: { [property]: input.checked } }], propertyLabel(property), { panels: false })) {
      input.checked = !input.checked;
      return;
    }
    if (layer.kind === "video") {
      renderer?.setPlaybackState(playing, currentTime);
      if (playing) void audioEngine.play(project!, currentTime);
    }
  }));
  root.querySelectorAll<HTMLInputElement>("[data-effect-param]").forEach((input) => {
    input.addEventListener("blur", endEditSession);
    input.addEventListener("change", endEditSession);
    input.addEventListener("input", () => {
      const effect = selectedEffect();
      if (!effect || !Number.isFinite(input.valueAsNumber)) return;
      const property = input.dataset.effectParam!;
      let value = input.valueAsNumber;
      if (input.type === "range" && input.dataset.sliderCenter) {
        const center = Number(input.dataset.sliderCenter);
        const range = Number(input.max) - Number(input.min);
        if (Math.abs(value - center) <= range * 0.025) {
          value = center;
          input.value = String(center);
        }
      }
      const session = openEditSession(`effect:${effect.id}:${property}`, `${editLabel("Efeito", "Effect")}: ${effect.kind}`);
      const edit = effectValueCommands(effect, property, value);
      if (!previewEdit(session, edit.entries)) return;
      updateParamScrub(input);
      void renderFrame();
      if (edit.created) requestTimelineRefresh();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-keyframe]").forEach((button) => button.addEventListener("click", () => toggleKeyframe(button.dataset.keyframe!)));
  root.querySelectorAll<HTMLElement>("[data-color-keyframe]").forEach((button) => button.addEventListener("click", () => toggleColorKeyframe(button.dataset.colorKeyframe as "fill" | "stroke")));
  root.querySelectorAll<HTMLElement>("[data-effect-keyframe]").forEach((button) => button.addEventListener("click", () => toggleEffectKeyframe(button.dataset.effectKeyframe!)));
  root.querySelectorAll<HTMLSelectElement>("[data-layer-easing]").forEach((select) => select.addEventListener("change", () => {
    const layer = selectedLayer();
    const property = select.dataset.layerEasing!;
    const keyframe = keyframeAt(layer?.keyframes[property]);
    if (!layer || !keyframe) return;
    const command = keyTrackCommand({ layerId: layer.id, property }, layer.keyframes[property], keyframe.time, withEasing(select.value as Easing));
    if (command && applyCommands([command], editLabel("Curva", "Easing"), { panels: false })) updateCurveTools();
  }));
  root.querySelectorAll<HTMLSelectElement>("[data-effect-easing]").forEach((select) => select.addEventListener("change", () => {
    const effect = selectedEffect();
    const property = select.dataset.effectEasing!;
    const keyframe = keyframeAt(effect?.keyframes[property]);
    if (!effect || !keyframe) return;
    const command = keyTrackCommand({ effectId: effect.id, property }, effect.keyframes[property], keyframe.time, withEasing(select.value as Easing));
    if (command && applyCommands([command], editLabel("Curva", "Easing"), { panels: false })) updateCurveTools();
  }));
  root.querySelector("#delete-layer")?.addEventListener("click", () => deleteLayer());
  root.querySelector("#duplicate-layer")?.addEventListener("click", duplicateLayer);
  root.querySelectorAll<HTMLElement>("[data-replace-layer-media]").forEach((button) => button.addEventListener("click", () => void replaceLayerMedia(button.dataset.replaceLayerMedia!)));
  root.querySelectorAll<HTMLElement>("[data-replace-audio-media]").forEach((button) => button.addEventListener("click", () => void replaceAudioMedia(button.dataset.replaceAudioMedia!)));
}

function beginLayerRename(button: HTMLElement, layerId: string) {
  const layer = project?.layers.find((item) => item.id === layerId);
  if (!layer) return;
  const input = document.createElement("input");
  input.className = "layer-rename-input";
  input.value = layer.name;
  input.maxLength = 80;
  const commit = () => {
    const value = input.value.trim();
    if (value && value !== layer.name) applyCommands([{ type: "layer.setName", layerId, name: value }], propertyLabel("name"), { panels: false });
    updateLayerStack();
    updateInspector();
    updateTimeline();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") {
      input.value = layer.name;
      input.blur();
    }
  });
  input.addEventListener("blur", commit, { once: true });
  button.replaceWith(input);
  input.focus();
  input.select();
}

function findEffect(id: string) {
  for (const layer of project?.layers || []) {
    const found = layer.effects.find((effect) => effect.id === id);
    if (found) return found;
  }
  return project?.postEffects.find((effect) => effect.id === id);
}

function renderEditorPreservingCanvas() {
  if (!project) return;
  renderer?.dispose();
  renderer = null;
  renderEditor();
  const canvas = app.querySelector<HTMLCanvasElement>("#composition-canvas")!;
  initializeRenderer(canvas);
}

function updatePanels() {
  updateBin();
  updateLayerStack();
  updateInspector();
  updateTimeline();
}

function updateLayerStack() {
  const target = app.querySelector("#layer-stack");
  if (!target || !project) return;
  target.innerHTML = project.layers.map(renderLayerItem).join("") || `<p class="empty-stack">${language === "pt-BR" ? "Sem camadas ainda" : "No layers yet"}</p>`;
  bindDynamicControls(target);
  bindDragAndDrop(target);
}

let inspectorScrollKey = "";

function updateInspector() {
  const target = app.querySelector("#inspector");
  if (!target) return;
  // Mantém a rolagem do painel quando a seleção não mudou (edição de valores).
  const key = `${selectedLayerId}|${selectedAudioTrackId}|${selectedEffectId}`;
  const scrollTop = key === inspectorScrollKey ? target.querySelector<HTMLElement>(".inspector-scroll")?.scrollTop || 0 : 0;
  inspectorScrollKey = key;
  target.innerHTML = renderInspector();
  bindDynamicControls(target);
  const scroll = target.querySelector<HTMLElement>(".inspector-scroll");
  if (scroll) scroll.scrollTop = scrollTop;
  // Nome completo no tooltip quando o painel estreito corta o rótulo.
  target.querySelectorAll<HTMLElement>(".param-scrub > span").forEach((label) => { label.title = label.textContent || ""; });
  const layer = selectedLayer();
  if (layer?.kind === "text") updateTextOverflowWarning(layer);
}

// Cresce a caixa de texto para caber todas as linhas; com altura animada, só avisa.
/** Height a text layer needs to show all of its text, or undefined when it already fits (or its height is animated). */
function fittedTextHeight(layer: Layer) {
  const layout = renderer?.measureText(layer, currentTime);
  if (!layout || layout.lines.length <= layout.maxLines || layer.keyframes.height?.length) return undefined;
  return Math.ceil(layout.requiredHeight);
}

function updateTextOverflowWarning(layer: Layer) {
  const warning = app.querySelector<HTMLElement>("[data-text-overflow]");
  const layout = renderer?.measureText(layer, currentTime);
  if (warning) warning.hidden = !layout || layout.lines.length <= layout.maxLines;
}

function updateTimeline() {
  const target = app.querySelector(".timeline-panel");
  if (!target) return;
  const previousScroll = target.querySelector<HTMLElement>(".timeline-scroll");
  const scrollLeft = previousScroll?.scrollLeft || 0;
  const scrollTop = previousScroll?.scrollTop || 0;
  target.innerHTML = renderTimeline();
  bindTimeline();
  bindDynamicControls(target);
  const nextScroll = target.querySelector<HTMLElement>(".timeline-scroll");
  if (nextScroll) {
    nextScroll.scrollLeft = scrollLeft;
    nextScroll.scrollTop = scrollTop;
  }
  syncMinimap();
}

function requestTimelineRefresh() {
  if (timelineRefreshTimer) return;
  timelineRefreshTimer = window.setTimeout(() => {
    timelineRefreshTimer = 0;
    updateTimeline();
  }, 90);
}

function updateParamScrub(input: HTMLInputElement) {
  const scrub = input.closest<HTMLElement>("[data-param-scrub]");
  if (!scrub) return;
  const min = Number(input.min);
  const max = Number(input.max);
  const fill = clamp((input.valueAsNumber - min) / Math.max(Number(input.step) || 1, max - min) * 100, 0, 100);
  scrub.style.setProperty("--value-fill", `${fill}%`);
  scrub.style.setProperty("--value-ratio", String(fill / 100));
}

function addGeneratedLayer(kind: "text" | "geometry") {
  if (!project) return;
  const fps = project.settings.fps;
  // Entra no playhead (em 0 ocupa a composição); passando do fim, a composição cresce.
  const at = currentTime > 0 ? Math.round(currentTime * fps) / fps : 0;
  const wanted = Math.max(project.settings.duration, at > 0 ? at + 3 : 0);
  const end = Math.min(MAX_TIMELINE_SECONDS, Math.ceil(wanted * fps - 1e-6) / fps);
  const layerId = uid("layer");
  const commands: VctCommand[] = [];
  if (end > project.settings.duration + 1e-6) commands.push({ type: "composition.set", props: { duration: end } });
  commands.push({
    type: "layer.create", layerId, kind, startTime: at, endTime: end,
    name: kind === "text" ? "Text" : language === "pt-BR" ? "Quadrado" : "Square",
  });
  applyCommands(commands, kind === "text" ? editLabel("Adicionar texto", "Add text") : editLabel("Adicionar forma", "Add shape"), {
    select() {
      selectedLayerId = layerId;
      selectedAudioTrackId = "";
      selectedEffectId = "";
      selectedKeyRef = "";
    },
  });
}

// ---- Left panel: Mídia | Efeitos tabs and the media bin.

function bindLeftPanel() {
  const tabs = [...app.querySelectorAll<HTMLElement>("[data-left-tab]")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setLeftTab(tab.dataset.leftTab as LeftTab));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
      if (target < 0) return;
      event.preventDefault();
      setLeftTab(tabs[target].dataset.leftTab as LeftTab, true);
    });
  });
  bindLeftBody();
}

function setLeftTab(tab: LeftTab, focus = false) {
  const changed = tab !== leftTab;
  leftTab = tab;
  try {
    localStorage.setItem("nt-vct-left-tab", tab);
  } catch {
    // Storage unavailable: the tab just is not remembered.
  }
  const top = app.querySelector<HTMLElement>(".left-top");
  if (top && changed) {
    top.outerHTML = renderLeftTop();
    bindLeftPanel();
    const body = app.querySelector<HTMLElement>(".left-tab-body");
    if (body && leftTab === "effects") bindDynamicControls(body);
    if (leftTab === "media") requestMissingThumbnails();
  }
  if (focus) app.querySelector<HTMLElement>(`#left-tab-${tab}`)?.focus();
}

function bindLeftBody() {
  const body = app.querySelector<HTMLElement>(".left-tab-body");
  if (!body) return;
  body.querySelectorAll<HTMLDetailsElement>("[data-library-accordion]").forEach((details) => details.addEventListener("toggle", () => {
    if (!details.open) return;
    libraryAccordion = details.dataset.libraryAccordion as "effects" | "post";
    body.querySelectorAll<HTMLDetailsElement>("[data-library-accordion]").forEach((other) => {
      if (other !== details) other.open = false;
    });
  }));
  body.querySelectorAll<HTMLElement>("[data-add-input]").forEach((button) => button.addEventListener("click", () => void addInput(button.dataset.addInput as "text" | "geometry" | "guide")));
  body.querySelector("[data-import-srt]")?.addEventListener("click", () => void importSubtitles());
  body.querySelectorAll<HTMLElement>("[data-add-effect]").forEach((button) => button.addEventListener("click", () => addEffect(button.dataset.addEffect as EffectKind, false)));
  body.querySelectorAll<HTMLElement>("[data-add-post]").forEach((button) => button.addEventListener("click", () => addEffect(button.dataset.addPost as EffectKind, true)));
  if (leftTab !== "media") return;
  bindMediaBin(body, binActions);
  body.querySelectorAll<HTMLElement>("[data-bin-asset]").forEach((card) => {
    card.addEventListener("dragstart", () => { draggedBinAsset = card.dataset.binAsset!; });
    card.addEventListener("dragend", () => {
      draggedBinAsset = "";
      clearBinDropRows();
    });
  });
}

const binActions: BinActions = {
  importMedia: () => void chooseAndImportMedia(),
  select: selectBinAsset,
  place: (asset, where) => placeAsset(asset, where === "playhead" ? { preferSelected: true } : {}),
  remove: removeBinAsset,
  changeView(change) {
    Object.assign(binView, change);
    updateBin();
  },
};

function updateBin() {
  if (leftTab !== "media" || !project) return;
  const body = app.querySelector<HTMLElement>(".left-tab-body");
  if (!body) return;
  if (binView.selected && !listAssets(project).some((entry) => entry.id === binView.selected)) binView.selected = "";
  const html = renderMediaBin(project, binView, language);
  if (html === binHtml) return;
  const active = document.activeElement as HTMLElement | null;
  const card = active?.closest<HTMLElement>("[data-bin-asset]");
  const focus = !active || !body.contains(active) ? ""
    : active.matches("[data-bin-search]") ? "[data-bin-search]"
    : active.matches("[data-bin-filter]") ? "[data-bin-filter]"
    : card ? `[data-bin-asset="${CSS.escape(card.dataset.binAsset!)}"]` : "";
  const caret = active instanceof HTMLInputElement ? active.selectionStart : null;
  const scroll = body.scrollTop;
  binHtml = html;
  body.innerHTML = html;
  bindLeftBody();
  body.scrollTop = scroll;
  const next = focus ? body.querySelector<HTMLElement>(focus) : null;
  next?.focus();
  if (next instanceof HTMLInputElement && caret !== null) next.setSelectionRange(caret, caret);
  requestMissingThumbnails();
}

function scheduleBinRefresh() {
  if (binRefreshTimer) return;
  binRefreshTimer = window.setTimeout(() => {
    binRefreshTimer = 0;
    if (draggedBinAsset) scheduleBinRefresh();
    else updateBin();
  }, 120);
}

// Projects opened from disk have metadata but no thumbnails yet.
function requestMissingThumbnails() {
  if (!project) return;
  for (const entry of listAssets(project)) {
    if ((entry.kind !== "image" && entry.kind !== "video") || binThumbnail(entry.id) || thumbnailRequests.has(entry.id) || !hasWebAsset(entry.id)) continue;
    thumbnailRequests.add(entry.id);
    void ensureThumbnail(entry.id, entry.kind).then((thumbnail) => { if (thumbnail) scheduleBinRefresh(); });
  }
}

function assetNeedsMetadata(metadata: NonNullable<ProjectDocument["assetMetadata"]>[string] | undefined) {
  if (!metadata?.kind) return true;
  return metadata.kind === "audio" ? !metadata.duration : !metadata.width;
}

let metadataRefresh: Promise<void> = Promise.resolve();

/**
 * Projects saved before the bin have no technical metadata. Once their files are
 * available it is read in the background; this is a metadata refresh, not an
 * edit, so it makes no undo step.
 */
function refreshAssetMetadata() {
  const target = project;
  if (!target) return;
  const pending = listAssets(target).filter((entry) => hasWebAsset(entry.id) && !metadataAttempts.has(entry.id) && assetNeedsMetadata(target.assetMetadata?.[entry.id]));
  if (!pending.length) return;
  for (const entry of pending) metadataAttempts.add(entry.id);
  metadataRefresh = metadataRefresh.then(async () => {
    let changed = false;
    for (const entry of pending) {
      if (project !== target) return;
      try {
        const blob = await (await fetch(resolveAssetUrl(entry.id))).blob();
        const known = target.assetMetadata?.[entry.id];
        const name = known?.originalName || entry.name;
        const file = new File([blob], name, { type: blob.type || known?.mimeType || "" });
        const source = known ?? { originalName: name, size: blob.size, lastModified: 0, mimeType: file.type };
        const probed = await probeMedia(entry.id, file, source);
        if (project !== target) return;
        target.assetMetadata ||= {};
        target.assetMetadata[entry.id] = probed;
        changed = true;
      } catch {
        // Unreadable file: the clip keeps working, the card just shows less.
      }
    }
    if (!changed || project !== target) return;
    markProjectModified(target);
    updateBin();
    if (inspectedAsset) updateInspector();
  });
}

function selectBinAsset(asset: string) {
  if (!project) return;
  binView.selected = asset;
  inspectedAsset = asset;
  updateBin();
  updateInspector();
  setStatus(`SELECT · ${listAssets(project).find((entry) => entry.id === asset)?.name ?? asset}`);
}

function removeBinAsset(asset: string) {
  if (!project) return;
  if (!applyCommands([{ type: "asset.remove", asset }], editLabel("Tirar mídia do painel", "Remove media from panel"))) return;
  if (binView.selected === asset) binView.selected = "";
  if (inspectedAsset === asset) inspectedAsset = "";
  updateBin();
  updateInspector();
}

/** Default framing for a source placed on the timeline (the inspector can change it). */
function defaultFit(entry?: Pick<BinEntry, "width" | "height">): "contain" | "cover" {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("nt-vct-default-fit");
  } catch {
    stored = null;
  }
  if (stored === "contain" || stored === "cover") return stored;
  const settings = project?.settings;
  return entry?.width && entry.height && entry.height > entry.width && settings && settings.height > settings.width ? "cover" : "contain";
}

function renderAssetInspector(entry: BinEntry) {
  const pt = language === "pt-BR";
  const kinds = { video: pt ? "Vídeo" : "Video", image: pt ? "Imagem" : "Image", audio: pt ? "Áudio" : "Audio" };
  const orientations: Record<string, string> = { vertical: "vertical", horizontal: "horizontal", quadrado: pt ? "quadrado" : "square" };
  const names = entry.usedBy.map((id) => project?.layers.find((layer) => layer.id === id)?.name || project?.audioTracks.find((track) => track.id === id)?.name || id);
  const audio = entry.kind === "audio" ? (pt ? "sim" : "yes")
    : entry.kind === "video" ? (entry.hasAudio === undefined ? "—" : entry.hasAudio ? (pt ? "sim" : "yes") : (pt ? "mudo" : "silent")) : "";
  const rows: Array<[string, string]> = [
    [pt ? "Tipo" : "Type", entry.kind ? kinds[entry.kind] : "—"],
    ...(entry.duration ? [[pt ? "Duração" : "Duration", `${entry.duration.toFixed(2)} s`] as [string, string]] : []),
    ...(entry.width && entry.height ? [[pt ? "Resolução" : "Resolution", `${entry.width}×${entry.height}`] as [string, string]] : []),
    ...(entry.orientation ? [[pt ? "Orientação" : "Orientation", orientations[entry.orientation] || entry.orientation] as [string, string]] : []),
    ...(audio ? [[pt ? "Áudio" : "Audio", audio] as [string, string]] : []),
    ...(entry.size ? [[pt ? "Tamanho" : "Size", `${(entry.size / 1048576).toFixed(entry.size > 10485760 ? 0 : 1)} MB`] as [string, string]] : []),
    [pt ? "Em uso" : "Used by", names.length ? names.join(", ") : (pt ? "livre" : "unused")],
  ];
  const fit = defaultFit(entry);
  return `<div class="inspector-header"><strong class="asset-title" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</strong><span>${entry.kind ? kinds[entry.kind].toUpperCase() : "—"}</span></div>
    <div class="inspector-scroll">
      <section class="property-group asset-details"><h3>${pt ? "MÍDIA" : "MEDIA"}</h3>
        <dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </section>
      ${entry.kind === "video" || entry.kind === "image" ? `<section class="property-group"><label class="select-field"><span>${pt ? "ENQUADRAR AO COLOCAR" : "FIT WHEN PLACED"}</span>
        <select data-asset-fit><option value="contain" ${fit === "contain" ? "selected" : ""}>${pt ? "Inteiro (contain)" : "Whole (contain)"}</option><option value="cover" ${fit === "cover" ? "selected" : ""}>${pt ? "Preencher (cover)" : "Fill (cover)"}</option></select></label></section>` : ""}
    </div>`;
}

// ---- Import: files go to the bin only; nothing lands on the timeline.

async function importIntoBin(file: File) {
  if (!assetKindOf(file.name, { mimeType: file.type, originalName: file.name })) {
    throw new Error(language === "pt-BR" ? "tipo de arquivo não suportado" : "unsupported file type");
  }
  const imported = await importWebAsset(file);
  const metadata = await probeMedia(imported.relativePath, file, imported.sourceMetadata);
  return { asset: imported.relativePath, metadata: { ...metadata } as Record<string, unknown> };
}

async function importSubtitles() {
  if (!project || exportInProgress) return;
  const [file] = await chooseFiles(".srt,application/x-subrip,text/plain");
  const target = project;
  if (!file || project !== target) return;
  let srt: string;
  try {
    srt = await file.text();
  } catch (error) {
    setStatus(`${editLabel("LEGENDAS", "SUBTITLES")} · ${errorMessage(error)}`);
    return;
  }
  let prefix = "legenda";
  for (let n = 2; target.layers.some((layer) => layer.id.startsWith(prefix)) || target.tracks?.some((track) => track.id.startsWith(prefix)); n++) prefix = `legenda${n}_`;
  const before = target.layers.length;
  const cues = (srt.match(/-->/g) || []).length;
  if (!applyCommands([{ type: "text.fromSrt", srt, idPrefix: prefix }], editLabel("Importar legendas", "Import subtitles"))) return;
  const created = project ? project.layers.length - before : 0;
  const skipped = cues - created;
  setStatus(language === "pt-BR"
    ? `LEGENDAS · ${created} IMPORTADA${created === 1 ? "" : "S"}${skipped > 0 ? ` · ${skipped} FORA DA COMPOSIÇÃO OU VAZIA${skipped === 1 ? "" : "S"}` : ""}`
    : `SUBTITLES · ${created} IMPORTED${skipped > 0 ? ` · ${skipped} OUTSIDE THE COMPOSITION OR EMPTY` : ""}`);
}

async function chooseAndImportMedia() {
  if (!project) return;
  const files = await chooseFiles(IMPORT_ACCEPT);
  if (files.length) await importMediaFiles(files);
}

async function importMediaFiles(files: File[]) {
  const target = project;
  if (!target || !files.length || exportInProgress) return;
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const progress = openImportProgress(language, sorted.length);
  const commands: VctCommand[] = [];
  const failures: string[] = [];
  try {
    for (const [index, file] of sorted.entries()) {
      progress.update(index, file.name);
      try {
        const item = await importIntoBin(file);
        commands.push({ type: "asset.add", asset: item.asset, metadata: item.metadata });
      } catch {
        failures.push(file.name);
      }
    }
  } finally {
    progress.close();
  }
  if (project !== target) return;
  const skipped = failures.length ? ` · ${language === "pt-BR" ? "não importadas" : "skipped"}: ${failures.join(", ")}` : "";
  if (!commands.length) {
    setStatus(language === "pt-BR" ? `NENHUMA MÍDIA IMPORTADA${skipped}` : `NO MEDIA IMPORTED${skipped}`);
    return;
  }
  if (!applyCommands(commands, editLabel("Importar mídia", "Import media"))) return;
  setStatus(language === "pt-BR" ? `${commands.length} MÍDIA(S) IMPORTADA(S)${skipped}` : `${commands.length} MEDIA FILE(S) IMPORTED${skipped}`);
}

// ---- Placing bin media on the timeline.

interface PlaceOptions {
  /** Start in seconds; the playhead when omitted. */
  time?: number;
  /** Track (video) the clip must go to. */
  trackId?: string;
  /** Use the selected clip's track when it is free at that time; otherwise a new top track. */
  preferSelected?: boolean;
}

const IMPORTED_IMAGE_SECONDS = 3;

function placeAsset(asset: string, options: PlaceOptions = {}) {
  if (!project) return;
  const entry = listAssets(project).find((item) => item.id === asset);
  if (!entry?.kind) {
    setStatus(language === "pt-BR" ? "MÍDIA NÃO ENCONTRADA NO PAINEL" : "MEDIA NOT FOUND IN THE PANEL");
    return;
  }
  const fps = project.settings.fps;
  const start = clamp(Math.round((options.time ?? currentTime) * fps) / fps, 0, MAX_TIMELINE_SECONDS);
  const length = entry.kind === "image" || !entry.duration ? IMPORTED_IMAGE_SECONDS : Math.max(1 / fps, Math.floor(entry.duration * fps + 1e-6) / fps);
  const end = Math.min(MAX_TIMELINE_SECONDS, start + length);
  if (end <= start + 1e-6) {
    setStatus(language === "pt-BR" ? "SEM ESPAÇO NA TIMELINE" : "NO ROOM ON THE TIMELINE");
    return;
  }
  const commands: VctCommand[] = [];
  const needed = Math.ceil(end * fps - 1e-6) / fps;
  if (needed > project.settings.duration + 1e-6) commands.push({ type: "composition.set", props: { duration: needed } });
  const label = editLabel("Colocar na timeline", "Place on timeline");
  if (entry.kind === "audio") {
    const trackId = uid("audio");
    const selected = selectedAudioTrack();
    const lane = options.preferSelected && selected ? laneIdOf(selected) : "";
    const free = lane && !project.audioTracks.some((track) => laneIdOf(track) === lane && track.startTime < end - 1e-6 && track.endTime > start + 1e-6);
    commands.push({ type: "audio.create", trackId, asset, name: entry.name, startTime: start, endTime: end, ...(free ? { laneId: lane } : {}) });
    const placed = applyCommands(commands, label, { select() { inspectedAsset = ""; } });
    if (!placed) return;
    selectAudioTrackById(trackId);
    void generateAudioWaveform(asset);
    return;
  }
  const layerId = uid("layer");
  let trackId = options.trackId;
  const selected = selectedLayer();
  if (!trackId && options.preferSelected && selected && !overlapsTrack(project, trackIdOf(selected), start, end)) trackId = trackIdOf(selected);
  commands.push({
    type: "clip.place", layerId, asset, startTime: start, endTime: end,
    ...(entry.width ? { fit: defaultFit(entry) } : {}),
    ...(trackId ? { trackId } : {}),
  });
  const placed = applyCommands(commands, label, {
    select() {
      inspectedAsset = "";
      selectedLayerId = layerId;
      selectedAudioTrackId = "";
      selectedEffectId = "";
      selectedKeyRef = "";
    },
  });
  if (!placed) return;
  const layer = project.layers.find((item) => item.id === layerId);
  if (layer?.kind === "video") {
    void generateVideoThumbnails(layer);
    const linked = project.audioTracks.find((track) => track.linkedLayerId === layer.id);
    if (linked) void generateAudioWaveform(linked.asset);
  }
  setStatus(`${language === "pt-BR" ? "COLOCADO NA TIMELINE" : "PLACED ON THE TIMELINE"} · ${entry.name}`);
}

async function addInput(kind: "text" | "geometry" | "guide") {
  if (!project) return;
  if (kind !== "guide") return addGeneratedLayer(kind);
  const source = await chooseFile("image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif");
  if (!source || !project) return;
  try {
    const item = await importIntoBin(source);
    const layerId = uid("layer");
    applyCommands([
      { type: "asset.add", asset: item.asset, metadata: item.metadata },
      { type: "layer.create", layerId, kind: "guide", name: source.name, asset: item.asset, startTime: 0, endTime: project.settings.duration },
      { type: "layer.fit", layerId, fit: "contain" },
    ], editLabel("Adicionar guia", "Add guide"), {
      select() {
        inspectedAsset = "";
        selectedLayerId = layerId;
        selectedAudioTrackId = "";
        selectedEffectId = "";
        selectedKeyRef = "";
      },
    });
  } catch (error) {
    window.alert(errorMessage(error));
  }
}

// ---- Dragging bin cards onto the timeline.

function clearBinDropRows() {
  app.querySelectorAll(".is-bin-drop-row").forEach((item) => item.classList.remove("is-bin-drop-row"));
}

function bindBinDrop(scrubArea: HTMLElement) {
  const draggedKind = () => project && listAssets(project).find((entry) => entry.id === draggedBinAsset)?.kind;
  const rowAt = (event: DragEvent) => (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>(".timeline-track[data-track-id]") ?? null;
  const accepts = (event: DragEvent) => Boolean(project && !exportInProgress && event.dataTransfer?.types.includes(BIN_DRAG_TYPE));
  scrubArea.addEventListener("dragover", (event) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
    clearBinDropRows();
    const mark = draggedKind() === "audio" ? app.querySelector(".audio-group-track") : rowAt(event) ?? app.querySelector(".video-group-track");
    mark?.classList.add("is-bin-drop-row");
  });
  scrubArea.addEventListener("dragleave", (event) => {
    if (!(event.relatedTarget instanceof Node) || !scrubArea.contains(event.relatedTarget)) clearBinDropRows();
  });
  scrubArea.addEventListener("drop", (event) => {
    clearBinDropRows();
    const asset = event.dataTransfer?.getData(BIN_DRAG_TYPE);
    if (!asset || !accepts(event)) return;
    event.preventDefault();
    const time = snapTimelineTime(timelineTimeFromPointer(event, scrubArea), scrubArea, "", "", event.altKey);
    const audio = draggedKind() === "audio";
    placeAsset(asset, { time, ...(audio ? {} : { trackId: rowAt(event)?.dataset.trackId }) });
  });
}

// ---- Track names and the empty track button.

function addEmptyTrack() {
  applyCommands([{ type: "track.create", trackId: uid("track"), kind: "video" }], editLabel("Nova faixa", "New track"));
}

function beginTrackRename(element: HTMLElement) {
  if (!project || element.isContentEditable) return;
  const trackId = element.dataset.trackName!;
  const original = element.textContent || "";
  const row = element.closest<HTMLElement>("[draggable='true']");
  if (row) row.draggable = false;
  element.contentEditable = "true";
  element.focus();
  window.getSelection()?.selectAllChildren(element);
  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    element.contentEditable = "false";
    if (row) row.draggable = true;
    const name = (element.textContent || "").replace(/\s+/g, " ").trim();
    element.textContent = original;
    if (commit && name && name !== original) applyCommands([{ type: "track.rename", trackId, name }], editLabel("Renomear faixa", "Rename track"));
  };
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  element.addEventListener("blur", () => finish(true), { once: true });
}

function probeMediaDuration(asset: string, kind: "video" | "audio") {
  return new Promise<number>((resolve) => {
    const media = document.createElement(kind);
    media.preload = "metadata";
    media.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(media.duration) ? media.duration : 0;
      media.removeAttribute("src");
      media.load();
      resolve(duration);
    }, { once: true });
    media.addEventListener("error", () => resolve(0), { once: true });
    media.src = resolveAssetUrl(asset);
  });
}

// Arrastar arquivos para o editor importa todos de uma vez.
window.addEventListener("dragover", (event) => {
  if (!project || exportInProgress || !event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  document.body.classList.add("is-dropping-media");
});
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) document.body.classList.remove("is-dropping-media");
});
window.addEventListener("drop", (event) => {
  document.body.classList.remove("is-dropping-media");
  if (!project || exportInProgress || !event.dataTransfer?.files.length) return;
  event.preventDefault();
  void importMediaFiles(Array.from(event.dataTransfer.files));
});

async function replaceLayerMedia(layerId: string) {
  if (!project) return;
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer || !layer.asset || !["image", "video", "guide"].includes(layer.kind)) return;
  const accept = layer.kind === "video" ? ".mp4,.webm,.mov,.m4v,video/*" : ".png,.jpg,.jpeg,.webp,.bmp,.gif,image/*";
  const source = await chooseFile(accept);
  if (!source) return;
  try {
    const asset = await importWebAsset(source);
    const oldAsset = layer.asset;
    const clipDuration = layer.endTime - layer.startTime;
    let mediaDuration = 0;
    let embeddedAudioDuration = 0;
    if (layer.kind === "video") {
      mediaDuration = await probeMediaDuration(asset.relativePath, "video");
      try {
        embeddedAudioDuration = (await probeAudio(asset.relativePath)).duration;
      } catch {
        embeddedAudioDuration = 0;
      }
    }
    const props: Record<string, unknown> = { asset: asset.relativePath };
    const commands: VctCommand[] = [];
    const linkedTracks = project.audioTracks.filter((track) => track.linked && track.linkedLayerId === layer.id);
    if (layer.kind === "video") {
      props.sourceIn = 0;
      props.sourceOut = mediaDuration;
      props.loop = mediaDuration > 0 && clipDuration * Math.max(.05, Math.abs(layer.playbackRate)) > mediaDuration;
      if (embeddedAudioDuration > 0) {
        for (const track of linkedTracks) commands.push({ type: "audio.set", trackId: track.id, props: { asset: asset.relativePath } });
      } else {
        for (const track of linkedTracks) commands.push({ type: "audio.remove", trackId: track.id });
      }
    }
    // The video's timing is applied last: it also syncs the linked audio clips.
    commands.push({ type: "layer.set", layerId: layer.id, props, ...(overlapMode ? { allowOverlap: true } : {}) });
    if (layer.kind === "video" && embeddedAudioDuration > 0 && !linkedTracks.length) {
      const trackId = uid("audio");
      commands.push({ type: "audio.create", trackId, asset: asset.relativePath, name: `${layer.name} · audio`, startTime: layer.startTime, endTime: layer.endTime });
      commands.push({ type: "audio.link", trackId, layerId: layer.id });
    }
    const audioCount = project.audioTracks.length;
    rememberAssetSource(asset.relativePath, asset.sourceMetadata);
    renderer?.removeMedia(layer.id);
    if (!applyCommands(commands, editLabel("Substituir mídia", "Replace media"), { panels: false })) return;
    for (const track of linkedTracks) audioWaveformCache.delete(track.asset);
    audioEngine.stop();
    if (project.audioTracks.length === audioCount) renderEditorPreservingCanvas();
    refreshHistoryButtons();
    const replaced = project.layers.find((item) => item.id === layerId);
    if (replaced?.kind === "video") {
      void generateVideoThumbnails(replaced);
      const linked = project.audioTracks.find((track) => track.linked && track.linkedLayerId === layer.id);
      if (linked) void generateAudioWaveform(linked.asset);
    }
    setStatus(`${language === "pt-BR" ? "MÍDIA SUBSTITUÍDA" : "MEDIA REPLACED"} · ${source.name}`);
    if (oldAsset && !projectMediaReferences().includes(oldAsset)) audioWaveformCache.delete(oldAsset);
  } catch (error) {
    window.alert(String(error));
  }
}

async function replaceAudioMedia(trackId: string) {
  if (!project) return;
  const track = project.audioTracks.find((item) => item.id === trackId);
  if (!track) return;
  if (track.linked && track.linkedLayerId) {
    await replaceLayerMedia(track.linkedLayerId);
    return;
  }
  const source = await chooseFile(".mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,audio/*");
  if (!source) return;
  try {
    const asset = await importWebAsset(source);
    const decoded = await probeAudio(asset.relativePath);
    const duration = decoded.duration || await probeMediaDuration(asset.relativePath, "audio");
    if (!duration) throw new Error(language === "pt-BR" ? "Não foi possível ler este arquivo de áudio." : "Could not read this audio file.");
    const clipDuration = track.endTime - track.startTime;
    const previousAsset = track.asset;
    rememberAssetSource(asset.relativePath, asset.sourceMetadata);
    const loop = clipDuration * Math.max(.05, Math.abs(track.playbackRate)) > duration;
    if (!applyCommands([{ type: "audio.set", trackId: track.id, props: { asset: asset.relativePath, sourceIn: 0, sourceOut: duration, loop } }], editLabel("Substituir áudio", "Replace audio"), { panels: false })) return;
    audioWaveformCache.delete(previousAsset);
    audioEngine.stop();
    renderEditorPreservingCanvas();
    refreshHistoryButtons();
    void generateAudioWaveform(asset.relativePath);
    setStatus(`${language === "pt-BR" ? "ÁUDIO SUBSTITUÍDO" : "AUDIO REPLACED"} · ${source.name}`);
  } catch (error) {
    window.alert(String(error));
  }
}

function deleteAudioTrack(id = selectedAudioTrackId) {
  if (!project || !id) return;
  const applied = applyCommands([{ type: "audio.remove", trackId: id }], editLabel("Apagar áudio", "Delete audio"), { select: clearSelectionAfterDelete });
  if (applied) audioEngine.stop();
}

function clearSelectionAfterDelete() {
  selectedAudioTrackId = "";
  selectedLayerId = project?.layers[0]?.id || "";
  selectedEffectId = "";
  selectedKeyRef = "";
}

function copyParameterSection(section: ClipboardSection) {
  const layer = selectedLayer();
  const audio = selectedAudioTrack();
  if (section === "audio" && audio) {
    parameterClipboard = { section, data: structuredClone({
      volume: audio.volume, playbackRate: audio.playbackRate, reverse: audio.reverse, loop: audio.loop,
      fadeInStart: audio.fadeInStart - audio.startTime, fadeInEnd: audio.fadeInEnd - audio.startTime,
      fadeOutStart: audio.fadeOutStart - audio.startTime, fadeOutEnd: audio.fadeOutEnd - audio.startTime,
      duration: audio.endTime - audio.startTime, effects: audio.effects,
    }) };
  } else if (layer && section === "transform") {
    parameterClipboard = { section, data: structuredClone({ x: layer.x, y: layer.y, width: layer.width, height: layer.height, scaleX: layer.scaleX, scaleY: layer.scaleY, rotation: layer.rotation, opacity: layer.opacity, scaleLocked: layer.scaleLocked, sizeLocked: layer.sizeLocked }) };
  } else if (layer && section === "timing") {
    parameterClipboard = { section, data: structuredClone({
      playbackRate: layer.playbackRate, reverse: layer.reverse, loop: layer.loop,
      fadeInStart: layer.fadeInStart - layer.startTime, fadeInEnd: layer.fadeInEnd - layer.startTime,
      fadeOutStart: layer.fadeOutStart - layer.startTime, fadeOutEnd: layer.fadeOutEnd - layer.startTime,
      duration: layer.endTime - layer.startTime,
    }) };
  } else if (layer && section === "effects") {
    parameterClipboard = { section, data: structuredClone(layer.effects) };
  } else return;
  updateInspector();
  setStatus(`COPIED · ${section.toUpperCase()}`);
}

function pasteParameterSection(section: ClipboardSection) {
  if (!project || !parameterClipboard || parameterClipboard.section !== section) return;
  const layer = selectedLayer();
  const audio = selectedAudioTrack();
  const commands: VctCommand[] = [];
  if (section === "audio" && audio) {
    const data = structuredClone(parameterClipboard.data) as Record<string, unknown> & { effects: AudioEffectNode[] };
    const start = audio.startTime;
    commands.push({
      type: "audio.set",
      trackId: audio.id,
      props: {
        volume: Number(data.volume),
        playbackRate: Number(data.playbackRate),
        reverse: Boolean(data.reverse),
        loop: Boolean(data.loop),
        fadeInStart: start + Number(data.fadeInStart),
        fadeInEnd: start + Number(data.fadeInEnd),
        fadeOutStart: start + Number(data.fadeOutStart),
        fadeOutEnd: start + Number(data.fadeOutEnd),
      },
    });
    for (const effect of audio.effects) commands.push({ type: "audioEffect.remove", effectId: effect.id });
    for (const effect of data.effects || []) {
      const effectId = uid("afx");
      commands.push({ type: "audioEffect.add", trackId: audio.id, kind: effect.kind, effectId });
      for (const [parameter, value] of Object.entries(effect.params)) commands.push({ type: "audioEffect.setParam", effectId, parameter, value });
      if (!effect.enabled) commands.push({ type: "audioEffect.set", effectId, enabled: false });
    }
  } else if (section === "transform" && layer) {
    commands.push({ type: "layer.set", layerId: layer.id, props: structuredClone(parameterClipboard.data) as Record<string, unknown> });
  } else if (section === "timing" && layer) {
    const data = structuredClone(parameterClipboard.data) as Record<string, unknown>;
    const start = layer.startTime;
    commands.push({
      type: "layer.set",
      layerId: layer.id,
      props: {
        playbackRate: Number(data.playbackRate),
        reverse: Boolean(data.reverse),
        loop: Boolean(data.loop),
        fadeInStart: start + Number(data.fadeInStart),
        fadeInEnd: start + Number(data.fadeInEnd),
        fadeOutStart: start + Number(data.fadeOutStart),
        fadeOutEnd: start + Number(data.fadeOutEnd),
      },
    });
  } else if (section === "effects" && layer) {
    for (const effect of layer.effects) commands.push({ type: "effect.remove", effectId: effect.id });
    for (const effect of structuredClone(parameterClipboard.data) as EffectNode[]) {
      const effectId = uid("fx");
      commands.push({ type: "effect.add", kind: effect.kind, ownerId: layer.id, effectId });
      for (const [parameter, value] of Object.entries(effect.params)) commands.push({ type: "effect.setParam", effectId, parameter, value });
      for (const [property, keys] of Object.entries(effect.keyframes || {})) {
        if (keys.length) commands.push({ type: "effect.keyframe.set", effectId, property, keys });
      }
      if (!effect.enabled || effect.name !== effect.kind) commands.push({ type: "effect.set", effectId, enabled: effect.enabled, name: effect.name });
    }
  } else return;
  if (!commands.length || !applyCommands(commands, `${editLabel("Colar", "Paste")}: ${section}`)) return;
  if (playing) void audioEngine.play(project, currentTime);
  setStatus(`PASTED · ${section.toUpperCase()}`);
}

function addEffect(kind: EffectKind, post: boolean) {
  if (!project) return;
  if (!post && !selectedLayer()) {
    setStatus(language === "pt-BR" ? "SELECIONE UM INPUT PRIMEIRO" : "SELECT AN INPUT FIRST");
    return;
  }
  const effectId = uid("fx");
  const label = `${editLabel("Efeito", "Effect")}: ${kind}`;
  if (!applyCommands([{ type: "effect.add", kind, ownerId: post ? "__post__" : selectedLayer()!.id, effectId }], label, { panels: false })) return;
  selectedAudioTrackId = "";
  selectedEffectId = effectId;
  selectedKeyRef = "";
  renderEditorPreservingCanvas();
  refreshHistoryButtons();
}

function removeEffect(id: string) {
  const effect = findEffect(id);
  if (!project || !effect) return;
  if (!applyCommands([{ type: "effect.remove", effectId: id }], `${editLabel("Remover efeito", "Remove effect")}: ${effect.kind}`, { panels: false })) return;
  if (selectedEffectId === id) selectedEffectId = "";
  renderEditorPreservingCanvas();
  refreshHistoryButtons();
}

function deleteLayer(layerId = selectedLayerId) {
  const layer = project?.layers.find((item) => item.id === layerId);
  if (!project || !layer) return;
  applyCommands([{ type: "clip.remove", layerId: layer.id }], `${editLabel("Apagar", "Delete")}: ${layer.name}`, { select: clearSelectionAfterDelete });
}

function moveLayer(layerId: string, direction: number) {
  if (!project) return;
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) return;
  const tracks = visualTracks(project);
  const index = tracks.findIndex((track) => track.id === trackIdOf(layer));
  const target = clamp(index + direction, 0, tracks.length - 1);
  if (index < 0 || target === index) return;
  reorderLayerTracks(tracks[index].id, target);
}

function moveAudioTrack(trackId: string, direction: number) {
  if (!project) return;
  const track = project.audioTracks.find((item) => item.id === trackId);
  if (!track) return;
  const lanes = [...new Set(project.audioTracks.map(laneIdOf))];
  const index = lanes.indexOf(laneIdOf(track));
  const target = clamp(index + direction, 0, lanes.length - 1);
  if (index < 0 || index === target) return;
  applyCommands([{ type: "audio.reorderLane", laneId: lanes[index], index: target }], editLabel("Ordem do áudio", "Audio order"));
}

function moveEffect(effectId: string, direction: number) {
  if (!project) return;
  const lists = [...project.layers.map((layer) => layer.effects), project.postEffects];
  const list = lists.find((candidate) => candidate.some((effect) => effect.id === effectId));
  if (!list) return;
  const index = list.findIndex((effect) => effect.id === effectId);
  const target = clamp(index + direction, 0, list.length - 1);
  if (index === target) return;
  if (!applyCommands([{ type: "effect.reorder", effectId, index: target }], editLabel("Ordem dos efeitos", "Effect order"), { panels: false })) return;
  renderEditorPreservingCanvas();
  refreshHistoryButtons();
}

function transitionLabel(type: TransitionType) {
  const pt = language === "pt-BR";
  return ({
    dissolve: pt ? "Dissolver" : "Dissolve",
    dip: pt ? "Fade pelo fundo" : "Dip to background",
    "wipe-right": pt ? "Cortina →" : "Wipe →",
    "wipe-left": pt ? "Cortina ←" : "Wipe ←",
    "push-left": pt ? "Empurrar" : "Push",
  } as Record<TransitionType, string>)[type];
}

function transitionGlyph(type: TransitionType) {
  return ({ dissolve: "◐", dip: "◑", "wipe-right": "▷", "wipe-left": "◁", "push-left": "⇤" } as Record<TransitionType, string>)[type];
}

function renderTransitionControls(layer: Layer) {
  if (!project) return "";
  const window = transitionWindow(project, layer);
  const options = [`<option value="">${language === "pt-BR" ? "Nenhuma" : "None"}</option>`,
    ...TRANSITION_TYPES.map((type) => `<option value="${type}" ${layer.transition?.type === type ? "selected" : ""}>${transitionLabel(type)}</option>`)].join("");
  const duration = layer.transition
    ? window?.partner
      ? `<p class="transition-note">${language === "pt-BR" ? "Duração = sobreposição" : "Duration = overlap"} · ${(window.end - window.start).toFixed(2)} s</p>`
      : `<label class="transition-duration"><span>${language === "pt-BR" ? "DURAÇÃO (s)" : "DURATION (s)"}</span><input type="number" data-transition-duration min="0.05" step="0.05" value="${Number(layer.transition.duration.toFixed(3))}"></label>`
    : "";
  return `<h4 class="subsection-title">${language === "pt-BR" ? "TRANSIÇÃO DE ENTRADA" : "TRANSITION IN"}</h4>
    <div class="transition-controls"><label class="select-field"><select data-transition-type aria-label="${language === "pt-BR" ? "Transição de entrada" : "Transition in"}">${options}</select></label>${duration}</div>`;
}

function selectionIds() {
  if (!project) return [];
  const ids = selectedClipIds.size ? [...selectedClipIds] : selectedLayerId ? [selectedLayerId] : [];
  return ids.filter((id) => project!.layers.some((layer) => layer.id === id));
}

function deleteSelection() {
  const ids = selectionIds();
  if (!project || !ids.length) return;
  if (ids.length === 1) return deleteLayer(ids[0]);
  applyCommands(ids.map((layerId): VctCommand => ({ type: "clip.remove", layerId })), editLabel("Apagar clipes", "Delete clips"), { select: clearSelectionAfterDelete });
}

function rippleDeleteSelection() {
  const ids = selectionIds();
  if (!project || !ids.length) return;
  const starts = new Map(project.layers.map((layer) => [layer.id, layer.startTime]));
  const commands = [...ids].sort((a, b) => (starts.get(b) ?? 0) - (starts.get(a) ?? 0))
    .map((layerId): VctCommand => ({ type: "clip.remove", layerId, ripple: true }));
  if (!applyCommands(commands, editLabel("Apagar com ripple", "Ripple delete"), { clipEdit: true, select: clearSelectionAfterDelete })) return;
  setStatus(language === "pt-BR" ? "APAGADO COM RIPPLE · espaço fechado" : "RIPPLE DELETE · gap closed");
}

function pasteClipboard() {
  if (!project || !clipClipboard) return;
  const fps = project.settings.fps;
  const at = Math.round(currentTime * fps) / fps;
  const first = Math.min(...clipClipboard.layers.map((layer) => layer.startTime));
  const contentEnd = at - first + Math.max(...clipClipboard.layers.map((layer) => layer.endTime), ...clipClipboard.audio.map((track) => track.endTime));
  const commands: VctCommand[] = [];
  if (contentEnd > project.settings.duration + 1e-6) {
    commands.push({ type: "composition.set", props: { duration: Math.min(MAX_TIMELINE_SECONDS, Math.ceil(contentEnd * fps - 1e-6) / fps) } });
  }
  commands.push({ type: "clip.paste", clipboard: clipClipboard, startTime: at });
  const results = applyCommands([...commands, ...linkedAudioOrderCommands(commands)], editLabel("Colar", "Paste"), {
    clipEdit: true,
    select(done) {
      const pasted = (done[commands.length - 1] as { layerIds: string[] }).layerIds;
      selectedClipIds.clear();
      pasted.forEach((id) => selectedClipIds.add(id));
      selectedLayerId = pasted[0];
    },
  });
  if (!results) return;
  const count = (results[commands.length - 1] as { layerIds: string[] }).layerIds.length;
  setStatus(language === "pt-BR" ? `${count} CLIPE(S) COLADO(S) NO PLAYHEAD` : `${count} CLIP(S) PASTED AT PLAYHEAD`);
}

// Corta no playhead: o clipe selecionado, ou o clipe da faixa selecionada sob o
// playhead. O áudio vinculado é cortado junto.
function splitAtPlayhead() {
  if (!project || exportInProgress) return;
  const selected = selectedLayer();
  const fps = project.settings.fps;
  const time = Math.round(currentTime * fps) / fps;
  const covers = (layer: Layer) => time > layer.startTime + .5 / fps && time < layer.endTime - .5 / fps;
  const target = selected && covers(selected)
    ? selected
    : project.layers.find((layer) => selected && trackIdOf(layer) === trackIdOf(selected) && covers(layer))
      || (!selected ? project.layers.find(covers) : undefined);
  if (!target) {
    setStatus(language === "pt-BR" ? "CORTE · posicione o playhead sobre o clipe selecionado" : "SPLIT · place the playhead over the selected clip");
    return;
  }
  stopPlayback();
  const mediaDuration = renderer?.mediaDuration(target.id) || 0;
  const newLayerId = uid("layer");
  const applied = applyCommands([{
    type: "clip.split", layerId: target.id, time, newLayerId, ...(mediaDuration > 0 ? { sourceDuration: mediaDuration } : {}),
  }], editLabel("Cortar clipe", "Split clip"), {
    select(done) {
      selectedLayerId = (done[0] as { newLayerId: string }).newLayerId;
      selectedAudioTrackId = "";
      selectedEffectId = "";
      selectedKeyRef = "";
    },
  });
  if (applied) setStatus(language === "pt-BR" ? "CLIPE CORTADO" : "CLIP SPLIT");
}

function duplicateLayer() {
  const layer = selectedLayer();
  if (!project || !layer) return;
  // Cola uma cópia no mesmo instante: vai para a faixa original se livre, senão para uma faixa nova no topo.
  const clipboard = copyClips(project, [layer.id]);
  const [copy] = clipboard.layers;
  copy.name = `${copy.name} copy`.slice(0, 200);
  copy.x += 24;
  copy.y += 24;
  clipboard.audio.forEach((track) => track.name = `${track.name} copy`.slice(0, 200));
  applyCommands([{ type: "clip.paste", clipboard, startTime: layer.startTime }], editLabel("Duplicar camada", "Duplicate layer"), {
    select(done) {
      selectedLayerId = (done[0] as { layerIds: string[] }).layerIds[0];
      selectedAudioTrackId = "";
      selectedEffectId = "";
      selectedKeyRef = "";
    },
  });
}

function toggleKeyframe(property: string) {
  const layer = selectedLayer();
  if (!layer) return;
  const applied = applyCommands([{
    type: "keyframe.toggle",
    layerId: layer.id,
    property,
    time: currentTime,
    value: renderer?.layerValue(layer, property as keyof Layer, currentTime)
      ?? Number((layer as unknown as Record<string, unknown>)[property]),
  }], "Keyframe", { panels: false });
  if (!applied) return;
  const keyframe = keyframeAt(selectedLayer()?.keyframes[property]);
  selectedKeyRef = keyframe ? `${layer.id}|${property}|${keyframe.time}` : "";
  updateInspector();
  updateTimeline();
}

function toggleEffectKeyframe(property: string) {
  const effect = selectedEffect();
  if (!effect) return;
  const applied = applyCommands([{
    type: "effect.keyframe.toggle",
    effectId: effect.id,
    property,
    time: currentTime,
    value: renderer?.effectValue(effect, property, currentTime) ?? effect.params[property],
  }], "Keyframe", { panels: false });
  if (!applied) return;
  const owner = project!.postEffects.some((item) => item.id === effect.id)
    ? "__post__"
    : project!.layers.find((layer) => layer.effects.some((item) => item.id === effect.id))?.id || "__post__";
  const keyframe = keyframeAt(findEffect(effect.id)?.keyframes[property]);
  selectedKeyRef = keyframe ? `${owner}|fx:${effect.id}:${property}|${keyframe.time}` : "";
  updateInspector();
  updateTimeline();
}

function toggleColorKeyframe(property: "fill" | "stroke") {
  const layer = selectedLayer();
  if (!layer) return;
  const key = `${property}Color`;
  const applied = applyCommands([{
    type: "keyframe.toggle",
    layerId: layer.id,
    property: key,
    time: currentTime,
    value: parseInt((renderer?.layerColor(layer, property, currentTime) || layer[property]).slice(1), 16),
  }], "Keyframe", { panels: false });
  if (!applied) return;
  const keyframe = keyframeAt(selectedLayer()?.keyframes[key]);
  selectedKeyRef = keyframe ? `${layer.id}|${key}|${keyframe.time}` : "";
  updateInspector();
  updateTimeline();
}

function updateTimelineClipStyles(id: string, start: number, end: number, audio = false) {
  if (!project) return;
  const selector = audio ? `[data-move-audio-clip="${id}"]` : `[data-clip-layer="${id}"]`;
  const clip = app.querySelector<HTMLElement>(selector);
  if (!clip) return;
  clip.style.left = `${start / project.settings.duration * 100}%`;
  clip.style.width = `${(end - start) / project.settings.duration * 100}%`;
}

const MAX_TIMELINE_SECONDS = 7200;

function updateFadeClipVisuals(clip: HTMLElement, item: Pick<Layer, "startTime" | "endTime" | "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd">) {
  const duration = Math.max(.001, item.endTime - item.startTime);
  const fadeIn = clip.querySelector<HTMLElement>(".fade-overlay.fade-in");
  const fadeOut = clip.querySelector<HTMLElement>(".fade-overlay.fade-out");
  if (fadeIn) fadeIn.style.cssText = fadeOverlayStyle(item, "in");
  if (fadeOut) fadeOut.style.cssText = fadeOverlayStyle(item, "out");
  clip.querySelectorAll<HTMLElement>("[data-fade-property]").forEach((handle) => {
    const property = handle.dataset.fadeProperty as "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd";
    handle.style.left = `${(item[property] - item.startTime) / duration * 100}%`;
  });
}

function timelineSnapCandidates(layerId = "", audioId = "", excludePlayhead = false) {
  return collectTimelineSnapCandidates(project, currentTime, {
    layerId,
    audioId,
    playhead: excludePlayhead,
  });
}

function timelineContentRect(scrubArea: HTMLElement) {
  return (scrubArea.querySelector<HTMLElement>(".timeline-content") || scrubArea).getBoundingClientRect();
}

function timelineTimeFromPointer(event: Pick<MouseEvent, "clientX">, scrubArea: HTMLElement) {
  const rect = timelineContentRect(scrubArea);
  return clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1) * (project?.settings.duration || 0);
}

function snapTimelineTime(
  value: number,
  scrubArea: HTMLElement,
  excludeLayerId = "",
  excludeAudioId = "",
  bypass = false,
  excludePlayhead = false,
) {
  let candidates: number[] = [];
  const result = calculateTimelineSnap(value, project, timelineSnap,
    () => timelineContentRect(scrubArea).width,
    () => candidates = timelineSnapCandidates(excludeLayerId, excludeAudioId, excludePlayhead), bypass);
  lastSnap = candidates.some((candidate) => Math.abs(candidate - result) < 1e-6) ? result : null;
  return result;
}

function snapClipStart(value: number, length: number, scrubArea: HTMLElement, excludeLayerId = "", excludeAudioId = "", bypass = false) {
  const start = snapTimelineTime(value, scrubArea, excludeLayerId, excludeAudioId, bypass);
  const startHit = lastSnap;
  const end = snapTimelineTime(value + length, scrubArea, excludeLayerId, excludeAudioId, bypass) - length;
  const useStart = Math.abs(start - value) <= Math.abs(end - value);
  // O guia fica na borda do clipe que travou: início ou fim.
  if (useStart) lastSnap = startHit;
  return useStart ? start : end;
}

/** Vertical guide on the timeline at the time a drag just snapped to; null removes it. */
function showSnapGuide(time: number | null) {
  const tracks = app.querySelector<HTMLElement>("#timeline-tracks");
  if (!tracks || !project) return;
  let line = tracks.querySelector<HTMLElement>(".snap-guide-line");
  if (time === null) {
    line?.remove();
    return;
  }
  if (!line) {
    line = document.createElement("i");
    line.className = "snap-guide-line";
    tracks.append(line);
  }
  line.style.left = `${time / project.settings.duration * 100}%`;
}

const TRIM_FIELDS = ["startTime", "endTime", "sourceIn", "sourceOut", "loop", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"] as const;
const FADE_FIELDS = ["fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"] as const;

/** The fields of after that differ from before, as layer.set / audio.set props. */
function changedProps<T extends object>(before: T, after: T, fields: readonly string[]) {
  const props: Record<string, unknown> = {};
  for (const field of fields) {
    const next = (after as Record<string, unknown>)[field];
    if (next !== (before as Record<string, unknown>)[field]) props[field] = next;
  }
  return props;
}

// ---- Régua, zoom, região de trabalho e atalhos de transporte.

function syncMinimap() {
  const scroll = app.querySelector<HTMLElement>(".timeline-scroll");
  const view = app.querySelector<HTMLElement>("#timeline-minimap b");
  if (!scroll || !view || !scroll.scrollWidth) return;
  view.style.left = `${scroll.scrollLeft / scroll.scrollWidth * 100}%`;
  view.style.width = `${Math.min(100, scroll.clientWidth / scroll.scrollWidth * 100)}%`;
}

function bindMinimap(scroll: HTMLElement) {
  const minimap = app.querySelector<HTMLElement>("#timeline-minimap");
  if (!minimap) return;
  const scrollTo = (event: PointerEvent) => {
    const rect = minimap.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    scroll.scrollLeft = ratio * scroll.scrollWidth - scroll.clientWidth / 2;
  };
  minimap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    minimap.setPointerCapture(event.pointerId);
    scrollTo(event);
    const move = (moveEvent: PointerEvent) => scrollTo(moveEvent);
    const stop = (upEvent: PointerEvent) => {
      minimap.removeEventListener("pointermove", move);
      minimap.removeEventListener("pointerup", stop);
      minimap.removeEventListener("pointercancel", stop);
      if (minimap.hasPointerCapture(upEvent.pointerId)) minimap.releasePointerCapture(upEvent.pointerId);
    };
    minimap.addEventListener("pointermove", move);
    minimap.addEventListener("pointerup", stop);
    minimap.addEventListener("pointercancel", stop);
  });
  syncMinimap();
}

/** Scrolls the timeline so the playhead stays visible while playing. */
function followPlayhead() {
  const scroll = app.querySelector<HTMLElement>(".timeline-scroll");
  if (!scroll || !project || scroll.scrollWidth <= scroll.clientWidth + 1) return;
  const x = currentTime / project.settings.duration * scroll.scrollWidth;
  if (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 24) scroll.scrollLeft = x - scroll.clientWidth * .15;
}

function updateLevelMeter() {
  const meter = app.querySelector<HTMLElement>("#level-meter");
  const bar = meter?.firstElementChild as HTMLElement | null;
  if (!meter || !bar) return;
  const level = playing ? audioEngine.level() : 0;
  bar.style.width = `${Math.min(100, level * 100)}%`;
  meter.classList.toggle("is-hot", level > .95);
}

/**
 * Horizontal zoom anchored on a screen x (pointer or pinch centre). The content
 * width changes in place; the ruler labels are rebuilt once the zoom settles.
 */
function applyTimelineZoom(next: number, clientX: number) {
  const scroll = app.querySelector<HTMLElement>(".timeline-scroll");
  const content = scroll?.querySelector<HTMLElement>(".timeline-content");
  if (!scroll || !content) return;
  const value = clamp(next, 1, 10);
  if (Math.abs(value - timelineZoomX) < 1e-4) return;
  const rect = content.getBoundingClientRect();
  const anchor = clientX - scroll.getBoundingClientRect().left;
  const ratio = (clientX - rect.left) / Math.max(1, rect.width);
  timelineZoomX = value;
  localStorage.setItem("nt-vct-timeline-zoom-x", String(timelineZoomX));
  content.style.width = `${value * 100}%`;
  scroll.scrollLeft = ratio * content.offsetWidth - anchor;
  syncMinimap();
  window.clearTimeout(timelineZoomTimer);
  timelineZoomTimer = window.setTimeout(updateTimeline, 160);
}

// Pinça com dois dedos sobre a timeline; o estado vive fora da timeline porque ela é recriada.
const pinchPointers = new Map<number, { x: number; y: number }>();
let pinchStart: { distance: number; zoom: number } | null = null;
const pinchDistance = () => {
  const [a, b] = [...pinchPointers.values()];
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
};
window.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || !(event.target as Element | null)?.closest?.(".timeline-scroll")) return;
  pinchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinchPointers.size === 2) pinchStart = { distance: pinchDistance(), zoom: timelineZoomX };
}, true);
window.addEventListener("pointermove", (event) => {
  const point = pinchPointers.get(event.pointerId);
  if (!point) return;
  point.x = event.clientX;
  point.y = event.clientY;
  if (pinchPointers.size !== 2 || !pinchStart) return;
  const [a, b] = [...pinchPointers.values()];
  applyTimelineZoom(pinchStart.zoom * pinchDistance() / pinchStart.distance, (a.x + b.x) / 2);
}, true);
const endPinchPointer = (event: PointerEvent) => {
  pinchPointers.delete(event.pointerId);
  if (pinchPointers.size < 2) pinchStart = null;
};
window.addEventListener("pointerup", endPinchPointer, true);
window.addEventListener("pointercancel", endPinchPointer, true);

function snapFrame(time: number) {
  const fps = project?.settings.fps || 30;
  return Math.round(time * fps) / fps;
}

/** I / O: moves one edge of the work area to the playhead; the missing edge defaults to 0 or the end. */
function setWorkAreaEdge(edge: "in" | "out") {
  if (!project || exportInProgress) return;
  const duration = project.settings.duration;
  const time = clamp(snapFrame(currentTime), 0, duration);
  const area = project.settings.workArea;
  let start = edge === "in" ? time : area?.in ?? 0;
  let end = edge === "out" ? time : area?.out ?? duration;
  if (edge === "in" && end <= start) end = duration;
  if (edge === "out" && start >= end) start = 0;
  if (end <= start) {
    setStatus(language === "pt-BR" ? "REGIÃO DE TRABALHO · posicione o playhead dentro da composição" : "WORK AREA · place the playhead inside the composition");
    return;
  }
  if (area && area.in === start && area.out === end) return;
  const label = edge === "in" ? editLabel("Início da região de trabalho", "Work area in") : editLabel("Fim da região de trabalho", "Work area out");
  if (applyCommands([{ type: "composition.set", props: { workArea: { in: start, out: end } } }], label, { panels: false })) {
    updateTimeline();
    setStatus(`${language === "pt-BR" ? "REGIÃO DE TRABALHO" : "WORK AREA"} · ${formatRulerTime(start, project.settings.fps)} – ${formatRulerTime(end, project.settings.fps)}`);
  }
}

function clearWorkArea() {
  if (!project || !project.settings.workArea) return;
  if (applyCommands([{ type: "composition.set", props: { workArea: null } }], editLabel("Limpar região de trabalho", "Clear work area"), { panels: false })) {
    updateTimeline();
    setStatus(language === "pt-BR" ? "REGIÃO DE TRABALHO LIMPA" : "WORK AREA CLEARED");
  }
}

/** Moves the later clips of the selected track left so no gap remains between them. */
function closeGaps() {
  if (!project || exportInProgress) return;
  const fps = project.settings.fps;
  const commands: VctCommand[] = [];
  const audio = selectedAudioTrack();
  const selected = selectedLayer();
  let clips: Array<Layer | AudioTrack> = [];
  if (audio) clips = (audioLanes(project).find((lane) => lane.clips.some((clip) => clip.id === audio.id))?.clips || []).filter((clip) => !clip.linked);
  else if (selected) clips = project.layers.filter((layer) => trackIdOf(layer) === trackIdOf(selected));
  else {
    setStatus(language === "pt-BR" ? "FECHAR ESPAÇOS · selecione um clipe da faixa" : "CLOSE GAPS · select a clip on the track");
    return;
  }
  clips = [...clips].sort((a, b) => a.startTime - b.startTime);
  let end = clips[0]?.endTime ?? 0;
  for (const clip of clips.slice(1)) {
    const start = Math.round(end * fps) / fps;
    if (clip.startTime > end + 1e-6 && start < clip.startTime - 1e-6) {
      commands.push(audio
        ? { type: "audio.move", trackId: clip.id, startTime: start }
        : { type: "clip.move", layerId: clip.id, startTime: start });
      end = start + (clip.endTime - clip.startTime);
    } else end = Math.max(end, clip.endTime);
  }
  if (!commands.length) {
    setStatus(language === "pt-BR" ? "SEM ESPAÇOS PARA FECHAR" : "NO GAPS TO CLOSE");
    return;
  }
  stopPlayback();
  if (applyCommands(commands, editLabel("Fechar espaços", "Close gaps"), { clipEdit: true })) {
    setStatus(language === "pt-BR" ? `${commands.length} CLIPE(S) MOVIDO(S) · espaços fechados` : `${commands.length} CLIP(S) MOVED · gaps closed`);
  }
}

/** Ctrl+X: copies the selected clips to the clip clipboard and removes them in one undo step. */
function cutSelection() {
  const ids = selectionIds();
  if (!project || !ids.length) return;
  const previous = clipClipboard;
  clipClipboard = copyClips(project, ids);
  const removed = applyCommands(ids.map((layerId): VctCommand => ({ type: "clip.remove", layerId })),
    editLabel("Recortar clipes", "Cut clips"), { select: clearSelectionAfterDelete });
  if (!removed) {
    clipClipboard = previous;
    return;
  }
  setStatus(language === "pt-BR" ? `${ids.length} CLIPE(S) RECORTADO(S)` : `${ids.length} CLIP(S) CUT`);
}

/** Deletes the keyframe selected on the timeline; false when none is selected. */
function deleteSelectedKeyframe() {
  const track = keyRefTrack(selectedKeyRef);
  const command = track && keyTrackCommand(track.target, track.keys, track.time, () => null);
  if (!command) return false;
  const ref = selectedKeyRef;
  selectedKeyRef = "";
  if (applyCommands([command], editLabel("Excluir keyframe", "Delete keyframe"))) return true;
  selectedKeyRef = ref;
  return false;
}

function stepTime(frames: number) {
  if (!project) return;
  stopPlayback();
  setTime(snapFrame(currentTime) + frames / project.settings.fps);
}

/** Transport shortcuts (not while typing). Returns true when the key was used. */
function handleTransportKey(event: KeyboardEvent) {
  if (!project || event.ctrlKey || event.metaKey) return false;
  if (event.altKey) {
    if (event.code !== "KeyX") return false;
    clearWorkArea();
    return true;
  }
  const key = event.key.toLowerCase();
  if (event.repeat && event.code !== "Comma" && event.code !== "Period" && key !== "j" && !event.shiftKey) return true;
  if (event.code === "Comma" || event.code === "Period") {
    stepTime((event.code === "Comma" ? -1 : 1) * (event.shiftKey ? 10 : 1));
    return true;
  }
  if (event.key === "?") {
    openShortcutsPanel(language);
    return true;
  }
  if (event.shiftKey) return false;
  if (key === "k") togglePlayback();
  else if (key === "l") {
    if (!playing) togglePlayback();
  } else if (key === "j") {
    stopPlayback();
    setTime(currentTime - 1);
  } else if (event.key === "Home") {
    stopPlayback();
    setTime(0);
  } else if (event.key === "End") {
    stopPlayback();
    setTime(project.settings.duration);
  } else if (key === "i") setWorkAreaEdge("in");
  else if (key === "o") setWorkAreaEdge("out");
  else return false;
  return true;
}

let suppressKeyClick = false;

/** Dragging a keyframe diamond moves it in time (one undo step); a plain tap still selects it. */
function bindKeyframeDrag(scrubArea: HTMLElement) {
  scrubArea.querySelectorAll<HTMLElement>("[data-key-ref]").forEach((dot) => dot.addEventListener("pointerdown", (event) => {
    if (!project || event.button !== 0) return;
    const info = keyRefTrack(dot.dataset.keyRef!);
    if (!info) return;
    const parts = dot.dataset.keyRef!.split("|");
    const startX = event.clientX;
    let gesture: Gesture | null = null;
    let ref = dot.dataset.keyRef!;
    dot.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (!project) return;
      if (!gesture) {
        if (Math.abs(moveEvent.clientX - startX) < 4) return;
        stopPlayback();
        endEditSession();
        gesture = beginGesture(editLabel("Mover keyframe", "Move keyframe"));
      }
      const time = clamp(snapTimelineTime(timelineTimeFromPointer(moveEvent, scrubArea), scrubArea, "", "", moveEvent.altKey), 0, project.settings.duration);
      showSnapGuide(lastSnap);
      const clash = info.keys.some((key) => Math.abs(key.time - info.time) > keyframeTolerance() && Math.abs(key.time - time) <= keyframeTolerance());
      const command = clash ? null : keyTrackCommand(info.target, info.keys, info.time, (key) => ({ ...key, time }));
      if (!command || !gesture.preview([command])) return;
      parts[2] = String(time);
      ref = parts.join("|");
      dot.style.left = `${time / project.settings.duration * 100}%`;
      dot.dataset.keyRef = ref;
      void renderFrame();
    };
    const stop = (upEvent: PointerEvent) => {
      dot.removeEventListener("pointermove", move);
      dot.removeEventListener("pointerup", stop);
      dot.removeEventListener("pointercancel", stop);
      if (dot.hasPointerCapture(upEvent.pointerId)) dot.releasePointerCapture(upEvent.pointerId);
      showSnapGuide(null);
      if (!gesture) return;
      suppressKeyClick = true;
      window.setTimeout(() => { suppressKeyClick = false; }, 0);
      (gesture as Gesture).end();
      selectedKeyRef = ref;
      if (parts[0] !== "__post__") selectedLayerId = parts[0];
      selectedAudioTrackId = "";
      selectedEffectId = parts[1].startsWith("fx:") ? parts[1].split(":")[1] : "";
      updateLayerStack();
      updateInspector();
      updateTimeline();
    };
    dot.addEventListener("pointermove", move);
    dot.addEventListener("pointerup", stop);
    dot.addEventListener("pointercancel", stop);
  }));
}

/** Alt+drag: copies the clip (with its linked audio) so it starts at the given time. */
function duplicateClipAt(layerId: string, startTime: number, length: number, trackId = "") {
  if (!project) return;
  const fps = project.settings.fps;
  const newLayerId = uid("layer");
  const end = startTime + length;
  const prefix: VctCommand[] = end > project.settings.duration + 1e-6
    ? [{ type: "composition.set", props: { duration: Math.min(MAX_TIMELINE_SECONDS, Math.ceil(end * fps - 1e-6) / fps) } }]
    : [];
  const duplicate: VctCommand = { type: "clip.duplicate", layerId, startTime, newLayerId };
  const label = editLabel("Duplicar clipe", "Duplicate clip");
  const select = () => {
    selectedClipIds.clear();
    selectedLayerId = newLayerId;
    selectedAudioTrackId = "";
    selectedEffectId = "";
    selectedKeyRef = "";
  };
  const withTrack: VctCommand[] = trackId ? [duplicate, { type: "clip.move", layerId: newLayerId, startTime, trackId }] : [duplicate];
  if (trackId && applyCommands([...prefix, ...withTrack], label, { clipEdit: true, select })) return;
  if (applyCommands([...prefix, duplicate], label, { clipEdit: true, select })) {
    setStatus(language === "pt-BR" ? "CLIPE DUPLICADO" : "CLIP DUPLICATED");
  }
}

function bindTimeline() {
  app.querySelector("#play")?.addEventListener("click", togglePlayback);
  app.querySelector("#split-clip")?.addEventListener("click", splitAtPlayhead);
  app.querySelector("#area-in")?.addEventListener("click", () => setWorkAreaEdge("in"));
  app.querySelector("#area-out")?.addEventListener("click", () => setWorkAreaEdge("out"));
  app.querySelector("#area-clear")?.addEventListener("click", clearWorkArea);
  app.querySelector("#close-gaps")?.addEventListener("click", closeGaps);
  app.querySelector("#overlap-mode")?.addEventListener("click", () => {
    overlapMode = !overlapMode;
    localStorage.setItem("nt-vct-overlap-mode", overlapMode ? "1" : "0");
    setStatus(overlapMode
      ? (language === "pt-BR" ? "SOBREPOR LIGADO · sobreposição na mesma faixa vira transição" : "OVERLAP ON · overlaps on a track become transitions")
      : (language === "pt-BR" ? "SOBREPOR DESLIGADO" : "OVERLAP OFF"));
    updateTimeline();
  });
  app.querySelector("#to-start")?.addEventListener("click", () => {
    stopPlayback();
    setTime(0);
  });
  app.querySelector("#to-end")?.addEventListener("click", () => {
    stopPlayback();
    setTime(project!.settings.duration);
  });
  app.querySelector("#timeline-loop")?.addEventListener("click", () => {
    timelineLoop = !timelineLoop;
    const button = app.querySelector<HTMLButtonElement>("#timeline-loop");
    button?.classList.toggle("is-active", timelineLoop);
    button?.setAttribute("aria-pressed", String(timelineLoop));
  });
  app.querySelector("#timeline-snap")?.addEventListener("click", () => {
    timelineSnap = !timelineSnap;
    localStorage.setItem("nt-vct-timeline-snap", String(timelineSnap));
    app.querySelector("#timeline-snap")?.classList.toggle("is-active", timelineSnap);
  });
  app.querySelector("#record-mode")?.addEventListener("click", () => {
    if (recordMode) finalizeRecordedAutomation();
    recordMode = !recordMode;
    const button = app.querySelector<HTMLButtonElement>("#record-mode");
    button?.classList.toggle("is-active", recordMode);
    button?.setAttribute("aria-pressed", String(recordMode));
    updateLiveUi();
  });
  app.querySelectorAll<HTMLElement>("[data-toggle-timeline-layer]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.toggleTimelineLayer!;
    if (expandedTimelineLayers.has(id)) expandedTimelineLayers.delete(id);
    else expandedTimelineLayers.add(id);
    updateTimeline();
  }));
  app.querySelector<HTMLElement>("[data-toggle-timeline-post]")?.addEventListener("click", () => {
    timelinePostExpanded = !timelinePostExpanded;
    updateTimeline();
  });
  app.querySelectorAll<HTMLElement>("[data-select-timeline-effect]").forEach((button) => button.addEventListener("click", () => {
    const owner = button.dataset.effectOwner!;
    if (owner !== "__post__") selectedLayerId = owner;
    selectedAudioTrackId = "";
    selectedEffectId = button.dataset.selectTimelineEffect!;
    selectedKeyRef = "";
    updateLayerStack();
    updateInspector();
    updateTimeline();
  }));
  app.querySelectorAll<HTMLElement>("[data-timeline-zoom]").forEach((button) => button.addEventListener("click", () => {
    const [axis, direction] = button.dataset.timelineZoom!.split(":");
    setTimelineZoom(axis as "x" | "y", Number(direction));
  }));
  app.querySelectorAll<HTMLElement>("[data-group-height]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const [group, direction] = button.dataset.groupHeight!.split(":");
    if (group === "video") {
      videoTrackZoomY = clamp(videoTrackZoomY + Number(direction) * .2, .6, 4);
      localStorage.setItem("nt-vct-video-track-zoom-y", String(videoTrackZoomY));
    } else {
      audioTrackZoomY = clamp(audioTrackZoomY + Number(direction) * .2, .6, 4);
      localStorage.setItem("nt-vct-audio-track-zoom-y", String(audioTrackZoomY));
    }
    updateTimeline();
  }));
  app.querySelector("#add-track")?.addEventListener("click", addEmptyTrack);
  app.querySelectorAll<HTMLElement>("[data-track-name]").forEach((element) => element.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    beginTrackRename(element);
  }));
  bindTimelineOrderDrag();
  bindCurveTools();
  app.querySelector<HTMLSelectElement>("#duration-unit")?.addEventListener("change", (event) => {
    durationUnit = (event.target as HTMLSelectElement).value === "frames" ? "frames" : "tc";
    localStorage.setItem("nt-vct-duration-unit", durationUnit);
    const input = app.querySelector<HTMLInputElement>("#duration-input");
    if (input && project) {
      input.value = formatDurationValue(project.settings.duration, project.settings.fps, durationUnit);
      input.title = durationUnit === "frames" ? "Frames" : "HH:MM:SS:FF";
    }
  });
  app.querySelector<HTMLInputElement>("#duration-input")?.addEventListener("change", (event) => {
    if (!project) return;
    const input = event.target as HTMLInputElement;
    const parsed = parseDurationValue(input.value, project.settings.fps, durationUnit);
    if (parsed === null || parsed <= 0) {
      input.value = formatDurationValue(project.settings.duration, project.settings.fps, durationUnit);
      setStatus(language === "pt-BR"
        ? `DURAÇÃO INVÁLIDA · use ${durationUnit === "frames" ? "um número de frames" : "HH:MM:SS:FF"}`
        : `INVALID DURATION · use ${durationUnit === "frames" ? "a frame count" : "HH:MM:SS:FF"}`);
      return;
    }
    const previous = project.settings.duration;
    const value = clamp(parsed, 1 / project.settings.fps, MAX_TIMELINE_SECONDS);
    // Clipes que terminam no fim antigo acompanham o novo fim (o áudio vinculado segue o vídeo).
    const followEnd = (item: Layer | AudioTrack) => {
      const moved = { ...item, endTime: value, fadeOutStart: item.fadeOutStart + value - previous, fadeOutEnd: item.fadeOutEnd + value - previous };
      normalizeFades(moved);
      return { endTime: moved.endTime, fadeInStart: moved.fadeInStart, fadeInEnd: moved.fadeInEnd, fadeOutStart: moved.fadeOutStart, fadeOutEnd: moved.fadeOutEnd };
    };
    const atEnd = (item: Layer | AudioTrack) => Math.abs(item.endTime - previous) < .001;
    const follow: VctCommand[] = [
      ...project.layers.filter(atEnd).map((layer): VctCommand => ({ type: "layer.set", layerId: layer.id, props: followEnd(layer) })),
      ...project.audioTracks.filter((track) => atEnd(track) && !(track.linked && project!.layers.some((layer) => layer.id === track.linkedLayerId)))
        .map((track): VctCommand => ({ type: "audio.set", trackId: track.id, props: followEnd(track) })),
    ];
    const resize: VctCommand = { type: "composition.set", props: { duration: value } };
    const applied = applyCommands(value < previous ? [...follow, resize] : [resize, ...follow], editLabel("Duração da composição", "Composition duration"), {
      select() { currentTime = clamp(currentTime, 0, value); },
    });
    if (!applied) {
      input.value = formatDurationValue(project.settings.duration, project.settings.fps, durationUnit);
      return;
    }
    setTime(currentTime);
  });
  app.querySelectorAll<HTMLElement>("[data-key-ref]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (suppressKeyClick) return;
      const [layerId, property, time] = button.dataset.keyRef!.split("|");
      app.querySelectorAll(".key-dot.is-selected").forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      selectedKeyRef = button.dataset.keyRef!;
      stopPlayback();
      if (layerId !== "__post__") selectedLayerId = layerId;
      selectedAudioTrackId = "";
      selectedEffectId = property.startsWith("fx:") ? property.split(":")[1] : "";
      setTime(Number(time), false);
      updateLayerStack();
      updateInspector();
      updateCurveTools();
      app.querySelectorAll<HTMLElement>("[data-label-layer]").forEach((label) =>
        label.classList.toggle("is-selected", label.dataset.labelLayer === selectedLayerId));
    });
    button.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      const track = keyRefTrack(button.dataset.keyRef!);
      const command = track && keyTrackCommand(track.target, track.keys, track.time, () => null);
      if (!command) return;
      const wasSelected = selectedKeyRef === button.dataset.keyRef;
      if (wasSelected) selectedKeyRef = "";
      if (!applyCommands([command], editLabel("Excluir keyframe", "Delete keyframe"))) {
        if (wasSelected) selectedKeyRef = button.dataset.keyRef!;
      }
    });
  });

  const scrubArea = app.querySelector<HTMLElement>(".timeline-scroll");
  if (!scrubArea) return;
  const labels = app.querySelector<HTMLElement>(".timeline-labels");
  bindBinDrop(scrubArea);
  scrubArea.addEventListener("scroll", () => {
    if (labels && Math.abs(labels.scrollTop - scrubArea.scrollTop) > 1) labels.scrollTop = scrubArea.scrollTop;
    syncMinimap();
  });
  scrubArea.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    applyTimelineZoom(timelineZoomX * Math.exp(-event.deltaY * (event.deltaMode === 1 ? .05 : .0025)), event.clientX);
  }, { passive: false });
  bindMinimap(scrubArea);
  bindKeyframeDrag(scrubArea);
  labels?.addEventListener("scroll", () => {
    if (Math.abs(scrubArea.scrollTop - labels.scrollTop) > 1) scrubArea.scrollTop = labels.scrollTop;
  });
  app.querySelectorAll<HTMLElement>("[data-trim-clip]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
    if (!project || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopPlayback();
    const found = project.layers.find((item) => item.id === handle.dataset.trimClip);
    if (!found) return;
    selectLayerById(found.id, false);
    endEditSession();
    const layer = structuredClone(found);
    const gesture = beginGesture(editLabel("Aparar clipe", "Trim clip"));
    const edge = handle.dataset.trimEdge as "start" | "end";
    const initialStart = layer.startTime;
    const initialEnd = layer.endTime;
    const initialSourceIn = layer.sourceIn;
    const mediaDuration = renderer?.mediaDuration(layer.id) || layer.sourceOut || project.settings.duration;
    const initialSourceOut = layer.sourceOut > initialSourceIn ? layer.sourceOut : mediaDuration;
    const speed = Math.max(.05, Math.abs(layer.playbackRate || 1));
    const minLength = 1 / Math.max(1, project.settings.fps);
    const clip = app.querySelector<HTMLElement>(`[data-clip-layer="${layer.id}"]`);
    const neighbors = overlapMode ? { previousEnd: 0, nextStart: Number.POSITIVE_INFINITY } : clipNeighbors(project, layer.id);
    handle.setPointerCapture(event.pointerId);
    const pointerTime = (moveEvent: PointerEvent) => {
      const snapped = snapTimelineTime(timelineTimeFromPointer(moveEvent, scrubArea), scrubArea, layer.id, "", moveEvent.altKey);
      showSnapGuide(lastSnap);
      return snapped;
    };
    const move = (moveEvent: PointerEvent) => {
      const time = pointerTime(moveEvent);
      const draft = { ...layer };
      if (edge === "start") {
        const nextStart = clamp(time, neighbors.previousEnd, initialEnd - minLength);
        const delta = nextStart - initialStart;
        draft.startTime = nextStart;
        if (layer.kind === "video") {
          if (layer.reverse) draft.sourceOut = clamp(initialSourceOut - delta * speed, initialSourceIn + .001, mediaDuration);
          else draft.sourceIn = clamp(initialSourceIn + delta * speed, 0, initialSourceOut - .001);
        }
      } else {
        draft.endTime = clamp(time, initialStart + minLength, Math.min(project!.settings.duration, neighbors.nextStart));
        if (layer.kind === "video") {
          const naturalTimelineDuration = (initialSourceOut - draft.sourceIn) / speed;
          draft.loop = draft.endTime - draft.startTime > naturalTimelineDuration + minLength / 2;
        }
      }
      normalizeFades(draft);
      const props = changedProps(layer, draft, TRIM_FIELDS);
      if (!gesture.preview(Object.keys(props).length ? [{ type: "layer.set", layerId: layer.id, props, ...(overlapMode ? { allowOverlap: true } : {}) }] : [])) return;
      if (clip) {
        clip.style.left = `${draft.startTime / project!.settings.duration * 100}%`;
        clip.style.width = `${(draft.endTime - draft.startTime) / project!.settings.duration * 100}%`;
      }
      if (layer.kind === "video") for (const track of project!.audioTracks) {
        if (track.linked && track.linkedLayerId === layer.id) updateTimelineClipStyles(track.id, track.startTime, track.endTime, true);
      }
      syncInspectorValues();
      void renderFrame();
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      showSnapGuide(null);
      gesture.end({ clipEdit: true });
      updateInspector();
      updateTimeline();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }));
  app.querySelectorAll<HTMLElement>("[data-move-layer-clip], [data-move-audio-clip]").forEach((clip) => clip.addEventListener("pointerdown", (event) => {
    if (!project || event.button !== 0 || (event.target as HTMLElement).closest("[data-trim-clip], [data-trim-audio], [data-fade-handle]")) return;
    event.preventDefault();
    event.stopPropagation();
    stopPlayback();
    const videoId = clip.dataset.moveLayerClip;
    const audioId = clip.dataset.moveAudioClip;
    const layer = videoId ? project.layers.find((item) => item.id === videoId) : undefined;
    const track = audioId ? project.audioTracks.find((item) => item.id === audioId) : undefined;
    if (!layer && !track) return;
    if (layer && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      if (!selectedClipIds.size && selectedLayerId) selectedClipIds.add(selectedLayerId);
      if (selectedClipIds.has(layer.id)) selectedClipIds.delete(layer.id);
      else selectedClipIds.add(layer.id);
      selectLayerById(layer.id, false);
      updateTimeline();
      return;
    }
    selectedClipIds.clear();
    const linkedLayer = track?.linked && track.linkedLayerId
      ? project.layers.find((item) => item.id === track.linkedLayerId && item.kind === "video")
      : undefined;
    if (layer) selectLayerById(layer.id, false);
    else if (track) selectAudioTrackById(track.id, false);
    endEditSession();
    const gesture = beginGesture(editLabel("Mover clipe", "Move clip"));
    // O áudio vinculado anda pelo vídeo, que leva junto fades e keyframes.
    const movingLayerId = (layer || linkedLayer)?.id;
    // Alt + arrastar um clipe visual duplica-o (com o áudio vinculado) no ponto solto; o original fica.
    // Em clipes de áudio o Alt continua só ignorando o snap.
    const duplicating = Boolean(layer) && event.altKey;
    let ghost: HTMLElement | null = null;
    const layerId = layer?.id || "";
    const audioTrackId = track?.id || "";
    const sourceTrackId = layer ? trackIdOf(layer) : "";
    const fps = project.settings.fps;
    const baseDuration = project.settings.duration;
    const initialStart = (layer || track)!.startTime;
    const initialEnd = (layer || track)!.endTime;
    const length = initialEnd - initialStart;
    const startX = event.clientX;
    const timelinePixelWidth = timelineContentRect(scrubArea).width;
    clip.setPointerCapture(event.pointerId);
    // Na própria faixa, o clipe só anda no espaço livre entre os vizinhos.
    const neighbors = layer && !overlapMode && !duplicating ? clipNeighbors(project, layer.id) : { previousEnd: 0, nextStart: Number.POSITIVE_INFINITY };
    const minStart = neighbors.previousEnd;
    const maxStart = Math.min(MAX_TIMELINE_SECONDS, neighbors.nextStart) - length;
    // clip.move exige início num frame; os limites também caem na grade.
    const onFrames = Boolean(movingLayerId);
    const lowStart = onFrames ? Math.ceil(minStart * fps - 1e-6) / fps : minStart;
    const highStart = onFrames ? Math.floor(maxStart * fps + 1e-6) / fps : maxStart;
    // Durante o arrasto o clipe fica dentro da composição; a duração cresce ao soltar.
    const fitStart = Math.max(0, onFrames ? Math.floor((baseDuration - length) * fps + 1e-6) / fps : baseDuration - length);
    // Arrastar na vertical sobre outra faixa visual muda o clipe de faixa ao soltar.
    let dropTrackId = "";
    let wantedStart = initialStart;
    const markDropTarget = (moveEvent: PointerEvent) => {
      if (!layer) return;
      const row = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>(".timeline-track[data-track-id]");
      const candidate = row?.dataset.trackId || "";
      dropTrackId = candidate && candidate !== sourceTrackId ? candidate : "";
      app.querySelectorAll(".timeline-track.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
      if (dropTrackId) row!.classList.add("is-drop-target");
    };
    const moveCommands = (start: number, options: { extend?: boolean; trackId?: string } = {}) => {
      const commands: VctCommand[] = [];
      const end = start + length;
      if (options.extend && end > baseDuration + 1e-6) {
        commands.push({ type: "composition.set", props: { duration: Math.min(MAX_TIMELINE_SECONDS, Math.ceil(end * fps - 1e-6) / fps) } });
      }
      if (movingLayerId) {
        commands.push({
          type: "clip.move", layerId: movingLayerId, startTime: start,
          ...(options.trackId ? { trackId: options.trackId } : {}), ...(overlapMode ? { allowOverlap: true } : {}),
        });
      } else commands.push({ type: "audio.move", trackId: audioTrackId, startTime: start });
      return commands;
    };
    const move = (moveEvent: PointerEvent) => {
      markDropTarget(moveEvent);
      const delta = (moveEvent.clientX - startX) / Math.max(1, timelinePixelWidth) * baseDuration;
      // O clipe pode passar do fim da composição; a duração é estendida ao soltar.
      const nextStart = clamp(initialStart + delta, minStart, maxStart);
      const snapped = clamp(snapClipStart(nextStart, length, scrubArea, layerId, audioTrackId, moveEvent.altKey), minStart, maxStart);
      if (lowStart > highStart + 1e-9) return;
      wantedStart = clamp(onFrames ? Math.round(snapped * fps) / fps : snapped, lowStart, highStart);
      showSnapGuide(lastSnap);
      if (duplicating) {
        if (!ghost) {
          ghost = document.createElement("span");
          ghost.className = "clip-range clip-ghost";
          ghost.style.width = clip.style.width || `${length / baseDuration * 100}%`;
          clip.parentElement?.append(ghost);
        }
        ghost.style.left = `${wantedStart / baseDuration * 100}%`;
        return;
      }
      const previewStart = Math.min(wantedStart, fitStart);
      if (previewStart < lowStart - 1e-9 || !gesture.preview(moveCommands(previewStart))) return;
      if (layer) {
        if (layer.kind === "video") {
          for (const linked of project!.audioTracks) {
            if (linked.linked && linked.linkedLayerId === layer.id) updateTimelineClipStyles(linked.id, linked.startTime, linked.endTime, true);
          }
        }
      } else if (linkedLayer) {
        const owner = project!.layers.find((item) => item.id === linkedLayer.id);
        if (owner) updateTimelineClipStyles(owner.id, owner.startTime, owner.endTime);
      }
      clip.style.left = `${wantedStart / baseDuration * 100}%`;
      void renderFrame();
    };
    const stop = (upEvent: PointerEvent) => {
      clip.removeEventListener("pointermove", move);
      clip.removeEventListener("pointerup", stop);
      clip.removeEventListener("pointercancel", stop);
      if (clip.hasPointerCapture(upEvent.pointerId)) clip.releasePointerCapture(upEvent.pointerId);
      showSnapGuide(null);
      ghost?.remove();
      if (duplicating) {
        app.querySelectorAll(".timeline-track.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
        if (Math.abs(wantedStart - initialStart) > 1e-6 || dropTrackId) duplicateClipAt(movingLayerId!, wantedStart, length, dropTrackId);
        updateTimeline();
        return;
      }
      if (wantedStart !== initialStart || dropTrackId) {
        let committed = false;
        if (layer && dropTrackId) {
          const withTrack = moveCommands(wantedStart, { extend: true, trackId: dropTrackId });
          committed = gesture.preview([...withTrack, ...linkedAudioOrderCommands(withTrack)]);
          if (!committed) setStatus(language === "pt-BR" ? "FAIXA OCUPADA NESSE TRECHO" : "TRACK IS OCCUPIED AT THAT TIME");
        }
        if (!committed) gesture.preview(moveCommands(wantedStart, { extend: true }));
      }
      app.querySelectorAll(".timeline-track.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
      gesture.end({ clipEdit: true });
      updateLayerStack();
      updateInspector();
      updateTimeline();
      updateTransformBox();
    };
    clip.addEventListener("pointermove", move);
    clip.addEventListener("pointerup", stop);
    clip.addEventListener("pointercancel", stop);
  }));
  app.querySelectorAll<HTMLElement>("[data-trim-audio]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
    if (!project || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopPlayback();
    const found = project.audioTracks.find((item) => item.id === handle.dataset.trimAudio);
    if (!found) return;
    selectAudioTrackById(found.id, false);
    endEditSession();
    const track = structuredClone(found);
    const gesture = beginGesture(editLabel("Aparar áudio", "Trim audio"));
    const edge = handle.dataset.trimEdge as "start" | "end";
    const initialStart = track.startTime;
    const initialEnd = track.endTime;
    const initialSourceIn = track.sourceIn;
    const initialSourceOut = track.sourceOut;
    const speed = Math.max(.05, Math.abs(track.playbackRate || 1));
    const minLength = 1 / Math.max(1, project.settings.fps);
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const time = snapTimelineTime(timelineTimeFromPointer(moveEvent, scrubArea), scrubArea, "", track.id, moveEvent.altKey);
      showSnapGuide(lastSnap);
      const draft = { ...track };
      if (edge === "start") {
        const next = clamp(time, 0, initialEnd - minLength);
        const delta = next - initialStart;
        draft.startTime = next;
        draft.sourceIn = clamp(initialSourceIn + delta * speed, 0, initialSourceOut - .001);
      } else {
        draft.endTime = clamp(time, initialStart + minLength, project!.settings.duration);
        draft.loop = draft.endTime - draft.startTime > (initialSourceOut - draft.sourceIn) / speed + minLength / 2;
      }
      normalizeFades(draft);
      const props = changedProps(track, draft, TRIM_FIELDS);
      if (!gesture.preview(Object.keys(props).length ? [{ type: "audio.set", trackId: track.id, props }] : [])) return;
      if (track.linked && track.linkedLayerId) {
        const owner = project!.layers.find((item) => item.id === track.linkedLayerId);
        if (owner) {
          updateTimelineClipStyles(owner.id, owner.startTime, owner.endTime);
          renderer?.setPlaybackState(playing, currentTime);
          void renderFrame();
        }
      }
      updateTimelineClipStyles(track.id, draft.startTime, draft.endTime, true);
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      showSnapGuide(null);
      gesture.end({ clipEdit: true });
      updateInspector();
      updateTimeline();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }));
  app.querySelectorAll<HTMLElement>("[data-fade-handle]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
    if (!project || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopPlayback();
    const scope = handle.dataset.fadeScope as "layer" | "audio";
    const id = handle.dataset.fadeId!;
    const property = handle.dataset.fadeProperty as "fadeInStart" | "fadeInEnd" | "fadeOutStart" | "fadeOutEnd";
    const layerItem = scope === "layer" ? project.layers.find((layer) => layer.id === id) : undefined;
    const audioItem = scope === "audio" ? project.audioTracks.find((track) => track.id === id) : undefined;
    const found = layerItem || audioItem;
    const clip = handle.closest<HTMLElement>(".clip-range");
    if (!found || !clip) return;
    if (layerItem) selectLayerById(layerItem.id, false);
    else if (audioItem) selectAudioTrackById(audioItem.id, false);
    endEditSession();
    const item = structuredClone(found);
    const gesture = beginGesture(editLabel("Ajustar fade", "Adjust fade"));
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const time = snapTimelineTime(
        timelineTimeFromPointer(moveEvent, scrubArea),
        scrubArea,
        layerItem?.id || "",
        audioItem?.id || "",
        moveEvent.altKey,
      );
      showSnapGuide(lastSnap);
      const draft = { ...item };
      setFadeHandle(draft, property.startsWith("fadeIn") ? "in" : "out", time);
      const props = changedProps(item, draft, FADE_FIELDS);
      const command: VctCommand = scope === "layer"
        ? { type: "layer.set", layerId: id, props }
        : { type: "audio.set", trackId: id, props };
      if (!gesture.preview(Object.keys(props).length ? [command] : [])) return;
      updateFadeClipVisuals(clip, draft);
      const inspectorInput = app.querySelector<HTMLInputElement>(scope === "layer" ? `[data-layer-property="${property}"]` : `[data-audio-property="${property}"]`);
      if (inspectorInput) {
        inspectorInput.value = String(Number(draft[property].toFixed(4)));
        updateParamScrub(inspectorInput);
      }
      void renderFrame();
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      showSnapGuide(null);
      gesture.end({ clipEdit: true });
      updateInspector();
      updateTimeline();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }));
  let scrubbing = false;
  const scrubToPointer = (event: PointerEvent) => {
    if (!project || pinchPointers.size > 1) return;
    setTime(snapTimelineTime(timelineTimeFromPointer(event, scrubArea), scrubArea, "", "", event.altKey, true), false);
  };
  scrubArea.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-key-ref], [data-trim-clip], [data-trim-audio], [data-fade-handle], [data-move-layer-clip], [data-move-audio-clip]")) return;
    event.preventDefault();
    stopPlayback();
    scrubbing = true;
    scrubArea.setPointerCapture(event.pointerId);
    scrubToPointer(event);
  });
  scrubArea.addEventListener("pointermove", (event) => {
    if (scrubbing) scrubToPointer(event);
  });
  const stopScrubbing = (event: PointerEvent) => {
    if (!scrubbing) return;
    scrubbing = false;
    if (scrubArea.hasPointerCapture(event.pointerId)) scrubArea.releasePointerCapture(event.pointerId);
    updateInspector();
  };
  scrubArea.addEventListener("pointerup", stopScrubbing);
  scrubArea.addEventListener("pointercancel", stopScrubbing);
}

function bindTimelineOrderDrag() {
  let draggedType: "layer" | "audio" | "" = "";
  let draggedId = "";
  const items = app.querySelectorAll<HTMLElement>("[data-timeline-order-layer], [data-timeline-order-audio]");
  items.forEach((item) => {
    item.addEventListener("dragstart", () => {
      draggedType = item.dataset.timelineOrderLayer ? "layer" : "audio";
      draggedId = item.dataset.timelineOrderLayer || item.dataset.timelineOrderAudio || "";
      item.classList.add("is-dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("is-dragging"));
    item.addEventListener("dragover", (event) => {
      const type = item.dataset.timelineOrderLayer ? "layer" : "audio";
      if (type !== draggedType) return;
      event.preventDefault();
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!project || !draggedId) return;
      const targetId = item.dataset.timelineOrderLayer || item.dataset.timelineOrderAudio || "";
      if (!targetId || targetId === draggedId) return;
      if (draggedType === "layer") {
        // Arrastar a linha move a faixa inteira para antes/depois da faixa alvo.
        const source = project.layers.find((layer) => layer.id === draggedId);
        const target = project.layers.find((layer) => layer.id === targetId);
        if (!source || !target) return;
        const tracks = visualTracks(project).map((track) => track.id);
        const index = trackDropIndex(trackIdOf(source), trackIdOf(target), tracks.indexOf(trackIdOf(source)) < tracks.indexOf(trackIdOf(target)));
        if (index !== null) reorderLayerTracks(trackIdOf(source), index);
      } else {
        const lanes = [...new Set(project.audioTracks.map(laneIdOf))];
        const source = project.audioTracks.find((track) => track.id === draggedId);
        const target = project.audioTracks.find((track) => track.id === targetId);
        if (!source || !target || laneIdOf(source) === laneIdOf(target)) return;
        applyCommands([{ type: "audio.reorderLane", laneId: laneIdOf(source), index: lanes.indexOf(laneIdOf(target)) }], editLabel("Ordem do áudio", "Audio order"));
      }
    });
  });
}

function updateCurveTools() {
  const target = app.querySelector("#curve-tools");
  if (!target) return;
  target.innerHTML = renderCurveTools();
  bindCurveTools();
}

function bindCurveTools() {
  app.querySelector<HTMLSelectElement>("#timeline-key-easing")?.addEventListener("change", (event) => {
    const track = keyRefTrack(selectedKeyRef);
    const command = track && keyTrackCommand(track.target, track.keys, track.time, withEasing((event.target as HTMLSelectElement).value as Easing));
    if (!command || !applyCommands([command], editLabel("Curva", "Easing"), { panels: false })) return;
    updateCurveTools();
    updateInspector();
  });
  const strength = app.querySelector<HTMLInputElement>("#timeline-bezier-strength");
  strength?.addEventListener("blur", endEditSession);
  strength?.addEventListener("change", endEditSession);
  strength?.addEventListener("input", () => {
    const track = keyRefTrack(selectedKeyRef);
    if (!track || !Number.isFinite(strength.valueAsNumber)) return;
    const command = keyTrackCommand(track.target, track.keys, track.time, (key) => ({ ...key, curve: strength.valueAsNumber }));
    if (!command) return;
    const session = openEditSession(`curve:${selectedKeyRef}`, editLabel("Curva", "Easing"));
    if (previewEdit(session, [["set", command]])) void renderFrame();
  });
}

function setTimelineZoom(axis: "x" | "y", direction: number) {
  const scroll = app.querySelector<HTMLElement>(".timeline-scroll");
  const horizontalRatio = scroll && scroll.scrollWidth > scroll.clientWidth
    ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth
    : 0;
  if (axis === "x") {
    timelineZoomX = clamp(timelineZoomX * (direction > 0 ? 1.35 : 1 / 1.35), 1, 10);
    localStorage.setItem("nt-vct-timeline-zoom-x", String(timelineZoomX));
  } else {
    timelineZoomY = clamp(timelineZoomY + direction * .2, .7, 3);
    localStorage.setItem("nt-vct-timeline-zoom-y", String(timelineZoomY));
  }
  updateTimeline();
  const nextScroll = app.querySelector<HTMLElement>(".timeline-scroll");
  if (nextScroll && axis === "x") nextScroll.scrollLeft = horizontalRatio * nextScroll.scrollWidth - nextScroll.clientWidth / 2;
}

function bindDragAndDrop(root: ParentNode = app) {
  let draggedLayer = "";
  let draggedEffect = "";
  root.querySelectorAll<HTMLElement>("[data-layer-id]").forEach((item) => {
    item.addEventListener("dragstart", () => {
      draggedLayer = item.dataset.layerId!;
      item.classList.add("is-dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("is-dragging");
      root.querySelectorAll(".drop-before, .drop-after").forEach((target) => target.classList.remove("drop-before", "drop-after"));
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      const rect = item.getBoundingClientRect();
      item.classList.toggle("drop-before", event.clientY < rect.top + rect.height / 2);
      item.classList.toggle("drop-after", event.clientY >= rect.top + rect.height / 2);
    });
    item.addEventListener("dragleave", () => item.classList.remove("drop-before", "drop-after"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!project || !draggedLayer || draggedLayer === item.dataset.layerId) return;
      const dragged = project.layers.find((layer) => layer.id === draggedLayer);
      const targetLayer = project.layers.find((layer) => layer.id === item.dataset.layerId);
      const rect = item.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      if (!dragged || !targetLayer) return;
      const index = trackDropIndex(trackIdOf(dragged), trackIdOf(targetLayer), after);
      if (index !== null) reorderLayerTracks(trackIdOf(dragged), index);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-effect-id]").forEach((item) => {
    item.addEventListener("dragstart", () => {
      draggedEffect = item.dataset.effectId!;
      item.classList.add("is-dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("is-dragging");
      root.querySelectorAll(".drop-before, .drop-after").forEach((target) => target.classList.remove("drop-before", "drop-after"));
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      const rect = item.getBoundingClientRect();
      item.classList.toggle("drop-before", event.clientY < rect.top + rect.height / 2);
      item.classList.toggle("drop-after", event.clientY >= rect.top + rect.height / 2);
    });
    item.addEventListener("dragleave", () => item.classList.remove("drop-before", "drop-after"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const targetId = item.dataset.effectId!;
      if (!project || !draggedEffect || draggedEffect === targetId) return;
      const lists = [...project.layers.map((layer) => layer.effects), project.postEffects];
      const list = lists.find((candidate) =>
        candidate.some((effect) => effect.id === draggedEffect)
        && candidate.some((effect) => effect.id === targetId));
      if (!list) return;
      const rect = item.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      const target = list.filter((effect) => effect.id !== draggedEffect).findIndex((effect) => effect.id === targetId);
      if (!applyCommands([{ type: "effect.reorder", effectId: draggedEffect, index: target + (after ? 1 : 0) }], editLabel("Ordem dos efeitos", "Effect order"), { panels: false })) return;
      renderEditorPreservingCanvas();
      refreshHistoryButtons();
    });
  });
}

function bindColumnResizers() {
  app.querySelectorAll<HTMLElement>("[data-resize-column]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const side = handle.dataset.resizeColumn as "left" | "right";
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("is-resizing-columns");
      const move = (moveEvent: PointerEvent) => {
        if (side === "left") leftColumnWidth = clamp(moveEvent.clientX, 210, 520);
        else rightColumnWidth = clamp(window.innerWidth - moveEvent.clientX, 240, 560);
        const editor = app.querySelector<HTMLElement>(".editor-app");
        editor?.style.setProperty(side === "left" ? "--left-width" : "--right-width", `${side === "left" ? leftColumnWidth : rightColumnWidth}px`);
      };
      const stop = (upEvent: PointerEvent) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
        document.body.classList.remove("is-resizing-columns");
        localStorage.setItem("nt-vct-left-width", String(leftColumnWidth));
        localStorage.setItem("nt-vct-right-width", String(rightColumnWidth));
        fitCanvas();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  });
}

function bindTimelineResizer() {
  const handle = app.querySelector<HTMLElement>("#timeline-resizer");
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-timeline");
    const startY = event.clientY;
    const startHeight = timelineHeight;
    const move = (moveEvent: PointerEvent) => {
      timelineHeight = clamp(startHeight + startY - moveEvent.clientY, 150, Math.max(200, window.innerHeight - 300));
      app.querySelector<HTMLElement>(".editor-app")?.style.setProperty("--timeline-height", `${timelineHeight}px`);
      fitCanvas();
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      document.body.classList.remove("is-resizing-timeline");
      localStorage.setItem("nt-vct-timeline-height", String(Math.round(timelineHeight)));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
}

function snapCanvasPosition(layer: Layer, x: number, y: number, rect: DOMRect, bypass = false) {
  if (!project || !renderer || !canvasSnap || bypass) return { x, y, guideX: null as number | null, guideY: null as number | null };
  const width = Math.abs((renderer.layerValue(layer, "width", currentTime) || layer.width) * (renderer.layerValue(layer, "scaleX", currentTime) || layer.scaleX));
  const height = Math.abs((renderer.layerValue(layer, "height", currentTime) || layer.height) * (renderer.layerValue(layer, "scaleY", currentTime) || layer.scaleY));
  const targetsX = [0, project.settings.width / 2, project.settings.width];
  const targetsY = [0, project.settings.height / 2, project.settings.height];
  for (const other of project.layers) {
    if (other.id === layer.id || !other.visible || currentTime < other.startTime || currentTime > other.endTime) continue;
    const otherX = renderer.layerValue(other, "x", currentTime) || other.x;
    const otherY = renderer.layerValue(other, "y", currentTime) || other.y;
    const otherWidth = Math.abs((renderer.layerValue(other, "width", currentTime) || other.width) * (renderer.layerValue(other, "scaleX", currentTime) || other.scaleX));
    const otherHeight = Math.abs((renderer.layerValue(other, "height", currentTime) || other.height) * (renderer.layerValue(other, "scaleY", currentTime) || other.scaleY));
    targetsX.push(otherX - otherWidth / 2, otherX, otherX + otherWidth / 2);
    targetsY.push(otherY - otherHeight / 2, otherY, otherY + otherHeight / 2);
  }
  const snapAxis = (value: number, offsets: number[], targets: number[], tolerance: number) => {
    let bestDelta = 0;
    let bestDistance = tolerance;
    let guide: number | null = null;
    for (const offset of offsets) for (const target of targets) {
      const delta = target - (value + offset);
      const distance = Math.abs(delta);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
        guide = target;
      }
    }
    return { value: value + bestDelta, guide };
  };
  const snappedX = snapAxis(x, [-width / 2, 0, width / 2], targetsX, 9 / rect.width * project.settings.width);
  const snappedY = snapAxis(y, [-height / 2, 0, height / 2], targetsY, 9 / rect.height * project.settings.height);
  return { x: snappedX.value, y: snappedY.value, guideX: snappedX.guide, guideY: snappedY.guide };
}

function updateTransformBox() {
  const box = app.querySelector<HTMLElement>("#transform-box");
  const layer = selectedLayer();
  if (!box || !layer || !renderer || !project || !layer.visible || currentTime < layer.startTime || currentTime > layer.endTime) {
    box?.classList.remove("is-visible");
    return;
  }
  const x = renderer.layerValue(layer, "x", currentTime);
  const y = renderer.layerValue(layer, "y", currentTime);
  const width = Math.max(2, Math.abs(renderer.layerValue(layer, "width", currentTime) * renderer.layerValue(layer, "scaleX", currentTime)));
  const height = Math.max(2, Math.abs(renderer.layerValue(layer, "height", currentTime) * renderer.layerValue(layer, "scaleY", currentTime)));
  const rotation = renderer.layerValue(layer, "rotation", currentTime);
  box.style.left = `${x / project.settings.width * 100}%`;
  box.style.top = `${y / project.settings.height * 100}%`;
  box.style.width = `${width / project.settings.width * 100}%`;
  box.style.height = `${height / project.settings.height * 100}%`;
  box.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
  box.classList.add("is-visible");
  box.classList.toggle("is-locked", layer.locked);
}

function bindTransformBoxInteraction() {
  const canvas = app.querySelector<HTMLCanvasElement>("#composition-canvas");
  if (!canvas) return;
  app.querySelectorAll<HTMLElement>("[data-transform-handle]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
    const layer = selectedLayer();
    if (!project || !renderer || !layer || layer.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const operation = handle.dataset.transformHandle!;
    const rect = canvas.getBoundingClientRect();
    const point = (pointer: PointerEvent) => ({
      x: (pointer.clientX - rect.left) / rect.width * project!.settings.width,
      y: (pointer.clientY - rect.top) / rect.height * project!.settings.height,
    });
    const originPointer = point(event);
    const origin = {
      x: renderer.layerValue(layer, "x", currentTime),
      y: renderer.layerValue(layer, "y", currentTime),
      width: Math.max(1, renderer.layerValue(layer, "width", currentTime)),
      height: Math.max(1, renderer.layerValue(layer, "height", currentTime)),
      scaleX: Math.max(.0001, Math.abs(renderer.layerValue(layer, "scaleX", currentTime))),
      scaleY: Math.max(.0001, Math.abs(renderer.layerValue(layer, "scaleY", currentTime))),
      rotation: renderer.layerValue(layer, "rotation", currentTime),
    };
    const originAngle = Math.atan2(originPointer.y - origin.y, originPointer.x - origin.x);
    const directionX = operation.includes("w") ? -1 : operation.includes("e") ? 1 : 0;
    const directionY = operation.includes("n") ? -1 : operation.includes("s") ? 1 : 0;
    let createdKeyframe = false;
    const layerId = layer.id;
    const gestureKey = `transform:${layerId}:${operation}`;
    const gestureLabel = operation === "rotate" ? editLabel("Girar camada", "Rotate layer") : editLabel("Redimensionar camada", "Resize layer");
    endEditSession();
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const nextPointer = point(moveEvent);
      const session = openEditSession(gestureKey, gestureLabel);
      let values: Record<string, number>;
      if (operation === "rotate") {
        const angle = Math.atan2(nextPointer.y - origin.y, nextPointer.x - origin.x);
        let rotation = origin.rotation + (angle - originAngle) * 180 / Math.PI;
        const angleSnap = Math.round(rotation / 15) * 15;
        if ((canvasSnap || moveEvent.shiftKey) && Math.abs(rotation - angleSnap) <= 3) rotation = angleSnap;
        values = { rotation };
      } else {
        const dx = nextPointer.x - originPointer.x;
        const dy = nextPointer.y - originPointer.y;
        const angle = origin.rotation * Math.PI / 180;
        const localDx = dx * Math.cos(angle) + dy * Math.sin(angle);
        const localDy = -dx * Math.sin(angle) + dy * Math.cos(angle);
        let nextWidth = directionX ? Math.max(8, origin.width + localDx * directionX / origin.scaleX) : origin.width;
        let nextHeight = directionY ? Math.max(8, origin.height + localDy * directionY / origin.scaleY) : origin.height;
        if (layer.sizeLocked) {
          const widthRatio = directionX ? nextWidth / origin.width : 1;
          const heightRatio = directionY ? nextHeight / origin.height : 1;
          const ratio = directionX && directionY
            ? (Math.abs(widthRatio - 1) >= Math.abs(heightRatio - 1) ? widthRatio : heightRatio)
            : directionX ? widthRatio : heightRatio;
          nextWidth = Math.max(8, origin.width * ratio);
          nextHeight = Math.max(8, origin.height * ratio);
        }
        const localShiftX = directionX ? (nextWidth - origin.width) * origin.scaleX * directionX / 2 : 0;
        const localShiftY = directionY ? (nextHeight - origin.height) * origin.scaleY * directionY / 2 : 0;
        const nextX = origin.x + localShiftX * Math.cos(angle) - localShiftY * Math.sin(angle);
        const nextY = origin.y + localShiftX * Math.sin(angle) + localShiftY * Math.cos(angle);
        values = { width: nextWidth, height: nextHeight, x: nextX, y: nextY };
      }
      const previewed = previewLayerValues(session, layerId, values);
      if (!previewed) return;
      createdKeyframe = previewed.created || createdKeyframe;
      syncInspectorValues();
      void renderFrame();
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      endEditSession();
      updateInspector();
      if (createdKeyframe) requestTimelineRefresh();
      updateTransformBox();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }));
}

function bindCanvasInteraction() {
  const canvas = app.querySelector<HTMLCanvasElement>("#composition-canvas");
  if (!canvas) return;
  bindInlineTextEditing(canvas);
  let dragging = false;
  let originPointer = { x: 0, y: 0 };
  let originLayer = { x: 0, y: 0 };
  let createdKeyframe = false;
  const position = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * project!.settings.width,
      y: (event.clientY - rect.top) / rect.height * project!.settings.height,
    };
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = position(event);
    const hits = renderer?.hitTestAll(point.x, point.y, currentTime) || [];
    const currentIndex = hits.findIndex((item) => item.id === selectedLayerId);
    const hit = event.altKey && hits.length
      ? hits[(currentIndex + 1 + hits.length) % hits.length]
      : hits.find((item) => item.id === selectedLayerId) || hits[0];
    if (!hit) return;
    if (selectedLayerId !== hit.id) {
      selectLayerById(hit.id);
    }
    const layer = selectedLayer();
    if (!layer || layer.locked || event.button !== 0) return;
    endEditSession();
    dragging = true;
    originPointer = point;
    originLayer = {
      x: renderer?.layerValue(layer, "x", currentTime) ?? layer.x,
      y: renderer?.layerValue(layer, "y", currentTime) ?? layer.y,
    };
    createdKeyframe = false;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    const layer = selectedLayer();
    if (!dragging || !layer) return;
    const point = position(event);
    const deltaX = point.x - originPointer.x;
    const deltaY = point.y - originPointer.y;
    const snapped = snapCanvasPosition(layer, originLayer.x + deltaX, originLayer.y + deltaY, canvas.getBoundingClientRect(), event.altKey);
    const session = openEditSession(`canvas:${layer.id}`, editLabel("Mover camada", "Move layer"));
    const previewed = previewLayerValues(session, layer.id, { x: snapped.x, y: snapped.y });
    if (!previewed) return;
    createdKeyframe = previewed.created || createdKeyframe;
    const guideX = app.querySelector<HTMLElement>("#canvas-snap-x");
    const guideY = app.querySelector<HTMLElement>("#canvas-snap-y");
    if (guideX) {
      guideX.classList.toggle("is-visible", snapped.guideX !== null);
      if (snapped.guideX !== null) guideX.style.left = `${snapped.guideX / project!.settings.width * 100}%`;
    }
    if (guideY) {
      guideY.classList.toggle("is-visible", snapped.guideY !== null);
      if (snapped.guideY !== null) guideY.style.top = `${snapped.guideY / project!.settings.height * 100}%`;
    }
    syncInspectorValues();
    void renderFrame();
  });
  const stopDragging = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("is-dragging");
    app.querySelectorAll(".canvas-snap-guide").forEach((guide) => guide.classList.remove("is-visible"));
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    endEditSession();
    updateInspector();
    if (createdKeyframe) requestTimelineRefresh();
  };
  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);
}

// ---- Edição de texto direto no canvas: duplo clique (ou duplo toque) abre um textarea sobre a caixa.
let inlineEditor: { layerId: string; textarea: HTMLTextAreaElement; closed: boolean } | null = null;

function positionInlineEditor() {
  const editor = inlineEditor;
  const canvas = app.querySelector<HTMLCanvasElement>("#composition-canvas");
  const layer = project?.layers.find((item) => item.id === editor?.layerId);
  if (!editor || !canvas || !layer || !renderer || !project) return;
  const { textarea } = editor;
  const scale = canvas.getBoundingClientRect().width / project.settings.width;
  const scaleX = Math.abs(renderer.layerValue(layer, "scaleX", currentTime));
  const scaleY = Math.abs(renderer.layerValue(layer, "scaleY", currentTime));
  const width = Math.max(2, renderer.layerValue(layer, "width", currentTime) * scaleX);
  const height = Math.max(2, renderer.layerValue(layer, "height", currentTime) * scaleY);
  const fontSize = (renderer.layerValue(layer, "fontSize", currentTime) || 80) * scaleY * scale;
  const layout = renderer.measureText(layer, currentTime);
  const lineHeight = layout.lineHeight * scaleY * scale;
  const boxHeight = height * scale;
  textarea.style.left = `${renderer.layerValue(layer, "x", currentTime) / project.settings.width * 100}%`;
  textarea.style.top = `${renderer.layerValue(layer, "y", currentTime) / project.settings.height * 100}%`;
  textarea.style.width = `${width / project.settings.width * 100}%`;
  textarea.style.height = `${height / project.settings.height * 100}%`;
  textarea.style.transform = `translate(-50%, -50%) rotate(${renderer.layerValue(layer, "rotation", currentTime)}deg)`;
  textarea.style.fontFamily = layer.fontFamily || "IBM Plex Sans";
  textarea.style.fontWeight = String(renderer.layerValue(layer, "fontWeight", currentTime) || 500);
  textarea.style.fontSize = `${fontSize}px`;
  textarea.style.lineHeight = `${lineHeight}px`;
  textarea.style.textAlign = layer.align || "center";
  textarea.style.padding = `${Math.max(0, (boxHeight - layout.lines.length * lineHeight) / 2)}px ${layout.padding * scaleX * scale}px 0`;
}

function previewInlineText(layerId: string, value: string) {
  const layer = project?.layers.find((item) => item.id === layerId);
  if (!layer || layer.locked) return;
  const session = openEditSession(`layer:${layer.id}:text`, propertyLabel("text"));
  if (!session.memo.has("layer")) session.memo.set("layer", { ...layer });
  const base = session.memo.get("layer") as Layer;
  const props: Record<string, unknown> = { text: value };
  const height = fittedTextHeight({ ...base, text: value });
  if (height !== undefined) props.height = height;
  if (!previewEdit(session, [["set", { type: "layer.set", layerId: layer.id, props }]])) return;
  const updated = project?.layers.find((item) => item.id === layerId);
  if (updated) updateTextOverflowWarning(updated);
  const inspectorText = app.querySelector<HTMLTextAreaElement>('[data-layer-text="text"]');
  if (inspectorText && inspectorText.value !== value) inspectorText.value = value;
  positionInlineEditor();
  updateTransformBox();
  void renderFrame();
}

function closeInlineEditor(commit: boolean) {
  const editor = inlineEditor;
  if (!editor || editor.closed) return;
  editor.closed = true;
  inlineEditor = null;
  const key = `layer:${editor.layerId}:text`;
  if (commit) endEditSession();
  else if (editSession?.key === key) {
    editSession.gesture.cancel();
    editSession = null;
  }
  editor.textarea.remove();
  app.querySelector(".canvas-shell")?.classList.remove("is-text-editing");
  updateInspector();
  updateTransformBox();
  requestTimelineRefresh();
  void renderFrame();
}

function openInlineTextEditor(layerId: string) {
  const layer = project?.layers.find((item) => item.id === layerId);
  const shell = app.querySelector<HTMLElement>("#canvas-shell");
  if (!project || !layer || layer.kind !== "text" || layer.locked || !shell || exportInProgress) return;
  if (inlineEditor && !inlineEditor.textarea.isConnected) inlineEditor = null;
  if (inlineEditor) {
    if (inlineEditor.layerId === layerId) return;
    closeInlineEditor(true);
  }
  stopPlayback();
  if (selectedLayerId !== layerId) selectLayerById(layerId);
  endEditSession();
  const textarea = document.createElement("textarea");
  textarea.className = "text-inline-editor";
  textarea.value = layer.text || "";
  textarea.spellcheck = false;
  textarea.setAttribute("aria-label", language === "pt-BR" ? "Editar texto no canvas" : "Edit text on canvas");
  textarea.setAttribute("data-inline-text-editor", "");
  shell.append(textarea);
  shell.classList.add("is-text-editing");
  inlineEditor = { layerId, textarea, closed: false };
  positionInlineEditor();
  textarea.addEventListener("input", () => previewInlineText(layerId, textarea.value));
  textarea.addEventListener("pointerdown", (event) => event.stopPropagation());
  textarea.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closeInlineEditor(false);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      closeInlineEditor(true);
    }
  });
  textarea.addEventListener("blur", () => closeInlineEditor(true));
  textarea.focus();
  textarea.select();
}

function textLayerAt(event: PointerEvent | MouseEvent, canvas: HTMLCanvasElement) {
  if (!project || !renderer) return null;
  const rect = canvas.getBoundingClientRect();
  const hits = renderer.hitTestAll((event.clientX - rect.left) / rect.width * project.settings.width, (event.clientY - rect.top) / rect.height * project.settings.height, currentTime);
  const hit = hits.find((item) => item.id === selectedLayerId) || hits[0];
  const layer = hit && project.layers.find((item) => item.id === hit.id);
  return layer?.kind === "text" ? layer : null;
}

function bindInlineTextEditing(canvas: HTMLCanvasElement) {
  canvas.addEventListener("dblclick", (event) => {
    const layer = textLayerAt(event, canvas);
    if (layer) openInlineTextEditor(layer.id);
  });
  // Toque e caneta não geram dblclick de forma confiável: o duplo toque é detectado aqui.
  let lastTap = { time: 0, x: 0, y: 0 };
  canvas.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") return;
    const now = performance.now();
    const again = now - lastTap.time < 400 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 32;
    lastTap = again ? { time: 0, x: 0, y: 0 } : { time: now, x: event.clientX, y: event.clientY };
    if (!again) return;
    const layer = textLayerAt(event, canvas);
    if (layer) openInlineTextEditor(layer.id);
  });
}

function setTime(time: number, rerenderInspector = true) {
  if (!project) return;
  currentTime = clamp(time, 0, project.settings.duration);
  const cursor = app.querySelector<HTMLElement>("#timeline-cursor");
  if (cursor) cursor.style.left = `${currentTime / project.settings.duration * 100}%`;
  const display = app.querySelector(".time-display");
  if (display) display.innerHTML = `${formatTime(currentTime)} <small>/ ${formatTime(project.settings.duration)}</small>`;
  const frame = app.querySelector("#frame-value");
  if (frame) frame.textContent = `${t("frame").toUpperCase()} ${Math.round(currentTime * project.settings.fps)}`;
  syncInspectorValues();
  void renderFrame();
  if (rerenderInspector) updateInspector();
}

function syncInspectorValues() {
  if (!project || !renderer) return;
  const layer = selectedLayer();
  if (layer) {
    app.querySelectorAll<HTMLInputElement>("[data-layer-property]").forEach((input) => {
      const property = input.dataset.layerProperty as keyof Layer;
      const value = renderer!.layerValue(layer, property, currentTime);
      if (Number.isFinite(value)) {
        input.value = String(Number(value.toFixed(4)));
        updateParamScrub(input);
      }
    });
    app.querySelectorAll<HTMLInputElement>("[data-layer-text='fill'], [data-layer-text='stroke']").forEach((input) => {
      const property = input.dataset.layerText as "fill" | "stroke";
      input.value = renderer!.layerColor(layer, property, currentTime);
    });
  }
  const effect = selectedEffect();
  if (effect) {
    app.querySelectorAll<HTMLInputElement>("[data-effect-param]").forEach((input) => {
      const property = input.dataset.effectParam!;
      const value = renderer!.effectValue(effect, property, currentTime);
      input.value = String(value);
      updateParamScrub(input);
    });
  }
}

function stopPlayback() {
  if (!playing) return;
  playing = false;
  playbackGeneration++;
  renderer?.setPlaybackState(false, currentTime);
  audioEngine.stop();
  renderer?.setPreviewScale(1);
  finalizeRecordedAutomation();
  const button = app.querySelector("#play");
  if (button) button.textContent = "▶";
  updateLevelMeter();
  updateLiveUi();
  updatePreviewQualityState();
  setStatus("READY · PREVIEW FULL");
  void renderFrame();
}

function finalizeRecordedAutomation() {
  if (!project || !recordedTracks.size) return;
  endEditSession();
  const discrete = new Set(["mode", "count", "segments", "direction", "invert", "colorize", "blocks", "fontWeight"]);
  const commands: VctCommand[] = [];
  for (const token of recordedTracks) {
    const [scope, id, property] = token.split(":");
    const stored = scope === "effect"
      ? findEffect(id)?.keyframes[property]
      : project.layers.find((layer) => layer.id === id)?.keyframes[property];
    if (!stored?.length) continue;
    const keys = structuredClone(stored).sort((a, b) => a.time - b.time);
    const recordedRange = recordedRanges.get(token);
    const affected = (key: Keyframe) => !recordedRange
      || (key.time >= recordedRange.min - keyframeTolerance() && key.time <= recordedRange.max + keyframeTolerance());
    if (scope !== "color" && !discrete.has(property) && keys.length > 2) {
      let values = keys.map((key) => key.value);
      for (let pass = 0; pass < 2; pass++) {
        const next = [...values];
        for (let index = 1; index < values.length - 1; index++) {
          if (affected(keys[index])) next[index] = (values[index - 1] + values[index] * 2 + values[index + 1]) / 4;
        }
        values = next;
      }
      keys.forEach((key, index) => key.value = values[index]);
    }
    for (const key of keys) {
      if (!affected(key)) continue;
      key.easing = discrete.has(property) || scope === "color" ? "linear" : "bezier";
      if (key.easing === "bezier") key.curve = .82;
    }
    commands.push(scope === "effect"
      ? { type: "effect.keyframe.set", effectId: id, property, keys }
      : { type: "keyframe.set", layerId: id, property, keys });
  }
  recordedTracks.clear();
  recordedRanges.clear();
  applyCommands(commands, editLabel("Gravação", "Recording"));
  requestTimelineRefresh();
  updateInspector();
}

function togglePlayback() {
  if (!project) return;
  if (playing) {
    stopPlayback();
    return;
  }
  playing = true;
  if (currentTime >= project.settings.duration) setTime(0, false);
  const area = project.settings.workArea;
  if (timelineLoop && area && (currentTime < area.in || currentTime >= area.out)) setTime(area.in, false);
  lastPlaybackFrame = Math.floor(currentTime * project.settings.fps);
  playbackDroppedFrames = 0;
  previewFastFrames = 0;
  previewSlowFrames = 0;
  lastPreviewScaleChangeAt = performance.now();
  renderer?.setPreviewScale(activePreviewScale());
  renderer?.setPlaybackState(true, currentTime);
  void audioEngine.play(project, currentTime);
  playbackStarted = performance.now();
  playbackOffset = currentTime;
  const generation = ++playbackGeneration;
  requestAnimationFrame((now) => playbackLoop(now, generation));
  const button = app.querySelector("#play");
  if (button) button.textContent = "❚❚";
  updateLiveUi();
}

function updateLiveUi() {
  app.querySelector(".editor-app")?.classList.toggle("is-live", playing || recordMode);
}

function playbackLoop(now: number, generation: number) {
  if (!playing || !project || generation !== playbackGeneration) return;
  const next = playbackOffset + (now - playbackStarted) / 1000;
  const area = project.settings.workArea;
  const loopStart = area ? area.in : 0;
  const loopEnd = area ? area.out : project.settings.duration;
  if (timelineLoop && next >= loopEnd) {
    const wrapped = loopStart + (next - loopStart) % (loopEnd - loopStart);
    playbackStarted = now;
    playbackOffset = wrapped;
    lastPlaybackFrame = -1;
    renderer?.setPlaybackState(true, wrapped);
    void audioEngine.play(project, wrapped);
    setTime(wrapped, false);
    followPlayhead();
    requestAnimationFrame((time) => playbackLoop(time, generation));
    return;
  }
  if (next >= project.settings.duration) {
    setTime(project.settings.duration, false);
    stopPlayback();
    updateInspector();
    return;
  }
  const frame = Math.floor(next * project.settings.fps);
  if (frame !== lastPlaybackFrame) {
    if (lastPlaybackFrame >= 0 && frame > lastPlaybackFrame + 1) {
      playbackDroppedFrames += frame - lastPlaybackFrame - 1;
      setStatus(`PLAY ${previewQualityState()} · DROP ${playbackDroppedFrames}`);
    }
    lastPlaybackFrame = frame;
    setTime(frame / project.settings.fps, false);
    followPlayhead();
  }
  updateLevelMeter();
  requestAnimationFrame((time) => playbackLoop(time, generation));
}

function notePreviewPerformance(milliseconds: number) {
  if (!playing || previewQuality !== "auto" || !project) return;
  const budget = 1000 / Math.max(1, project.settings.fps);
  if (milliseconds > budget * .9) {
    previewSlowFrames++;
    previewFastFrames = 0;
  } else if (milliseconds < budget * .5) {
    previewFastFrames++;
    previewSlowFrames = Math.max(0, previewSlowFrames - 1);
  } else {
    previewFastFrames = Math.max(0, previewFastFrames - 1);
    previewSlowFrames = Math.max(0, previewSlowFrames - 1);
  }
  const levels = [1, .75, .5, .33, .25];
  let index = levels.findIndex((level) => Math.abs(level - adaptivePreviewScale) < .01);
  if (index < 0) index = 1;
  let next = adaptivePreviewScale;
  const canChangeScale = performance.now() - lastPreviewScaleChangeAt >= 2500;
  if (canChangeScale && previewSlowFrames >= 5 && index < levels.length - 1) {
    next = levels[index + 1];
    previewSlowFrames = 0;
  } else if (canChangeScale && previewFastFrames >= 90 && index > 0) {
    next = levels[index - 1];
    previewFastFrames = 0;
  }
  if (next !== adaptivePreviewScale) {
    adaptivePreviewScale = next;
    lastPreviewScaleChangeAt = performance.now();
    localStorage.setItem("nt-vct-adaptive-preview-scale", String(next));
    renderer?.setPreviewScale(next);
    updatePreviewQualityState();
  }
}

async function renderFrame(exporting = false) {
  if (!renderer || !project) return;
  if (exporting) {
    await renderer.render(currentTime, true);
    return;
  }
  if (renderInFlight) {
    renderQueued = true;
    return;
  }
  renderInFlight = true;
  try {
    do {
      renderQueued = false;
      renderer.setPreviewScale(activePreviewScale());
      const startedAt = performance.now();
      await renderer.render(currentTime, false);
      notePreviewPerformance(performance.now() - startedAt);
    } while (renderQueued);
    renderErrorActive = false;
    updateTransformBox();
  } catch (error) {
    renderErrorActive = true;
    setStatus(`RENDER ERROR: ${String(error)}`);
  } finally {
    renderInFlight = false;
  }
}

async function settleRender() {
  while (renderInFlight) await new Promise<void>((resolve) => window.setTimeout(resolve, 8));
}

/** Renders one frame that waits for video decode; the preview loop stays out of the way meanwhile. */
async function renderStillFrame(time?: number) {
  if (!project || !renderer) throw new Error("Nenhum projeto está aberto.");
  if (exportInProgress) throw new Error("Aguarde a exportação antes de capturar quadros.");
  if (time !== undefined) stopPlayback();
  await settleRender();
  renderInFlight = true;
  try {
    if (time !== undefined) setTime(clamp(time, 0, project.settings.duration), false);
    return await renderer.renderStill(currentTime);
  } finally {
    renderQueued = false;
    renderInFlight = false;
  }
}

function copyCompositionCanvas(maxWidth: number) {
  const canvas = app.querySelector<HTMLCanvasElement>("#composition-canvas");
  if (!canvas || !project) throw new Error("Preview indisponível.");
  const scale = Math.min(1, maxWidth / canvas.width);
  const frame = document.createElement("canvas");
  frame.width = Math.max(1, Math.round(canvas.width * scale));
  frame.height = Math.max(1, Math.round(canvas.height * scale));
  const context = frame.getContext("2d")!;
  context.fillStyle = project.settings.transparent ? "#000000" : project.settings.background;
  context.fillRect(0, 0, frame.width, frame.height);
  context.drawImage(canvas, 0, 0, frame.width, frame.height);
  return frame;
}

// Enquanto o usuário não muda o zoom à mão, o preview acompanha o tamanho da janela.
let canvasAutoFit = true;

function setZoom(value: number, fromFit = false) {
  canvasAutoFit = fromFit;
  zoom = clamp(value, .1, 3);
  const shell = app.querySelector<HTMLElement>("#canvas-shell");
  if (shell && project) shell.style.width = `${project.settings.width * zoom}px`;
  const label = app.querySelector("#zoom-value");
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
}

function fitCanvas() {
  if (!project) return;
  const viewport = app.querySelector<HTMLElement>("#canvas-viewport");
  if (!viewport) return;
  const availableWidth = viewport.clientWidth - 70;
  const availableHeight = viewport.clientHeight - 70;
  setZoom(Math.min(1, availableWidth / project.settings.width, availableHeight / project.settings.height), true);
}

let fitOnResizeFrame = 0;
window.addEventListener("resize", () => {
  if (!canvasAutoFit) return;
  cancelAnimationFrame(fitOnResizeFrame);
  fitOnResizeFrame = requestAnimationFrame(fitCanvas);
});

async function saveProject() {
  if (!project) return true;
  markProjectModified();
  try {
    const savedName = await saveWebProject(project);
    if (!savedName) return false;
    projectJsonPath = savedName;
    startProjectAutosaveTracking(project);
    try {
      await autosaveWrites;
      await clearProjectRecovery();
    } catch (error) {
      console.error("Could not clear the recovery snapshot after saving.", error);
      setStatus(`${language === "pt-BR" ? "PROJETO SALVO · LIMPE A RECUPERAÇÃO MANUALMENTE" : "PROJECT SAVED · RECOVERY CLEANUP FAILED"} · ${String(error)}`);
      return true;
    }
    setStatus(t("projectSaved").toUpperCase());
    return true;
  } catch (error) {
    window.alert(String(error));
    return false;
  }
}

async function offerSave(context: string) {
  if (!project) return true;
  const message = language === "pt-BR"
    ? `Deseja salvar o projeto atual ${context}?`
    : `Do you want to save the current project ${context}?`;
  const shouldSave = window.confirm(message);
  return shouldSave ? await saveProject() : true;
}

function showCompositionModal() {
  if (!project) return;
  const root = app.querySelector<HTMLDivElement>("#modal-root")!;
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="export-modal composition-modal">
        <header><div><span class="micro">NOISETUPI CANVAS</span><h2>${language === "pt-BR" ? "Tamanho da composição" : "Composition size"}</h2></div><button id="close-composition">×</button></header>
        <div class="composition-grid">
          <label class="select-field composition-preset-field"><span>${language === "pt-BR" ? "PRESET / REDE SOCIAL" : "PRESET / SOCIAL NETWORK"}</span><select id="composition-preset">${compositionPresetOptions(project.settings.width, project.settings.height)}</select></label>
          <label class="field"><span>${t("width")} PX</span><input id="composition-width" type="number" value="${project.settings.width}" min="16" max="8192" step="1"></label>
          <label class="field"><span>${t("height")} PX</span><input id="composition-height" type="number" value="${project.settings.height}" min="16" max="8192" step="1"></label>
          <label class="field"><span>${t("background")}</span><input id="composition-background" type="color" value="${escapeHtml(project.settings.background)}"></label>
          <label class="toggle-field composition-alpha"><input id="composition-transparent" type="checkbox" ${project.settings.transparent ? "checked" : ""}><span class="toggle"></span><span>${t("transparent")} / ALPHA</span></label>
          <fieldset class="grid-settings">
            <legend>${language === "pt-BR" ? "GRADE MUSICAL (BPM)" : "MUSICAL GRID (BPM)"}</legend>
            <label class="field"><span>BPM</span><input id="composition-bpm" type="number" value="${project.settings.grid?.bpm ?? ""}" min="20" max="400" step="0.1" placeholder="—"></label>
            <label class="field"><span>OFFSET (s)</span><input id="composition-grid-offset" type="number" value="${project.settings.grid?.offset ?? 0}" min="0" max="60" step="0.01"></label>
            <label class="field"><span>${language === "pt-BR" ? "TEMPOS POR COMPASSO" : "BEATS PER BAR"}</span><input id="composition-beats" type="number" value="${project.settings.grid?.beatsPerBar ?? 4}" min="1" max="16" step="1"></label>
            <div class="grid-actions"><button type="button" id="composition-tap" title="${language === "pt-BR" ? "Toque no ritmo (3 toques ou mais)" : "Tap along (3 taps or more)"}">TAP</button><button type="button" id="composition-grid-remove">${language === "pt-BR" ? "Remover grade" : "Remove grid"}</button></div>
          </fieldset>
          <fieldset class="resize-mode">
            <legend>${language === "pt-BR" ? "COMO TRATAR AS CAMADAS EXISTENTES" : "HOW TO HANDLE EXISTING LAYERS"}</legend>
            <label><input type="radio" name="resize-mode" value="adapt" checked><span><strong>${language === "pt-BR" ? "ADAPTAR PROPORCIONALMENTE" : "ADAPT PROPORTIONALLY"}</strong><small>${language === "pt-BR" ? "Redimensiona e centraliza as camadas sem deformação." : "Resizes and centers layers without distortion."}</small></span></label>
            <label><input type="radio" name="resize-mode" value="keep"><span><strong>${language === "pt-BR" ? "CENTRALIZAR SEM ESCALAR" : "CENTER WITHOUT SCALING"}</strong><small>${language === "pt-BR" ? "Mantém os tamanhos e desloca tudo a partir do centro do canvas." : "Keeps layer sizes and offsets everything from the canvas center."}</small></span></label>
          </fieldset>
          <p class="composition-warning" id="composition-warning"></p>
        </div>
        <footer><button id="cancel-composition">${t("cancel")}</button><button class="primary-button" id="apply-composition">${language === "pt-BR" ? "APLICAR" : "APPLY"} →</button></footer>
      </section>
    </div>`;
  const preset = root.querySelector<HTMLSelectElement>("#composition-preset")!;
  const width = root.querySelector<HTMLInputElement>("#composition-width")!;
  const height = root.querySelector<HTMLInputElement>("#composition-height")!;
  preset.addEventListener("change", () => applyPresetToInputs(preset, width, height));
  [width, height].forEach((input) => input.addEventListener("input", () => {
    if (preset.value !== `${width.value},${height.value}`) preset.value = "custom";
  }));
  const bpm = root.querySelector<HTMLInputElement>("#composition-bpm")!;
  const gridOffset = root.querySelector<HTMLInputElement>("#composition-grid-offset")!;
  const beats = root.querySelector<HTMLInputElement>("#composition-beats")!;
  const taps: number[] = [];
  root.querySelector("#composition-tap")?.addEventListener("click", () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 3000) taps.length = 0;
    taps.push(now);
    const tempo = tapTempo(taps);
    if (tempo) bpm.value = String(clamp(tempo, 20, 400));
  });
  root.querySelector("#composition-grid-remove")?.addEventListener("click", () => {
    bpm.value = "";
    gridOffset.value = "0";
    beats.value = "4";
    taps.length = 0;
  });
  root.querySelector("#close-composition")?.addEventListener("click", closeCompositionModal);
  root.querySelector("#cancel-composition")?.addEventListener("click", closeCompositionModal);
  root.querySelector("#apply-composition")?.addEventListener("click", applyCompositionResize);
}

function closeCompositionModal() {
  const root = app.querySelector("#modal-root");
  if (root) root.innerHTML = "";
}

function applyCompositionResize() {
  if (!project) return;
  const width = Math.round(Number(app.querySelector<HTMLInputElement>("#composition-width")?.value));
  const height = Math.round(Number(app.querySelector<HTMLInputElement>("#composition-height")?.value));
  const background = app.querySelector<HTMLInputElement>("#composition-background")?.value || project.settings.background;
  const transparent = Boolean(app.querySelector<HTMLInputElement>("#composition-transparent")?.checked);
  const warning = app.querySelector("#composition-warning");
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16 || width > 8192 || height > 8192) {
    if (warning) warning.textContent = language === "pt-BR" ? "Use dimensões entre 16 e 8192 pixels." : "Use dimensions between 16 and 8192 pixels.";
    return;
  }
  if (width * height > 33_554_432) {
    if (warning) warning.textContent = language === "pt-BR" ? "A composição excede o limite seguro de pixels para a GPU." : "The composition exceeds the safe GPU pixel limit.";
    return;
  }
  const bpmText = app.querySelector<HTMLInputElement>("#composition-bpm")?.value.trim() || "";
  const oldGrid = project.settings.grid;
  let grid: { bpm: number; offset: number; beatsPerBar: number } | null = null;
  if (bpmText) {
    grid = {
      bpm: Number(bpmText),
      offset: Number(app.querySelector<HTMLInputElement>("#composition-grid-offset")?.value || 0),
      beatsPerBar: Number(app.querySelector<HTMLInputElement>("#composition-beats")?.value || 4),
    };
    if (!(grid.bpm >= 20 && grid.bpm <= 400) || !(grid.offset >= 0 && grid.offset <= 60) || !Number.isInteger(grid.beatsPerBar) || grid.beatsPerBar < 1 || grid.beatsPerBar > 16) {
      if (warning) warning.textContent = language === "pt-BR" ? "Grade: BPM de 20 a 400, offset de 0 a 60 s e 1 a 16 tempos por compasso." : "Grid: BPM 20–400, offset 0–60 s and 1–16 beats per bar.";
      return;
    }
  }
  const gridChanged = JSON.stringify(grid) !== JSON.stringify(oldGrid ?? null);
  const oldWidth = project.settings.width;
  const oldHeight = project.settings.height;
  const sizeChanged = width !== oldWidth || height !== oldHeight || background !== project.settings.background || transparent !== project.settings.transparent;
  if (!sizeChanged && !gridChanged) {
    closeCompositionModal();
    return;
  }
  const mode = app.querySelector<HTMLInputElement>('input[name="resize-mode"]:checked')?.value === "keep" ? "keep" : "adapt";
  stopPlayback();
  // Tamanho e grade entram no mesmo comando: um único passo de desfazer.
  const props: Record<string, unknown> = sizeChanged ? { width, height, background, transparent } : {};
  if (gridChanged) props.grid = grid;
  if (!applyCommands([{ type: "composition.set", props, ...(sizeChanged ? { resize: mode } : {}) }], editLabel("Alterar composição", "Resize composition"))) {
    if (warning && project.layers.some((layer) => layer.locked)) {
      warning.textContent = language === "pt-BR" ? "Desbloqueie as camadas bloqueadas para redimensionar a composição." : "Unlock locked layers to resize the composition.";
    }
    return;
  }
  closeCompositionModal();
  window.setTimeout(fitCanvas, 0);
  setStatus(`${language === "pt-BR" ? "COMPOSIÇÃO ALTERADA" : "COMPOSITION RESIZED"} · ${width}×${height}`);
}

function showExportModal() {
  if (!project) return;
  const defaultFormat = project.settings.transparent ? "png-sequence" : "mp4-h264";
  const defaultName = project.settings.name.replace(/[^a-zA-Z0-9._ -]+/g, "_") || "noisetupi-render";
  const root = app.querySelector<HTMLDivElement>("#modal-root")!;
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="export-modal">
        <header><div><span class="micro">NOISETUPI RENDER</span><h2>${t("exportTitle")}</h2></div><button id="close-export">×</button></header>
        <div class="export-grid">
          <label class="select-field"><span>${t("format")}</span><select id="export-format">
            <option value="mp4-h264" ${defaultFormat === "mp4-h264" ? "selected" : ""}>MP4 H.264</option>
            <option value="png-sequence" ${defaultFormat === "png-sequence" ? "selected" : ""}>PNG SEQUENCE + ALPHA (.ZIP)</option>
          </select></label>
          <label class="field"><span>${t("width")} PX</span><input id="export-width" type="number" value="${project.settings.width}" min="16" max="8192"></label>
          <label class="field"><span>${t("height")} PX</span><input id="export-height" type="number" value="${project.settings.height}" min="16" max="8192"></label>
          <label class="field"><span>FPS</span><input id="export-fps" type="number" value="${project.settings.fps}" min="1" max="240"></label>
          <label class="field"><span>${t("quality")}</span><input id="export-quality" type="number" value="82" min="1" max="100"></label>
          <label class="toggle-field"><input id="export-alpha" type="checkbox" ${defaultFormat === "png-sequence" ? "checked" : ""} disabled><span class="toggle"></span><span>ALPHA ${language === "pt-BR" ? "DISPONÍVEL NA SEQUÊNCIA PNG" : "AVAILABLE IN PNG SEQUENCE"}</span></label>
        </div>
        <label class="output-picker"><span>${language === "pt-BR" ? "NOME DO ARQUIVO" : "FILE NAME"}</span><input id="export-output" value="${escapeHtml(defaultName)}" maxlength="120"></label>
        <div class="export-summary" id="export-summary"></div>
        <div class="export-log" id="export-log"><span class="status-dot is-ready"></span><span>READY</span></div>
        <div class="progress-track"><span id="export-progress"></span></div>
        <footer><button id="cancel-export">${t("cancel")}</button><button class="primary-button" id="start-export">${t("startExport")} →</button></footer>
      </section>
    </div>`;
  const updateSummary = () => {
    if (!project) return;
    const fps = Number(root.querySelector<HTMLInputElement>("#export-fps")?.value) || project.settings.fps;
    const range = exportRange({ fps, duration: project.settings.duration, workArea: project.settings.workArea });
    const area = project.settings.workArea;
    const scope = area
      ? `${language === "pt-BR" ? "Região de trabalho" : "Work area"} ${formatRulerTime(range.start, fps)} – ${formatRulerTime(range.end, fps)}`
      : language === "pt-BR" ? "Composição inteira" : "Whole composition";
    const summary = root.querySelector("#export-summary");
    if (summary) summary.textContent = `${range.frameCount} FRAMES · ${formatTime(range.duration)} · ${scope}`;
  };
  updateSummary();
  root.querySelector("#export-fps")?.addEventListener("input", updateSummary);
  const format = root.querySelector<HTMLSelectElement>("#export-format")!;
  const alpha = root.querySelector<HTMLInputElement>("#export-alpha")!;
  format.addEventListener("change", () => {
    alpha.checked = format.value === "png-sequence";
  });
  root.querySelector("#close-export")?.addEventListener("click", closeExportModal);
  root.querySelector("#cancel-export")?.addEventListener("click", () => void cancelExport());
  root.querySelector("#start-export")?.addEventListener("click", () => void startExport());
}

function closeExportModal() {
  if (exportSessionId) return;
  const root = app.querySelector("#modal-root");
  if (root) root.innerHTML = "";
}

async function startExport() {
  if (!project || !renderer || exportInProgress) return;
  exportInProgress = true;
  try {
    await runExport();
  } finally {
    exportInProgress = false;
  }
}

async function runExport() {
  if (!project || !renderer) return;
  notificationAudio ||= new AudioContext();
  void notificationAudio.resume();
  stopPlayback();
  while (renderInFlight) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  const format = app.querySelector<HTMLSelectElement>("#export-format")!.value;
  const hasVideoEncoder = typeof (globalThis as typeof globalThis & { VideoEncoder?: unknown }).VideoEncoder !== "undefined";
  if (format === "mp4-h264" && !hasVideoEncoder) {
    globalThis.alert(language === "pt-BR"
      ? "Este navegador não oferece o encoder de vídeo necessário. Use Chrome ou Edge atualizado em uma conexão HTTPS."
      : "This browser does not provide the required video encoder. Use an up-to-date Chrome or Edge over HTTPS.");
    return;
  }
  const fps = Number(app.querySelector<HTMLInputElement>("#export-fps")!.value);
  const range = exportRange({ fps, duration: project.settings.duration, workArea: project.settings.workArea });
  const total = range.frameCount;
  const options = {
    fileName: app.querySelector<HTMLInputElement>("#export-output")!.value.trim().replace(/\.(mp4|zip)$/i, "") || "noisetupi-render",
    width: Number(app.querySelector<HTMLInputElement>("#export-width")!.value),
    height: Number(app.querySelector<HTMLInputElement>("#export-height")!.value),
    fps,
    quality: Number(app.querySelector<HTMLInputElement>("#export-quality")!.value),
  };
  exportCancelled = false;
  const start = app.querySelector<HTMLButtonElement>("#start-export")!;
  start.disabled = true;
  app.querySelector<HTMLButtonElement>("#close-export")!.disabled = true;
  const previousTime = currentTime;
  const exportCanvas = createExportCanvas(options.width, options.height);
  try {
    const fullMix = format === "mp4-h264" ? await mixProjectAudio(project) : null;
    // A mixagem cobre a composição inteira; com região de trabalho, só o trecho dela segue para o arquivo.
    const mixedAudio = fullMix && project.settings.workArea ? sliceAudioBuffer(fullMix, range.start, range.duration) : fullMix;
    activeExporter = format === "png-sequence"
      ? new PngSequenceBrowserExporter(exportCanvas, options)
      : new Mp4BrowserExporter(exportCanvas, options, mixedAudio);
    exportSessionId = "browser-export";
    await activeExporter.start();
    for (let frame = 0; frame < total; frame++) {
      if (exportCancelled) throw new Error(language === "pt-BR" ? "Exportação cancelada" : "Export cancelled");
      currentTime = range.start + frame / fps;
      await renderer.render(currentTime, true);
      copyFrame(renderer.canvas, exportCanvas, format === "png-sequence", project.settings.background);
      await activeExporter.addFrame(frame);
      const percent = (frame + 1) / total * 96;
      setExportProgress(percent, `${t("exporting").toUpperCase()} FRAME ${frame + 1}/${total}`);
      if (frame % 3 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    setExportProgress(98, language === "pt-BR" ? "FINALIZANDO ARQUIVO" : "FINALIZING FILE");
    const sizeBytes = await activeExporter.finish();
    exportSessionId = null;
    activeExporter = null;
    setExportProgress(100, t("complete").toUpperCase());
    const log = app.querySelector("#export-log")!;
    const downloadedName = format === "png-sequence" ? `${options.fileName}-png-sequence.zip` : `${options.fileName}.mp4`;
    log.innerHTML = `<span class="status-dot is-ready"></span><span>${escapeHtml(downloadedName)} · ${(sizeBytes / 1048576).toFixed(1)} MB</span>`;
    app.querySelector<HTMLButtonElement>("#close-export")!.disabled = false;
    const cancel = app.querySelector<HTMLButtonElement>("#cancel-export")!;
    cancel.textContent = language === "pt-BR" ? "Fechar" : "Close";
    playExportCompleteSound();
  } catch (error) {
    if (activeExporter) {
      try { await activeExporter.cancel(); } catch { /* exporter is already closed */ }
    }
    exportSessionId = null;
    activeExporter = null;
    setExportProgress(0, String(error));
    start.disabled = false;
    app.querySelector<HTMLButtonElement>("#close-export")!.disabled = false;
  } finally {
    currentTime = previousTime;
    renderer.setPlaybackState(false, currentTime);
    renderer.setPreviewScale(1);
    try {
      await renderer.render(currentTime);
      setTime(currentTime, false);
    } catch (error) {
      setStatus(`RENDER ERROR: ${String(error)}`);
    }
  }
}

function playExportCompleteSound() {
  const context = notificationAudio;
  if (!context) return;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.48);
  gain.connect(context.destination);
  [659.25, 987.77].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(context.currentTime + index * 0.12);
    oscillator.stop(context.currentTime + 0.32 + index * 0.12);
  });
}

function setExportProgress(percent: number, message: string) {
  const bar = app.querySelector<HTMLElement>("#export-progress");
  if (bar) bar.style.width = `${percent}%`;
  const log = app.querySelector("#export-log span:last-child");
  if (log) log.textContent = message;
}

async function cancelExport() {
  exportCancelled = true;
  if (activeExporter) {
    try { await activeExporter.cancel(); } catch { /* cancellation is best-effort */ }
  }
  activeExporter = null;
  exportSessionId = null;
  closeExportModal();
}

function setStatus(message: string) {
  const target = app.querySelector("#status-text");
  if (target) target.textContent = message;
}

window.addEventListener("keydown", (event) => {
  if (exportInProgress) {
    if ((event.ctrlKey || event.metaKey) || event.code === "Space"
      || ["Delete", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveProject();
  }
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement || (event.target as HTMLElement | null)?.isContentEditable;
  if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  }
  if (project && !typing && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "x" && selectionIds().length) {
    event.preventDefault();
    cutSelection();
    return;
  }
  if (project && !typing && !event.shiftKey && (event.key === "Delete" || event.key === "Backspace") && selectedKeyRef && deleteSelectedKeyframe()) {
    event.preventDefault();
    return;
  }
  if (project && !typing && handleTransportKey(event)) {
    event.preventDefault();
    return;
  }
  // Corte no playhead: S (sem modificador) ou Ctrl/⌘+B, fora de campos de texto.
  if (project && !typing && ((event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey && !event.altKey)
    || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b"))) {
    event.preventDefault();
    splitAtPlayhead();
    return;
  }
  if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && project) {
    event.preventDefault();
    duplicateLayer();
  }
  if (event.code === "Space" && project && !typing && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
    event.preventDefault();
    togglePlayback();
  }
  if ((event.key === "Delete" || event.key === "Backspace") && project && document.activeElement?.tagName === "BODY") {
    if (event.shiftKey) rippleDeleteSelection();
    else deleteSelection();
  }
  if (project && !typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selectionIds().length) {
    clipClipboard = copyClips(project, selectionIds());
    setStatus(language === "pt-BR" ? `${clipClipboard.layers.length} CLIPE(S) COPIADO(S)` : `${clipClipboard.layers.length} CLIP(S) COPIED`);
  }
  if (project && !typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && clipClipboard) {
    event.preventDefault();
    pasteClipboard();
  }
  if (project && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && document.activeElement?.tagName === "BODY") {
    const layer = selectedLayer();
    if (!layer || layer.locked) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const x = renderer?.layerValue(layer, "x", currentTime) ?? layer.x;
    const y = renderer?.layerValue(layer, "y", currentTime) ?? layer.y;
    const values: Record<string, number> = {};
    if (event.key === "ArrowLeft") values.x = x - amount;
    if (event.key === "ArrowRight") values.x = x + amount;
    if (event.key === "ArrowUp") values.y = y - amount;
    if (event.key === "ArrowDown") values.y = y + amount;
    // Segurar a tecla é um único passo de desfazer; terminar ao soltar.
    const session = openEditSession(`nudge:${layer.id}`, editLabel("Mover camada", "Move layer"));
    const previewed = previewLayerValues(session, layer.id, values);
    if (!previewed) return;
    updateInspector();
    if (previewed.created) requestTimelineRefresh();
    void renderFrame();
  }
});

function endNudge() {
  if (editSession?.key.startsWith("nudge:")) endEditSession();
}

window.addEventListener("keyup", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) endNudge();
});
window.addEventListener("blur", endNudge);

window.addEventListener("beforeunload", (event) => {
  if (!project) return;
  event.preventDefault();
  event.returnValue = "";
});

automationApi = createVctApi({
  getProject: () => project,
  keyframeTolerance,
  assertCanEdit: () => {
    if (exportInProgress) throw new Error('Aguarde a exportação antes de editar.');
  },
  undo: () => {
    if (!project || !history.canUndo(JSON.stringify(project))) return false;
    stopPlayback(); undo(); return true;
  },
  redo: () => {
    if (!project || !history.canRedo(JSON.stringify(project))) return false;
    stopPlayback(); redo(); return true;
  },
  confirmConsequential: (message) => window.confirm(language === "pt-BR" ? message : "Confirm clip/effect removal before applying this batch?"),
  captureFrame: async (time, maxWidth) => {
    const { notReady } = await renderStillFrame(time);
    const frame = copyCompositionCanvas(maxWidth);
    return { time: currentTime, width: frame.width, height: frame.height, dataUrl: frame.toDataURL("image/jpeg", .8), notReady };
  },
  stillFrame: async (time, maxWidth) => {
    const { notReady } = await renderStillFrame(time);
    return { canvas: copyCompositionCanvas(maxWidth), notReady };
  },
  commitProject: (next, label) => {
    if (!project) throw new Error("Nenhum projeto está aberto.");
    if (exportInProgress) throw new Error('Aguarde a exportação antes de editar.');
    // An open edit (scrub, nudge, inline text) would rebuild from its old base and erase this batch.
    endEditSession();
    stopPlayback();
    snapshot(label);
    selectedClipIds.clear();
    commitDocument(next);
    setStatus(`VCT · ${label}`);
  },
});
installAgentAutomation(automationApi, () => language);
Object.defineProperty(window, "vct", { value: automationApi, configurable: true, enumerable: false });

renderLanguage();
void document.fonts.ready.then(() => void renderFrame());
window.setTimeout(() => document.querySelector("#boot-splash")?.classList.add("is-hidden"), 850);

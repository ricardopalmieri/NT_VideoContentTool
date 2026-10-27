import { clamp } from "../model/math";
import { normalizeFades, setFadeHandle } from "../timeline/timing";
import { formatDurationValue, parseDurationValue, type DurationUnit } from "../timeline/timecode";
import { sourceTimeFor } from "../renderer/source-time";
import { installAgentAutomation, openAgentPanel } from "../automation/agent-panel";
import { audioLanes, clipNeighbors, copyClips, moveClipToTrack, pasteClips, placeTrack, rippleDelete, shiftClip, shiftTrack, splitClip, trackIdOf, visualTracks, type ClipboardClips } from "../model/clip-tracks";
import { autoTransitionsForOverlap, DEFAULT_TRANSITION_DURATION, isTransitionType, syncTransitionAudioFades, transitionWindow, TRANSITION_TYPES, type TransitionType } from "../model/transitions";
import { timelineSnapCandidates as collectTimelineSnapCandidates, snapTimelineTime as calculateTimelineSnap } from "../timeline/snapping";
import { migrateProject } from "../model/migrate-project";
import { UndoHistory } from "../model/undo-history";
import { syncLinkedAudioTracks, syncLinkedVideoLayer } from "../model/linked-media";
import {
  AUDIO_EFFECT_CATALOG,
  AUDIO_EFFECT_PARAMETERS,
  EFFECT_CATALOG,
  EFFECT_PARAMETERS,
  type EffectParameterDefinition,
} from "../model/effect-catalog";
import { createVctApi, type VctApi } from "../automation/window-vct";
import {
  keyframeAt as findKeyframeAt,
  upsertKeyframe as upsertDomainKeyframe,
} from "../model/keyframes";
import { translate, type TranslationKey } from "../i18n";
import { ComposerRenderer } from "../renderer/composer-renderer";
import { AudioTimelineEngine, mixProjectAudio, probeAudio } from "../audio/audio-engine";
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
  createEffect,
  createAudioTrack,
  createAudioEffect,
  createLayer,
  createProject,
  uid,
  type Easing,
  type AudioEffectKind,
  type AudioEffectNode,
  type AudioTrack,
  type EffectKind,
  type EffectNode,
  type ImportedAsset,
  type InputKind,
  type Keyframe,
  type Language,
  type Layer,
  type OpenProjectResult,
  type ProjectDocument,
  type ProjectSettings,
} from "../model/types";

const app = document.querySelector<HTMLDivElement>("#app")!;
const APP_VERSION = "0.7.0";
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

function snapshot() {
  if (!project) return;
  history.checkpoint(JSON.stringify(project));
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
  const previous = history.undo(JSON.stringify(project));
  if (previous !== null) restore(previous);
}

function redo() {
  if (!project) return;
  const next = history.redo(JSON.stringify(project));
  if (next !== null) restore(next);
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
          <button id="agent-panel-button" aria-label="${language === "pt-BR" ? "Conectar agente de IA" : "Connect AI agent"}" title="${language === "pt-BR" ? "Conectar agente de IA (MCP)" : "Connect AI agent (MCP)"}"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="6" width="12" height="9" rx="2.5"/><path d="M10 6V3.5M7.5 10.5h.01M12.5 10.5h.01M2 10v2M18 10v2"/></svg></button>
          <button class="language-mini" id="language" aria-label="${language === "pt-BR" ? "Mudar idioma" : "Change language"}" title="${language === "pt-BR" ? "Mudar idioma" : "Change language"}">${uiIcon("language")}<span>${language === "pt-BR" ? "PT" : "EN"}</span></button>
        </div>
      </header>
      <aside class="left-panel">
        ${renderLibrary()}
        <section class="stack-section">
          <header><span>${t("layers")}</span><small>${project.layers.length}</small></header>
          <div class="layer-stack" id="layer-stack">${project.layers.map(renderLayerItem).join("") || `<p class="empty-stack">+ ${t("inputs")}</p>`}</div>
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
      <div class="statusbar"><span id="status-text">READY · BUILD ${APP_VERSION}</span><span>${projectJsonPath}</span></div>
    </div>
    <div id="modal-root"></div>`;
  bindEditor();
}

function renderLibrary() {
  const inputButtons: Array<[InputKind, string]> = [
    ["image", t("image")], ["video", t("video")], ["guide", t("guide")], ["geometry", t("geometry")], ["text", t("text")],
  ];
  const effects = (Object.keys(EFFECT_CATALOG) as EffectKind[]).filter((kind) => EFFECT_CATALOG[kind].category === "layer");
  const post = (Object.keys(EFFECT_CATALOG) as EffectKind[]).filter((kind) => EFFECT_CATALOG[kind].category === "post");
  return `
    <section class="library-section">
      <details open><summary><span>${t("inputs")}</span><b>+</b></summary><div class="tool-grid">
        ${inputButtons.map(([kind, label]) => `<button data-add-input="${kind}">${label}</button>`).join("")}
        <button data-add-audio>${language === "pt-BR" ? "Áudio" : "Audio"}</button>
        <button class="import-many-button" data-import-many title="${language === "pt-BR" ? "Selecione vários vídeos, imagens e áudios de uma vez (ou arraste os arquivos para o editor)" : "Select several videos, images and audio files at once (or drop files on the editor)"}">${language === "pt-BR" ? "Importar vários…" : "Import several…"}</button>
      </div></details>
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

function upsertKeyframe(keys: Keyframe[], value: number) {
  const keyTime = recordMode && playing && project
    ? Math.round(currentTime * project.settings.fps) / project.settings.fps
    : currentTime;
  const result = upsertDomainKeyframe(keys, keyTime, value, keyframeTolerance(), recordMode && playing ? "linear" : "easeInOut");
  keys.splice(0, keys.length, ...result.keyframes);
  return result.created;
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

function setLayerNumericValue(layer: Layer, property: string, value: number) {
  (layer as unknown as Record<string, unknown>)[property] = value;
  let keys = layer.keyframes[property];
  if (recordMode && playing && !keys) keys = layer.keyframes[property] = [];
  if (recordMode && playing) markRecordedTrack(`layer:${layer.id}:${property}`);
  return keys?.length || (recordMode && playing) ? upsertKeyframe(keys!, value) : false;
}

function setEffectNumericValue(effect: EffectNode, property: string, value: number) {
  effect.params[property] = value;
  effect.keyframes ||= {};
  let keys = effect.keyframes[property];
  if (recordMode && playing && !keys) keys = effect.keyframes[property] = [];
  if (recordMode && playing) markRecordedTrack(`effect:${effect.id}:${property}`);
  return keys?.length || (recordMode && playing) ? upsertKeyframe(keys!, value) : false;
}



function syncLinkedAudioOrder() {
  if (!project) return;
  const layerOrder = new Map(project.layers.map((layer, index) => [layer.id, index]));
  const slots = project.audioTracks.map((track, index) => track.linked && track.linkedLayerId ? index : -1).filter((index) => index >= 0);
  const linked = project.audioTracks.filter((track) => track.linked && track.linkedLayerId)
    .sort((a, b) => (layerOrder.get(a.linkedLayerId!) ?? Number.MAX_SAFE_INTEGER) - (layerOrder.get(b.linkedLayerId!) ?? Number.MAX_SAFE_INTEGER));
  slots.forEach((slot, index) => project!.audioTracks[slot] = linked[index]);
}

// O renderer não anima tempo, fades nem trechos de origem; esses campos não mostram ◆.
const TIMING_PROPERTIES = new Set(["startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd", "sourceIn", "sourceOut"]);

function numberField(label: string, property: keyof Layer, value: number, min: number, max: number, step: number) {
  const keys = selectedLayer()?.keyframes[String(property)] || [];
  const active = keyframeAt(keys);
  const layer = selectedLayer();
  const evaluatedValue = layer && renderer ? renderer.layerValue(layer, property, currentTime) : value;
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
        <div class="video-mode-row audio-mode-row">
          <label class="check-row"><input type="checkbox" data-audio-check="muted" ${track.muted ? "checked" : ""}><span>MUTE</span></label>
          <label class="check-row"><input type="checkbox" data-audio-check="reverse" ${track.reverse ? "checked" : ""}><span>REVERSE</span></label>
          <label class="check-row"><input type="checkbox" data-audio-check="loop" ${track.loop ? "checked" : ""}><span>LOOP</span></label>
          ${track.linkedLayerId ? `<label class="check-row"><input type="checkbox" data-audio-check="linked" ${track.linked ? "checked" : ""}><span>${language === "pt-BR" ? "VINCULAR AO VÍDEO" : "LINK TO VIDEO"}</span></label>` : ""}
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
      ${renderColorControls(layer)}
    </section>`;
  return `<section class="property-group"><h3>ASSET</h3><p class="asset-path ${layer.asset && !hasWebAsset(layer.asset) ? "is-missing" : ""}">${layer.asset && !hasWebAsset(layer.asset) ? "MISSING MEDIA · " : ""}${escapeHtml(layer.asset || "")}</p></section>`;
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
  const tickCount = Math.max(10, Math.round(10 * timelineZoomX));
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => index / tickCount * duration);
  const rows = timelineRows();
  return `
    <header class="timeline-header">
      <div class="transport">
        <button id="to-start">|◀</button><button class="play-button" id="play">${playing ? "❚❚" : "▶"}</button><button id="to-end">▶|</button>
        <button class="loop-button ${timelineLoop ? "is-active" : ""}" id="timeline-loop" title="Loop" aria-pressed="${timelineLoop}">↻</button>
        <button class="record-button ${recordMode ? "is-active" : ""}" id="record-mode" title="Record automation" aria-pressed="${recordMode}"><i></i> REC</button>
        <span class="time-display">${formatTime(currentTime)} <small>/ ${formatTime(duration)}</small></span>
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
      <div class="timeline-labels">${rows.map(renderTimelineLabel).join("")}</div>
      <div class="timeline-scroll">
        <div class="timeline-content" style="width:${timelineZoomX * 100}%">
          <div class="time-ruler">${ticks.map((time) => `<span style="left:${time / duration * 100}%">${time.toFixed(duration < 10 ? 1 : 0)}s</span>`).join("")}</div>
          <div class="timeline-tracks" id="timeline-tracks">
            ${rows.map((row) => renderTimelineTrack(row, duration)).join("")}
            <div class="timeline-cursor" id="timeline-cursor" style="left:${currentTime / duration * 100}%"><span></span></div>
          </div>
        </div>
      </div>
    </div>`;
}

type TimelineRow =
  | { type: "videoHeader" }
  | { type: "layer"; layer: Layer; clips: Layer[]; trackId: string }
  | { type: "effect"; layer: Layer; effect: EffectNode }
  | { type: "post"; effects: EffectNode[] }
  | { type: "postEffect"; effect: EffectNode }
  | { type: "audioHeader" }
  | { type: "audio"; track: AudioTrack; clips: AudioTrack[]; laneId: string };

function timelineRows(): TimelineRow[] {
  if (!project) return [];
  const rows: TimelineRow[] = [];
  rows.push({ type: "videoHeader" });
  // Uma linha por faixa; a faixa mostra todos os seus clipes. O clipe selecionado
  // (ou o primeiro) dá nome à linha.
  for (const track of visualTracks(project)) {
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
  return Math.round(25 * timelineZoomY * (row.type === "audio" ? audioTrackZoomY : videoTrackZoomY));
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

function renderTimelineLabel(row: TimelineRow) {
  const style = `style="--row-height:${timelineRowHeight(row)}px"`;
  if (row.type === "videoHeader") return `<div class="timeline-label-row media-group-label video-group-label" ${style}><strong>VIDEO</strong><span>${project?.layers.length || 0}</span><span class="group-height-controls"><button data-group-height="video:-1">−</button><button data-group-height="video:1">+</button></span></div>`;
  if (row.type === "audioHeader") return `<div class="timeline-label-row media-group-label audio-group-label" ${style}><strong>AUDIO</strong><span>${project?.audioTracks.length || 0}</span><span class="group-height-controls"><button data-group-height="audio:-1">−</button><button data-group-height="audio:1">+</button></span></div>`;
  if (row.type === "audio") return `<div class="timeline-label-row audio-label ${row.clips.some((clip) => clip.id === selectedAudioTrackId) ? "is-selected" : ""}" ${style} draggable="true" data-timeline-order-audio="${row.track.id}" data-select-audio-row="${row.track.id}" data-lane-members="${row.clips.map((clip) => clip.id).join(" ")}">
    <span class="timeline-order"><button data-move-audio-order="${row.track.id}" data-direction="-1">▲</button><button data-move-audio-order="${row.track.id}" data-direction="1">▼</button></span>
    <button class="audio-kind" data-select-audio="${row.track.id}" title="Audio">AUD</button>
    <button class="timeline-label-name" data-select-audio="${row.track.id}">${escapeHtml(row.track.name)}</button>${row.clips.length > 1 ? `<span class="timeline-clip-count">${row.clips.length}</span>` : ""}
    ${row.track.linkedLayerId ? `<button class="audio-link ${row.track.linked ? "is-linked" : ""}" data-toggle-audio-link="${row.track.id}" title="${row.track.linked ? "Unlock audio" : "Link audio to video"}">${row.track.linked ? "▣" : "□"}</button>` : ""}
    <button class="audio-mute ${row.track.muted ? "is-muted" : ""}" data-toggle-audio-mute="${row.track.id}" title="Mute">${row.track.muted ? "M" : "A"}</button>
  </div>`;
  if (row.type === "layer") {
    const open = expandedTimelineLayers.has(row.layer.id);
    return `<div class="timeline-label-row layer-label ${row.clips.some((clip) => clip.id === selectedLayerId) ? "is-selected" : ""}" ${style} data-label-layer="${row.layer.id}" data-select-layer-row="${row.layer.id}" draggable="true" data-timeline-order-layer="${row.layer.id}" data-track-id="${row.trackId}" data-track-members="${row.clips.map((clip) => clip.id).join(" ")}">
      <span class="timeline-order"><button data-move-layer="${row.layer.id}" data-direction="-1">▲</button><button data-move-layer="${row.layer.id}" data-direction="1">▼</button></span>
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
  app.querySelectorAll<HTMLDetailsElement>("[data-library-accordion]").forEach((details) => details.addEventListener("toggle", () => {
    if (!details.open) return;
    libraryAccordion = details.dataset.libraryAccordion as "effects" | "post";
    app.querySelectorAll<HTMLDetailsElement>("[data-library-accordion]").forEach((other) => {
      if (other !== details) other.open = false;
    });
  }));
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
  app.querySelectorAll<HTMLElement>("[data-add-input]").forEach((button) => button.addEventListener("click", () => void addInput(button.dataset.addInput as InputKind)));
  app.querySelector<HTMLElement>("[data-add-audio]")?.addEventListener("click", () => void addAudioInput());
  app.querySelector<HTMLElement>("[data-import-many]")?.addEventListener("click", async () => {
    const files = await chooseFiles("video/*,image/*,audio/*,.mp4,.webm,.mov,.m4v,.png,.jpg,.jpeg,.webp,.bmp,.gif,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac");
    if (files.length) void importMediaFiles(files);
  });
  app.querySelectorAll<HTMLElement>("[data-add-effect]").forEach((button) => button.addEventListener("click", () => addEffect(button.dataset.addEffect as EffectKind, false)));
  app.querySelectorAll<HTMLElement>("[data-add-post]").forEach((button) => button.addEventListener("click", () => addEffect(button.dataset.addPost as EffectKind, true)));
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

function bindDynamicControls(root: ParentNode = app) {
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
    snapshot();
    track.linked = !track.linked;
    if (track.linked && track.linkedLayerId) {
      const owner = project!.layers.find((layer) => layer.id === track.linkedLayerId);
      if (owner?.kind === "video") syncLinkedAudio(owner);
    }
    project!.modifiedAt = new Date().toISOString();
    updateTimeline();
    updateInspector();
  }));
  root.querySelectorAll<HTMLElement>("[data-toggle-audio-mute]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const track = project?.audioTracks.find((item) => item.id === button.dataset.toggleAudioMute);
    if (!track) return;
    snapshot();
    track.muted = !track.muted;
    if (playing) void audioEngine.play(project!, currentTime);
    updateTimeline();
  }));
  root.querySelectorAll<HTMLElement>("[data-layer-visible]").forEach((button) => button.addEventListener("click", () => {
    snapshot();
    const layer = project!.layers.find((item) => item.id === button.dataset.layerVisible)!;
    layer.visible = !layer.visible;
    renderEditorPreservingCanvas();
  }));
  root.querySelectorAll<HTMLElement>("[data-layer-lock]").forEach((button) => button.addEventListener("click", () => {
    snapshot();
    const layer = project!.layers.find((item) => item.id === button.dataset.layerLock)!;
    layer.locked = !layer.locked;
    renderEditorPreservingCanvas();
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
    snapshot();
    const effect = findEffect(button.dataset.toggleEffect!);
    if (effect) effect.enabled = !effect.enabled;
    updateInspector();
    void renderFrame();
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
    input.addEventListener("focus", snapshot);
    input.addEventListener("input", () => {
      const layer = selectedLayer();
      if (!layer || layer.locked || !Number.isFinite(input.valueAsNumber)) return;
      const property = input.dataset.layerProperty!;
      const previous = Number((layer as unknown as Record<string, unknown>)[property]) || 0;
      let createdKeyframe = setLayerNumericValue(layer, property, input.valueAsNumber);
      const paired = property === "scaleX" && layer.scaleLocked ? "scaleY"
        : property === "scaleY" && layer.scaleLocked ? "scaleX"
          : property === "width" && layer.sizeLocked ? "height"
            : property === "height" && layer.sizeLocked ? "width" : "";
      if (paired) {
        const previousPair = Number((layer as unknown as Record<string, unknown>)[paired]) || 0;
        const ratio = Math.abs(previous) > .000001 ? input.valueAsNumber / previous : 1;
        createdKeyframe = setLayerNumericValue(layer, paired, previousPair * ratio) || createdKeyframe;
        syncInspectorValues();
      }
      if (["startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"].includes(property)) {
        layer.endTime = Math.max(layer.startTime + 1 / project!.settings.fps, layer.endTime);
        normalizeFades(layer);
      }
      if (layer.kind === "video" && ["playbackRate", "sourceIn", "sourceOut", "startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"].includes(property)) {
        const duration = renderer?.mediaDuration(layer.id) || Math.max(layer.sourceOut, project!.settings.duration);
        layer.sourceIn = clamp(layer.sourceIn, 0, duration);
        if (layer.sourceOut > 0) layer.sourceOut = clamp(layer.sourceOut, layer.sourceIn + .001, duration);
        syncLinkedAudio(layer);
        renderer?.setPlaybackState(playing, currentTime);
      }
      updateParamScrub(input);
      project!.modifiedAt = new Date().toISOString();
      void renderFrame();
      if (createdKeyframe) requestTimelineRefresh();
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
          snapshot();
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
      };
      scrub.addEventListener("pointermove", move);
      scrub.addEventListener("pointerup", stop);
      scrub.addEventListener("pointercancel", stop);
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-audio-property]").forEach((input) => {
    input.addEventListener("focus", snapshot);
    input.addEventListener("input", () => {
      const track = selectedAudioTrack();
      if (!track || !Number.isFinite(input.valueAsNumber)) return;
      (track as unknown as Record<string, number>)[input.dataset.audioProperty!] = input.valueAsNumber;
      track.endTime = Math.max(track.startTime + 1 / project!.settings.fps, track.endTime);
      track.sourceOut = Math.max(track.sourceIn + .001, track.sourceOut);
      normalizeFades(track);
      const linkedLayer = track.linked ? syncLinkedLayer(track) : undefined;
      updateParamScrub(input);
      project!.modifiedAt = new Date().toISOString();
      if (linkedLayer) {
        renderer?.setPlaybackState(playing, currentTime);
        void renderFrame();
      }
      if (playing) void audioEngine.play(project!, currentTime);
      requestTimelineRefresh();
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-audio-effect-param]").forEach((input) => input.addEventListener("input", () => {
    const track = selectedAudioTrack();
    const effect = track?.effects.find((item) => item.id === input.dataset.audioEffectId);
    if (!effect || !Number.isFinite(input.valueAsNumber)) return;
    effect.params[input.dataset.audioEffectParam!] = input.valueAsNumber;
    updateParamScrub(input);
    project!.modifiedAt = new Date().toISOString();
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-add-audio-effect]").forEach((button) => button.addEventListener("click", () => {
    const track = selectedAudioTrack();
    if (!track) return;
    snapshot();
    track.effects.push(createAudioEffect(button.dataset.addAudioEffect as AudioEffectKind));
    updateInspector();
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-toggle-audio-effect]").forEach((button) => button.addEventListener("click", () => {
    const track = selectedAudioTrack();
    const effect = track?.effects.find((item) => item.id === button.dataset.toggleAudioEffect);
    if (!effect) return;
    snapshot();
    effect.enabled = !effect.enabled;
    updateInspector();
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-remove-audio-effect]").forEach((button) => button.addEventListener("click", () => {
    const track = selectedAudioTrack();
    if (!track) return;
    snapshot();
    track.effects = track.effects.filter((item) => item.id !== button.dataset.removeAudioEffect);
    updateInspector();
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-move-audio-effect]").forEach((button) => button.addEventListener("click", () => {
    const track = selectedAudioTrack();
    if (!track) return;
    const index = track.effects.findIndex((item) => item.id === button.dataset.moveAudioEffect);
    const target = clamp(index + Number(button.dataset.direction), 0, track.effects.length - 1);
    if (index < 0 || index === target) return;
    snapshot();
    const [effect] = track.effects.splice(index, 1);
    track.effects.splice(target, 0, effect);
    updateInspector();
    if (playing) void audioEngine.play(project!, currentTime);
  }));
  root.querySelectorAll<HTMLElement>("[data-axis-lock]").forEach((button) => button.addEventListener("click", () => {
    const layer = selectedLayer();
    if (!layer) return;
    snapshot();
    const property = button.dataset.axisLock as "scaleLocked" | "sizeLocked";
    layer[property] = !layer[property];
    updateInspector();
  }));
  root.querySelectorAll<HTMLElement>("[data-copy-section]").forEach((button) => button.addEventListener("click", () => copyParameterSection(button.dataset.copySection as ClipboardSection)));
  root.querySelectorAll<HTMLElement>("[data-paste-section]").forEach((button) => button.addEventListener("click", () => pasteParameterSection(button.dataset.pasteSection as ClipboardSection)));
  root.querySelector<HTMLInputElement>("[data-audio-name]")?.addEventListener("change", (event) => {
    const track = selectedAudioTrack();
    const value = (event.target as HTMLInputElement).value.trim();
    if (track && value) {
      snapshot();
      track.name = value;
      updateTimeline();
    }
  });
  root.querySelectorAll<HTMLInputElement>("[data-audio-check]").forEach((input) => input.addEventListener("change", () => {
    const track = selectedAudioTrack();
    if (!track) return;
    snapshot();
    if (input.dataset.audioCheck === "linked") {
      track.linked = input.checked;
      if (track.linked && track.linkedLayerId) {
        const owner = project!.layers.find((layer) => layer.id === track.linkedLayerId);
        if (owner?.kind === "video") syncLinkedAudio(owner);
      }
    } else {
      (track as unknown as Record<string, boolean>)[input.dataset.audioCheck!] = input.checked;
    }
    project!.modifiedAt = new Date().toISOString();
    if (playing) void audioEngine.play(project!, currentTime);
    updateTimeline();
  }));
  root.querySelector("#delete-audio-track")?.addEventListener("click", () => deleteAudioTrack());
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-layer-text]").forEach((input) => {
    input.addEventListener("focus", snapshot);
    input.addEventListener("input", () => {
      const layer = selectedLayer();
      if (!layer || layer.locked) return;
      (layer as unknown as Record<string, unknown>)[input.dataset.layerText!] = input.value;
      if (layer.kind === "text" && ["text", "fontFamily"].includes(input.dataset.layerText!)) {
        fitTextHeight(layer);
        updateTextOverflowWarning(layer);
      }
      if (input instanceof HTMLInputElement && input.type === "color") {
        const property = `${input.dataset.layerText}Color`;
        let keys = layer.keyframes[property];
        if (recordMode && playing && !keys) keys = layer.keyframes[property] = [];
        if (recordMode && playing) markRecordedTrack(`color:${layer.id}:${property}`);
        if ((keys?.length || (recordMode && playing)) && upsertKeyframe(keys!, parseInt(input.value.slice(1), 16))) requestTimelineRefresh();
      }
      project!.modifiedAt = new Date().toISOString();
      void renderFrame();
      if (input.dataset.layerText === "name") updateLayerStack();
    });
  });
  root.querySelector<HTMLSelectElement>("[data-transition-type]")?.addEventListener("change", (event) => {
    const layer = selectedLayer();
    if (!layer || !project) return;
    snapshot();
    const value = (event.target as HTMLSelectElement).value;
    if (isTransitionType(value)) layer.transition = { type: value, duration: layer.transition?.duration || DEFAULT_TRANSITION_DURATION };
    else delete layer.transition;
    afterClipEdit();
    updateInspector();
    updateTimeline();
  });
  root.querySelector<HTMLInputElement>("[data-transition-duration]")?.addEventListener("change", (event) => {
    const layer = selectedLayer();
    const value = Number((event.target as HTMLInputElement).value);
    if (!layer?.transition || !Number.isFinite(value)) return;
    snapshot();
    layer.transition.duration = clamp(value, 1 / project!.settings.fps, Math.max(.05, layer.endTime - layer.startTime));
    afterClipEdit();
    updateTimeline();
  });
  root.querySelectorAll<HTMLInputElement>("[data-layer-check]").forEach((input) => input.addEventListener("change", () => {
    const layer = selectedLayer();
    if (!layer || layer.locked) return;
    snapshot();
    (layer as unknown as Record<string, unknown>)[input.dataset.layerCheck!] = input.checked;
    if (layer.kind === "video") {
      syncLinkedAudio(layer);
      renderer?.setPlaybackState(playing, currentTime);
      if (playing) void audioEngine.play(project!, currentTime);
    }
    project!.modifiedAt = new Date().toISOString();
    void renderFrame();
  }));
  root.querySelectorAll<HTMLInputElement>("[data-effect-param]").forEach((input) => {
    input.addEventListener("focus", snapshot);
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
      const createdKeyframe = setEffectNumericValue(effect, property, value);
      updateParamScrub(input);
      project!.modifiedAt = new Date().toISOString();
      void renderFrame();
      if (createdKeyframe) requestTimelineRefresh();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-keyframe]").forEach((button) => button.addEventListener("click", () => toggleKeyframe(button.dataset.keyframe!)));
  root.querySelectorAll<HTMLElement>("[data-color-keyframe]").forEach((button) => button.addEventListener("click", () => toggleColorKeyframe(button.dataset.colorKeyframe as "fill" | "stroke")));
  root.querySelectorAll<HTMLElement>("[data-effect-keyframe]").forEach((button) => button.addEventListener("click", () => toggleEffectKeyframe(button.dataset.effectKeyframe!)));
  root.querySelectorAll<HTMLSelectElement>("[data-layer-easing]").forEach((select) => select.addEventListener("change", () => {
    const keyframe = keyframeAt(selectedLayer()?.keyframes[select.dataset.layerEasing!]);
    if (!keyframe) return;
    snapshot();
    keyframe.easing = select.value as Easing;
    if (keyframe.easing === "bezier") keyframe.curve ??= .75;
    updateCurveTools();
    void renderFrame();
  }));
  root.querySelectorAll<HTMLSelectElement>("[data-effect-easing]").forEach((select) => select.addEventListener("change", () => {
    const keyframe = keyframeAt(selectedEffect()?.keyframes[select.dataset.effectEasing!]);
    if (!keyframe) return;
    snapshot();
    keyframe.easing = select.value as Easing;
    if (keyframe.easing === "bezier") keyframe.curve ??= .75;
    updateCurveTools();
    void renderFrame();
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
    if (value && value !== layer.name) {
      snapshot();
      layer.name = value;
      project!.modifiedAt = new Date().toISOString();
    }
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
  updateLayerStack();
  updateInspector();
  updateTimeline();
}

function updateLayerStack() {
  const target = app.querySelector("#layer-stack");
  if (!target || !project) return;
  target.innerHTML = project.layers.map(renderLayerItem).join("") || `<p class="empty-stack">+ ${t("inputs")}</p>`;
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
function fitTextHeight(layer: Layer) {
  const layout = renderer?.measureText(layer, currentTime);
  if (!layout || layout.lines.length <= layout.maxLines || layer.keyframes.height?.length) return;
  layer.height = Math.ceil(layout.requiredHeight);
  const input = app.querySelector<HTMLInputElement>('[data-layer-property="height"]');
  if (input) {
    input.value = String(layer.height);
    updateParamScrub(input);
  }
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

async function addInput(kind: InputKind) {
  if (!project) return;
  let asset: ImportedAsset | null = null;
  if (["image", "video", "guide"].includes(kind)) {
    const accept = kind === "video"
      ? ".mp4,.webm,.mov,.m4v,video/*"
      : ".png,.jpg,.jpeg,.webp,.bmp,.gif,image/*";
    const source = await chooseFile(accept);
    if (!source) return;
    try {
      asset = await importWebAsset(source);
    } catch (error) {
      window.alert(String(error));
      return;
    }
  }
  snapshot();
  const layer = createLayer(kind, project.settings, {
    asset: asset?.relativePath,
    name: asset?.fileName || (kind === "text" ? "Text" : kind === "geometry" ? (language === "pt-BR" ? "Quadrado" : "Square") : kind),
  });
  if (kind === "video" && layer.asset) {
    const duration = await probeMediaDuration(layer.asset, "video");
    if (duration > 0) {
      layer.sourceOut = duration;
      layer.endTime = duration;
      layer.loop = false;
      layer.fadeOutStart = duration;
      layer.fadeOutEnd = duration;
      if (duration > project.settings.duration) project.settings.duration = duration;
    }
    try {
      const audio = await probeAudio(layer.asset);
      const audioDuration = audio.duration || duration;
      if (audioDuration > 0) {
        project.audioTracks.push(createAudioTrack(`${layer.name} · audio`, layer.asset, audioDuration, {
          linkedLayerId: layer.id,
          linked: true,
          endTime: layer.endTime,
          sourceOut: audioDuration,
          fadeOutStart: layer.endTime,
          fadeOutEnd: layer.endTime,
        }));
      }
    } catch {
      // Video sem faixa de áudio ou codec de áudio não suportado pelo navegador.
    }
  }
  project.layers.unshift(layer);
  // Mídia nova entra no playhead (em 0 continua igual: ocupa a composição).
  if (currentTime > 0 && kind !== "guide") {
    const at = Math.round(currentTime * project.settings.fps) / project.settings.fps;
    if (kind === "video") shiftClip(project, layer, at);
    else {
      layer.startTime = at;
      layer.endTime = Math.max(project.settings.duration, at + 3);
      layer.fadeInStart = layer.fadeInEnd = at;
      layer.fadeOutStart = layer.fadeOutEnd = layer.endTime;
    }
    extendDurationToContent();
  }
  if (asset) rememberAssetSource(asset.relativePath, asset.sourceMetadata);
  selectedLayerId = layer.id;
  selectedAudioTrackId = "";
  selectedEffectId = "";
  selectedKeyRef = "";
  renderEditorPreservingCanvas();
  if (layer.asset) {
    renderer?.removeMedia(layer.id);
    renderer?.preload(layer, true, () => {
      if (selectedLayerId === layer.id) updateInspector();
    });
  }
  if (layer.kind === "video") {
    void generateVideoThumbnails(layer);
    const linkedAudio = project.audioTracks.find((track) => track.linkedLayerId === layer.id);
    if (linkedAudio) void generateAudioWaveform(linkedAudio.asset);
  }
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

const IMPORTED_IMAGE_SECONDS = 3;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|bmp|gif)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|oga|flac)$/i;

function mediaKindOf(file: File): "video" | "image" | "audio" | null {
  if (file.type.startsWith("video/") || VIDEO_EXTENSIONS.test(file.name)) return "video";
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name)) return "image";
  if (file.type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name)) return "audio";
  return null;
}

// Importa vários arquivos de uma vez: vídeos e imagens em sequência numa faixa
// nova a partir do playhead (imagens com 3 s), áudios em sequência numa faixa de
// áudio. Tudo vira um único passo de desfazer, pronto para editar à mão ou pelo agente.
async function importMediaFiles(files: File[]) {
  if (!project || !files.length) return;
  const settings = project.settings;
  const start = Math.round(currentTime * settings.fps) / settings.fps;
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const failures: string[] = [];
  const prepared: Array<{ kind: "video" | "image" | "audio"; asset: ImportedAsset; duration: number; audioDuration: number }> = [];
  setStatus(language === "pt-BR" ? `IMPORTANDO ${sorted.length} ARQUIVO(S)…` : `IMPORTING ${sorted.length} FILE(S)…`);
  for (const file of sorted) {
    const kind = mediaKindOf(file);
    if (!kind) {
      failures.push(file.name);
      continue;
    }
    try {
      const asset = await importWebAsset(file);
      let duration = kind === "image" ? IMPORTED_IMAGE_SECONDS : 0;
      let audioDuration = 0;
      if (kind === "video") duration = await probeMediaDuration(asset.relativePath, "video");
      if (kind !== "image") {
        try {
          audioDuration = (await probeAudio(asset.relativePath)).duration;
        } catch {
          audioDuration = 0;
        }
      }
      if (kind === "audio") duration = audioDuration || await probeMediaDuration(asset.relativePath, "audio");
      if (!(duration > 0)) throw new Error("sem duração");
      prepared.push({ kind, asset, duration, audioDuration });
    } catch {
      failures.push(file.name);
    }
  }
  if (!prepared.length) {
    setStatus(language === "pt-BR" ? `NENHUMA MÍDIA IMPORTADA · ${failures.join(", ")}` : `NO MEDIA IMPORTED · ${failures.join(", ")}`);
    return;
  }
  snapshot();
  const fps = settings.fps;
  const frame = (seconds: number) => Math.max(1 / fps, Math.round(seconds * fps) / fps);
  let visualCursor = start;
  let audioCursor = start;
  let visualTrack: string | undefined;
  let linkedLane: string | undefined;
  let audioLane: string | undefined;
  const layers: Layer[] = [];
  for (const item of prepared) {
    const { asset } = item;
    rememberAssetSource(asset.relativePath, asset.sourceMetadata);
    if (item.kind === "audio") {
      const end = audioCursor + frame(item.duration);
      const track = createAudioTrack(asset.fileName, asset.relativePath, item.duration, {
        startTime: audioCursor, endTime: end, laneId: audioLane,
        fadeInStart: audioCursor, fadeInEnd: audioCursor, fadeOutStart: end, fadeOutEnd: end,
      });
      audioLane ||= track.id;
      project.audioTracks.push(track);
      audioCursor = end;
      continue;
    }
    const end = visualCursor + frame(item.duration);
    const layer = createLayer(item.kind, settings, {
      asset: asset.relativePath, name: asset.fileName, trackId: visualTrack,
      startTime: visualCursor, endTime: end,
      fadeInStart: visualCursor, fadeInEnd: visualCursor, fadeOutStart: end, fadeOutEnd: end,
      ...(item.kind === "video" ? { sourceIn: 0, sourceOut: item.duration, loop: false } : {}),
    });
    visualTrack ||= layer.id;
    layers.push(layer);
    if (item.kind === "video" && item.audioDuration > 0) {
      const track = createAudioTrack(`${layer.name} · audio`, asset.relativePath, item.audioDuration, {
        linkedLayerId: layer.id, linked: true, laneId: linkedLane,
        startTime: visualCursor, endTime: end, sourceOut: item.audioDuration,
        fadeInStart: visualCursor, fadeInEnd: visualCursor, fadeOutStart: end, fadeOutEnd: end,
      });
      linkedLane ||= track.id;
      project.audioTracks.push(track);
    }
    visualCursor = end;
  }
  project.layers.unshift(...layers);
  extendDurationToContent();
  selectedClipIds.clear();
  selectedLayerId = layers[0]?.id || selectedLayerId;
  selectedAudioTrackId = layers.length ? "" : project.audioTracks[project.audioTracks.length - 1]?.id || "";
  selectedEffectId = "";
  selectedKeyRef = "";
  markProjectModified();
  renderEditorPreservingCanvas();
  for (const layer of layers) {
    renderer?.removeMedia(layer.id);
    renderer?.preload(layer, true, () => {
      if (selectedLayerId === layer.id) updateInspector();
    });
    if (layer.kind === "video") void generateVideoThumbnails(layer);
  }
  for (const asset of new Set(project.audioTracks.map((track) => track.asset))) void generateAudioWaveform(asset);
  const imported = prepared.length;
  setStatus(language === "pt-BR"
    ? `${imported} MÍDIA(S) IMPORTADA(S)${failures.length ? ` · não importadas: ${failures.join(", ")}` : ""}`
    : `${imported} MEDIA FILE(S) IMPORTED${failures.length ? ` · skipped: ${failures.join(", ")}` : ""}`);
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

async function addAudioInput() {
  if (!project) return;
  const source = await chooseFile(".mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,audio/*");
  if (!source) return;
  try {
    const asset = await importWebAsset(source);
    const decoded = await probeAudio(asset.relativePath);
    const duration = decoded.duration || await probeMediaDuration(asset.relativePath, "audio");
    if (!duration) throw new Error(language === "pt-BR" ? "Não foi possível ler este arquivo de áudio." : "Could not read this audio file.");
    snapshot();
    if (duration > project.settings.duration) project.settings.duration = duration;
    const track = createAudioTrack(asset.fileName, asset.relativePath, duration);
    project.audioTracks.push(track);
    rememberAssetSource(asset.relativePath, asset.sourceMetadata);
    selectedAudioTrackId = track.id;
    selectedLayerId = "";
    selectedEffectId = "";
    selectedKeyRef = "";
    renderEditorPreservingCanvas();
    void generateAudioWaveform(track.asset);
  } catch (error) {
    window.alert(String(error));
  }
}

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
    snapshot();
    layer.asset = asset.relativePath;
    rememberAssetSource(asset.relativePath, asset.sourceMetadata);
    renderer?.removeMedia(layer.id);
    if (layer.kind === "video") {
      layer.sourceIn = 0;
      layer.sourceOut = mediaDuration;
      layer.loop = mediaDuration > 0 && clipDuration * Math.max(.05, Math.abs(layer.playbackRate)) > mediaDuration;
      const linkedTracks = project.audioTracks.filter((track) => track.linked && track.linkedLayerId === layer.id);
      if (embeddedAudioDuration > 0) {
        if (!linkedTracks.length) {
          project.audioTracks.push(createAudioTrack(`${layer.name} · audio`, asset.relativePath, embeddedAudioDuration, {
            linkedLayerId: layer.id,
            linked: true,
            startTime: layer.startTime,
            endTime: layer.endTime,
            sourceIn: 0,
            sourceOut: embeddedAudioDuration,
            loop: layer.loop,
            fadeInStart: layer.fadeInStart,
            fadeInEnd: layer.fadeInEnd,
            fadeOutStart: layer.fadeOutStart,
            fadeOutEnd: layer.fadeOutEnd,
          }));
        } else {
          for (const track of linkedTracks) {
            audioWaveformCache.delete(track.asset);
            track.asset = asset.relativePath;
            track.sourceIn = 0;
            track.sourceOut = embeddedAudioDuration;
          }
          syncLinkedAudio(layer);
        }
      } else if (linkedTracks.length) {
        project.audioTracks = project.audioTracks.filter((track) => !linkedTracks.includes(track));
      }
    }
    project.modifiedAt = new Date().toISOString();
    audioEngine.stop();
    renderEditorPreservingCanvas();
    if (layer.kind === "video") {
      void generateVideoThumbnails(layer);
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
    snapshot();
    const clipDuration = track.endTime - track.startTime;
    audioWaveformCache.delete(track.asset);
    track.asset = asset.relativePath;
    rememberAssetSource(asset.relativePath, asset.sourceMetadata);
    track.sourceIn = 0;
    track.sourceOut = duration;
    track.loop = clipDuration * Math.max(.05, Math.abs(track.playbackRate)) > duration;
    project.modifiedAt = new Date().toISOString();
    audioEngine.stop();
    renderEditorPreservingCanvas();
    void generateAudioWaveform(track.asset);
    setStatus(`${language === "pt-BR" ? "ÁUDIO SUBSTITUÍDO" : "AUDIO REPLACED"} · ${source.name}`);
  } catch (error) {
    window.alert(String(error));
  }
}

function deleteAudioTrack(id = selectedAudioTrackId) {
  if (!project || !id) return;
  snapshot();
  project.audioTracks = project.audioTracks.filter((track) => track.id !== id);
  selectedAudioTrackId = "";
  selectedLayerId = project.layers[0]?.id || "";
  selectedEffectId = "";
  selectedKeyRef = "";
  audioEngine.stop();
  renderEditorPreservingCanvas();
}

function syncLinkedAudio(layer: Layer) {
  if (project) syncLinkedAudioTracks(layer, project.audioTracks);
}

function syncLinkedLayer(track: AudioTrack) {
  return project ? syncLinkedVideoLayer(track, project.layers, project.audioTracks) : undefined;
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
  snapshot();
  if (section === "audio" && audio) {
    const data = structuredClone(parameterClipboard.data) as Record<string, unknown> & { effects: AudioEffectNode[] };
    const start = audio.startTime;
    audio.volume = Number(data.volume);
    audio.playbackRate = Number(data.playbackRate);
    audio.reverse = Boolean(data.reverse);
    audio.loop = Boolean(data.loop);
    audio.fadeInStart = start + Number(data.fadeInStart);
    audio.fadeInEnd = start + Number(data.fadeInEnd);
    audio.fadeOutStart = start + Number(data.fadeOutStart);
    audio.fadeOutEnd = start + Number(data.fadeOutEnd);
    audio.effects = (data.effects || []).map((effect) => ({ ...effect, id: uid("afx") }));
  } else if (section === "transform" && layer) {
    Object.assign(layer, structuredClone(parameterClipboard.data));
  } else if (section === "timing" && layer) {
    const data = structuredClone(parameterClipboard.data) as Record<string, unknown>;
    const start = layer.startTime;
    layer.playbackRate = Number(data.playbackRate);
    layer.reverse = Boolean(data.reverse);
    layer.loop = Boolean(data.loop);
    layer.fadeInStart = start + Number(data.fadeInStart);
    layer.fadeInEnd = start + Number(data.fadeInEnd);
    layer.fadeOutStart = start + Number(data.fadeOutStart);
    layer.fadeOutEnd = start + Number(data.fadeOutEnd);
    syncLinkedAudio(layer);
  } else if (section === "effects" && layer) {
    layer.effects = (structuredClone(parameterClipboard.data) as EffectNode[]).map((effect) => ({ ...effect, id: uid("fx") }));
  } else return;
  project.modifiedAt = new Date().toISOString();
  updatePanels();
  if (playing) void audioEngine.play(project, currentTime);
  void renderFrame();
  setStatus(`PASTED · ${section.toUpperCase()}`);
}

function addEffect(kind: EffectKind, post: boolean) {
  if (!project) return;
  if (!post && !selectedLayer()) {
    setStatus(language === "pt-BR" ? "SELECIONE UM INPUT PRIMEIRO" : "SELECT AN INPUT FIRST");
    return;
  }
  snapshot();
  const effect = createEffect(kind);
  if (post) project.postEffects.push(effect);
  else selectedLayer()!.effects.push(effect);
  selectedAudioTrackId = "";
  selectedEffectId = effect.id;
  selectedKeyRef = "";
  renderEditorPreservingCanvas();
}

function removeEffect(id: string) {
  if (!project) return;
  snapshot();
  for (const layer of project.layers) layer.effects = layer.effects.filter((effect) => effect.id !== id);
  project.postEffects = project.postEffects.filter((effect) => effect.id !== id);
  if (selectedEffectId === id) selectedEffectId = "";
  renderEditorPreservingCanvas();
}

function deleteLayer(layerId = selectedLayerId) {
  const layer = project?.layers.find((item) => item.id === layerId);
  if (!project || !layer) return;
  snapshot();
  renderer?.removeMedia(layer.id);
  project.layers = project.layers.filter((item) => item.id !== layer.id);
  project.audioTracks = project.audioTracks.filter((track) => track.linkedLayerId !== layer.id || !track.linked);
  selectedLayerId = project.layers[0]?.id || "";
  selectedAudioTrackId = "";
  selectedEffectId = "";
  selectedKeyRef = "";
  renderEditorPreservingCanvas();
}

function moveLayer(layerId: string, direction: number) {
  if (!project) return;
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) return;
  // O undo ignora checkpoints sem alteração, então o snapshot antes é seguro.
  snapshot();
  if (!shiftTrack(project, trackIdOf(layer), direction)) return;
  syncLinkedAudioOrder();
  project.modifiedAt = new Date().toISOString();
  renderEditorPreservingCanvas();
}

function moveAudioTrack(trackId: string, direction: number) {
  if (!project) return;
  const index = project.audioTracks.findIndex((track) => track.id === trackId);
  const target = clamp(index + direction, 0, project.audioTracks.length - 1);
  if (index < 0 || index === target) return;
  snapshot();
  const [moved] = project.audioTracks.splice(index, 1);
  project.audioTracks.splice(target, 0, moved);
  project.modifiedAt = new Date().toISOString();
  updateTimeline();
}

function moveEffect(effectId: string, direction: number) {
  if (!project) return;
  const lists = [...project.layers.map((layer) => layer.effects), project.postEffects];
  const list = lists.find((candidate) => candidate.some((effect) => effect.id === effectId));
  if (!list) return;
  const index = list.findIndex((effect) => effect.id === effectId);
  const target = clamp(index + direction, 0, list.length - 1);
  if (index === target) return;
  snapshot();
  const [moved] = list.splice(index, 1);
  list.splice(target, 0, moved);
  project.modifiedAt = new Date().toISOString();
  renderEditorPreservingCanvas();
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

// Depois de mover/aparar: no modo Sobrepor, sobreposições ganham Dissolver; o
// áudio vinculado segue o crossfade das transições com sobreposição.
function afterClipEdit() {
  if (!project) return;
  if (overlapMode) autoTransitionsForOverlap(project);
  syncTransitionAudioFades(project);
  markProjectModified();
  void renderFrame();
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
  snapshot();
  for (const id of ids) renderer?.removeMedia(id);
  project.layers = project.layers.filter((layer) => !ids.includes(layer.id));
  project.audioTracks = project.audioTracks.filter((track) => !(track.linked && ids.includes(track.linkedLayerId || "")));
  selectedClipIds.clear();
  selectedLayerId = project.layers[0]?.id || "";
  markProjectModified();
  renderEditorPreservingCanvas();
}

function rippleDeleteSelection() {
  const ids = selectionIds();
  if (!project || !ids.length) return;
  snapshot();
  for (const id of ids) renderer?.removeMedia(id);
  rippleDelete(project, ids);
  selectedClipIds.clear();
  selectedLayerId = project.layers[0]?.id || "";
  afterClipEdit();
  renderEditorPreservingCanvas();
  setStatus(language === "pt-BR" ? "APAGADO COM RIPPLE · espaço fechado" : "RIPPLE DELETE · gap closed");
}

function pasteClipboard() {
  if (!project || !clipClipboard) return;
  snapshot();
  const pasted = pasteClips(project, clipClipboard, Math.round(currentTime * project.settings.fps) / project.settings.fps);
  if (!pasted.length) return;
  extendDurationToContent();
  syncLinkedAudioOrder();
  selectedClipIds.clear();
  pasted.forEach((layer) => selectedClipIds.add(layer.id));
  selectedLayerId = pasted[0].id;
  afterClipEdit();
  renderEditorPreservingCanvas();
  setStatus(language === "pt-BR" ? `${pasted.length} CLIPE(S) COLADO(S) NO PLAYHEAD` : `${pasted.length} CLIP(S) PASTED AT PLAYHEAD`);
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
  snapshot();
  const mediaDuration = renderer?.mediaDuration(target.id) || 0;
  const result = splitClip(project, target.id, time, mediaDuration, .5 / fps);
  if (!result) return;
  selectedLayerId = result.second.id;
  selectedAudioTrackId = "";
  selectedEffectId = "";
  selectedKeyRef = "";
  markProjectModified();
  renderEditorPreservingCanvas();
  setStatus(language === "pt-BR" ? "CLIPE CORTADO" : "CLIP SPLIT");
}

function duplicateLayer() {
  const layer = selectedLayer();
  if (!project || !layer) return;
  snapshot();
  const clone = structuredClone(layer);
  clone.id = uid("layer");
  clone.name += " copy";
  clone.x += 24;
  clone.y += 24;
  clone.effects.forEach((effect) => effect.id = uid("fx"));
  const linkedAudio = project.audioTracks.filter((track) => track.linkedLayerId === layer.id);
  for (const track of linkedAudio) {
    const audioClone = structuredClone(track);
    audioClone.id = uid("audio");
    audioClone.name += " copy";
    audioClone.linkedLayerId = clone.id;
    project.audioTracks.push(audioClone);
  }
  const index = project.layers.findIndex((item) => item.id === layer.id);
  project.layers.splice(index, 0, clone);
  selectedLayerId = clone.id;
  selectedAudioTrackId = "";
  selectedEffectId = "";
  selectedKeyRef = "";
  renderEditorPreservingCanvas();
}

function toggleKeyframe(property: string) {
  const layer = selectedLayer();
  if (!layer) return;
  automationApi.dispatch({
    type: "keyframe.toggle",
    layerId: layer.id,
    property,
    time: currentTime,
    value: renderer?.layerValue(layer, property as keyof Layer, currentTime)
      ?? Number((layer as unknown as Record<string, unknown>)[property]),
  });
  const keyframe = keyframeAt(layer.keyframes[property]);
  selectedKeyRef = keyframe ? `${layer.id}|${property}|${keyframe.time}` : "";
  updateInspector();
  updateTimeline();
  void renderFrame();
}

function toggleEffectKeyframe(property: string) {
  const effect = selectedEffect();
  if (!effect) return;
  automationApi.dispatch({
    type: "effect.keyframe.toggle",
    effectId: effect.id,
    property,
    time: currentTime,
    value: renderer?.effectValue(effect, property, currentTime) ?? effect.params[property],
  });
  const owner = project!.postEffects.some((item) => item.id === effect.id)
    ? "__post__"
    : project!.layers.find((layer) => layer.effects.some((item) => item.id === effect.id))?.id || "__post__";
  const keyframe = keyframeAt(effect.keyframes[property]);
  selectedKeyRef = keyframe ? `${owner}|fx:${effect.id}:${property}|${keyframe.time}` : "";
  updateInspector();
  updateTimeline();
  void renderFrame();
}

function toggleColorKeyframe(property: "fill" | "stroke") {
  const layer = selectedLayer();
  if (!layer) return;
  const key = `${property}Color`;
  automationApi.dispatch({
    type: "keyframe.toggle",
    layerId: layer.id,
    property: key,
    time: currentTime,
    value: parseInt((renderer?.layerColor(layer, property, currentTime) || layer[property]).slice(1), 16),
  });
  const keyframe = keyframeAt(layer.keyframes[key]);
  selectedKeyRef = keyframe ? `${layer.id}|${key}|${keyframe.time}` : "";
  updateInspector();
  updateTimeline();
  void renderFrame();
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

// Estende a duração da composição até o fim do último clipe (arrastar além do fim).
function extendDurationToContent() {
  if (!project) return;
  const fps = project.settings.fps;
  const contentEnd = Math.max(0, ...project.layers.map((layer) => layer.endTime), ...project.audioTracks.map((track) => track.endTime));
  if (contentEnd <= project.settings.duration + 1e-6) return;
  project.settings.duration = Math.min(MAX_TIMELINE_SECONDS, Math.ceil(contentEnd * fps - 1e-6) / fps);
}

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

function timelineTimeFromPointer(event: PointerEvent, scrubArea: HTMLElement) {
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
  return calculateTimelineSnap(value, project, timelineSnap,
    () => timelineContentRect(scrubArea).width,
    () => timelineSnapCandidates(excludeLayerId, excludeAudioId, excludePlayhead), bypass);
}

function snapClipStart(value: number, length: number, scrubArea: HTMLElement, excludeLayerId = "", excludeAudioId = "", bypass = false) {
  const start = snapTimelineTime(value, scrubArea, excludeLayerId, excludeAudioId, bypass);
  const end = snapTimelineTime(value + length, scrubArea, excludeLayerId, excludeAudioId, bypass) - length;
  return Math.abs(start - value) <= Math.abs(end - value) ? start : end;
}

function bindTimeline() {
  app.querySelector("#play")?.addEventListener("click", togglePlayback);
  app.querySelector("#split-clip")?.addEventListener("click", splitAtPlayhead);
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
    else snapshot();
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
    snapshot();
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
    project.settings.duration = value;
    for (const layer of project.layers) if (Math.abs(layer.endTime - previous) < .001) {
      const shift = value - previous;
      layer.endTime = value;
      layer.fadeOutStart += shift;
      layer.fadeOutEnd += shift;
      normalizeFades(layer);
      if (layer.kind === "video") syncLinkedAudio(layer);
    }
    currentTime = clamp(currentTime, 0, value);
    updateTimeline();
    setTime(currentTime);
  });
  app.querySelectorAll<HTMLElement>("[data-key-ref]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
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
      const [layerId, property, time] = button.dataset.keyRef!.split("|");
      const layer = layerId === "__post__" ? undefined : project!.layers.find((item) => item.id === layerId);
      snapshot();
      if (property.startsWith("fx:")) {
        const [, effectId, parameter] = property.split(":");
        const effect = layerId === "__post__"
          ? project!.postEffects.find((item) => item.id === effectId)
          : layer?.effects.find((item) => item.id === effectId);
        if (effect) effect.keyframes[parameter] = effect.keyframes[parameter].filter((key) => Math.abs(key.time - Number(time)) > keyframeTolerance());
      } else if (layer) {
        layer.keyframes[property] = layer.keyframes[property].filter((key) => Math.abs(key.time - Number(time)) > keyframeTolerance());
      }
      if (selectedKeyRef === button.dataset.keyRef) selectedKeyRef = "";
      updateTimeline();
      updateInspector();
      void renderFrame();
    });
  });

  const scrubArea = app.querySelector<HTMLElement>(".timeline-scroll");
  if (!scrubArea) return;
  const labels = app.querySelector<HTMLElement>(".timeline-labels");
  scrubArea.addEventListener("scroll", () => {
    if (labels && Math.abs(labels.scrollTop - scrubArea.scrollTop) > 1) labels.scrollTop = scrubArea.scrollTop;
  });
  labels?.addEventListener("scroll", () => {
    if (Math.abs(scrubArea.scrollTop - labels.scrollTop) > 1) scrubArea.scrollTop = labels.scrollTop;
  });
  app.querySelectorAll<HTMLElement>("[data-trim-clip]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
    if (!project || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopPlayback();
    const layer = project.layers.find((item) => item.id === handle.dataset.trimClip);
    if (!layer) return;
    selectLayerById(layer.id, false);
    snapshot();
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
      return snapTimelineTime(timelineTimeFromPointer(moveEvent, scrubArea), scrubArea, layer.id, "", moveEvent.altKey);
    };
    const move = (moveEvent: PointerEvent) => {
      const time = pointerTime(moveEvent);
      if (edge === "start") {
        const nextStart = clamp(time, neighbors.previousEnd, initialEnd - minLength);
        const delta = nextStart - initialStart;
        layer.startTime = nextStart;
        if (layer.kind === "video") {
          if (layer.reverse) layer.sourceOut = clamp(initialSourceOut - delta * speed, initialSourceIn + .001, mediaDuration);
          else layer.sourceIn = clamp(initialSourceIn + delta * speed, 0, initialSourceOut - .001);
        }
      } else {
        layer.endTime = clamp(time, initialStart + minLength, Math.min(project!.settings.duration, neighbors.nextStart));
        if (layer.kind === "video") {
          const naturalTimelineDuration = (initialSourceOut - layer.sourceIn) / speed;
          layer.loop = layer.endTime - layer.startTime > naturalTimelineDuration + minLength / 2;
        }
      }
      normalizeFades(layer);
      if (layer.kind === "video") syncLinkedAudio(layer);
      if (clip) {
        clip.style.left = `${layer.startTime / project!.settings.duration * 100}%`;
        clip.style.width = `${(layer.endTime - layer.startTime) / project!.settings.duration * 100}%`;
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
      project!.modifiedAt = new Date().toISOString();
      afterClipEdit();
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
    snapshot();
    const initialStart = (layer || track)!.startTime;
    const initialEnd = (layer || track)!.endTime;
    const length = initialEnd - initialStart;
    const initialFades = {
      fadeInStart: (layer || track)!.fadeInStart,
      fadeInEnd: (layer || track)!.fadeInEnd,
      fadeOutStart: (layer || track)!.fadeOutStart,
      fadeOutEnd: (layer || track)!.fadeOutEnd,
    };
    const animatedLayer = layer || linkedLayer;
    const layerKeyTimes = animatedLayer ? new Map<string, number[]>(Object.entries(animatedLayer.keyframes).map(([property, keys]) => [property, keys.map((key) => key.time)])) : null;
    const effectKeyTimes = animatedLayer ? new Map<string, Map<string, number[]>>(animatedLayer.effects.map((effect) => [effect.id, new Map(Object.entries(effect.keyframes).map(([property, keys]) => [property, keys.map((key) => key.time)]))])) : null;
    const startX = event.clientX;
    const timelinePixelWidth = timelineContentRect(scrubArea).width;
    clip.setPointerCapture(event.pointerId);
    // Na própria faixa, o clipe só anda no espaço livre entre os vizinhos.
    const neighbors = layer && !overlapMode ? clipNeighbors(project, layer.id) : { previousEnd: 0, nextStart: Number.POSITIVE_INFINITY };
    const minStart = neighbors.previousEnd;
    const maxStart = Math.min(MAX_TIMELINE_SECONDS, neighbors.nextStart) - length;
    // Arrastar na vertical sobre outra faixa visual muda o clipe de faixa ao soltar.
    let dropTrackId = "";
    const markDropTarget = (moveEvent: PointerEvent) => {
      if (!layer) return;
      const row = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>(".timeline-track[data-track-id]");
      const candidate = row?.dataset.trackId || "";
      dropTrackId = candidate && candidate !== trackIdOf(layer) ? candidate : "";
      app.querySelectorAll(".timeline-track.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
      if (dropTrackId) row!.classList.add("is-drop-target");
    };
    const move = (moveEvent: PointerEvent) => {
      markDropTarget(moveEvent);
      const delta = (moveEvent.clientX - startX) / Math.max(1, timelinePixelWidth) * project!.settings.duration;
      // O clipe pode passar do fim da composição; a duração é estendida ao soltar.
      const nextStart = clamp(initialStart + delta, minStart, maxStart);
      const snapped = clamp(snapClipStart(nextStart, length, scrubArea, layer?.id || "", track?.id || "", moveEvent.altKey), minStart, maxStart);
      if (layer) {
        layer.startTime = snapped;
        layer.endTime = snapped + length;
        const shift = snapped - initialStart;
        layer.fadeInStart = initialFades.fadeInStart + shift;
        layer.fadeInEnd = initialFades.fadeInEnd + shift;
        layer.fadeOutStart = initialFades.fadeOutStart + shift;
        layer.fadeOutEnd = initialFades.fadeOutEnd + shift;
        for (const [property, times] of layerKeyTimes || []) layer.keyframes[property].forEach((key, index) => key.time = clamp(times[index] + shift, 0, MAX_TIMELINE_SECONDS));
        for (const effect of layer.effects) {
          const sourceTimes = effectKeyTimes?.get(effect.id);
          if (!sourceTimes) continue;
          for (const [property, times] of sourceTimes) effect.keyframes[property].forEach((key, index) => key.time = clamp(times[index] + shift, 0, MAX_TIMELINE_SECONDS));
        }
        if (layer.kind === "video") {
          syncLinkedAudio(layer);
          for (const linked of project!.audioTracks) {
            if (linked.linked && linked.linkedLayerId === layer.id) updateTimelineClipStyles(linked.id, linked.startTime, linked.endTime, true);
          }
        }
      } else if (track) {
        track.startTime = snapped;
        track.endTime = snapped + length;
        const shift = snapped - initialStart;
        track.fadeInStart = initialFades.fadeInStart + shift;
        track.fadeInEnd = initialFades.fadeInEnd + shift;
        track.fadeOutStart = initialFades.fadeOutStart + shift;
        track.fadeOutEnd = initialFades.fadeOutEnd + shift;
        if (linkedLayer) {
          linkedLayer.startTime = track.startTime;
          linkedLayer.endTime = track.endTime;
          linkedLayer.fadeInStart = track.fadeInStart;
          linkedLayer.fadeInEnd = track.fadeInEnd;
          linkedLayer.fadeOutStart = track.fadeOutStart;
          linkedLayer.fadeOutEnd = track.fadeOutEnd;
          for (const [property, times] of layerKeyTimes || []) linkedLayer.keyframes[property].forEach((key, index) => key.time = clamp(times[index] + shift, 0, MAX_TIMELINE_SECONDS));
          for (const effect of linkedLayer.effects) {
            const sourceTimes = effectKeyTimes?.get(effect.id);
            if (!sourceTimes) continue;
            for (const [property, times] of sourceTimes) effect.keyframes[property].forEach((key, index) => key.time = clamp(times[index] + shift, 0, MAX_TIMELINE_SECONDS));
          }
          syncLinkedAudio(linkedLayer);
          updateTimelineClipStyles(linkedLayer.id, linkedLayer.startTime, linkedLayer.endTime);
        }
      }
      clip.style.left = `${snapped / project!.settings.duration * 100}%`;
      void renderFrame();
    };
    const stop = (upEvent: PointerEvent) => {
      clip.removeEventListener("pointermove", move);
      clip.removeEventListener("pointerup", stop);
      clip.removeEventListener("pointercancel", stop);
      if (clip.hasPointerCapture(upEvent.pointerId)) clip.releasePointerCapture(upEvent.pointerId);
      project!.modifiedAt = new Date().toISOString();
      extendDurationToContent();
      if (layer && dropTrackId) {
        if (moveClipToTrack(project!, layer.id, dropTrackId, overlapMode)) syncLinkedAudioOrder();
        else setStatus(language === "pt-BR" ? "FAIXA OCUPADA NESSE TRECHO" : "TRACK IS OCCUPIED AT THAT TIME");
      }
      app.querySelectorAll(".timeline-track.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
      afterClipEdit();
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
    const track = project.audioTracks.find((item) => item.id === handle.dataset.trimAudio);
    if (!track) return;
    selectAudioTrackById(track.id, false);
    snapshot();
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
      if (edge === "start") {
        const next = clamp(time, 0, initialEnd - minLength);
        const delta = next - initialStart;
        track.startTime = next;
        track.sourceIn = clamp(initialSourceIn + delta * speed, 0, initialSourceOut - .001);
      } else {
        track.endTime = clamp(time, initialStart + minLength, project!.settings.duration);
        track.loop = track.endTime - track.startTime > (initialSourceOut - track.sourceIn) / speed + minLength / 2;
      }
      normalizeFades(track);
      if (track.linked && track.linkedLayerId) {
        syncLinkedLayer(track);
        const owner = project!.layers.find((item) => item.id === track.linkedLayerId);
        if (owner) {
          updateTimelineClipStyles(owner.id, owner.startTime, owner.endTime);
          renderer?.setPlaybackState(playing, currentTime);
          void renderFrame();
        }
      }
      updateTimelineClipStyles(track.id, track.startTime, track.endTime, true);
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      project!.modifiedAt = new Date().toISOString();
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
    const item = layerItem || audioItem;
    const clip = handle.closest<HTMLElement>(".clip-range");
    if (!item || !clip) return;
    if (layerItem) selectLayerById(layerItem.id, false);
    else if (audioItem) selectAudioTrackById(audioItem.id, false);
    snapshot();
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const time = snapTimelineTime(
        timelineTimeFromPointer(moveEvent, scrubArea),
        scrubArea,
        layerItem?.id || "",
        audioItem?.id || "",
        moveEvent.altKey,
      );
      setFadeHandle(item, property.startsWith("fadeIn") ? "in" : "out", time);
      updateFadeClipVisuals(clip, item);
      if (layerItem?.kind === "video") syncLinkedAudio(layerItem);
      if (audioItem?.linked && audioItem.linkedLayerId) {
        const owner = project!.layers.find((layer) => layer.id === audioItem.linkedLayerId);
        if (owner) {
          owner.fadeInStart = audioItem.fadeInStart;
          owner.fadeInEnd = audioItem.fadeInEnd;
          owner.fadeOutStart = audioItem.fadeOutStart;
          owner.fadeOutEnd = audioItem.fadeOutEnd;
        }
      }
      const inspectorInput = app.querySelector<HTMLInputElement>(scope === "layer" ? `[data-layer-property="${property}"]` : `[data-audio-property="${property}"]`);
      if (inspectorInput) {
        inspectorInput.value = String(Number(item[property].toFixed(4)));
        updateParamScrub(inspectorInput);
      }
      project!.modifiedAt = new Date().toISOString();
      void renderFrame();
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      updateInspector();
      updateTimeline();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }));
  let scrubbing = false;
  const scrubToPointer = (event: PointerEvent) => {
    if (!project) return;
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
      const list = draggedType === "layer" ? project.layers : project.audioTracks;
      const source = list.findIndex((entry) => entry.id === draggedId);
      const target = list.findIndex((entry) => entry.id === targetId);
      if (source < 0 || target < 0) return;
      snapshot();
      if (draggedType === "layer") {
        // Arrastar a linha move a faixa inteira para antes/depois da faixa alvo.
        placeTrack(project, trackIdOf(project.layers[source]), trackIdOf(project.layers[target]), source < target);
        syncLinkedAudioOrder();
      } else {
        const [moved] = list.splice(source, 1);
        list.splice(target, 0, moved as never);
      }
      project.modifiedAt = new Date().toISOString();
      updateLayerStack();
      updateTimeline();
      void renderFrame();
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
    const keyframe = keyframeFromRef();
    if (!keyframe) return;
    snapshot();
    keyframe.easing = (event.target as HTMLSelectElement).value as Easing;
    if (keyframe.easing === "bezier") keyframe.curve ??= .75;
    updateCurveTools();
    updateInspector();
    void renderFrame();
  });
  app.querySelector<HTMLInputElement>("#timeline-bezier-strength")?.addEventListener("input", (event) => {
    const keyframe = keyframeFromRef();
    if (!keyframe) return;
    keyframe.curve = Number((event.target as HTMLInputElement).value);
    project!.modifiedAt = new Date().toISOString();
    void renderFrame();
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
      snapshot();
      const dragged = project.layers.find((layer) => layer.id === draggedLayer);
      const targetLayer = project.layers.find((layer) => layer.id === item.dataset.layerId);
      const rect = item.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      if (dragged && targetLayer) placeTrack(project, trackIdOf(dragged), trackIdOf(targetLayer), after);
      syncLinkedAudioOrder();
      project.modifiedAt = new Date().toISOString();
      renderEditorPreservingCanvas();
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
      snapshot();
      const source = list.findIndex((effect) => effect.id === draggedEffect);
      const rect = item.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      const [moved] = list.splice(source, 1);
      const target = list.findIndex((effect) => effect.id === targetId);
      list.splice(target + (after ? 1 : 0), 0, moved);
      project.modifiedAt = new Date().toISOString();
      renderEditorPreservingCanvas();
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
    snapshot();
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const nextPointer = point(moveEvent);
      if (operation === "rotate") {
        const angle = Math.atan2(nextPointer.y - origin.y, nextPointer.x - origin.x);
        let rotation = origin.rotation + (angle - originAngle) * 180 / Math.PI;
        const angleSnap = Math.round(rotation / 15) * 15;
        if ((canvasSnap || moveEvent.shiftKey) && Math.abs(rotation - angleSnap) <= 3) rotation = angleSnap;
        createdKeyframe = setLayerNumericValue(layer, "rotation", rotation) || createdKeyframe;
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
        createdKeyframe = setLayerNumericValue(layer, "width", nextWidth) || createdKeyframe;
        createdKeyframe = setLayerNumericValue(layer, "height", nextHeight) || createdKeyframe;
        createdKeyframe = setLayerNumericValue(layer, "x", nextX) || createdKeyframe;
        createdKeyframe = setLayerNumericValue(layer, "y", nextY) || createdKeyframe;
      }
      project!.modifiedAt = new Date().toISOString();
      syncInspectorValues();
      void renderFrame();
    };
    const stop = (upEvent: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
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
    snapshot();
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
    createdKeyframe = setLayerNumericValue(layer, "x", snapped.x) || createdKeyframe;
    createdKeyframe = setLayerNumericValue(layer, "y", snapped.y) || createdKeyframe;
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
    project!.modifiedAt = new Date().toISOString();
    syncInspectorValues();
    void renderFrame();
  });
  const stopDragging = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("is-dragging");
    app.querySelectorAll(".canvas-snap-guide").forEach((guide) => guide.classList.remove("is-visible"));
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    updateInspector();
    if (createdKeyframe) requestTimelineRefresh();
  };
  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);
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
  updateLiveUi();
  updatePreviewQualityState();
  setStatus("READY · PREVIEW FULL");
  void renderFrame();
}

function finalizeRecordedAutomation() {
  if (!project || !recordedTracks.size) return;
  const discrete = new Set(["mode", "count", "segments", "direction", "invert", "colorize", "blocks", "fontWeight"]);
  for (const token of recordedTracks) {
    const [scope, id, property] = token.split(":");
    const keys = scope === "layer"
      ? project.layers.find((layer) => layer.id === id)?.keyframes[property]
      : scope === "effect"
        ? findEffect(id)?.keyframes[property]
        : project.layers.find((layer) => layer.id === id)?.keyframes[property];
    if (!keys?.length) continue;
    keys.sort((a, b) => a.time - b.time);
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
  }
  recordedTracks.clear();
  recordedRanges.clear();
  project.modifiedAt = new Date().toISOString();
  requestTimelineRefresh();
  updateInspector();
  void renderFrame();
}

function togglePlayback() {
  if (!project) return;
  if (playing) {
    stopPlayback();
    return;
  }
  playing = true;
  if (currentTime >= project.settings.duration) setTime(0, false);
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
  if (next >= project.settings.duration) {
    if (timelineLoop) {
      const wrapped = next % project.settings.duration;
      playbackStarted = now;
      playbackOffset = wrapped;
      lastPlaybackFrame = -1;
      renderer?.setPlaybackState(true, wrapped);
      void audioEngine.play(project, wrapped);
      setTime(wrapped, false);
      requestAnimationFrame((time) => playbackLoop(time, generation));
      return;
    }
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
  }
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
          <fieldset class="resize-mode">
            <legend>${language === "pt-BR" ? "COMO TRATAR AS CAMADAS EXISTENTES" : "HOW TO HANDLE EXISTING LAYERS"}</legend>
            <label><input type="radio" name="resize-mode" value="adapt" checked><span><strong>${language === "pt-BR" ? "ADAPTAR PROPORCIONALMENTE" : "ADAPT PROPORTIONALLY"}</strong><small>${language === "pt-BR" ? "Redimensiona e centraliza as camadas sem deformação." : "Resizes and centers layers without distortion."}</small></span></label>
            <label><input type="radio" name="resize-mode" value="keep"><span><strong>${language === "pt-BR" ? "CENTRALIZAR SEM ESCALAR" : "CENTER WITHOUT SCALING"}</strong><small>${language === "pt-BR" ? "Mantém os tamanhos e desloca tudo a partir do centro do canvas." : "Keeps layer sizes and offsets everything from the canvas center."}</small></span></label>
          </fieldset>
          <p class="composition-warning" id="composition-warning"></p>
        </div>
        <footer><button id="cancel-composition">${t("cancel")}</button><button class="primary-button" id="apply-composition">${language === "pt-BR" ? "APLICAR TAMANHO" : "APPLY SIZE"} →</button></footer>
      </section>
    </div>`;
  const preset = root.querySelector<HTMLSelectElement>("#composition-preset")!;
  const width = root.querySelector<HTMLInputElement>("#composition-width")!;
  const height = root.querySelector<HTMLInputElement>("#composition-height")!;
  preset.addEventListener("change", () => applyPresetToInputs(preset, width, height));
  [width, height].forEach((input) => input.addEventListener("input", () => {
    if (preset.value !== `${width.value},${height.value}`) preset.value = "custom";
  }));
  root.querySelector("#close-composition")?.addEventListener("click", closeCompositionModal);
  root.querySelector("#cancel-composition")?.addEventListener("click", closeCompositionModal);
  root.querySelector("#apply-composition")?.addEventListener("click", applyCompositionResize);
}

function closeCompositionModal() {
  const root = app.querySelector("#modal-root");
  if (root) root.innerHTML = "";
}

function remapLayerForComposition(layer: Layer, oldWidth: number, oldHeight: number, newWidth: number, newHeight: number) {
  const scale = Math.min(newWidth / oldWidth, newHeight / oldHeight);
  const mapX = (value: number) => (value - oldWidth / 2) * scale + newWidth / 2;
  const mapY = (value: number) => (value - oldHeight / 2) * scale + newHeight / 2;
  layer.x = mapX(layer.x);
  layer.y = mapY(layer.y);
  layer.width *= scale;
  layer.height *= scale;
  if (layer.fontSize) layer.fontSize *= scale;
  layer.strokeWidth *= scale;
  for (const keyframe of layer.keyframes.x || []) keyframe.value = mapX(keyframe.value);
  for (const keyframe of layer.keyframes.y || []) keyframe.value = mapY(keyframe.value);
  for (const property of ["width", "height", "fontSize", "strokeWidth"]) {
    for (const keyframe of layer.keyframes[property] || []) keyframe.value *= scale;
  }
}

function recenterLayerForComposition(layer: Layer, oldWidth: number, oldHeight: number, newWidth: number, newHeight: number) {
  const shiftX = (newWidth - oldWidth) / 2;
  const shiftY = (newHeight - oldHeight) / 2;
  layer.x += shiftX;
  layer.y += shiftY;
  for (const keyframe of layer.keyframes.x || []) keyframe.value += shiftX;
  for (const keyframe of layer.keyframes.y || []) keyframe.value += shiftY;
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
  const oldWidth = project.settings.width;
  const oldHeight = project.settings.height;
  if (width === oldWidth && height === oldHeight && background === project.settings.background && transparent === project.settings.transparent) {
    closeCompositionModal();
    return;
  }
  const mode = app.querySelector<HTMLInputElement>('input[name="resize-mode"]:checked')?.value || "adapt";
  stopPlayback();
  snapshot();
  if (width !== oldWidth || height !== oldHeight) {
    for (const layer of project.layers) {
      if (mode === "adapt") remapLayerForComposition(layer, oldWidth, oldHeight, width, height);
      else recenterLayerForComposition(layer, oldWidth, oldHeight, width, height);
    }
  }
  project.settings.width = width;
  project.settings.height = height;
  project.settings.background = background;
  project.settings.transparent = transparent;
  project.modifiedAt = new Date().toISOString();
  closeCompositionModal();
  renderEditorPreservingCanvas();
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
        <div class="export-summary">${Math.ceil(project.settings.duration * project.settings.fps)} FRAMES · ${formatTime(project.settings.duration)}</div>
        <div class="export-log" id="export-log"><span class="status-dot is-ready"></span><span>READY</span></div>
        <div class="progress-track"><span id="export-progress"></span></div>
        <footer><button id="cancel-export">${t("cancel")}</button><button class="primary-button" id="start-export">${t("startExport")} →</button></footer>
      </section>
    </div>`;
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
  const total = Math.ceil(project.settings.duration * fps);
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
    const mixedAudio = format === "mp4-h264" ? await mixProjectAudio(project) : null;
    activeExporter = format === "png-sequence"
      ? new PngSequenceBrowserExporter(exportCanvas, options)
      : new Mp4BrowserExporter(exportCanvas, options, mixedAudio);
    exportSessionId = "browser-export";
    await activeExporter.start();
    for (let frame = 0; frame < total; frame++) {
      if (exportCancelled) throw new Error(language === "pt-BR" ? "Exportação cancelada" : "Export cancelled");
      currentTime = frame / fps;
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  }
  // Corte no playhead: S (sem modificador) ou Ctrl/⌘+B, fora de campos de texto.
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement || (event.target as HTMLElement | null)?.isContentEditable;
  if (project && !typing && ((event.key.toLowerCase() === "s" && !event.ctrlKey && !event.metaKey && !event.altKey)
    || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b"))) {
    event.preventDefault();
    splitAtPlayhead();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && project) {
    event.preventDefault();
    duplicateLayer();
  }
  if (event.code === "Space" && project && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
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
    snapshot();
    const amount = event.shiftKey ? 10 : 1;
    const x = renderer?.layerValue(layer, "x", currentTime) ?? layer.x;
    const y = renderer?.layerValue(layer, "y", currentTime) ?? layer.y;
    let createdKeyframe = false;
    if (event.key === "ArrowLeft") createdKeyframe = setLayerNumericValue(layer, "x", x - amount);
    if (event.key === "ArrowRight") createdKeyframe = setLayerNumericValue(layer, "x", x + amount);
    if (event.key === "ArrowUp") createdKeyframe = setLayerNumericValue(layer, "y", y - amount);
    if (event.key === "ArrowDown") createdKeyframe = setLayerNumericValue(layer, "y", y + amount);
    updateInspector();
    if (createdKeyframe) requestTimelineRefresh();
    void renderFrame();
  }
});

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
    if (!project || !renderer) throw new Error("Nenhum projeto está aberto.");
    if (time !== undefined) {
      stopPlayback();
      setTime(clamp(time, 0, project.settings.duration), false);
    }
    await renderFrame();
    const canvas = app.querySelector<HTMLCanvasElement>("#composition-canvas");
    if (!canvas) throw new Error("Preview indisponível.");
    const scale = Math.min(1, maxWidth / canvas.width);
    const frame = document.createElement("canvas");
    frame.width = Math.max(1, Math.round(canvas.width * scale));
    frame.height = Math.max(1, Math.round(canvas.height * scale));
    const context = frame.getContext("2d")!;
    context.fillStyle = project.settings.transparent ? "#000000" : project.settings.background;
    context.fillRect(0, 0, frame.width, frame.height);
    context.drawImage(canvas, 0, 0, frame.width, frame.height);
    return { time: currentTime, width: frame.width, height: frame.height, dataUrl: frame.toDataURL("image/jpeg", .8) };
  },
  commitProject: (next, label) => {
    if (!project) throw new Error("Nenhum projeto está aberto.");
    if (exportInProgress) throw new Error('Aguarde a exportação antes de editar.');
    stopPlayback();
    snapshot();
    const structureChanged = project.layers.map(layer => layer.id).join('|') !== next.layers.map(layer => layer.id).join('|')
      || project.audioTracks.map(track => track.id).join('|') !== next.audioTracks.map(track => track.id).join('|');
    Object.assign(project, next);
    selectedClipIds.clear();
    if (!project.layers.some(layer => layer.id === selectedLayerId)) selectedLayerId = project.layers[0]?.id || '';
    if (!project.audioTracks.some(track => track.id === selectedAudioTrackId)) selectedAudioTrackId = '';
    markProjectModified(project);
    if (structureChanged) renderEditorPreservingCanvas();
    else updatePanels();
    updateTransformBox();
    const serialized = JSON.stringify(project);
    app.querySelector<HTMLButtonElement>("#undo")?.toggleAttribute("disabled", !history.canUndo(serialized));
    app.querySelector<HTMLButtonElement>("#redo")?.toggleAttribute("disabled", !history.canRedo(serialized));
    setStatus(`VCT · ${label}`);
    void renderFrame();
  },
});
installAgentAutomation(automationApi, () => language);
Object.defineProperty(window, "vct", { value: automationApi, configurable: true, enumerable: false });

renderLanguage();
void document.fonts.ready.then(() => void renderFrame());
window.setTimeout(() => document.querySelector("#boot-splash")?.classList.add("is-hidden"), 850);

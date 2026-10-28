// Diálogo da legenda automática: escolhas, aviso de download, progresso e revisão do
// SRT. Carregado sob demanda (import dinâmico no editor). Estado visível ao agente
// fica em transcribe-state.ts.
import { decodeAssetTo16kMono, mixProjectAudio } from "../audio/audio-engine";
import type { VctCommand } from "../model/commands";
import { listAssets } from "../model/media-assets";
import type { Language, ProjectDocument } from "../model/types";
import { escapeHtml } from "../ui/escape-html";
import { WHISPER_RATE, mixToMono } from "./audio-prep";
import {
  LONG_MEDIA_SECONDS, defaultWordTimestamps, doneAudioSeconds, estimateRemainingSeconds, estimateTranscribeSeconds, etaMinutes,
  blockSecondsOf, findSpeechRanges, formatClock, mergeBlockSegments, blockOverlap, parseClock, planBlocks, planSeconds, transcribeTuning, type AudioBlock,
} from "./blocks";
import { buildCues, cuesToSrt, offsetSegments, type TimedSegment } from "./cues";
import { getTranscribeEngine } from "./engine";
import { classifyError } from "./errors";
import { detectProfile } from "./gpu";
import { mediaPlacementCommands } from "./insert-media";
import {
  TRANSCRIBE_LANGUAGES, WHISPER_SIZES, formatMegabytes, isTranscribeLanguage, isWhisperSize, whisperModel,
  type ModelProfile, type ModelSource, type TranscribeLanguage, type WhisperSize,
} from "./model-catalog";
import type { ImportReport, TranscribeProgress } from "./protocol";
import { DEFAULT_SUBTITLE_STYLE, SUBTITLE_SIZE_RATIO, subtitleMaxChars, subtitleStyleProps, type SubtitlePosition, type SubtitleSize } from "./subtitle-style";
import { BUSY_PHASES, countCues, registerTranscribeCanceller, transcribeStore } from "./transcribe-state";

/** Mídia do clipe selecionado, vista pelo editor: qual arquivo, que trecho dele e onde cai na timeline. */
export interface ClipSource {
  asset: string;
  label: string;
  /** Início e duração (s) dentro do arquivo. */
  from: number;
  length?: number;
  /** Onde o início do trecho cai na timeline (s). */
  offset: number;
  /** Segundos de timeline por segundo do arquivo (1 / velocidade do clipe). */
  scale: number;
}

export interface TranscribeHost {
  language(): Language;
  project(): ProjectDocument | null;
  selectedSource(): ClipSource | null;
  /**
   * Aplica o SRT na timeline como um passo de desfazer; devolve quantas legendas entraram (0 se recusado).
   * props: tamanho, posição e sombra escolhidos no diálogo (vão em text.fromSrt).
   * before: comandos que entram no MESMO lote, antes do text.fromSrt (a mídia transcrita, se ela ainda não
   * está na timeline; ver insert-media.ts). Eles não contam no número devolvido.
   */
  insertSrt(srt: string, props?: Record<string, unknown>, before?: readonly VctCommand[]): number;
  say(message: string): void;
}

/** source: "mix", "clip" (clipe selecionado) ou "asset:<caminho>". */
export interface TranscribeChoices {
  source?: string;
  language?: TranscribeLanguage;
  model?: WhisperSize;
  /** Trecho a transcrever, em segundos da mixagem ou do arquivo; end vazio = até o fim. */
  range?: { start: number; end?: number };
  /** Tempos por palavra; sem isto, só para mídia curta. */
  words?: boolean;
}

interface Resolved {
  key: string;
  label: string;
  asset?: string;
  from: number;
  length?: number;
  offset: number;
  scale: number;
  /** Trecho escolhido dentro da fonte (segundos da mixagem ou do arquivo). */
  range?: { start: number; end: number };
}

/** Plano e resultado até agora: sobrevive a um travamento para a pessoa retomar do bloco seguinte. */
interface Job {
  choice: Resolved;
  audio: Float32Array;
  blocks: AudioBlock[];
  segments: TimedSegment[];
  /** Posição, no plano, do próximo bloco a fazer. */
  next: number;
  source: ModelSource;
  words: boolean;
}

type RangeMode = "all" | "area" | "range";

const PREFS_KEY = "nt-vct-transcribe";

function loadPrefs(): { language?: TranscribeLanguage; model?: WhisperSize } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { language: isTranscribeLanguage(raw.language) ? raw.language : undefined, model: isWhisperSize(raw.model) ? raw.model : undefined };
  } catch {
    return {};
  }
}

function savePrefs(language: TranscribeLanguage, model: WhisperSize) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ language, model })); } catch { /* storage unavailable */ }
}

/** Escolhe arquivos ou uma pasta inteira (webkitdirectory). */
function pickFiles(directory: boolean) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (directory) input.setAttribute("webkitdirectory", "");
    input.addEventListener("change", () => resolve(Array.from(input.files || [])), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}

let current: { close(): void } | null = null;

/** Abre o diálogo para a pessoa (botão da aba Mídia). */
export function openTranscribeDialog(host: TranscribeHost, choices: TranscribeChoices = {}) {
  void createDialog(host, choices).begin(false);
}

/**
 * Pedido do agente: devolve na hora. Com o modelo disponível a transcrição começa; sem ele a
 * pessoa vê o aviso de download e decide. O resultado vai para transcribeStore.
 */
export async function startAgentTranscription(host: TranscribeHost, choices: TranscribeChoices) {
  return createDialog(host, choices).begin(true);
}

function createDialog(host: TranscribeHost, choices: TranscribeChoices) {
  current?.close();
  const language = host.language();
  const pt = language === "pt-BR";
  const t = (portuguese: string, english: string) => (pt ? portuguese : english);
  const engine = getTranscribeEngine();
  const prefs = loadPrefs();
  const project = host.project()!;
  const opener = document.activeElement as HTMLElement | null;

  // Escolhas atuais (os selects as espelham).
  let sourceKey = choices.source ?? (host.selectedSource() ? "clip" : "mix");
  let spoken: TranscribeLanguage = choices.language ?? prefs.language ?? (pt ? "pt" : "en");
  let modelSize: WhisperSize = choices.model ?? prefs.model ?? "base";
  let availability: ModelSource | null = null;
  let manualOpen = false;
  let manualMessage = "";
  let step: "setup" | "progress" | "review" | "error" = "setup";
  let errorMessage = "";
  let controller: AbortController | null = null;
  let timer = 0;
  let watchTimer = 0;
  let closed = false;
  // Trecho e tempos por palavra escolhidos no diálogo (words null = decidir pela duração).
  let rangeMode: RangeMode = choices.range ? "range" : "all";
  let rangeStartText = choices.range ? String(choices.range.start) : "";
  let rangeEndText = choices.range?.end !== undefined ? String(choices.range.end) : "";
  let words: boolean | null = choices.words ?? null;
  // Perfil do modelo para este dispositivo (decide os arquivos, o tamanho do download e a estimativa de tempo).
  let profile: ModelProfile = "wasm";
  const modelOf = (size: WhisperSize = modelSize) => whisperModel(size, profile);
  const isGpu = () => profile !== "wasm";
  // Trabalho em andamento e controle de cada tentativa (retomar abre uma nova).
  let job: Job | null = null;
  let attempt = 0;
  let liveFraction = 0;
  // Estilo das legendas ao inserir (a sombra vem ligada).
  let subtitleStyle = { ...DEFAULT_SUBTITLE_STYLE };

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop transcribe-backdrop";
  backdrop.innerHTML = `<section class="export-modal transcribe-modal" role="dialog" aria-modal="true" aria-labelledby="transcribe-title">
    <header><div><span class="micro">${t("LEGENDA AUTOMÁTICA", "AUTO SUBTITLES")}</span><h2 id="transcribe-title"></h2></div>
      <button type="button" data-transcribe-close aria-label="${t("Fechar", "Close")}">×</button></header>
    <div class="transcribe-body" aria-live="polite"></div>
    <footer></footer>
  </section>`;
  const dialog = backdrop.querySelector<HTMLElement>(".transcribe-modal")!;
  const title = backdrop.querySelector<HTMLElement>("#transcribe-title")!;
  const body = backdrop.querySelector<HTMLElement>(".transcribe-body")!;
  const footer = backdrop.querySelector<HTMLElement>("footer")!;
  document.body.append(backdrop);

  const assetName = (key: string) => {
    const asset = key.slice("asset:".length);
    return listAssets(project).find((entry) => entry.id === asset)?.name ?? asset;
  };

  function sources(): Array<{ key: string; label: string }> {
    const list: Array<{ key: string; label: string }> = [];
    const clip = host.selectedSource();
    if (clip) list.push({ key: "clip", label: `${t("Clipe selecionado", "Selected clip")}: ${clip.label}` });
    list.push({ key: "mix", label: t("Mixagem da timeline", "Timeline mix") });
    for (const entry of listAssets(project)) {
      if (entry.kind === "audio" || (entry.kind === "video" && entry.hasAudio !== false)) list.push({ key: `asset:${entry.id}`, label: `${t("Mídia", "Media")}: ${entry.name}` });
    }
    if (sourceKey.startsWith("asset:") && !list.some((item) => item.key === sourceKey)) list.push({ key: sourceKey, label: `${t("Mídia", "Media")}: ${assetName(sourceKey)}` });
    return list;
  }

  function isClip() { return sourceKey === "clip" && Boolean(host.selectedSource()); }

  /** Duração total da fonte escolhida (s); 0 se não se sabe. */
  function sourceSeconds() {
    if (isClip()) {
      const clip = host.selectedSource()!;
      const known = listAssets(project).find((entry) => entry.id === clip.asset)?.duration ?? 0;
      return Math.max(0, clip.length !== undefined && Number.isFinite(clip.length) ? clip.length : known - clip.from);
    }
    if (sourceKey.startsWith("asset:")) return listAssets(project).find((entry) => entry.id === sourceKey.slice(6))?.duration ?? 0;
    return project.settings.duration;
  }

  /** O trecho escolhido ou null para tudo; texto de erro (não vazio) se os campos não servem. */
  function chosenRange(): { range: { start: number; end: number } | null; error: string } {
    const total = sourceSeconds();
    if (isClip() || rangeMode === "all") return { range: null, error: "" };
    if (rangeMode === "area") {
      const area = project.settings.workArea;
      if (!area || sourceKey.startsWith("asset:")) return { range: null, error: "" };
      return { range: { start: area.in, end: area.out }, error: "" };
    }
    const start = rangeStartText.trim() ? parseClock(rangeStartText) : 0;
    const end = rangeEndText.trim() ? parseClock(rangeEndText) : total;
    if (start === null || end === null) return { range: null, error: t("Use tempos como 90, 1:30 ou 1:02:03.", "Use times like 90, 1:30 or 1:02:03.") };
    const last = total > 0 ? Math.min(end, total) : end;
    if (!(last > start)) return { range: null, error: t("O fim precisa vir depois do início (e dentro da mídia).", "The end must come after the start (and inside the media).") };
    return { range: { start, end: last }, error: "" };
  }

  /** Segundos de áudio que a transcrição vai cobrir com as escolhas atuais. */
  function effectiveSeconds() {
    const { range } = chosenRange();
    return range ? range.end - range.start : sourceSeconds();
  }

  function resolveSource(): Resolved {
    if (sourceKey === "clip") {
      const clip = host.selectedSource();
      if (clip) return { key: sourceKey, label: clip.label, asset: clip.asset, from: clip.from, length: clip.length, offset: clip.offset, scale: clip.scale };
    }
    const { range } = chosenRange();
    if (sourceKey.startsWith("asset:")) {
      const from = range?.start ?? 0;
      return { key: sourceKey, label: assetName(sourceKey), asset: sourceKey.slice(6), from, length: range ? range.end - range.start : undefined, offset: from, scale: 1, range: range ?? undefined };
    }
    return { key: "mix", label: t("Mixagem da timeline", "Timeline mix"), from: 0, offset: range?.start ?? 0, scale: 1, range: range ?? undefined };
  }

  const mb = (bytes: number) => (bytes / 1e6).toFixed(1).replace(".", pt ? "," : ".");

  function focusFirst() {
    const target = dialog.querySelector<HTMLElement>("[data-transcribe-go]:not([disabled]), select, textarea") ?? dialog.querySelector<HTMLElement>("button");
    target?.focus();
  }

  // ---- Passos.

  function renderSetup() {
    step = "setup";
    title.textContent = t("Legendar automaticamente", "Subtitle automatically");
    const model = modelOf();
    const options = (items: Array<{ key: string; label: string }>, selected: string) =>
      items.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
    const languageLabel: Record<TranscribeLanguage, string> = { pt: "Português", en: "English", es: "Español", auto: t("Detectar automaticamente", "Detect automatically") };
    body.innerHTML = `<div class="transcribe-fields">
      <label class="select-field"><span>${t("Áudio", "Audio")}</span><select data-transcribe-source>${options(sources(), sourceKey)}</select></label>
      <label class="select-field"><span>${t("Idioma da fala", "Spoken language")}</span><select data-transcribe-language>${options(TRANSCRIBE_LANGUAGES.map((key) => ({ key, label: languageLabel[key] })), spoken)}</select></label>
      <label class="select-field"><span>${t("Modelo", "Model")}</span><select data-transcribe-model>${options(WHISPER_SIZES.map((size) => ({ key: size, label: `${modelOf(size).label[pt ? 0 : 1]} · Whisper ${size} · ${formatMegabytes(modelOf(size).bytes)}` })), modelSize)}</select></label>
      <div class="transcribe-range" data-transcribe-range-box>
        <label class="select-field"><span>${t("Trecho", "Range")}</span><select data-transcribe-range></select></label>
        <div class="transcribe-range-inputs" data-transcribe-range-inputs>
          <label class="select-field"><span>${t("Início", "Start")}</span><input type="text" inputmode="decimal" autocomplete="off" placeholder="0:00" data-transcribe-start value="${escapeHtml(rangeStartText)}"></label>
          <label class="select-field"><span>${t("Fim", "End")}</span><input type="text" inputmode="decimal" autocomplete="off" placeholder="${escapeHtml(formatClock(sourceSeconds()))}" data-transcribe-end value="${escapeHtml(rangeEndText)}"></label>
        </div>
      </div>
      <label class="transcribe-check"><input type="checkbox" data-transcribe-words><span>${t("Tempo por palavra (mais lento; legendas mais precisas)", "Word timestamps (slower; more precise cues)")}</span></label>
    </div>
    <p class="transcribe-range-error" role="alert" data-transcribe-range-error hidden></p>
    <div class="transcribe-note transcribe-long" data-transcribe-long hidden></div>
    <div class="transcribe-note" data-transcribe-note></div>
    <div class="transcribe-manual" data-transcribe-manual-panel ${manualOpen ? "" : "hidden"}>
      <p>${t(`Escolha os arquivos do modelo Whisper ${modelSize} (${model.id}) para ${isGpu() ? "placa de vídeo (WebGPU)" : "processador (WebAssembly)"}, baixados antes em huggingface.co, ou a pasta inteira (só os arquivos abaixo são usados). Eles ficam guardados neste navegador e o modelo carrega sem internet.`,
        `Pick the Whisper ${modelSize} model files (${model.id}) for the ${isGpu() ? "graphics card (WebGPU)" : "processor (WebAssembly)"}, downloaded earlier from huggingface.co, or the whole folder (only the files below are used). They are stored in this browser and the model loads offline.`)}</p>
      <ul>${model.files.map((file) => `<li><code>${escapeHtml(file.path)}</code> <small>${mb(file.bytes)} MB</small></li>`).join("")}</ul>
      <div class="transcribe-manual-buttons">
        <button type="button" data-transcribe-pick="files">${t("Escolher arquivos…", "Choose files…")}</button>
        <button type="button" data-transcribe-pick="folder">${t("Escolher pasta…", "Choose folder…")}</button>
      </div>
      <p class="transcribe-manual-result" role="status">${escapeHtml(manualMessage)}</p>
    </div>`;
    renderNote();
    renderSetupFooter();
    refreshLong();
    body.querySelector("[data-transcribe-source]")!.addEventListener("change", (event) => {
      sourceKey = (event.target as HTMLSelectElement).value;
      refreshLong();
    });
    body.querySelector("[data-transcribe-range]")!.addEventListener("change", (event) => { rangeMode = (event.target as HTMLSelectElement).value as RangeMode; refreshLong(); });
    body.querySelector("[data-transcribe-start]")!.addEventListener("input", (event) => { rangeStartText = (event.target as HTMLInputElement).value; refreshLong(); });
    body.querySelector("[data-transcribe-end]")!.addEventListener("input", (event) => { rangeEndText = (event.target as HTMLInputElement).value; refreshLong(); });
    body.querySelector("[data-transcribe-words]")!.addEventListener("change", (event) => { words = (event.target as HTMLInputElement).checked; });
    body.querySelector("[data-transcribe-language]")!.addEventListener("change", (event) => { spoken = (event.target as HTMLSelectElement).value as TranscribeLanguage; });
    body.querySelector("[data-transcribe-model]")!.addEventListener("change", (event) => {
      modelSize = (event.target as HTMLSelectElement).value as WhisperSize;
      manualMessage = "";
      renderSetup();
      void refreshAvailability();
    });
    body.querySelectorAll<HTMLElement>("[data-transcribe-pick]").forEach((button) => button.addEventListener("click", () => void importFiles(button.dataset.transcribePick === "folder")));
  }

  /** Campos de trecho e aviso de mídia longa: atualizados sem refazer o diálogo. */
  function refreshLong() {
    const clip = isClip();
    const total = sourceSeconds();
    const area = project.settings.workArea;
    const showArea = Boolean(area) && sourceKey === "mix";
    if (rangeMode === "area" && !showArea) rangeMode = "all";
    const rangeBox = body.querySelector<HTMLElement>("[data-transcribe-range-box]");
    const select = body.querySelector<HTMLSelectElement>("[data-transcribe-range]");
    if (!rangeBox || !select) return;
    rangeBox.hidden = clip;
    const entries: Array<[RangeMode, string]> = [["all", `${t("Tudo", "Everything")}${total ? ` (${formatClock(total)})` : ""}`]];
    if (showArea && area) entries.push(["area", `${t("Região de trabalho", "Work area")} (${formatClock(area.in)}–${formatClock(area.out)})`]);
    entries.push(["range", t("Intervalo (início e fim)", "Range (start and end)")]);
    select.innerHTML = entries.map(([key, label]) => `<option value="${key}" ${key === rangeMode ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    body.querySelector<HTMLElement>("[data-transcribe-range-inputs]")!.hidden = clip || rangeMode !== "range";
    const { error } = chosenRange();
    const errorLine = body.querySelector<HTMLElement>("[data-transcribe-range-error]")!;
    errorLine.hidden = !(rangeMode === "range" && error);
    errorLine.textContent = error;
    const seconds = effectiveSeconds();
    const box = body.querySelector<HTMLInputElement>("[data-transcribe-words]");
    if (box) box.checked = words ?? defaultWordTimestamps(seconds);
    const long = body.querySelector<HTMLElement>("[data-transcribe-long]")!;
    long.hidden = !(seconds > LONG_MEDIA_SECONDS);
    if (long.hidden) return;
    const minutes = etaMinutes(estimateTranscribeSeconds(seconds, modelSize, isGpu(), false));
    const noGpu = !isGpu();
    const suggestFast = noGpu && modelSize !== "base";
    long.innerHTML = `<strong>${t(`Mídia longa: ${formatClock(seconds)}`, `Long media: ${formatClock(seconds)}`)}</strong>
      <p>${t(`Vai demorar ~${minutes} min nesta máquina${noGpu ? " (sem WebGPU, o processamento é mais lento)" : ""}. Silêncios longos são pulados.`,
        `This will take ~${minutes} min on this machine${noGpu ? " (no WebGPU, processing is slower)" : ""}. Long silences are skipped.`)}
        ${t("Para ir mais rápido, transcreva só o necessário:", "To go faster, transcribe only what you need:")}</p>
      <div class="transcribe-manual-buttons">
        ${!clip && host.selectedSource() ? `<button type="button" data-transcribe-use-clip>${t("Só o clipe selecionado", "Only the selected clip")}</button>` : ""}
        ${suggestFast ? `<button type="button" data-transcribe-use-fast>${t("Usar o modelo Rápido", "Use the fast model")}</button>` : ""}
      </div>`;
    long.querySelector("[data-transcribe-use-clip]")?.addEventListener("click", () => { sourceKey = "clip"; renderSetup(); void refreshAvailability(); });
    long.querySelector("[data-transcribe-use-fast]")?.addEventListener("click", () => { modelSize = "base"; manualMessage = ""; renderSetup(); void refreshAvailability(); });
  }

  function renderNote() {
    const note = body.querySelector<HTMLElement>("[data-transcribe-note]");
    if (!note) return;
    const model = modelOf();
    note.className = `transcribe-note${availability === "download" ? " is-warning" : ""}`;
    if (availability === null) note.textContent = t("Verificando o modelo…", "Checking the model…");
    else if (availability === "cache") note.textContent = t("O modelo já está guardado neste navegador. Nada será baixado.", "The model is already stored in this browser. Nothing will be downloaded.");
    else if (availability === "server") note.textContent = t("O modelo vem da pasta models/ deste servidor. Nada é baixado da internet.", "The model comes from this server's models/ folder. Nothing is downloaded from the internet.");
    else {
      note.innerHTML = `<strong>${t("Primeiro uso: é preciso baixar o modelo", "First use: the model must be downloaded")}</strong>
        <dl><dt>${t("Modelo", "Model")}</dt><dd>Whisper ${modelSize} · ${model.label[pt ? 0 : 1]}</dd>
        <dt>${t("Tamanho", "Size")}</dt><dd>${formatMegabytes(model.bytes)}</dd>
        <dt>${t("Fonte", "Source")}</dt><dd>Hugging Face (huggingface.co)</dd></dl>
        <p>${isGpu()
    ? t("É a versão para placa de vídeo (WebGPU): maior que a versão de processador, mas várias vezes mais rápida neste computador.", "This is the graphics-card (WebGPU) version: larger than the processor version, but several times faster on this computer.")
    : t("É a versão para processador (WebAssembly): este navegador ou computador não tem WebGPU.", "This is the processor (WebAssembly) version: this browser or computer has no WebGPU.")}</p>
        <p>${t("Fica guardado neste navegador; não baixa de novo. Seu áudio não sai do computador: só o modelo é baixado.", "It stays stored in this browser; it will not download again. Your audio never leaves the computer: only the model is downloaded.")}</p>`;
    }
  }

  function renderSetupFooter() {
    const ready = availability === "cache" || availability === "server";
    footer.innerHTML = `<button type="button" data-transcribe-close>${t("Cancelar", "Cancel")}</button>
      ${availability === "download" ? `<button type="button" data-transcribe-manual>${t("Usar arquivos do modelo (sem internet)", "Use model files (offline)")}</button>` : ""}
      <button type="button" class="primary-button" data-transcribe-go ${availability === null ? "disabled" : ""}>${availability === "download" ? t("Baixar e legendar", "Download and subtitle") : ready ? t("Legendar", "Subtitle") : t("Verificando…", "Checking…")} →</button>`;
    footer.querySelector("[data-transcribe-manual]")?.addEventListener("click", () => {
      manualOpen = !manualOpen;
      body.querySelector<HTMLElement>("[data-transcribe-manual-panel]")!.hidden = !manualOpen;
      if (manualOpen) body.querySelector<HTMLElement>("[data-transcribe-pick]")?.focus();
    });
    footer.querySelector("[data-transcribe-go]")?.addEventListener("click", () => void run(availability === "download"));
    bindClose();
  }

  async function refreshAvailability() {
    availability = null;
    renderNote();
    renderSetupFooter();
    const asked = modelSize;
    try {
      const found = await engine.availability(asked, profile);
      if (closed || asked !== modelSize) return;
      availability = found;
    } catch {
      if (closed || asked !== modelSize) return;
      availability = "download";
    }
    if (step !== "setup") return;
    renderNote();
    renderSetupFooter();
  }

  async function importFiles(directory: boolean) {
    const files = await pickFiles(directory);
    if (!files.length || closed) return;
    const result = body.querySelector<HTMLElement>(".transcribe-manual-result");
    if (result) result.textContent = t("Guardando os arquivos…", "Storing the files…");
    let report: ImportReport;
    try {
      report = await engine.importFiles(modelSize, files, profile);
    } catch (error) {
      manualMessage = error instanceof Error ? error.message : String(error);
      if (result) result.textContent = manualMessage;
      return;
    }
    const problems = [
      report.missing.length ? t(`Faltam: ${report.missing.join(", ")}.`, `Missing: ${report.missing.join(", ")}.`) : "",
      report.rejected.length ? t(`Tamanho de outro modelo: ${report.rejected.join(", ")}.`, `Size of another model: ${report.rejected.join(", ")}.`) : "",
    ].filter(Boolean);
    manualMessage = problems.length ? `${t("Guardados", "Stored")} ${report.stored.length}. ${problems.join(" ")}` : t("Arquivos guardados neste navegador.", "Files stored in this browser.");
    await refreshAvailability();
    const message = body.querySelector<HTMLElement>(".transcribe-manual-result");
    if (message) message.textContent = manualMessage;
  }

  function renderProgress() {
    step = "progress";
    title.textContent = t("Legendando…", "Subtitling…");
    body.innerHTML = `<p class="transcribe-phase" data-transcribe-phase></p>
      <div class="progress-track transcribe-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span data-transcribe-bar></span></div>
      <p class="transcribe-detail" data-transcribe-detail></p>
      <p class="transcribe-detail" data-transcribe-partial hidden></p>`;
    footer.innerHTML = `<button type="button" data-transcribe-close>${t("Cancelar", "Cancel")}</button>
      <button type="button" data-transcribe-stop hidden>${t("Parar e revisar o que existe", "Stop and review what exists")}</button>`;
    bindClose();
    footer.querySelector("[data-transcribe-stop]")!.addEventListener("click", stopAndReview);
    paintProgress();
    window.clearInterval(timer);
    timer = window.setInterval(paintProgress, 500);
    footer.querySelector<HTMLElement>("button")?.focus();
  }

  function paintProgress() {
    const phase = body.querySelector<HTMLElement>("[data-transcribe-phase]");
    if (!phase) return;
    const state = transcribeStore.get();
    const bar = body.querySelector<HTMLElement>("[data-transcribe-bar]")!;
    const detail = body.querySelector<HTMLElement>("[data-transcribe-detail]")!;
    const seconds = Math.round((Date.now() - state.startedAt) / 1000);
    let fraction = 0;
    let detailText = `${seconds} s`;
    if (state.phase === "preparing") phase.textContent = t("Preparando o áudio…", "Preparing the audio…");
    else if (state.phase === "download") {
      fraction = state.total ? state.loaded / state.total : 0;
      phase.textContent = t("Baixando o modelo…", "Downloading the model…");
      detailText = `${mb(state.loaded)} ${t("de", "of")} ${mb(state.total)} MB · ${Math.round(fraction * 100)}% · ${seconds} s`;
    } else if (state.phase === "loading") phase.textContent = t("Carregando o modelo…", "Loading the model…");
    else {
      fraction = liveFraction;
      phase.textContent = t("Transcrevendo…", "Transcribing…");
      const blocks = state.chunksTotal > 1 ? `${t("bloco", "block")} ${Math.min(state.chunksDone + 1, state.chunksTotal)} ${t("de", "of")} ${state.chunksTotal} · ` : "";
      const eta = state.etaSeconds >= 0 ? `~${etaMinutes(state.etaSeconds)} ${t("min restantes", "min left")} · ` : "";
      detailText = `${blocks}${eta}${seconds} s${state.device ? ` · ${state.device}` : ""}`;
    }
    const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    bar.style.width = `${percent}%`;
    bar.parentElement!.setAttribute("aria-valuenow", String(percent));
    detail.textContent = detailText;
    const partial = body.querySelector<HTMLElement>("[data-transcribe-partial]")!;
    partial.hidden = !state.cues;
    partial.textContent = state.cues ? `${state.cues} ${t(state.cues === 1 ? "legenda até agora" : "legendas até agora", state.cues === 1 ? "subtitle so far" : "subtitles so far")}` : "";
    footer.querySelector<HTMLElement>("[data-transcribe-stop]")!.hidden = !state.cues;
  }

  function renderReview() {
    step = "review";
    window.clearInterval(timer);
    const state = transcribeStore.get();
    title.textContent = t("Revisar legendas", "Review subtitles");
    const sizeChoices: Array<[SubtitleSize, string]> = [["small", t("P", "S")], ["medium", t("M", "M")], ["large", t("G", "L")]];
    const positionChoices: Array<[SubtitlePosition, string]> = [["bottom", t("Embaixo", "Bottom")], ["middle", t("No meio", "Middle")], ["top", t("Em cima", "Top")]];
    body.innerHTML = `<p class="transcribe-detail" data-transcribe-count></p>
      <textarea class="transcribe-srt" data-transcribe-srt spellcheck="false" aria-label="SRT">${escapeHtml(state.srt)}</textarea>
      <p class="transcribe-detail">${t("Edite o texto à vontade; mantenha o formato do SRT (número, tempos, texto).", "Edit the text freely; keep the SRT format (number, times, text).")}</p>
      <fieldset class="transcribe-style" data-transcribe-style>
        <legend>${t("Aparência na timeline", "Look on the timeline")}</legend>
        <div class="transcribe-style-sizes" role="radiogroup" aria-label="${t("Tamanho", "Size")}">${sizeChoices.map(([size, label]) =>
    `<label class="transcribe-size"><input type="radio" name="subtitle-size" value="${size}" data-subtitle-size ${subtitleStyle.size === size ? "checked" : ""}><span>${label}<small>${String(+(SUBTITLE_SIZE_RATIO[size] * 100).toFixed(1)).replace(".", pt ? "," : ".")}%</small></span></label>`).join("")}</div>
        <label class="select-field"><span>${t("Posição", "Position")}</span><select data-subtitle-position>${positionChoices.map(([value, label]) =>
    `<option value="${value}" ${subtitleStyle.position === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="transcribe-check"><input type="checkbox" data-subtitle-shadow ${subtitleStyle.shadow ? "checked" : ""}><span>${t("Sombra no texto", "Text shadow")}</span></label>
      </fieldset>`;
    footer.innerHTML = `<button type="button" data-transcribe-close>${t("Fechar", "Close")}</button>
      <button type="button" data-transcribe-save>${t("Baixar .srt", "Download .srt")}</button>
      <button type="button" class="primary-button" data-transcribe-insert>${t("Inserir na timeline", "Insert into timeline")} →</button>`;
    const area = body.querySelector<HTMLTextAreaElement>("[data-transcribe-srt]")!;
    const count = () => {
      const cues = countCues(area.value);
      transcribeStore.set({ srt: area.value, cues });
      body.querySelector<HTMLElement>("[data-transcribe-count]")!.textContent = `${cues} ${t(cues === 1 ? "legenda" : "legendas", cues === 1 ? "subtitle" : "subtitles")}${state.device ? ` · ${state.device}` : ""}`;
      footer.querySelector<HTMLButtonElement>("[data-transcribe-insert]")!.disabled = cues === 0;
    };
    area.addEventListener("input", count);
    count();
    // Tamanho maior = menos letras por linha. Enquanto a pessoa não editou o texto, as linhas são refeitas para o novo tamanho
    // (a partir dos trechos do modelo); depois de editado, o texto dela fica como está.
    let generated = area.value;
    const rewrap = () => {
      if (!job || area.value !== generated) return;
      const cues = currentCues(job);
      if (!cues.length) return;
      generated = cuesToSrt(cues);
      area.value = generated;
      count();
    };
    body.querySelectorAll<HTMLInputElement>("[data-subtitle-size]").forEach((input) => input.addEventListener("change", () => {
      if (!input.checked) return;
      subtitleStyle.size = input.value as SubtitleSize;
      rewrap();
    }));
    body.querySelector("[data-subtitle-position]")!.addEventListener("change", (event) => { subtitleStyle.position = (event.target as HTMLSelectElement).value as SubtitlePosition; });
    body.querySelector("[data-subtitle-shadow]")!.addEventListener("change", (event) => { subtitleStyle.shadow = (event.target as HTMLInputElement).checked; });
    footer.querySelector("[data-transcribe-save]")!.addEventListener("click", () => {
      const link = document.createElement("a");
      const url = URL.createObjectURL(new Blob([area.value], { type: "application/x-subrip" }));
      link.href = url;
      link.download = `${project.settings.name.replace(/[^a-zA-Z0-9._ -]+/g, "_") || "legenda"}.srt`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    footer.querySelector("[data-transcribe-insert]")!.addEventListener("click", () => {
      if (host.project() !== project) { host.say(t("LEGENDA · O PROJETO MUDOU; ABRA DE NOVO", "SUBTITLES · THE PROJECT CHANGED; OPEN AGAIN")); return; }
      // Mídia do bin que ainda não está na timeline entra junto, no mesmo passo de desfazer.
      const choice = job?.choice;
      const media = choice?.asset && choice.key.startsWith("asset:") ? { asset: choice.asset, from: choice.from, length: choice.length } : null;
      const inserted = host.insertSrt(area.value, subtitleStyleProps(project.settings, subtitleStyle), mediaPlacementCommands(project, media));
      if (!inserted) return;
      transcribeStore.set({ phase: "inserted", cues: inserted });
      host.say(t(`LEGENDA AUTOMÁTICA · ${inserted} LEGENDA(S) NA TIMELINE`, `AUTO SUBTITLES · ${inserted} SUBTITLE(S) IN THE TIMELINE`));
      close();
    });
    bindClose();
    footer.querySelector<HTMLElement>("[data-transcribe-insert]")?.focus();
  }

  /** Mensagem legível para a pessoa; o detalhe técnico vai no fim. */
  function readableError(error: unknown) {
    const known = classifyError(error);
    if (known.kind === "memory") {
      return `${t("Faltou memória para transcrever neste computador. Use o modelo Rápido, feche outras abas ou transcreva um trecho menor.", "This computer ran out of memory while transcribing. Use the fast model, close other tabs or transcribe a shorter range.")} (${known.message})`;
    }
    if (known.kind === "worker") return `${t("O motor de transcrição parou de funcionar", "The transcription engine stopped working")}: ${known.message}`;
    return known.message;
  }

  /** Parou no meio (travou ou falhou): mostra o que existe e, se der, deixa retomar do bloco guardado. */
  function renderInterrupted(kind: "stalled" | "error") {
    step = "error";
    window.clearInterval(timer);
    window.clearInterval(watchTimer);
    const state = transcribeStore.get();
    const resumable = Boolean(job && job.next < job.blocks.length);
    title.textContent = kind === "stalled" ? t("O motor parou de responder", "The engine stopped responding") : t("Não foi possível legendar", "Could not subtitle");
    const kept = state.cues
      ? `<p>${t(`${state.cues} legendas dos blocos anteriores foram mantidas.`, `${state.cues} subtitles from the previous blocks were kept.`)}</p>`
      : "";
    body.innerHTML = `<p class="transcribe-note is-warning" role="alert">${escapeHtml(errorMessage)}</p>${kept}`;
    footer.innerHTML = `<button type="button" data-transcribe-close>${t("Fechar", "Close")}</button>
      ${state.cues ? `<button type="button" data-transcribe-partial-review>${t("Revisar o que existe", "Review what exists")}</button>` : ""}
      <button type="button" data-transcribe-again>${t("Começar de novo", "Start over")}</button>
      ${resumable ? `<button type="button" class="primary-button" data-transcribe-resume>${t(`Retomar do bloco ${job!.next + 1}`, `Resume from block ${job!.next + 1}`)} →</button>` : ""}`;
    footer.querySelector("[data-transcribe-again]")!.addEventListener("click", () => {
      job = null;
      transcribeStore.reset({ model: modelSize, language: spoken });
      renderSetup();
      void refreshAvailability();
      focusFirst();
    });
    footer.querySelector("[data-transcribe-partial-review]")?.addEventListener("click", () => {
      transcribeStore.set({ phase: "review" });
      renderReview();
    });
    footer.querySelector("[data-transcribe-resume]")?.addEventListener("click", async () => {
      if (!job) return;
      const current = job;
      transcribeStore.set({ phase: "loading", resumeBlock: 0, error: "" });
      renderProgress();
      // O perfil pode ter mudado (placa de vídeo → processador): o modelo pode estar em outro lugar.
      current.source = await engine.availability(modelSize, profile).catch(() => current.source);
      if (job !== current) return;
      void runBlocks(current.next);
    });
    bindClose();
    footer.querySelector<HTMLElement>("[data-transcribe-resume], [data-transcribe-again]")?.focus();
  }

  function renderError() { renderInterrupted("error"); }

  // ---- Execução.

  async function prepareAudio(choice: Resolved, signal?: AbortSignal) {
    if (!choice.asset) {
      const mix = await mixProjectAudio(project, WHISPER_RATE);
      if (!mix) throw new Error(t("Não há áudio na timeline para transcrever.", "There is no audio in the timeline to transcribe."));
      const channels = Array.from({ length: mix.numberOfChannels }, (_, index) => mix.getChannelData(index));
      const mono = mixToMono(channels);
      // Um trecho da mixagem: copia só ele, para o resto poder ser liberado.
      if (choice.range) return mono.slice(Math.round(choice.range.start * WHISPER_RATE), Math.round(choice.range.end * WHISPER_RATE));
      return new Float32Array(mono);
    }
    return decodeAssetTo16kMono(choice.asset, { from: choice.from, length: choice.length, signal });
  }

  async function run(confirmedDownload: boolean) {
    if (closed) return;
    const picked = chosenRange();
    if (picked.error) { refreshLong(); body.querySelector<HTMLElement>("[data-transcribe-start]")?.focus(); return; }
    const choice = resolveSource();
    savePrefs(spoken, modelSize);
    controller = new AbortController();
    const signal = controller.signal;
    job = null;
    transcribeStore.reset({
      phase: "preparing", model: modelSize, language: spoken, source: choice.key === "mix" ? "mix" : choice.asset ?? choice.key, startedAt: Date.now(),
      rangeStart: choice.range?.start ?? 0, rangeEnd: choice.range?.end ?? 0,
    });
    renderProgress();
    try {
      // O modelo pode ter mudado de lugar desde que o diálogo abriu: confere de novo.
      const source = await engine.availability(modelSize, profile);
      if (source === "download" && !confirmedDownload) {
        availability = source;
        transcribeStore.set({ phase: "waiting" });
        renderSetup();
        focusFirst();
        return;
      }
      const audio = await prepareAudio(choice, signal);
      if (signal.aborted) return;
      if (!audio.length) throw new Error(t("Áudio vazio.", "Empty audio."));
      // Silêncios longos não vão ao modelo (ele os preenche com texto inventado e gasta tempo neles).
      const tuning = transcribeTuning();
      const blocks = planBlocks(audio.length, { ...tuning, ranges: findSpeechRanges(audio) });
      if (!blocks.length) throw new Error(t("Nenhuma fala encontrada nesse áudio.", "No speech found in this audio."));
      job = { choice, audio, blocks, segments: [], next: 0, source, words: words ?? defaultWordTimestamps(audio.length / WHISPER_RATE) };
      transcribeStore.set({ chunksDone: 0, chunksTotal: blocks.length });
      await runBlocks(0);
    } catch (error) {
      if (closed || signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      errorMessage = readableError(error);
      transcribeStore.set({ phase: "failed", error: errorMessage });
      renderError();
    }
  }

  /** Cues do que já foi transcrito, no tempo da timeline. */
  function currentCues(current: Job) {
    // Linhas que cabem na caixa do estilo escolhido (o padrão M até a pessoa escolher outro na revisão).
    return buildCues(offsetSegments(current.segments, current.choice.offset, current.choice.scale), {
      fps: project.settings.fps, duration: project.settings.duration, maxChars: subtitleMaxChars(project.settings, subtitleStyle),
    });
  }

  /** Transcreve os blocos de `start` em diante; cada bloco pronto atualiza as legendas parciais. */
  async function runBlocks(start: number) {
    const current = job;
    if (!current || closed) return;
    const token = ++attempt;
    controller = new AbortController();
    const signal = controller.signal;
    const { stallMs } = transcribeTuning();
    const total = current.blocks.length;
    const totalSeconds = planSeconds(current.blocks);
    const startDone = doneAudioSeconds(current.blocks, start);
    let workStart = 0;
    let signature = "";
    let lastChange = Date.now();
    // Sinal de vida do worker (a cada ~3 s). Motores que não o mandam são vigiados só pelo progresso.
    let lastAlive = Date.now();
    let heartbeats = false;
    current.next = start;
    liveFraction = totalSeconds ? startDone / totalSeconds : 0;
    window.clearInterval(watchTimer);
    // Quanto o bloco em andamento deveria levar (ms), pela estimativa do modelo neste dispositivo.
    const blockEstimateMs = () => {
      const block = current.blocks[Math.min(current.next, total - 1)];
      return block ? estimateTranscribeSeconds(blockSecondsOf(block), modelSize, isGpu(), false) * 1000 : 0;
    };
    // Com heartbeat: o motor é encerrado se ficar calado por stallMs (thread travada) ou se o progresso não andar
    // por muito mais que isso (vivo, mas preso). Sem heartbeat: stallMs, no mínimo a estimativa do bloco, sem progresso.
    // Em qualquer caso as legendas dos blocos prontos ficam guardadas para a pessoa retomar.
    // Montar o modelo não depende do tamanho do bloco: na WebGPU leva de segundos a ~1 min; mais que 2x stallMs é travamento.
    const loadingModel = () => ["download", "loading"].includes(transcribeStore.get().phase);
    const stalledFor = () => {
      const now = Date.now();
      if (heartbeats) {
        if (now - lastAlive >= stallMs) return now - lastAlive;
        const progressLimit = loadingModel() ? stallMs * 2 : Math.max(stallMs * 4, blockEstimateMs() * 2);
        return now - lastChange >= progressLimit ? now - lastChange : 0;
      }
      return now - lastChange >= Math.max(stallMs, blockEstimateMs()) ? now - lastChange : 0;
    };
    watchTimer = window.setInterval(() => {
      if (token !== attempt || closed) { window.clearInterval(watchTimer); return; }
      const silent = stalledFor();
      if (!silent) return;
      window.clearInterval(watchTimer);
      attempt++;
      controller?.abort();
      const seconds = Math.max(1, Math.round(silent / 1000));
      const inLoad = loadingModel();
      // Travou montando o modelo na placa de vídeo: retomar usa o processador (WebAssembly), que funciona em todo navegador.
      const toCpu = inLoad && isGpu();
      if (toCpu) profile = "wasm";
      errorMessage = inLoad
        ? t(`O modelo não terminou de carregar em ${seconds} s e o motor foi encerrado.${toCpu ? " Retomar usa o processador em vez da placa de vídeo." : ""}`,
          `The model did not finish loading in ${seconds} s and the engine was stopped.${toCpu ? " Resuming uses the processor instead of the graphics card." : ""}`)
        : !heartbeats
        ? t(`O motor ficou ${seconds} s sem progresso no bloco ${current.next + 1} de ${total} e foi encerrado. Os blocos já prontos foram mantidos.`,
          `The engine made no progress for ${seconds} s on block ${current.next + 1} of ${total} and was stopped. Finished blocks were kept.`)
        : Date.now() - lastAlive < stallMs
          ? t(`O motor ficou ${seconds} s sem avançar no bloco ${current.next + 1} de ${total} e foi encerrado. Os blocos já prontos foram mantidos.`,
          `The engine made no headway for ${seconds} s on block ${current.next + 1} of ${total} and was stopped. Finished blocks were kept.`)
        : t(`O motor ficou ${seconds} s sem responder no bloco ${current.next + 1} de ${total} e foi encerrado. Os blocos já prontos foram mantidos.`,
          `The engine did not respond for ${seconds} s on block ${current.next + 1} of ${total} and was stopped. Finished blocks were kept.`);
      transcribeStore.set({ phase: "stalled", resumeBlock: current.next + 1, error: errorMessage });
      renderInterrupted("stalled");
    }, Math.max(20, Math.min(1000, stallMs / 4)));
    const publish = () => {
      const cues = currentCues(current);
      transcribeStore.set({ cues: cues.length, srt: cuesToSrt(cues), chunksDone: current.next, chunksTotal: total });
    };
    const measure = (blockFraction: number) => {
      const done = doneAudioSeconds(current.blocks, current.next, blockFraction);
      liveFraction = totalSeconds ? done / totalSeconds : 0;
      const eta = workStart ? estimateRemainingSeconds({ doneSeconds: done - startDone, totalSeconds: totalSeconds - startDone, elapsedSeconds: (Date.now() - workStart) / 1000 }) : null;
      return eta === null ? -1 : eta;
    };
    try {
      const result = await engine.transcribe({
        model: modelSize, language: spoken, audio: current.audio, source: current.source, profile, signal,
        blocks: current.blocks, startBlock: start, wordTimestamps: current.words,
        onAlive: () => { if (token === attempt) { heartbeats = true; lastAlive = Date.now(); } },
        onProgress: (progress: TranscribeProgress) => {
          if (token !== attempt) return;
          const next = [progress.phase, progress.loaded, progress.total, progress.blockFraction, current.next].join("|");
          if (next !== signature) { signature = next; lastChange = Date.now(); }
          if (progress.phase === "transcribing" && !workStart) workStart = Date.now();
          transcribeStore.set({
            phase: progress.phase, device: progress.device ?? transcribeStore.get().device,
            ...(progress.total !== undefined ? { loaded: progress.loaded ?? 0, total: progress.total } : {}),
            ...(progress.phase === "transcribing" ? { chunksDone: current.next, chunksTotal: total, etaSeconds: measure(progress.blockFraction ?? 0) } : {}),
          });
          paintProgress();
        },
        onBlock: (block) => {
          if (token !== attempt) return;
          const position = current.blocks.findIndex((item) => item.index === block.index);
          if (position < current.next) return;
          current.segments = mergeBlockSegments(current.segments, block.segments, blockOverlap(current.blocks[position - 1], current.blocks[position]));
          current.next = position + 1;
          lastChange = Date.now();
          signature = "";
          publish();
          transcribeStore.set({ etaSeconds: measure(0) });
          paintProgress();
        },
      });
      if (token !== attempt || closed || signal.aborted) return;
      window.clearInterval(watchTimer);
      const cues = currentCues(current);
      if (!cues.length) throw new Error(t("Nenhuma fala encontrada nesse áudio.", "No speech found in this audio."));
      transcribeStore.set({ phase: "review", srt: cuesToSrt(cues), cues: cues.length, device: result.device, chunksDone: total, etaSeconds: -1 });
      renderReview();
    } catch (error) {
      if (token !== attempt || closed || signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      window.clearInterval(watchTimer);
      errorMessage = readableError(error);
      transcribeStore.set({ phase: "failed", error: errorMessage, resumeBlock: current.next + 1 });
      renderError();
    }
  }

  /** "Parar e revisar": encerra o motor e mostra as legendas dos blocos prontos. */
  function stopAndReview() {
    if (!job || !transcribeStore.get().cues) return;
    attempt++;
    window.clearInterval(watchTimer);
    controller?.abort();
    transcribeStore.set({ phase: "review", etaSeconds: -1 });
    renderReview();
  }

  // ---- Janela.

  function close() {
    if (closed) return;
    closed = true;
    window.clearInterval(timer);
    window.clearInterval(watchTimer);
    attempt++;
    const phase = transcribeStore.get().phase;
    if (BUSY_PHASES.includes(phase) || phase === "stalled") {
      controller?.abort();
      transcribeStore.set({ phase: "cancelled", etaSeconds: -1 });
    }
    job = null;
    backdrop.remove();
    if (current === handle) { current = null; registerTranscribeCanceller(null); }
    if (opener?.isConnected) opener.focus();
  }

  function bindClose() {
    backdrop.querySelectorAll<HTMLElement>("[data-transcribe-close]").forEach((button) => { button.onclick = close; });
  }

  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button, select, textarea, input, [href]")).filter((element) => !element.hasAttribute("disabled") && !element.closest("[hidden]"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  // Atalhos do editor (espaço, setas, Delete) não devem agir por trás do diálogo.
  backdrop.addEventListener("keydown", (event) => { if (event.key !== "Tab" && event.key !== "Escape") event.stopPropagation(); });

  const handle = { close };
  current = handle;
  // vct.cancelTranscribe(): cancela o que está em andamento (ou parado) sem passar pela interface.
  registerTranscribeCanceller(() => {
    const phase = transcribeStore.get().phase;
    if (closed || !(BUSY_PHASES.includes(phase) || phase === "stalled")) return false;
    close();
    return true;
  });

  return {
    /**
     * Mostra o diálogo. Pessoa: espera o clique. Agente: começa sozinho se o modelo está disponível,
     * senão mostra o aviso de download; devolve um texto curto sem esperar a pessoa.
     */
    async begin(agent: boolean) {
      // O perfil (WebGPU com ou sem fp16, ou WASM) decide quais arquivos e quantos MB; a consulta é rápida, mas não trava o diálogo.
      profile = await Promise.race([detectProfile(), new Promise<ModelProfile>((resolve) => window.setTimeout(() => resolve("wasm"), 1500))]);
      if (closed) return "";
      transcribeStore.reset({ phase: "waiting", model: modelSize, language: spoken, source: sourceKey === "mix" ? "mix" : sourceKey.replace(/^asset:/, ""), total: modelOf().bytes });
      renderSetup();
      focusFirst();
      if (!agent) {
        await refreshAvailability();
        if (!closed && transcribeStore.get().phase === "waiting") transcribeStore.set({ phase: "idle" });
        return "";
      }
      try {
        availability = await Promise.race([engine.availability(modelSize, profile), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 4000))]);
      } catch {
        availability = "download";
      }
      const model = modelOf();
      if (availability === "download") {
        renderSetup();
        focusFirst();
        return `O modelo ${modelSize} (${formatMegabytes(model.bytes)}) não está neste navegador: mostrei o aviso de download à pessoa. Ela precisa clicar em Baixar e legendar. Não espere: confira vct.status().`;
      }
      void run(false);
      const picked = chosenRange().range;
      const span = picked ? ` do trecho ${formatClock(picked.start)} a ${formatClock(picked.end)}` : "";
      return `Transcrição iniciada${span} com o modelo ${modelSize} (${availability === "cache" ? "já neste navegador" : "do servidor"}). Em blocos de cerca de 5 min: confira vct.status() (bloco N de M e tempo restante), leia o que já existe com vct.transcript() e cancele com vct.cancelTranscribe().`;
    },
  };
}

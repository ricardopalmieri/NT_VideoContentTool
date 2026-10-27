// Diálogo da legenda automática: escolhas, aviso de download, progresso e revisão do
// SRT. Carregado sob demanda (import dinâmico no editor). Estado visível ao agente
// fica em transcribe-state.ts.
import { decodeAsset, mixProjectAudio } from "../audio/audio-engine";
import { listAssets } from "../model/media-assets";
import type { Language, ProjectDocument } from "../model/types";
import { escapeHtml } from "../ui/escape-html";
import { WHISPER_RATE, mixToMono, resampleTo16kMono } from "./audio-prep";
import { buildCues, cuesToSrt, offsetSegments } from "./cues";
import { getTranscribeEngine } from "./engine";
import {
  TRANSCRIBE_LANGUAGES, WHISPER_MODELS, WHISPER_SIZES, formatMegabytes, isTranscribeLanguage, isWhisperSize,
  type ModelSource, type TranscribeLanguage, type WhisperSize,
} from "./model-catalog";
import type { ImportReport, TranscribeProgress } from "./protocol";
import { BUSY_PHASES, countCues, transcribeStore } from "./transcribe-state";

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
  /** Aplica o SRT na timeline como um passo de desfazer; devolve quantas legendas entraram (0 se recusado). */
  insertSrt(srt: string): number;
  say(message: string): void;
}

/** source: "mix", "clip" (clipe selecionado) ou "asset:<caminho>". */
export interface TranscribeChoices {
  source?: string;
  language?: TranscribeLanguage;
  model?: WhisperSize;
}

interface Resolved {
  key: string;
  label: string;
  asset?: string;
  from: number;
  length?: number;
  offset: number;
  scale: number;
}

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
  let closed = false;

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

  function resolveSource(): Resolved {
    if (sourceKey === "clip") {
      const clip = host.selectedSource();
      if (clip) return { key: sourceKey, label: clip.label, asset: clip.asset, from: clip.from, length: clip.length, offset: clip.offset, scale: clip.scale };
    }
    if (sourceKey.startsWith("asset:")) return { key: sourceKey, label: assetName(sourceKey), asset: sourceKey.slice(6), from: 0, offset: 0, scale: 1 };
    return { key: "mix", label: t("Mixagem da timeline", "Timeline mix"), from: 0, offset: 0, scale: 1 };
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
    const model = WHISPER_MODELS[modelSize];
    const options = (items: Array<{ key: string; label: string }>, selected: string) =>
      items.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
    const languageLabel: Record<TranscribeLanguage, string> = { pt: "Português", en: "English", es: "Español", auto: t("Detectar automaticamente", "Detect automatically") };
    body.innerHTML = `<div class="transcribe-fields">
      <label class="select-field"><span>${t("Áudio", "Audio")}</span><select data-transcribe-source>${options(sources(), sourceKey)}</select></label>
      <label class="select-field"><span>${t("Idioma da fala", "Spoken language")}</span><select data-transcribe-language>${options(TRANSCRIBE_LANGUAGES.map((key) => ({ key, label: languageLabel[key] })), spoken)}</select></label>
      <label class="select-field"><span>${t("Modelo", "Model")}</span><select data-transcribe-model>${options(WHISPER_SIZES.map((size) => ({ key: size, label: `${WHISPER_MODELS[size].label[pt ? 0 : 1]} · Whisper ${size} · ${formatMegabytes(WHISPER_MODELS[size].bytes)}` })), modelSize)}</select></label>
    </div>
    <div class="transcribe-note" data-transcribe-note></div>
    <div class="transcribe-manual" data-transcribe-manual-panel ${manualOpen ? "" : "hidden"}>
      <p>${t(`Escolha os arquivos do modelo Whisper ${modelSize} (${model.id}), baixados antes em huggingface.co, ou a pasta inteira. Eles ficam guardados neste navegador e o modelo carrega sem internet.`,
        `Pick the Whisper ${modelSize} model files (${model.id}) downloaded earlier from huggingface.co, or the whole folder. They are stored in this browser and the model loads offline.`)}</p>
      <ul>${model.files.map((file) => `<li><code>${escapeHtml(file.path)}</code> <small>${mb(file.bytes)} MB</small></li>`).join("")}</ul>
      <div class="transcribe-manual-buttons">
        <button type="button" data-transcribe-pick="files">${t("Escolher arquivos…", "Choose files…")}</button>
        <button type="button" data-transcribe-pick="folder">${t("Escolher pasta…", "Choose folder…")}</button>
      </div>
      <p class="transcribe-manual-result" role="status">${escapeHtml(manualMessage)}</p>
    </div>`;
    renderNote();
    renderSetupFooter();
    body.querySelector("[data-transcribe-source]")!.addEventListener("change", (event) => { sourceKey = (event.target as HTMLSelectElement).value; });
    body.querySelector("[data-transcribe-language]")!.addEventListener("change", (event) => { spoken = (event.target as HTMLSelectElement).value as TranscribeLanguage; });
    body.querySelector("[data-transcribe-model]")!.addEventListener("change", (event) => {
      modelSize = (event.target as HTMLSelectElement).value as WhisperSize;
      manualMessage = "";
      renderSetup();
      void refreshAvailability();
    });
    body.querySelectorAll<HTMLElement>("[data-transcribe-pick]").forEach((button) => button.addEventListener("click", () => void importFiles(button.dataset.transcribePick === "folder")));
  }

  function renderNote() {
    const note = body.querySelector<HTMLElement>("[data-transcribe-note]");
    if (!note) return;
    const model = WHISPER_MODELS[modelSize];
    note.className = `transcribe-note${availability === "download" ? " is-warning" : ""}`;
    if (availability === null) note.textContent = t("Verificando o modelo…", "Checking the model…");
    else if (availability === "cache") note.textContent = t("O modelo já está guardado neste navegador. Nada será baixado.", "The model is already stored in this browser. Nothing will be downloaded.");
    else if (availability === "server") note.textContent = t("O modelo vem da pasta models/ deste servidor. Nada é baixado da internet.", "The model comes from this server's models/ folder. Nothing is downloaded from the internet.");
    else {
      note.innerHTML = `<strong>${t("Primeiro uso: é preciso baixar o modelo", "First use: the model must be downloaded")}</strong>
        <dl><dt>${t("Modelo", "Model")}</dt><dd>Whisper ${modelSize} · ${model.label[pt ? 0 : 1]}</dd>
        <dt>${t("Tamanho", "Size")}</dt><dd>${formatMegabytes(model.bytes)}</dd>
        <dt>${t("Fonte", "Source")}</dt><dd>Hugging Face (huggingface.co)</dd></dl>
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
      const found = await engine.availability(asked);
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
      report = await engine.importFiles(modelSize, files);
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
      <p class="transcribe-detail" data-transcribe-detail></p>`;
    footer.innerHTML = `<button type="button" data-transcribe-close>${t("Cancelar", "Cancel")}</button>`;
    bindClose();
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
      fraction = state.chunksTotal ? state.chunksDone / state.chunksTotal : 0;
      phase.textContent = t("Transcrevendo…", "Transcribing…");
      detailText = `${state.chunksTotal > 1 ? `${t("trecho", "part")} ${Math.min(state.chunksDone + 1, state.chunksTotal)} ${t("de", "of")} ${state.chunksTotal} · ` : ""}${seconds} s${state.device ? ` · ${state.device}` : ""}`;
    }
    const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    bar.style.width = `${percent}%`;
    bar.parentElement!.setAttribute("aria-valuenow", String(percent));
    detail.textContent = detailText;
  }

  function renderReview() {
    step = "review";
    window.clearInterval(timer);
    const state = transcribeStore.get();
    title.textContent = t("Revisar legendas", "Review subtitles");
    body.innerHTML = `<p class="transcribe-detail" data-transcribe-count></p>
      <textarea class="transcribe-srt" data-transcribe-srt spellcheck="false" aria-label="SRT">${escapeHtml(state.srt)}</textarea>
      <p class="transcribe-detail">${t("Edite o texto à vontade; mantenha o formato do SRT (número, tempos, texto).", "Edit the text freely; keep the SRT format (number, times, text).")}</p>`;
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
      const inserted = host.insertSrt(area.value);
      if (!inserted) return;
      transcribeStore.set({ phase: "inserted", cues: inserted });
      host.say(t(`LEGENDA AUTOMÁTICA · ${inserted} LEGENDA(S) NA TIMELINE`, `AUTO SUBTITLES · ${inserted} SUBTITLE(S) IN THE TIMELINE`));
      close();
    });
    bindClose();
    footer.querySelector<HTMLElement>("[data-transcribe-insert]")?.focus();
  }

  function renderError() {
    step = "error";
    window.clearInterval(timer);
    title.textContent = t("Não foi possível legendar", "Could not subtitle");
    body.innerHTML = `<p class="transcribe-note is-warning" role="alert">${escapeHtml(errorMessage)}</p>`;
    footer.innerHTML = `<button type="button" data-transcribe-close>${t("Fechar", "Close")}</button>
      <button type="button" class="primary-button" data-transcribe-again>${t("Tentar de novo", "Try again")}</button>`;
    footer.querySelector("[data-transcribe-again]")!.addEventListener("click", () => {
      transcribeStore.reset({ model: modelSize, language: spoken });
      renderSetup();
      void refreshAvailability();
      focusFirst();
    });
    bindClose();
    footer.querySelector<HTMLElement>("[data-transcribe-again]")?.focus();
  }

  // ---- Execução.

  async function prepareAudio(choice: Resolved) {
    if (!choice.asset) {
      const mix = await mixProjectAudio(project, WHISPER_RATE);
      if (!mix) throw new Error(t("Não há áudio na timeline para transcrever.", "There is no audio in the timeline to transcribe."));
      const channels = Array.from({ length: mix.numberOfChannels }, (_, index) => mix.getChannelData(index));
      return new Float32Array(mixToMono(channels));
    }
    return resampleTo16kMono(await decodeAsset(choice.asset), choice.from, choice.length);
  }

  async function run(confirmedDownload: boolean) {
    if (closed) return;
    const choice = resolveSource();
    savePrefs(spoken, modelSize);
    controller = new AbortController();
    const signal = controller.signal;
    transcribeStore.reset({ phase: "preparing", model: modelSize, language: spoken, source: choice.key === "mix" ? "mix" : choice.asset ?? choice.key, startedAt: Date.now() });
    renderProgress();
    try {
      // O modelo pode ter mudado de lugar desde que o diálogo abriu: confere de novo.
      const source = await engine.availability(modelSize);
      if (source === "download" && !confirmedDownload) {
        availability = source;
        transcribeStore.set({ phase: "waiting" });
        renderSetup();
        focusFirst();
        return;
      }
      const audio = await prepareAudio(choice);
      if (signal.aborted) return;
      if (!audio.length) throw new Error(t("Áudio vazio.", "Empty audio."));
      const result = await engine.transcribe({
        model: modelSize, language: spoken, audio, source, signal,
        onProgress: (progress: TranscribeProgress) => {
          transcribeStore.set({
            phase: progress.phase, device: progress.device ?? transcribeStore.get().device,
            ...(progress.total !== undefined ? { loaded: progress.loaded ?? 0, total: progress.total } : {}),
            ...(progress.chunksTotal !== undefined ? { chunksDone: progress.chunksDone ?? 0, chunksTotal: progress.chunksTotal } : {}),
          });
          paintProgress();
        },
      });
      if (closed || signal.aborted) return;
      const fps = project.settings.fps;
      const cues = buildCues(offsetSegments(result.segments, choice.offset, choice.scale), { fps, duration: project.settings.duration });
      if (!cues.length) throw new Error(t("Nenhuma fala encontrada nesse áudio.", "No speech found in this audio."));
      transcribeStore.set({ phase: "review", srt: cuesToSrt(cues), cues: cues.length, device: result.device });
      renderReview();
    } catch (error) {
      if (closed || signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      errorMessage = error instanceof Error ? error.message : String(error);
      transcribeStore.set({ phase: "failed", error: errorMessage });
      renderError();
    }
  }

  // ---- Janela.

  function close() {
    if (closed) return;
    closed = true;
    window.clearInterval(timer);
    if (BUSY_PHASES.includes(transcribeStore.get().phase)) {
      controller?.abort();
      transcribeStore.set({ phase: "cancelled" });
    }
    backdrop.remove();
    if (current === handle) current = null;
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

  return {
    /**
     * Mostra o diálogo. Pessoa: espera o clique. Agente: começa sozinho se o modelo está disponível,
     * senão mostra o aviso de download; devolve um texto curto sem esperar a pessoa.
     */
    async begin(agent: boolean) {
      transcribeStore.reset({ phase: "waiting", model: modelSize, language: spoken, source: sourceKey === "mix" ? "mix" : sourceKey.replace(/^asset:/, "") });
      renderSetup();
      focusFirst();
      if (!agent) {
        await refreshAvailability();
        if (!closed && transcribeStore.get().phase === "waiting") transcribeStore.set({ phase: "idle" });
        return "";
      }
      try {
        availability = await Promise.race([engine.availability(modelSize), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 4000))]);
      } catch {
        availability = "download";
      }
      const model = WHISPER_MODELS[modelSize];
      if (availability === "download") {
        renderSetup();
        focusFirst();
        return `O modelo ${modelSize} (${formatMegabytes(model.bytes)}) não está neste navegador: mostrei o aviso de download à pessoa. Ela precisa clicar em Baixar e legendar. Não espere: confira vct.status().`;
      }
      void run(false);
      return `Transcrição iniciada com o modelo ${modelSize} (${availability === "cache" ? "já neste navegador" : "do servidor"}). Confira vct.status() e leia o resultado com vct.transcript().`;
    },
  };
}

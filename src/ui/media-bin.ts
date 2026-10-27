// Media panel (bin): imported files as cards. Rendering and events only; the
// editor owns the project and turns actions into commands. The Criar buttons
// keep data-add-input so the editor binds them like the old input buttons.
import { listAssets, type BinEntry } from "../model/media-assets";
import type { Language, ProjectDocument } from "../model/types";
import { binThumbnail } from "./media-probe";

export type BinFilter = "all" | "video" | "image" | "audio";

export interface BinView {
  filter: BinFilter;
  query: string;
  selected: string;
}

export interface BinActions {
  importMedia(): void;
  select(asset: string): void;
  /** where: "playhead" (selected track if free, else new) or "new-track". */
  place(asset: string, where: "playhead" | "new-track"): void;
  remove(asset: string): void;
  changeView(view: Partial<BinView>): void;
}

export const BIN_DRAG_TYPE = "application/x-vct-asset";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);

function clock(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(seconds < 60 ? 1 : 0).padStart(seconds < 60 ? 4 : 2, "0")}`;
}

const ICONS: Record<string, string> = {
  video: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5" width="11" height="10" rx="1.5"/><path d="M13.5 9l4-2.5v7l-4-2.5"/></svg>`,
  image: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 13l4-4 3 3 2-2 5 5"/></svg>`,
  audio: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h1M6 7v6M9 4v12M12 7v6M15 9v2M17 10h0"/></svg>`,
};

function orientationMark(entry: BinEntry, language: Language) {
  const labels = { vertical: language === "pt-BR" ? "vertical" : "vertical", horizontal: "horizontal", quadrado: language === "pt-BR" ? "quadrado" : "square" } as Record<string, string>;
  return entry.orientation ? `<span class="bin-orientation is-${entry.orientation}" title="${labels[entry.orientation]}"></span>` : "";
}

function card(entry: BinEntry, view: BinView, language: Language) {
  const thumb = binThumbnail(entry.id);
  const audio = entry.kind === "audio" || entry.hasAudio
    ? `<span class="bin-audio" title="${language === "pt-BR" ? "com áudio" : "has audio"}">${ICONS.audio}</span>` : "";
  const used = entry.usedBy.length ? `<span class="bin-used">${language === "pt-BR" ? "em uso" : "in use"} ${entry.usedBy.length}</span>` : "";
  const selected = view.selected === entry.id;
  const meta = [clock(entry.duration), entry.width && entry.height ? `${entry.width}×${entry.height}` : ""].filter(Boolean).join(" · ");
  return `<article class="bin-card ${selected ? "is-selected" : ""}" data-bin-asset="${escape(entry.id)}" draggable="true" tabindex="0" aria-selected="${selected}"
      aria-label="${escape(entry.name)}">
    <div class="bin-thumb">${thumb ? `<img src="${thumb}" alt="" draggable="false">` : ICONS[entry.kind || "image"] || ""}${used}</div>
    <div class="bin-meta"><strong title="${escape(entry.name)}">${escape(entry.name)}</strong><span>${meta}${orientationMark(entry, language)}${audio}</span></div>
    ${selected ? `<div class="bin-card-actions">
      <button type="button" data-bin-place="playhead">${language === "pt-BR" ? "No playhead" : "At playhead"}</button>
      <button type="button" data-bin-place="new-track">${language === "pt-BR" ? "Nova faixa" : "New track"}</button>
      ${entry.usedBy.length ? "" : `<button type="button" class="bin-remove" data-bin-remove aria-label="${language === "pt-BR" ? "Tirar do painel" : "Remove from panel"}" title="${language === "pt-BR" ? "Tirar do painel" : "Remove from panel"}">×</button>`}
    </div>` : ""}
  </article>`;
}

export function renderMediaBin(project: ProjectDocument, view: BinView, language: Language) {
  const pt = language === "pt-BR";
  const all = listAssets(project);
  const query = view.query.trim().toLowerCase();
  const entries = all.filter((entry) => (view.filter === "all" || entry.kind === view.filter) && (!query || entry.name.toLowerCase().includes(query)));
  const filters: Array<[BinFilter, string]> = [["all", pt ? "Tudo" : "All"], ["video", pt ? "Vídeo" : "Video"], ["image", pt ? "Imagem" : "Image"], ["audio", pt ? "Áudio" : "Audio"]];
  const empty = all.length
    ? `<p class="bin-empty">${pt ? "Nada com esse filtro." : "Nothing matches."}</p>`
    : `<button type="button" class="bin-empty-import" data-bin-import><strong>${pt ? "Importar mídia" : "Import media"}</strong><span>${pt ? "Vídeos, imagens e áudios. Você também pode arrastar os arquivos para cá." : "Videos, images and audio. You can also drop files here."}</span></button>`;
  return `<section class="media-bin" aria-label="${pt ? "Mídia" : "Media"}">
    <div class="bin-toolbar">
      <button type="button" class="bin-import" data-bin-import>${pt ? "Importar mídia" : "Import media"}</button>
      <input type="search" data-bin-search value="${escape(view.query)}" placeholder="${pt ? "Buscar" : "Search"}" aria-label="${pt ? "Buscar mídia" : "Search media"}">
      <select data-bin-filter aria-label="${pt ? "Filtrar por tipo" : "Filter by type"}">${filters.map(([value, label]) => `<option value="${value}" ${view.filter === value ? "selected" : ""}>${label}</option>`).join("")}</select>
    </div>
    <div class="bin-grid">${entries.map((entry) => card(entry, view, language)).join("") || empty}</div>
    <div class="bin-create"><span>${pt ? "Criar" : "Create"}</span>
      <button type="button" data-add-input="text">${pt ? "Texto" : "Text"}</button>
      <button type="button" data-add-input="geometry">${pt ? "Forma" : "Shape"}</button>
      <button type="button" data-add-input="guide">${pt ? "Guia" : "Guide"}</button>
      <button type="button" data-import-srt>${pt ? "Importar legendas (SRT)" : "Import subtitles (SRT)"}</button>
      <button type="button" data-auto-subtitles>${pt ? "Legendar automaticamente" : "Auto subtitles"}</button>
    </div>
  </section>`;
}

export function bindMediaBin(root: ParentNode, actions: BinActions) {
  root.querySelectorAll<HTMLElement>("[data-bin-import]").forEach((button) => button.addEventListener("click", () => actions.importMedia()));
  root.querySelector<HTMLInputElement>("[data-bin-search]")?.addEventListener("input", (event) => actions.changeView({ query: (event.target as HTMLInputElement).value }));
  root.querySelector<HTMLSelectElement>("[data-bin-filter]")?.addEventListener("change", (event) => actions.changeView({ filter: (event.target as HTMLSelectElement).value as BinFilter }));
  root.querySelectorAll<HTMLElement>("[data-bin-asset]").forEach((element) => {
    const asset = element.dataset.binAsset!;
    element.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const place = target.closest<HTMLElement>("[data-bin-place]");
      if (place) actions.place(asset, place.dataset.binPlace as "playhead" | "new-track");
      else if (target.closest("[data-bin-remove]")) actions.remove(asset);
      else actions.select(asset);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") actions.place(asset, "playhead");
      if (event.key === " ") { event.preventDefault(); actions.select(asset); }
    });
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData(BIN_DRAG_TYPE, asset);
      event.dataTransfer?.setData("text/plain", asset);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
  });
}

export const IMPORT_ACCEPT = "video/*,image/*,audio/*,.mp4,.webm,.mov,.m4v,.png,.jpg,.jpeg,.webp,.bmp,.gif,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac";

/** Progress modal while files are read; returns update/close handles. */
export function openImportProgress(language: Language, total: number) {
  const pt = language === "pt-BR";
  const overlay = document.createElement("div");
  overlay.className = "import-progress";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `<div class="import-progress-box"><strong>${pt ? "Carregando mídia" : "Loading media"}</strong>
    <span class="import-progress-file"></span><div class="import-progress-bar"><i></i></div>
    <small class="import-progress-count"></small></div>`;
  document.body.append(overlay);
  const file = overlay.querySelector<HTMLElement>(".import-progress-file")!;
  const bar = overlay.querySelector<HTMLElement>(".import-progress-bar i")!;
  const count = overlay.querySelector<HTMLElement>(".import-progress-count")!;
  return {
    update(index: number, name: string) {
      file.textContent = name;
      count.textContent = pt ? `${index + 1} de ${total}` : `${index + 1} of ${total}`;
      bar.style.width = `${Math.round((index / total) * 100)}%`;
    },
    close() { overlay.remove(); },
  };
}

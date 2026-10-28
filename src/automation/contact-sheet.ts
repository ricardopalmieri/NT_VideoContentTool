// Contact sheets for agents: many frames in one image, each with its time, so
// reviewing costs one screenshot instead of one per frame.
import { resolveAssetUrl } from "../io/web-platform";
import { loadImage } from "../ui/media-probe";

export interface SheetFrame {
  image: CanvasImageSource;
  width: number;
  height: number;
  label: string;
  warning?: boolean;
}

export function composeSheet(frames: readonly SheetFrame[], columns: number, cellWidth: number) {
  const cols = Math.max(1, Math.min(columns, frames.length));
  const aspect = frames[0] ? frames[0].height / frames[0].width : 9 / 16;
  const cellHeight = Math.round(cellWidth * aspect);
  const labelHeight = 18;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cellWidth;
  canvas.height = Math.ceil(frames.length / cols) * (cellHeight + labelHeight);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#111111";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = "12px IBM Plex Mono, monospace";
  context.textBaseline = "middle";
  frames.forEach((frame, index) => {
    const x = (index % cols) * cellWidth;
    const y = Math.floor(index / cols) * (cellHeight + labelHeight);
    const scale = Math.min(cellWidth / frame.width, cellHeight / frame.height);
    const width = frame.width * scale;
    const height = frame.height * scale;
    context.drawImage(frame.image, x + (cellWidth - width) / 2, y + (cellHeight - height) / 2, width, height);
    context.fillStyle = frame.warning ? "#ce111b" : "#000000";
    context.fillRect(x, y + cellHeight, cellWidth, labelHeight);
    context.fillStyle = "#f0eee8";
    context.fillText(frame.label, x + 6, y + cellHeight + labelHeight / 2);
    context.strokeStyle = "#333333";
    context.strokeRect(x + .5, y + .5, cellWidth - 1, cellHeight + labelHeight - 1);
  });
  return canvas;
}

const OVERLAY_ID = "vct-agent-sheet";

/** Shows the sheet over the editor until hideSheet() (or a click) for one screenshot. */
export function showSheet(canvas: HTMLCanvasElement, caption: string) {
  hideSheet();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", caption);
  overlay.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#000000e6;cursor:pointer";
  const label = document.createElement("div");
  label.textContent = `${caption} · clique para fechar`;
  label.style.cssText = "font:12px IBM Plex Mono,monospace;color:#f0eee8";
  canvas.style.cssText = "max-width:96vw;max-height:88vh;object-fit:contain";
  overlay.append(label, canvas);
  overlay.addEventListener("click", hideSheet);
  document.body.append(overlay);
}

export function hideSheet() {
  document.getElementById(OVERLAY_ID)?.remove();
}

/** One captured frame on the same overlay, with its time in the label (captureFrame show). */
export async function showFrame(frame: { dataUrl: string; width: number; height: number; time: number; notReady?: string[] }) {
  const image = await loadImage(frame.dataUrl);
  const warning = Boolean(frame.notReady?.length);
  const label = `${frame.time.toFixed(2)} s${warning ? " (sem decode)" : ""}`;
  showSheet(composeSheet([{ image, width: frame.width, height: frame.height, label, warning }], 1, Math.max(320, frame.width)), `Quadro ${label}`);
}

function seek(video: HTMLVideoElement, time: number) {
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), 4000);
    const done = () => { window.clearTimeout(timeout); resolve(video.readyState >= 2); };
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = time;
  });
}

/** Frames of a raw bin asset (no timeline needed): evenly spaced or at given times. */
export async function assetFrames(asset: string, options: { count?: number; times?: number[]; duration?: number }) {
  const url = resolveAssetUrl(asset);
  if (!url) throw new Error(`Arquivo não carregado nesta sessão: ${asset}. Peça ao usuário para reimportar ou relinkar.`);
  if (!/\.(mp4|webm|mov|m4v)$/i.test(asset)) {
    const image = await loadImage(url);
    return [{ image, width: image.naturalWidth, height: image.naturalHeight, label: "imagem" }];
  }
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error(`Não foi possível decodificar ${asset} neste navegador.`)), { once: true });
  });
  const duration = video.duration || options.duration || 0;
  const count = Math.max(1, Math.min(48, options.count ?? 12));
  const times = options.times?.length ? options.times : Array.from({ length: count }, (_, index) => duration * (index + .5) / count);
  const frames: SheetFrame[] = [];
  for (const time of times) {
    const ready = await seek(video, Math.max(0, Math.min(duration - .05, time)));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (ready) canvas.getContext("2d")!.drawImage(video, 0, 0);
    frames.push({ image: canvas, width: canvas.width, height: canvas.height, label: `${time.toFixed(2)} s${ready ? "" : " (sem decode)"}`, warning: !ready });
  }
  video.removeAttribute("src");
  video.load();
  return frames;
}

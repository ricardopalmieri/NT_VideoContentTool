// Reads what the bin shows about an imported file: kind, duration, size in
// pixels, whether it has audio, a fingerprint for relink and a thumbnail.
import { probeAudio } from "../audio/audio-engine";
import { fileFingerprint, resolveAssetUrl } from "../io/web-platform";
import { assetKindOf } from "../model/media-assets";
import type { AssetSourceMetadata } from "../model/types";

// Decoding the whole audio of a very large video only to learn it has sound
// costs too much memory; above this size hasAudio stays unknown.
const AUDIO_PROBE_LIMIT = 400 * 1024 * 1024;
const THUMB_WIDTH = 192;
const thumbnails = new Map<string, string>();

export function binThumbnail(asset: string) {
  return thumbnails.get(asset);
}

function videoInfo(url: string) {
  return new Promise<{ duration: number; width: number; height: number; thumb?: string }>((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const timeout = window.setTimeout(() => reject(new Error("Tempo esgotado ao ler o vídeo.")), 15000);
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(Math.max(0, video.duration * .1), Math.max(0, video.duration - .1));
    }, { once: true });
    video.addEventListener("seeked", () => {
      window.clearTimeout(timeout);
      const canvas = document.createElement("canvas");
      canvas.width = THUMB_WIDTH;
      canvas.height = Math.max(1, Math.round(THUMB_WIDTH * video.videoHeight / Math.max(1, video.videoWidth)));
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight, thumb: canvas.toDataURL("image/jpeg", .7) });
      video.removeAttribute("src");
      video.load();
    }, { once: true });
    video.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("Formato de vídeo não suportado neste navegador.")); }, { once: true });
    video.src = url;
  });
}

async function imageInfo(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = Math.max(1, Math.round(THUMB_WIDTH * image.naturalHeight / Math.max(1, image.naturalWidth)));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { width: image.naturalWidth, height: image.naturalHeight, thumb: canvas.toDataURL("image/jpeg", .7) };
}

/** Technical metadata for a file already registered under `asset`. */
export async function probeMedia(asset: string, file: File, source: AssetSourceMetadata): Promise<AssetSourceMetadata> {
  const url = resolveAssetUrl(asset);
  const kind = assetKindOf(asset, { mimeType: file.type, originalName: file.name });
  const metadata: AssetSourceMetadata = { ...source, kind: kind ?? undefined, fingerprint: await fileFingerprint(file), addedAt: new Date().toISOString() };
  if (!url || !kind) return metadata;
  if (kind === "video") {
    const info = await videoInfo(url);
    Object.assign(metadata, { duration: info.duration, width: info.width, height: info.height });
    if (info.thumb) thumbnails.set(asset, info.thumb);
    if (file.size <= AUDIO_PROBE_LIMIT) metadata.hasAudio = await probeAudio(asset).then(() => true, () => false);
  } else if (kind === "image") {
    const info = await imageInfo(url);
    Object.assign(metadata, { width: info.width, height: info.height });
    thumbnails.set(asset, info.thumb);
  } else {
    const buffer = await probeAudio(asset);
    metadata.duration = buffer.duration;
    metadata.hasAudio = true;
  }
  return metadata;
}

/** Thumbnail for an asset opened from a saved project (file loaded, metadata known). */
export async function ensureThumbnail(asset: string, kind: string | undefined) {
  if (thumbnails.has(asset)) return thumbnails.get(asset);
  const url = resolveAssetUrl(asset);
  if (!url) return undefined;
  try {
    const info = kind === "image" ? await imageInfo(url) : kind === "video" ? await videoInfo(url) : undefined;
    if (info?.thumb) thumbnails.set(asset, info.thumb);
    return info?.thumb;
  } catch {
    return undefined;
  }
}

// Media bin: the files imported into a project, used on the timeline or not.
// Entries live in project.assetMetadata (key: the media/… reference).
import type { AssetSourceMetadata, Layer, ProjectDocument, ProjectSettings } from "./types";

export type AssetKind = "video" | "image" | "audio";
export type Fit = "contain" | "cover" | "rotate-cover" | "none";
export const FITS: readonly Fit[] = ["contain", "cover", "rotate-cover", "none"];

const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const IMAGE = /\.(png|jpe?g|webp|bmp|gif)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|flac)$/i;

export function assetKindOf(reference: string, metadata?: Pick<AssetSourceMetadata, "kind" | "mimeType" | "originalName">): AssetKind | null {
  if (metadata?.kind) return metadata.kind;
  const mime = metadata?.mimeType || "";
  const name = metadata?.originalName || reference;
  if (mime.startsWith("video/") || VIDEO.test(name)) return "video";
  if (mime.startsWith("image/") || IMAGE.test(name)) return "image";
  if (mime.startsWith("audio/") || AUDIO.test(name)) return "audio";
  return null;
}

export function orientationOf(width?: number, height?: number) {
  if (!width || !height) return "";
  const ratio = width / height;
  return ratio > 1.05 ? "horizontal" : ratio < .95 ? "vertical" : "quadrado";
}

export interface BinEntry {
  id: string;
  name: string;
  kind: AssetKind | null;
  duration?: number;
  width?: number;
  height?: number;
  orientation: string;
  hasAudio?: boolean;
  size?: number;
  usedBy: string[];
}

/** Every asset of the project: bin entries plus references used by clips. */
export function listAssets(project: Pick<ProjectDocument, "layers" | "audioTracks" | "assetMetadata">): BinEntry[] {
  const references = new Set(Object.keys(project.assetMetadata || {}));
  for (const layer of project.layers) if (layer.asset) references.add(layer.asset);
  for (const track of project.audioTracks) if (track.asset) references.add(track.asset);
  return [...references].map((id) => {
    const metadata = project.assetMetadata?.[id];
    return {
      id,
      name: metadata?.originalName || id.replace(/^media\//, ""),
      kind: assetKindOf(id, metadata),
      duration: metadata?.duration,
      width: metadata?.width,
      height: metadata?.height,
      orientation: orientationOf(metadata?.width, metadata?.height),
      hasAudio: metadata?.hasAudio,
      size: metadata?.size,
      usedBy: [
        ...project.layers.filter((layer) => layer.asset === id).map((layer) => layer.id),
        ...project.audioTracks.filter((track) => track.asset === id && !track.linked).map((track) => track.id),
      ],
    };
  });
}

const megabytes = (size?: number) => size ? `${Math.max(.1, size / 1048576).toFixed(size > 10485760 ? 0 : 1)}MB` : "";

/** One line per asset, without ? & or =. */
export function assetsText(project: Pick<ProjectDocument, "layers" | "audioTracks" | "assetMetadata">) {
  const entries = listAssets(project);
  if (!entries.length) return "Nenhuma mídia importada. Peça ao usuário para importar (botão Importar mídia ou arrastar arquivos).";
  return entries.map((entry) => [
    entry.id,
    entry.kind || "desconhecido",
    entry.duration ? `${+entry.duration.toFixed(2)}s` : "",
    entry.width && entry.height ? `${entry.width}x${entry.height} ${entry.orientation}` : "",
    entry.kind === "video" ? (entry.hasAudio ? "com áudio" : entry.hasAudio === false ? "mudo" : "") : "",
    megabytes(entry.size),
    entry.usedBy.length ? `em uso: ${entry.usedBy.join(" ")}` : "livre",
  ].filter(Boolean).join(" | ")).join("\n");
}

/** Width, height and rotation that frame a source in the composition. */
export function fitFrame(sourceWidth: number, sourceHeight: number, settings: Pick<ProjectSettings, "width" | "height">, fit: Fit) {
  const { width, height } = settings;
  if (fit === "rotate-cover") {
    const scale = Math.max(width / sourceHeight, height / sourceWidth);
    return { width: sourceWidth * scale, height: sourceHeight * scale, rotation: 90 };
  }
  const scale = fit === "cover" ? Math.max(width / sourceWidth, height / sourceHeight)
    : fit === "contain" ? Math.min(width / sourceWidth, height / sourceHeight)
    : 1;
  return { width: sourceWidth * scale, height: sourceHeight * scale, rotation: 0 };
}

export function applyFit(layer: Layer, metadata: Pick<AssetSourceMetadata, "width" | "height"> | undefined, settings: ProjectSettings, fit: Fit) {
  if (!metadata?.width || !metadata.height) throw new Error(`Resolução desconhecida para ${layer.asset}; não dá para enquadrar.`);
  const frame = fitFrame(metadata.width, metadata.height, settings, fit);
  Object.assign(layer, frame, { x: settings.width / 2, y: settings.height / 2, scaleX: 1, scaleY: 1 });
}

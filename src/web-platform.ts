import { strFromU8, unzipSync } from "fflate";
import type { ImportedAsset, OpenProjectResult, ProjectDocument } from "./types";

const assetBlobs = new Map<string, Blob>();
const assetUrls = new Map<string, string>();
let currentProjectHandle: FileSystemFileHandle | null = null;
let currentProjectName = "";

type PickerWindow = Window & typeof globalThis & {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
};

const extensionMime: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", bmp: "image/bmp", mp4: "video/mp4", webm: "video/webm",
  mov: "video/quicktime", m4v: "video/x-m4v",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac",
};

function safeName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._ -]+/g, "_").replace(/^\.+/, "") || "asset";
}

function projectFileName(name: string) {
  const clean = safeName(name).replace(/\.[^.]+$/, "");
  return `${clean}.ntvct`;
}

function mimeFor(path: string) {
  return extensionMime[path.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";
}

export function clearWebAssets() {
  for (const url of assetUrls.values()) URL.revokeObjectURL(url);
  assetUrls.clear();
  assetBlobs.clear();
  currentProjectHandle = null;
  currentProjectName = "";
}

export function resolveAssetUrl(relative: string) {
  const cached = assetUrls.get(relative);
  if (cached) return cached;
  const blob = assetBlobs.get(relative);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  assetUrls.set(relative, url);
  return url;
}

export function chooseFile(accept: string) {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

export function chooseFiles(accept: string) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.addEventListener("change", () => resolve(Array.from(input.files || [])), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}

export function hasWebAsset(reference: string) {
  return assetBlobs.has(reference);
}

export function registerWebAsset(reference: string, file: Blob) {
  const previousUrl = assetUrls.get(reference);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  assetUrls.delete(reference);
  assetBlobs.set(reference, file);
}

export async function importWebAsset(file: File): Promise<ImportedAsset> {
  const base = safeName(file.name);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : "";
  let fileName = base;
  let index = 2;
  while (assetBlobs.has(`media/${fileName}`)) fileName = `${stem}-${index++}${extension}`;
  const relativePath = `media/${fileName}`;
  registerWebAsset(relativePath, file);
  return { relativePath, absolutePath: relativePath, fileName };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function saveWebProject(project: ProjectDocument) {
  const suggestedName = projectFileName(project.settings.name);
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  try {
    if (!currentProjectHandle && (window as PickerWindow).showSaveFilePicker) {
      currentProjectHandle = await (window as PickerWindow).showSaveFilePicker!({
        suggestedName,
        types: [{ description: "Noisetupi Video Content Tool", accept: { "application/json": [".ntvct"] } }],
      });
    }
    if (currentProjectHandle) {
      const writable = await currentProjectHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      currentProjectName = currentProjectHandle.name;
      return currentProjectName;
    }
  } catch (error) {
    if ((error as DOMException).name === "AbortError") return null;
    console.warn("Direct project save unavailable; using download.", error);
  }
  downloadBlob(blob, suggestedName);
  currentProjectName = suggestedName;
  return currentProjectName;
}

export async function openWebProject(): Promise<OpenProjectResult | null> {
  const file = await chooseFile(".ntvct,.zip,.json,application/json,application/zip");
  if (!file) return null;
  clearWebAssets();
  let project: ProjectDocument;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(bytes.slice(0, 256)).replace(/^\uFEFF/, "").trimStart();
  if (header.startsWith("{")) {
    project = JSON.parse(strFromU8(bytes)) as ProjectDocument;
  } else {
    const archive = unzipSync(bytes);
    const projectData = archive["project.json"];
    if (!projectData) throw new Error("project.json não foi encontrado no pacote.");
    project = JSON.parse(strFromU8(projectData)) as ProjectDocument;
    for (const [path, bytes] of Object.entries(archive)) {
      if (path.startsWith("assets/") && !path.endsWith("/")) registerWebAsset(path, new Blob([bytes as BlobPart], { type: mimeFor(path) }));
    }
  }
  if (project.format !== "noisetupi-video-content-tool") throw new Error("Arquivo de projeto inválido.");
  currentProjectName = file.name;
  return { root: "web-project", jsonPath: file.name, project };
}

export function createWebProject(project: ProjectDocument): OpenProjectResult {
  clearWebAssets();
  currentProjectName = projectFileName(project.settings.name);
  return { root: "web-project", jsonPath: currentProjectName, project };
}

export function currentWebProjectName() {
  return currentProjectName || "UNSAVED PROJECT";
}

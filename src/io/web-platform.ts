import { AsyncZipDeflate, strFromU8, unzipSync, Zip } from "fflate";
import { migrateProject } from "../model/migrate-project";
import { assertValidProjectDocument, hasValidProjectEnvelope } from "../model/validate-project";
import type { AssetSourceMetadata, ImportedAsset, OpenProjectResult, ProjectDocument } from "../model/types";

const assetBlobs = new Map<string, Blob>();
const assetUrls = new Map<string, string>();
const assetRevisions = new Map<string, number>();
const persistedAssetRevisions = new Map<string, number>();
let currentProjectHandle: FileSystemFileHandle | null = null;
let currentProjectName = "";
const recoveryDatabaseName = "noisetupi-video-content-tool";
const recoveryDatabaseVersion = 1;
const recoverySnapshotKey = "current";

interface RecoverySnapshotRecord {
  key: string;
  project: ProjectDocument;
  assetReferences: string[];
  savedAt: string;
}

interface RecoveryAssetRecord {
  reference: string;
  blob?: Blob;
  /** Safari em navegação privada recusa Blob no IndexedDB; aí guardamos os bytes. */
  bytes?: ArrayBuffer;
  type?: string;
}

export interface ProjectRecovery {
  project: ProjectDocument;
  savedAt: string;
  assets: Array<[string, Blob]>;
}

type PickerWindow = Window & typeof globalThis & {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
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
  assetRevisions.clear();
  persistedAssetRevisions.clear();
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
  assetRevisions.set(reference, (assetRevisions.get(reference) || 0) + 1);
}

function openRecoveryDatabase() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable; project recovery cannot be stored."));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(recoveryDatabaseName, recoveryDatabaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("snapshots")) database.createObjectStore("snapshots", { keyPath: "key" });
      if (!database.objectStoreNames.contains("assets")) database.createObjectStore("assets", { keyPath: "reference" });
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("Could not open project recovery storage.")), { once: true });
    request.addEventListener("blocked", () => reject(new Error("Project recovery storage upgrade is blocked by another open app tab.")), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Project recovery transaction was aborted.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("Project recovery transaction failed.")), { once: true });
  });
}

/** Media used by clips. */
export function usedAssetReferences(project: ProjectDocument) {
  return [...new Set([
    ...project.layers.map((layer) => layer.asset).filter((asset): asset is string => Boolean(asset)),
    ...project.audioTracks.map((track) => track.asset).filter(Boolean),
  ])];
}

/** Media used by clips plus media kept only in the bin. */
export function projectAssetReferences(project: ProjectDocument) {
  return [...new Set([...usedAssetReferences(project), ...Object.keys(project.assetMetadata || {})])];
}

let recoveryStoresBytes = false;

export async function saveProjectRecovery(project: ProjectDocument): Promise<void> {
  try {
    await writeProjectRecovery(project, recoveryStoresBytes);
  } catch (error) {
    if (recoveryStoresBytes) throw error;
    // Mesmo truque do localForage: se o Blob não entra, tenta de novo com ArrayBuffer.
    recoveryStoresBytes = true;
    persistedAssetRevisions.clear();
    await writeProjectRecovery(project, true);
  }
}

async function writeProjectRecovery(project: ProjectDocument, asBytes: boolean) {
  const byteRecords = new Map<string, RecoveryAssetRecord>();
  if (asBytes) {
    // IndexedDB fecha a transação num await; os bytes são lidos antes de abri-la.
    for (const reference of projectAssetReferences(project)) {
      const blob = assetBlobs.get(reference);
      const revision = assetRevisions.get(reference) || 0;
      if (blob && persistedAssetRevisions.get(reference) !== revision) {
        byteRecords.set(reference, { reference, bytes: await blob.arrayBuffer(), type: blob.type });
      }
    }
  }
  const database = await openRecoveryDatabase();
  try {
    const references = projectAssetReferences(project);
    const transaction = database.transaction(["snapshots", "assets"], "readwrite");
    const snapshots = transaction.objectStore("snapshots");
    const assets = transaction.objectStore("assets");
    const revisionsToPersist = new Map<string, number>();
    const existingKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = assets.getAllKeys();
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error || new Error("Could not read stored project media.")), { once: true });
    });
    const keep = new Set(references);
    for (const key of existingKeys) if (typeof key === "string" && !keep.has(key)) assets.delete(key);
    for (const reference of references) {
      const blob = assetBlobs.get(reference);
      if (!blob) continue;
      const revision = assetRevisions.get(reference) || 0;
      if (persistedAssetRevisions.get(reference) !== revision || !existingKeys.includes(reference)) {
        const record = asBytes ? byteRecords.get(reference) : ({ reference, blob } satisfies RecoveryAssetRecord);
        if (!record) continue;
        assets.put(record);
        revisionsToPersist.set(reference, revision);
      }
    }
    snapshots.put({
      key: recoverySnapshotKey,
      project: structuredClone(project),
      assetReferences: references,
      savedAt: new Date().toISOString(),
    } satisfies RecoverySnapshotRecord);
    await transactionComplete(transaction);
    for (const [reference, revision] of revisionsToPersist) persistedAssetRevisions.set(reference, revision);
  } finally {
    database.close();
  }
}

export async function readProjectRecovery(): Promise<ProjectRecovery | null> {
  const database = await openRecoveryDatabase();
  try {
    const transaction = database.transaction(["snapshots", "assets"], "readonly");
    const snapshotRequest = transaction.objectStore("snapshots").get(recoverySnapshotKey);
    const record = await new Promise<RecoverySnapshotRecord | undefined>((resolve, reject) => {
      snapshotRequest.addEventListener("success", () => resolve(snapshotRequest.result as RecoverySnapshotRecord | undefined), { once: true });
      snapshotRequest.addEventListener("error", () => reject(snapshotRequest.error || new Error("Could not read the saved recovery snapshot.")), { once: true });
    });
    await transactionComplete(transaction);
    if (!record) return null;
    if (!hasValidProjectEnvelope(record.project)
      || !Array.isArray(record.assetReferences)
      || !record.assetReferences.every((reference) => typeof reference === "string")
      || typeof record.savedAt !== "string") {
      throw new Error("The stored project recovery snapshot is invalid.");
    }
    migrateProject(record.project);
    assertValidProjectDocument(record.project);
    const assets = await Promise.all(record.assetReferences.map(async (reference): Promise<[string, Blob] | null> => {
      const assetTransaction = database.transaction("assets", "readonly");
      const request = assetTransaction.objectStore("assets").get(reference);
      const value = await new Promise<RecoveryAssetRecord | undefined>((resolve, reject) => {
        request.addEventListener("success", () => resolve(request.result as RecoveryAssetRecord | undefined), { once: true });
        request.addEventListener("error", () => reject(request.error || new Error(`Could not restore media ${reference}.`)), { once: true });
      });
      await transactionComplete(assetTransaction);
      if (value?.blob instanceof Blob) return [reference, value.blob];
      return value?.bytes ? [reference, new Blob([value.bytes], { type: value.type || "" })] : null;
    }));
    return {
      project: record.project,
      savedAt: record.savedAt,
      assets: assets.filter((asset): asset is [string, Blob] => asset !== null),
    };
  } finally {
    database.close();
  }
}

export async function clearProjectRecovery() {
  const database = await openRecoveryDatabase();
  try {
    const transaction = database.transaction(["snapshots", "assets"], "readwrite");
    transaction.objectStore("snapshots").delete(recoverySnapshotKey);
    transaction.objectStore("assets").clear();
    await transactionComplete(transaction);
    persistedAssetRevisions.clear();
  } finally {
    database.close();
  }
}

export async function discardProjectRecovery() {
  await clearProjectRecovery();
}

export function assetSourceMetadata(file: File): AssetSourceMetadata {
  return {
    originalName: file.name,
    ...(file.webkitRelativePath ? { sourcePath: file.webkitRelativePath } : {}),
    size: file.size,
    lastModified: file.lastModified,
    mimeType: file.type,
  };
}

function normalizedPath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
}

export function findRelinkFile(
  reference: string,
  metadata: AssetSourceMetadata | undefined,
  files: File[],
) {
  const expectedName = metadata?.originalName || reference.replaceAll("\\", "/").split("/").pop() || reference;
  const sameNameAndSize = (file: File) => file.name.toLowerCase() === expectedName.toLowerCase()
    && (!metadata || file.size === metadata.size);
  const sourcePath = metadata?.sourcePath;
  const pathMatches = sourcePath
    ? files.filter((file) => normalizedPath(file.webkitRelativePath || "") === normalizedPath(sourcePath) && sameNameAndSize(file))
    : [];
  const matches = pathMatches.length ? pathMatches : files.filter(sameNameAndSize);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && metadata) {
    const modifiedMatches = matches.filter((file) => file.lastModified === metadata.lastModified);
    if (modifiedMatches.length === 1) return modifiedMatches[0];
  }
  return null;
}

const FINGERPRINT_SLICE = 1024 * 1024;

/** Size plus SHA-256 of the first and last MiB: fast enough for 1 GB files, stable across renames. */
export async function fileFingerprint(file: Blob) {
  const head = await file.slice(0, FINGERPRINT_SLICE).arrayBuffer();
  const tail = file.size > FINGERPRINT_SLICE ? await file.slice(Math.max(FINGERPRINT_SLICE, file.size - FINGERPRINT_SLICE)).arrayBuffer() : new ArrayBuffer(0);
  const joined = new Uint8Array(head.byteLength + tail.byteLength);
  joined.set(new Uint8Array(head), 0);
  joined.set(new Uint8Array(tail), head.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
  return `${file.size}:${[...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Relink by content when the file was renamed or moved: same fingerprint, any name. */
export async function findRelinkFileByFingerprint(metadata: AssetSourceMetadata | undefined, files: File[]) {
  if (!metadata?.fingerprint) return null;
  for (const file of files) {
    if (file.size !== metadata.size) continue;
    if (await fileFingerprint(file) === metadata.fingerprint) return file;
  }
  return null;
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
  return { relativePath, absolutePath: relativePath, fileName, sourceMetadata: assetSourceMetadata(file) };
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

function assetFileName(reference: string, metadata: AssetSourceMetadata | undefined, usedNames: Set<string>) {
  const originalName = metadata?.originalName || reference.replaceAll("\\", "/").split("/").pop() || "asset";
  const clean = safeName(originalName);
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const extension = dot > 0 ? clean.slice(dot) : "";
  let name = clean;
  let index = 2;
  while (usedNames.has(name.toLowerCase())) name = `${stem}-${index++}${extension}`;
  usedNames.add(name.toLowerCase());
  return name;
}

interface CollectedMedia {
  projectFileName: string;
  projectJson: string;
  assets: Array<{ path: string; blob: Blob }>;
}

function prepareCollectedMedia(project: ProjectDocument): CollectedMedia {
  // Bin-only media is collected when its file is loaded; used media is required.
  const used = usedAssetReferences(project);
  const references = [...used, ...projectAssetReferences(project).filter((reference) => !used.includes(reference) && assetBlobs.has(reference))];
  const missing = used.filter((reference) => !assetBlobs.has(reference));
  if (missing.length) {
    throw new Error(`Não é possível coletar mídias ausentes: ${missing.join(", ")}`);
  }
  const assets: CollectedMedia["assets"] = [];

  const collectedProject = structuredClone(project);
  const usedNames = new Set<string>();
  const referencePaths = new Map<string, string>();
  for (const reference of references) {
    const name = assetFileName(reference, project.assetMetadata?.[reference], usedNames);
    const path = `assets/${name}`;
    referencePaths.set(reference, path);
    assets.push({ path, blob: assetBlobs.get(reference)! });
  }
  for (const layer of collectedProject.layers) {
    if (layer.asset) layer.asset = referencePaths.get(layer.asset)!;
  }
  for (const track of collectedProject.audioTracks) track.asset = referencePaths.get(track.asset)!;
  if (collectedProject.assetMetadata) {
    // Bin entries whose file is not loaded keep their metadata (and relink data) under the old key.
    collectedProject.assetMetadata = Object.fromEntries(Object.entries(project.assetMetadata || {}).map(([reference, metadata]) =>
      [referencePaths.get(reference) ?? reference, metadata]));
  }

  return {
    projectFileName: projectFileName(project.settings.name),
    projectJson: JSON.stringify(collectedProject, null, 2),
    assets,
  };
}

async function zipCollectedMedia(collected: CollectedMedia): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const toArrayBuffer = (chunk: Uint8Array) => {
    const buffer = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(buffer).set(chunk);
    return buffer;
  };
  let zipError: Error | null = null;
  let resolveZip!: () => void;
  let rejectZip!: (error: Error) => void;
  const complete = new Promise<void>((resolve, reject) => {
    resolveZip = resolve;
    rejectZip = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      zipError = error;
      rejectZip(error);
      return;
    }
    if (chunk) chunks.push(chunk);
    if (final) resolveZip();
  });
  const addBytes = (path: string, bytes: Uint8Array) => {
    const entry = new AsyncZipDeflate(path, { level: 6 });
    zip.add(entry);
    entry.push(bytes, true);
  };
  try {
    addBytes("project.json", new TextEncoder().encode(collected.projectJson));
    for (const { path, blob } of collected.assets) {
      const entry = new AsyncZipDeflate(path, { level: 6 });
      zip.add(entry);
      const reader = blob.stream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          entry.push(value, false);
        }
        entry.push(new Uint8Array(), true);
      } finally {
        reader.releaseLock();
      }
    }
    zip.end();
    await complete;
    if (zipError) throw zipError;
  } catch (error) {
    zip.terminate();
    throw error;
  }
  return new Blob(chunks.map(toArrayBuffer), { type: "application/zip" });
}

export async function createCollectedMediaArchive(project: ProjectDocument): Promise<Blob> {
  return zipCollectedMedia(prepareCollectedMedia(project));
}

export async function collectWebProject(project: ProjectDocument) {
  const collected = prepareCollectedMedia(project);
  const fileName = `${safeName(project.settings.name).replace(/\.[^.]+$/, "") || "project"}-media.zip`;
  const directoryPicker = (window as PickerWindow).showDirectoryPicker;
  if (directoryPicker) {
    const directory = await directoryPicker({ mode: "readwrite" });
    const archive = await zipCollectedMedia(collected);
    const file = await directory.getFileHandle(fileName, { create: true });
    const stream = await file.createWritable();
    await stream.write(archive);
    await stream.close();
    return fileName;
  }
  downloadBlob(await zipCollectedMedia(collected), fileName);
  return fileName;
}

export async function saveWebProject(project: ProjectDocument) {
  assertValidProjectDocument(project);
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
  return openWebProjectFile(file);
}

export async function openWebProjectFile(file: File): Promise<OpenProjectResult> {
  let project: ProjectDocument;
  const importedAssets: Array<[string, Blob]> = [];
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
      if (path.startsWith("assets/") && !path.endsWith("/")) {
        importedAssets.push([path, new Blob([bytes as BlobPart], { type: mimeFor(path) })]);
      }
    }
  }
  if (!hasValidProjectEnvelope(project)) throw new Error("Arquivo de projeto inválido.");
  migrateProject(project);
  assertValidProjectDocument(project);

  clearWebAssets();
  for (const [path, blob] of importedAssets) registerWebAsset(path, blob);
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

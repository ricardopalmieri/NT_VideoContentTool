// Streaming export straight to a file chosen with the File System Access API.
import type { StreamTargetChunk } from "mediabunny";

export interface ExportFileSink {
  /** Name the user picked (may differ from the suggestion). */
  name: string;
  /** Positioned writes, the shape mediabunny's StreamTarget expects. */
  stream: WritableStream<StreamTargetChunk>;
  /** End of the farthest write so far, i.e. the file size. */
  bytesWritten(): number;
  /** Drops the partial file instead of committing it. Safe to call twice. */
  abort(): Promise<void>;
}

type SavePickerWindow = Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> };

export function hasSaveFilePicker() {
  return typeof window !== "undefined" && typeof (window as SavePickerWindow).showSaveFilePicker === "function";
}

/**
 * Asks where to save and opens the file for writing. Must run inside the click
 * that started the export (the picker needs a user gesture). Returns null when
 * the picker is missing or the user cancels, and the caller downloads instead.
 */
export async function openExportSink(suggestedName: string, kind: "mp4" | "zip"): Promise<ExportFileSink | null> {
  if (!hasSaveFilePicker()) return null;
  try {
    const handle = await (window as SavePickerWindow).showSaveFilePicker!({
      suggestedName,
      types: [kind === "mp4"
        ? { description: "MP4 H.264", accept: { "video/mp4": [".mp4"] } }
        : { description: "ZIP", accept: { "application/zip": [".zip"] } }],
    });
    const writer = (await handle.createWritable()).getWriter();
    let end = 0;
    let discarded = false;
    let finished = false;
    const stream = new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        await writer.write(chunk);
        end = Math.max(end, chunk.position + chunk.data.byteLength);
      },
      async close() {
        if (discarded) {
          await writer.abort().catch(() => undefined);
          return;
        }
        await writer.close();
        finished = true;
      },
      async abort(reason) {
        discarded = true;
        await writer.abort(reason).catch(() => undefined);
      },
    });
    return {
      name: handle.name,
      stream,
      bytesWritten: () => end,
      async abort() {
        if (finished || discarded) return;
        discarded = true;
        await writer.abort().catch(() => undefined);
      },
    };
  } catch (error) {
    // AbortError (picker cancelled) and any other failure: the caller keeps the in-memory download.
    if ((error as DOMException)?.name !== "AbortError") console.warn("Direct export unavailable; using download.", error);
    return null;
  }
}

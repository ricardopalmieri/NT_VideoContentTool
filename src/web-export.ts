import { AsyncZipDeflate, Zip, ZipPassThrough } from "fflate";
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from "mediabunny";
import { downloadBlob } from "./web-platform";

export interface BrowserExportOptions {
  fileName: string;
  width: number;
  height: number;
  fps: number;
  quality: number;
}

function canvasBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Não foi possível capturar o frame.")),
    type,
    quality,
  ));
}

export class Mp4BrowserExporter {
  private target = new BufferTarget();
  private output: Output<Mp4OutputFormat, BufferTarget>;
  private source: CanvasSource;
  private audioSource: AudioBufferSource | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly options: BrowserExportOptions, private readonly audio: AudioBuffer | null = null) {
    const pixelsPerSecond = options.width * options.height * options.fps;
    const bitrate = Math.round(Math.max(1_500_000, pixelsPerSecond * (.055 + options.quality / 1000)));
    this.output = new Output({ format: new Mp4OutputFormat(), target: this.target });
    this.source = new CanvasSource(canvas, {
      codec: "avc",
      quality: new Quality({ bitrate }),
      latencyMode: "quality",
    });
    this.output.addVideoTrack(this.source, { frameRate: options.fps });
    if (audio) {
      this.audioSource = new AudioBufferSource({ codec: "aac", quality: new Quality({ bitrate: 192_000 }) });
      this.output.addAudioTrack(this.audioSource);
    }
    this.output.setMetadataTags({ title: options.fileName, artist: "Noisetupi Video Content Tool" });
  }

  async start() {
    await this.output.start();
    if (this.audioSource && this.audio) await this.audioSource.add(this.audio);
  }

  async addFrame(index: number) {
    const duration = 1 / this.options.fps;
    await this.source.add(index * duration, duration, { keyFrame: index % Math.max(1, this.options.fps * 2) === 0 });
  }

  async finish() {
    await this.output.finalize();
    if (!this.target.buffer) throw new Error("O encoder não produziu um arquivo MP4.");
    const blob = new Blob([this.target.buffer as BlobPart], { type: "video/mp4" });
    downloadBlob(blob, `${this.options.fileName}.mp4`);
    return blob.size;
  }

  async cancel() {
    await this.output.cancel();
  }
}

export class PngSequenceBrowserExporter {
  private chunks: Uint8Array[] = [];
  private error: Error | null = null;
  private zip: Zip;
  private completed: Promise<void>;
  private resolveCompleted!: () => void;
  private rejectCompleted!: (error: Error) => void;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: BrowserExportOptions) {
    this.completed = new Promise<void>((resolve, reject) => {
      this.resolveCompleted = resolve;
      this.rejectCompleted = reject;
    });
    this.zip = new Zip((error, chunk, final) => {
      if (error) {
        this.error = error;
        this.rejectCompleted(error);
        return;
      }
      this.chunks.push(chunk);
      if (final) this.resolveCompleted();
    });
  }

  async start() {
    const manifest = new AsyncZipDeflate("render-info.txt", { level: 6 });
    this.zip.add(manifest);
    manifest.push(new TextEncoder().encode(
      `Noisetupi Video Content Tool\n${this.options.width}x${this.options.height}\n${this.options.fps} fps\n`,
    ), true);
  }

  async addFrame(index: number) {
    const blob = await canvasBlob(this.canvas);
    const file = new ZipPassThrough(`frames/frame-${String(index + 1).padStart(6, "0")}.png`);
    this.zip.add(file);
    file.push(new Uint8Array(await blob.arrayBuffer()), true);
    if (this.error) throw this.error;
  }

  async finish() {
    this.zip.end();
    await this.completed;
    const blob = new Blob(this.chunks as BlobPart[], { type: "application/zip" });
    downloadBlob(blob, `${this.options.fileName}-png-sequence.zip`);
    return blob.size;
  }

  cancel() {
    this.zip.terminate();
  }
}

export function createExportCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function copyFrame(
  source: HTMLCanvasElement,
  destination: HTMLCanvasElement,
  alpha: boolean,
  background: string,
) {
  const context = destination.getContext("2d", { alpha })!;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, destination.width, destination.height);
  if (!alpha) {
    context.fillStyle = background || "#000000";
    context.fillRect(0, 0, destination.width, destination.height);
  }
  context.drawImage(source, 0, 0, destination.width, destination.height);
}

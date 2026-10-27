// Output size of an export: a percentage of the composition, even for H.264.
export const EXPORT_SCALES = [1, .75, .5, .25] as const;
export type ExportScale = typeof EXPORT_SCALES[number];
export type ExportFormat = "mp4-h264" | "png-sequence";

// Same floor the renderer uses for its render surface (see resizeRenderSurface).
const MIN_RENDER_SIDE = 16;

export function parseExportScale(value: unknown): ExportScale {
  const number = Number(value);
  return EXPORT_SCALES.find((scale) => Math.abs(scale - number) < 1e-6) ?? 1;
}

/** H.264 4:2:0 needs even sides: round down, never below 2. */
export function evenDown(value: number) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function exportSize(composition: { width: number; height: number }, scale: number, format: ExportFormat) {
  const width = Math.max(MIN_RENDER_SIDE, Math.round(composition.width * scale));
  const height = Math.max(MIN_RENDER_SIDE, Math.round(composition.height * scale));
  return format === "mp4-h264" ? { width: evenDown(width), height: evenDown(height) } : { width, height };
}

export function exportScaleLabel(composition: { width: number; height: number }, scale: number, format: ExportFormat) {
  const size = exportSize(composition, scale, format);
  return `${Math.round(scale * 100)}% · ${size.width}×${size.height}`;
}

/** Renderers that can draw export frames straight at a lower resolution implement this. */
export interface ExportScalable {
  setExportScale?(scale: number): void;
}

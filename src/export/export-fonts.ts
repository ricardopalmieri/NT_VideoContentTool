// Fonts the text layers need, so early export frames never use a fallback font.
import type { Layer } from "../model/types";

export interface FontRequest {
  family: string;
  weight: number;
}

// Same defaults the renderer uses when drawing text.
const DEFAULT_FAMILY = "IBM Plex Sans";
const DEFAULT_WEIGHT = 500;

export function collectProjectFonts(project: { layers: Array<Pick<Layer, "kind" | "fontFamily" | "fontWeight" | "keyframes">> }): FontRequest[] {
  const found = new Map<string, FontRequest>();
  for (const layer of project.layers) {
    if (layer.kind !== "text") continue;
    const family = layer.fontFamily?.trim() || DEFAULT_FAMILY;
    const weights = [layer.fontWeight || DEFAULT_WEIGHT, ...(layer.keyframes?.fontWeight ?? []).map((key) => key.value)];
    for (const raw of weights) {
      const weight = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_WEIGHT;
      found.set(`${family}\u0000${weight}`, { family, weight });
    }
  }
  return [...found.values()].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
}

export function fontLoadQuery({ family, weight }: FontRequest) {
  return `${weight} 48px "${family.replace(/["\\]/g, "\\$&")}"`;
}

interface FontLoader {
  load(font: string): Promise<unknown>;
  ready: Promise<unknown>;
}

export async function loadProjectFonts(project: Parameters<typeof collectProjectFonts>[0], fonts: FontLoader = document.fonts) {
  // A font that fails to load falls back like it does in the preview; it must not block the export.
  await Promise.all(collectProjectFonts(project).map((request) => fonts.load(fontLoadQuery(request)).catch(() => undefined)));
  await fonts.ready;
}

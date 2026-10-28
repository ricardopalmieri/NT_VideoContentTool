import type { EffectKind } from "../../model/types";
import { bloom } from "./bloom";
import { blur } from "./blur";
import { chromaticAberration } from "./chromatic";
import { color } from "./color";
import { glitch } from "./glitch";
import { grain } from "./grain";
import { halftone } from "./halftone";
import { sharpen } from "./sharpen";
import { tiltShift } from "./tilt-shift";
import type { EffectModule } from "./types";
import { vignette } from "./vignette";
import { zoomBlur } from "./zoom-blur";

export { EffectRuntime, type FxTarget } from "./runtime";
export type { EffectModule, EffectFrame, PassSpec } from "./types";

// Para criar um efeito: um arquivo aqui (EffectModule), uma entrada nesta lista, e o EffectKind,
// o catálogo e as faixas em src/model (types.ts, effect-catalog.ts). Os demais efeitos ainda usam o shader único.
export const EFFECT_MODULES: Partial<Record<EffectKind, EffectModule>> = Object.fromEntries(
  [blur, bloom, glitch, grain, color, vignette, chromaticAberration, sharpen, zoomBlur, tiltShift, halftone].map((module) => [module.kind, module]),
);

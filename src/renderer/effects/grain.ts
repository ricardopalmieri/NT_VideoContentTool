import type { EffectModule } from "./types";

// Grão de filme: ruído gaussiano aproximado (soma de dois sorteios), mais forte nos meios-tons,
// em células de `scale` px da composição, renovado 24 vezes por segundo. A ideia vem do NoiseEffect
// do pmndrs/postprocessing (zlib); a ponderação por luminância e o passo de tempo são nossos.
const FRAGMENT = `
uniform float u_amount;
uniform float u_cell;
void main() {
  vec4 c = unpremul(texture(u_input, v_uv));
  vec2 cell = floor(v_uv * u_frame / max(1.0, u_cell));
  float t = floor(u_time * 24.0);
  float n = hash(cell + t * 13.37) + hash(cell.yx * 1.31 + t * 7.11) - 1.0;
  float l = luma(c.rgb);
  float midtones = 1.0 - .6 * abs(2.0 * l - 1.0);
  c.rgb = max(c.rgb + n * u_amount * midtones, 0.0);
  outColor = premul(c);
}`;

export const grain: EffectModule = {
  kind: "noise",
  passes(params, frame) {
    const amount = Math.max(0, params.amount ?? 0);
    if (amount <= 0) return [];
    return [{ id: "grain", fragment: FRAGMENT, uniforms: { u_amount: amount, u_cell: Math.max(.1, params.scale ?? 1) * frame.scale } }];
  },
};

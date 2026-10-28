import type { EffectModule } from "./types";

// Vinheta: a curva `smoothstep(0.8, offset * 0.799, d * (darkness + offset))` é a do VignetteEffect do
// pmndrs/postprocessing (zlib), a mesma do vignette do glfx.js (MIT). Aqui o escurecimento é uma camada
// preta "por cima" em alpha pré-multiplicado, então também aparece sobre fundo transparente.
// `roundness` interpola entre seguir o quadro (0) e um círculo (1).
const FRAGMENT = `
uniform float u_offset;
uniform float u_darkness;
uniform float u_roundness;
void main() {
  vec4 c = texture(u_input, v_uv);
  vec2 p = v_uv - .5;
  float aspect = u_frame.x / u_frame.y;
  p.x *= mix(1.0, aspect, u_roundness);
  float d = length(p) * mix(1.0, 1.0 / max(aspect, 1.0), u_roundness);
  float keep = smoothstep(.8, u_offset * .799, d * (u_darkness + u_offset));
  outColor = vec4(c.rgb * keep, c.a * keep + (1.0 - keep));
}`;

export const vignette: EffectModule = {
  kind: "vignette",
  passes(params) {
    return [{ id: "vignette", fragment: FRAGMENT, uniforms: { u_offset: params.offset ?? .5, u_darkness: params.darkness ?? .5, u_roundness: params.roundness ?? 0 } }];
  },
};

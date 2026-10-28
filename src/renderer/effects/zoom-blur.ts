import type { EffectModule } from "./types";

// Desfoque de zoom: amostras ao longo da reta até o centro, com peso triangular e deslocamento sorteado
// por pixel para esconder as faixas. Portado do zoomBlur do glfx.js (MIT, © 2011 Evan Wallace).
// A entrada já é pré-multiplicada, então a soma direta equivale ao `sample.rgb *= sample.a` do original.
const FRAGMENT = `
uniform vec2 u_center;
uniform float u_strength;
void main() {
  vec4 color = vec4(0.0);
  float total = 0.0;
  vec2 toCenter = u_center - v_uv;
  float offset = hash(v_uv * u_size);
  for (float t = 0.0; t <= 40.0; t++) {
    float percent = (t + offset) / 40.0;
    float weight = 4.0 * (percent - percent * percent);
    color += texture(u_input, v_uv + toCenter * percent * u_strength) * weight;
    total += weight;
  }
  outColor = color / total;
}`;

export const zoomBlur: EffectModule = {
  kind: "zoomBlur",
  passes(params) {
    const strength = Math.max(0, Math.min(1, params.strength ?? 0));
    if (strength <= 0) return [];
    return [{ id: "zoom", fragment: FRAGMENT, uniforms: { u_center: [params.centerX ?? .5, 1 - (params.centerY ?? .5)], u_strength: strength } }];
  },
};

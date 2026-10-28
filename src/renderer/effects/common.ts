import type { PassSpec } from "./types";

// Funções GLSL compartilhadas, injetadas depois do cabeçalho de todo passe.
export const GLSL_COMMON = `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float luma(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
vec4 unpremul(vec4 c) { return c.a > .00001 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
`;

// Mistura seca/molhada: usada pelo runtime quando DRY / WET < 1.
export const MIX_FRAGMENT = `
uniform float u_mix;
void main() {
  outColor = mix(texture(u_dry, v_uv), texture(u_wet, v_uv), clamp(u_mix, 0.0, 1.0));
}`;

const MAX_TAPS = 48;

/**
 * Gaussiana separável (dois passes) com amostragem em linha e CLAMP_TO_EDGE.
 * `sigma` em pixels do buffer de entrada. Acima de MAX_TAPS por lado as amostras
 * se afastam (passo > 1 px); a curva é suave o bastante para o filtro bilinear cobrir os vãos.
 * Técnica clássica de blur gaussiano separável (ver glfx.js triangleBlur e three.js UnrealBloomPass,
 * cujos passes horizontal/vertical têm a mesma estrutura).
 */
export function gaussianPasses(id: string, input: string, sigma: number, size: number, output: string): PassSpec[] {
  const halfWidth = Math.max(1, sigma * 3);
  const taps = Math.min(MAX_TAPS, Math.ceil(halfWidth));
  const stride = Math.max(1, halfWidth / MAX_TAPS);
  const uniforms = (horizontal: boolean) => ({ u_dir: horizontal ? [1, 0] : [0, 1], u_sigma: Math.max(.1, sigma), u_taps: taps, u_stride: stride });
  return [
    { id: `${id}-h`, fragment: GAUSSIAN_FRAGMENT, inputs: { u_input: input }, size, uniforms: uniforms(true) },
    { id: `${id}-v`, fragment: GAUSSIAN_FRAGMENT, inputs: { u_input: `${id}-h` }, output, size, uniforms: uniforms(false) },
  ];
}

const GAUSSIAN_FRAGMENT = `
uniform vec2 u_dir;
uniform float u_sigma;
uniform float u_taps;
uniform float u_stride;
void main() {
  vec2 texel = u_dir / u_size;
  vec4 sum = texture(u_input, v_uv);
  float total = 1.0;
  for (float i = 1.0; i <= ${MAX_TAPS}.0; i++) {
    if (i > u_taps) break;
    float x = i * u_stride;
    float w = exp(-.5 * x * x / (u_sigma * u_sigma));
    sum += w * (texture(u_input, v_uv + texel * x) + texture(u_input, v_uv - texel * x));
    total += 2.0 * w;
  }
  outColor = sum / total;
}`;

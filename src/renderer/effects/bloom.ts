import { gaussianPasses } from "./common";
import type { EffectModule, PassSpec } from "./types";

// Bloom em cadeia de mips, na estrutura do UnrealBloomPass do three.js (MIT, © 2010-2026 three.js authors):
// filtro de luminosidade -> desfoque gaussiano em 5 resoluções decrescentes -> soma ponderada.
// Diferenças: o limiar usa joelho suave quadrático (curva do Unity/Karis) em vez de smoothstep, o raio é em
// pixels da composição e a soma é composta em "screen" exponencial, que nunca estoura um fundo claro.

const LEVELS = 5;
// Peso de cada mip na soma (já normalizado) e multiplicador do sigma em pixels do quadro.
const LEVEL_WEIGHTS = [1, .8, .6, .4, .2];
const LEVEL_SPREAD = [.6, 1, 1.7, 2.8, 4.5];

const PREFILTER = `
uniform float u_threshold;
uniform float u_knee;
void main() {
  // Média 2x2 do quadro cheio para meia resolução (evita cintilar em pixels isolados).
  vec2 texel = 1.0 / u_frame;
  vec4 c = .25 * (texture(u_input, v_uv + texel * vec2(-.5, -.5)) + texture(u_input, v_uv + texel * vec2(.5, -.5))
    + texture(u_input, v_uv + texel * vec2(-.5, .5)) + texture(u_input, v_uv + texel * vec2(.5, .5)));
  float brightness = max(c.r, max(c.g, c.b));
  float soft = clamp(brightness - u_threshold + u_knee, 0.0, 2.0 * u_knee);
  soft = soft * soft / (4.0 * u_knee + .0001);
  float weight = max(soft, brightness - u_threshold) / max(brightness, .0001);
  outColor = c * max(weight, 0.0);
}`;

const DOWNSAMPLE = `
void main() {
  vec2 texel = .5 / u_size;
  outColor = .25 * (texture(u_input, v_uv + texel * vec2(-1., -1.)) + texture(u_input, v_uv + texel * vec2(1., -1.))
    + texture(u_input, v_uv + texel * vec2(-1., 1.)) + texture(u_input, v_uv + texel * vec2(1., 1.)));
}`;

const COMPOSE = `
uniform float u_intensity;
uniform float u_saturation;
uniform float u_weights[${LEVELS}];
void main() {
  vec4 src = texture(u_src, v_uv);
  vec4 glow = u_weights[0] * texture(u_level0, v_uv) + u_weights[1] * texture(u_level1, v_uv)
    + u_weights[2] * texture(u_level2, v_uv) + u_weights[3] * texture(u_level3, v_uv) + u_weights[4] * texture(u_level4, v_uv);
  glow.rgb = mix(vec3(luma(glow.rgb)), glow.rgb, u_saturation) * u_intensity;
  glow.a *= u_intensity;
  glow = max(glow, 0.0);
  vec4 lift = 1.0 - exp(-glow);
  outColor = vec4(src.rgb + (1.0 - min(src.rgb, 1.0)) * lift.rgb, src.a + (1.0 - min(src.a, 1.0)) * lift.a);
}`;

export const bloom: EffectModule = {
  kind: "glow",
  passes(params, frame) {
    const intensity = Math.max(0, params.intensity ?? 1);
    if (intensity <= 0) return [];
    const radius = Math.max(.5, params.radius ?? 14) * frame.scale;
    const total = LEVEL_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
    const passes: PassSpec[] = [
      { id: "prefilter", fragment: PREFILTER, inputs: { u_input: "src" }, size: .5, uniforms: { u_threshold: params.threshold ?? .6, u_knee: Math.max(.01, params.knee ?? .2) } },
    ];
    let previous = "prefilter";
    for (let level = 0; level < LEVELS; level++) {
      const scale = 2 ** (level + 1);
      const size = 1 / scale;
      if (level > 0) passes.push({ id: `down${level}`, fragment: DOWNSAMPLE, inputs: { u_input: previous }, size });
      const input = level > 0 ? `down${level}` : previous;
      // sigma pedido em pixels do quadro, convertido para pixels deste mip.
      const sigma = Math.max(.8, radius * LEVEL_SPREAD[level] / scale);
      passes.push(...gaussianPasses(`mip${level}`, input, sigma, size, `level${level}`));
      previous = `level${level}`;
    }
    passes.push({
      id: "compose",
      fragment: COMPOSE,
      inputs: { u_src: "src", u_level0: "level0", u_level1: "level1", u_level2: "level2", u_level3: "level3", u_level4: "level4" },
      uniforms: { u_intensity: intensity, u_saturation: params.saturation ?? 1, ...Object.fromEntries(LEVEL_WEIGHTS.map((weight, index) => [`u_weights[${index}]`, weight / total])) },
    });
    return passes;
  },
};

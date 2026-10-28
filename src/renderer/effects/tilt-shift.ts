import type { EffectModule } from "./types";

// Tilt-shift: desfoque triangular cujo raio cresce com a distância a uma faixa em foco.
// Portado do tiltShift do glfx.js (MIT, © 2011 Evan Wallace): dois passes, o segundo perpendicular ao
// primeiro, com amostras de peso triangular e deslocamento sorteado por pixel.
// `focus` (0 topo, 1 base) e `angle` posicionam a linha de foco; `gradient` é a largura da transição.
const FRAGMENT = `
uniform float u_blur;
uniform float u_angleRad;
uniform float u_gradient;
uniform vec2 u_start;
uniform vec2 u_delta;
void main() {
  vec4 color = vec4(0.0);
  float total = 0.0;
  float offset = hash(v_uv * u_size + u_delta);
  vec2 lineDir = vec2(cos(u_angleRad), sin(u_angleRad));
  vec2 normal = vec2(-lineDir.y, lineDir.x);
  float radius = smoothstep(0.0, 1.0, abs(dot(v_uv * u_frame - u_start, normal)) / max(1.0, u_gradient)) * u_blur;
  for (float t = -30.0; t <= 30.0; t++) {
    float percent = (t + offset - .5) / 30.0;
    float weight = 1.0 - abs(percent);
    color += texture(u_input, v_uv + u_delta / u_size * percent * radius) * weight;
    total += weight;
  }
  outColor = color / total;
}`;

export const tiltShift: EffectModule = {
  kind: "tiltShift",
  passes(params, frame) {
    const blur = Math.max(0, params.blur ?? 0) * frame.scale;
    if (blur < .25) return [];
    const angle = (params.angle ?? 0) * Math.PI / 180;
    const common = {
      u_blur: blur,
      u_gradient: Math.max(1, params.gradient ?? 140) * frame.scale,
      u_angleRad: angle,
      u_start: [frame.width / 2, (1 - (params.focus ?? .5)) * frame.height],
    };
    return [
      { id: "tilt-a", fragment: FRAGMENT, inputs: { u_input: "src" }, uniforms: { ...common, u_delta: [Math.cos(angle), Math.sin(angle)] } },
      { id: "tilt-b", fragment: FRAGMENT, inputs: { u_input: "tilt-a" }, uniforms: { ...common, u_delta: [-Math.sin(angle), Math.cos(angle)] } },
    ];
  },
};

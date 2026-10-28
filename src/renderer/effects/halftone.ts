import type { EffectModule } from "./types";

// Retícula de meio-tom colorida (CMYK em quatro ângulos), do colorHalftone do glfx.js (MIT, © 2011 Evan Wallace).
// `size` é o passo da retícula em pixels da composição; `angle` gira o conjunto.
const FRAGMENT = `
uniform float u_angle;
uniform float u_dot;
float pattern(float angle) {
  float s = sin(angle), c = cos(angle);
  vec2 tex = v_uv * u_frame - u_frame * .5;
  vec2 point = vec2(c * tex.x - s * tex.y, s * tex.x + c * tex.y) * u_dot;
  return (sin(point.x) * sin(point.y)) * 4.0;
}
void main() {
  vec4 src = unpremul(texture(u_input, v_uv));
  vec3 cmy = 1.0 - src.rgb;
  float k = min(cmy.x, min(cmy.y, cmy.z));
  cmy = (cmy - k) / max(1.0 - k, .0001);
  cmy = clamp(cmy * 10.0 - 3.0 + vec3(pattern(u_angle + .26179), pattern(u_angle + 1.30899), pattern(u_angle)), 0.0, 1.0);
  k = clamp(k * 10.0 - 5.0 + pattern(u_angle + .78539), 0.0, 1.0);
  outColor = premul(vec4(1.0 - cmy - k, src.a));
}`;

export const halftone: EffectModule = {
  kind: "halftone",
  passes(params, frame) {
    const size = Math.max(1.5, params.size ?? 8) * frame.scale;
    return [{ id: "halftone", fragment: FRAGMENT, uniforms: { u_angle: (params.angle ?? 25) * Math.PI / 180, u_dot: Math.PI / size } }];
  },
};

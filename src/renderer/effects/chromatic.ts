import type { EffectModule } from "./types";

// Aberração cromática: canais R e B lidos em posições opostas, G no centro, alpha = máximo dos três.
// Estrutura do ChromaticAberrationEffect do pmndrs/postprocessing (zlib), com a modulação radial dele
// (o deslocamento cresce do centro para a borda). `offset` é em pixels da composição.
const FRAGMENT = `
uniform float u_offset;
uniform float u_radial;
uniform float u_angle;
void main() {
  vec2 fromCenter = (v_uv - .5) * u_frame;
  float distanceToCorner = clamp(length(fromCenter) / (.5 * length(u_frame)), 0.0, 1.0);
  vec2 radialDir = length(fromCenter) > .0001 ? normalize(fromCenter) : vec2(0.0);
  vec2 dir = mix(vec2(cos(u_angle), sin(u_angle)), radialDir, u_radial);
  float strength = u_offset * u_scale * mix(1.0, distanceToCorner, u_radial);
  vec2 shift = dir * strength / u_frame;
  vec4 mid = texture(u_input, v_uv);
  vec4 red = texture(u_input, v_uv + shift);
  vec4 blue = texture(u_input, v_uv - shift);
  outColor = vec4(red.r, mid.g, blue.b, max(max(red.a, blue.a), mid.a));
}`;

export const chromaticAberration: EffectModule = {
  kind: "chromaticAberration",
  passes(params) {
    if (!(params.offset > 0)) return [];
    return [{ id: "chromatic", fragment: FRAGMENT, uniforms: { u_offset: params.offset, u_radial: params.radial ?? 1, u_angle: (params.angle ?? 0) * Math.PI / 180 } }];
  },
};

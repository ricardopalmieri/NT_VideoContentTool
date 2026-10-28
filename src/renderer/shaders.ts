export const vertexSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * .5 + .5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_texture_r;
uniform sampler2D u_texture_g;
uniform sampler2D u_texture_b;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_effect;
uniform float u_mix;
// Composite final: opacidade × fade aplicados depois dos efeitos; u_darken compõe sobre branco para o MIN.
uniform float u_opacity;
uniform float u_darken;
uniform float u_p0;
uniform float u_p1;
uniform float u_p2;
uniform float u_p3;
uniform float u_p4;
uniform float u_p5;
uniform float u_p6;
uniform float u_p7;
in vec2 v_uv;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
vec4 source(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture(u_texture, uv);
}
float lum(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
float edgeAt(vec2 uv, float thickness) {
  vec2 px = thickness / u_resolution;
  float tl = lum(source(uv + px * vec2(-1., 1.)).rgb);
  float tc = lum(source(uv + px * vec2( 0., 1.)).rgb);
  float tr = lum(source(uv + px * vec2( 1., 1.)).rgb);
  float ml = lum(source(uv + px * vec2(-1., 0.)).rgb);
  float mr = lum(source(uv + px * vec2( 1., 0.)).rgb);
  float bl = lum(source(uv + px * vec2(-1.,-1.)).rgb);
  float bc = lum(source(uv + px * vec2( 0.,-1.)).rgb);
  float br = lum(source(uv + px * vec2( 1.,-1.)).rgb);
  float gx = -tl - 2. * ml - bl + tr + 2. * mr + br;
  float gy = -bl - 2. * bc - br + tl + 2. * tc + tr;
  float alphaEdge = abs(source(uv + px).a - source(uv - px).a);
  return max(length(vec2(gx, gy)), alphaEdge);
}
void main() {
  vec2 uv = v_uv;
  vec4 c = source(uv);

  if (u_effect == 1) {
    if (u_p0 < 1.5) uv.x = u_p1 - abs(uv.x - u_p1);
    else if (u_p0 < 2.5) uv.y = u_p1 - abs(uv.y - u_p1);
    else uv = vec2(u_p1) - abs(uv - vec2(u_p1));
    c = source(uv);
  } else if (u_effect == 2) {
    vec2 fuv = (uv - .5) * (1.0 - u_p1) + .5 + vec2(u_p2, u_p3);
    vec4 echo = source(fuv);
    c = mix(c, echo, clamp(u_p0, 0.0, .95));
  } else if (u_effect == 4) {
    vec2 p = uv - .5;
    float r = length(p) / max(.05, u_p2);
    float a = atan(p.y, p.x) + u_p1;
    float seg = 6.2831853 / max(2.0, u_p0);
    a = abs(mod(a + seg * .5, seg) - seg * .5);
    c = source(vec2(cos(a), sin(a)) * r + .5);
  } else if (u_effect == 6) {
    if (uv.x < u_p0 || uv.x > u_p1 || uv.y < u_p2 || uv.y > u_p3) c = vec4(0.0);
  } else if (u_effect == 7) {
    float e = smoothstep(u_p1, u_p1 + .12, edgeAt(uv, 1.0)) * u_p0;
    vec3 edgeColor = mix(vec3(e), c.rgb * e, u_p2);
    c = vec4(edgeColor, max(c.a * e, e));
  } else if (u_effect == 8) {
    vec3 key = vec3(abs(u_p0 * 6.0 - 3.0) - 1.0, 2.0 - abs(u_p0 * 6.0 - 2.0), 2.0 - abs(u_p0 * 6.0 - 4.0));
    key = clamp(key, 0.0, 1.0);
    // Textures are premultiplied: compare the straight color, scale all channels.
    vec3 straight = c.a > .0001 ? c.rgb / c.a : c.rgb;
    float dist = distance(straight, key);
    c *= smoothstep(u_p1, u_p1 + max(.001, u_p2), dist);
  } else if (u_effect == 10) {
    vec3 straight = c.a > .0001 ? c.rgb / c.a : c.rgb;
    float luma = dot(straight, vec3(.2126, .7152, .0722));
    float keep = smoothstep(u_p0, u_p0 + max(.001, u_p1), luma);
    c *= u_p2 > .5 ? 1.0 - keep : keep;
  } else if (u_effect == 11) {
    vec3 straight = c.a > .0001 ? c.rgb / c.a : c.rgb;
    vec3 keyColor = vec3(u_p0, u_p1, u_p2);
    mat3 toCbCr = mat3(-.168736, .5, 0.0, -.331264, -.418688, 0.0, .5, -.081312, 0.0);
    vec2 chroma = (toCbCr * straight).xy;
    vec2 keyChroma = (toCbCr * keyColor).xy;
    float keep = smoothstep(u_p3, u_p3 + max(.001, u_p4), distance(chroma, keyChroma));
    float gray = dot(straight, vec3(.2126, .7152, .0722));
    straight = mix(straight, mix(vec3(gray), straight, keep), u_p5);
    c = vec4(straight * c.a * keep, c.a * keep);
  } else if (u_effect == 9) {
    float e = edgeAt(uv, max(.5, u_p2));
    float line = smoothstep(u_p1, u_p1 + max(.005, u_p3), e);
    float axis = u_p4 < .5 ? uv.x : u_p4 < 1.5 ? (1.0 - uv.x) : u_p4 < 2.5 ? uv.y : (1.0 - uv.y);
    float organic = (hash(floor(uv * u_resolution / 8.0)) - .5) * u_p5;
    float reveal = 1.0 - smoothstep(u_p0 - .035, u_p0 + .035, axis + organic);
    if (u_p7 > .5) reveal = 1.0 - reveal;
    c = vec4(c.rgb * line, max(c.a, line) * reveal);
  } else if (u_effect == 20) {
    vec4 original = c;
    vec4 shifted = vec4(
      texture(u_texture_r, uv).r,
      texture(u_texture_g, uv).g,
      texture(u_texture_b, uv).b,
      original.a
    );
    c = shifted;
  } else if (u_effect == 23) {
    float scan = sin(uv.y * max(20., u_p1) * 3.14159) * .5 + .5;
    float tracking = step(.96, hash(vec2(floor(uv.y * 60.), floor(u_time * 5.)))) * u_p2;
    c.rgb *= 1.0 - scan * .16 * u_p0;
    c.rgb += tracking;
    c.r = source(uv + vec2(.002 * u_p0, 0)).r;
    c.b = source(uv - vec2(.003 * u_p0, 0)).b;
  } else if (u_effect == 24) {
    vec2 shake = vec2(hash(vec2(floor(u_time * u_p1), 1.)), hash(vec2(2., floor(u_time * u_p1)))) - .5;
    c = source(uv + shake * u_p0);
  }
  if (u_effect != 0) c = mix(source(v_uv), c, clamp(u_mix, 0.0, 1.0));
  c = clamp(c, 0.0, 1.0) * u_opacity;
  if (u_darken > 0.5) c = vec4(c.rgb + (1.0 - c.a), 1.0);
  outColor = c;
}`;


// Passe sem efeito (composite da layer, cópia, saída final): as mesmas contas de
// fragmentSource quando u_effect == 0, sem o resto do shader de efeitos, que na GPU
// de software custa caro por pixel.
export const compositeFragmentSource = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_opacity;
// Compõe sobre branco para o MIN do blend "darken".
uniform float u_darken;
in vec2 v_uv;
out vec4 outColor;

void main() {
  vec4 c = vec4(0.0);
  if (!(v_uv.x < 0.0 || v_uv.x > 1.0 || v_uv.y < 0.0 || v_uv.y > 1.0)) c = texture(u_texture, v_uv);
  c = clamp(c, 0.0, 1.0) * u_opacity;
  if (u_darken > 0.5) c = vec4(c.rgb + (1.0 - c.a), 1.0);
  outColor = c;
}`;

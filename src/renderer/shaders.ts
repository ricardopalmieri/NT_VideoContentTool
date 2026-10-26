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
vec4 bloomExtract(vec2 uv) {
  vec4 sampleColor = source(uv);
  float brightness = max(sampleColor.r, max(sampleColor.g, sampleColor.b));
  float knee = max(.0001, u_p3);
  float contribution = smoothstep(u_p0 - knee, u_p0 + knee, brightness);
  return sampleColor * contribution;
}
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
  } else if (u_effect == 3) {
    c.rgb += u_p0;
    c.rgb = (c.rgb - .5) * u_p1 + .5;
    float gray = lum(c.rgb);
    c.rgb = mix(vec3(gray), c.rgb, u_p2);
    c.rgb = pow(max(c.rgb, 0.0), vec3(1.0 / max(.05, u_p3)));
  } else if (u_effect == 4) {
    vec2 p = uv - .5;
    float r = length(p) / max(.05, u_p2);
    float a = atan(p.y, p.x) + u_p1;
    float seg = 6.2831853 / max(2.0, u_p0);
    a = abs(mod(a + seg * .5, seg) - seg * .5);
    c = source(vec2(cos(a), sin(a)) * r + .5);
  } else if (u_effect == 5) {
    vec2 d = (u_p1 < .5 ? vec2(max(.01, u_p0), 0.0) : vec2(0.0, max(.01, u_p0))) / u_resolution;
    c = source(uv) * .227027;
    c += source(uv + d * 1.384615) * .316216;
    c += source(uv - d * 1.384615) * .316216;
    c += source(uv + d * 3.230769) * .070270;
    c += source(uv - d * 3.230769) * .070270;
  } else if (u_effect == 6) {
    if (uv.x < u_p0 || uv.x > u_p1 || uv.y < u_p2 || uv.y > u_p3) c = vec4(0.0);
  } else if (u_effect == 7) {
    float e = smoothstep(u_p1, u_p1 + .12, edgeAt(uv, 1.0)) * u_p0;
    vec3 edgeColor = mix(vec3(e), c.rgb * e, u_p2);
    c = vec4(edgeColor, max(c.a * e, e));
  } else if (u_effect == 8) {
    vec3 key = vec3(abs(u_p0 * 6.0 - 3.0) - 1.0, 2.0 - abs(u_p0 * 6.0 - 2.0), 2.0 - abs(u_p0 * 6.0 - 4.0));
    key = clamp(key, 0.0, 1.0);
    float dist = distance(c.rgb, key);
    c.a *= smoothstep(u_p1, u_p1 + max(.001, u_p2), dist);
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
  } else if (u_effect == 21) {
    float n = hash(uv * u_resolution * max(.1, u_p1) + u_time);
    c.rgb += (n - .5) * u_p0;
  } else if (u_effect == 22) {
    float frame = floor(u_time * max(.1, u_p1));
    float bands = max(2., u_p2);
    float band = floor(uv.y * bands);
    float eventNoise = hash(vec2(band, frame));
    float gate = step(1.0 - max(.0001, clamp(u_p0, 0.0, 1.0)), eventNoise) * step(.0001, u_p0);
    float shift = (hash(vec2(frame, band * 1.37)) - .5) * u_p3 * gate;
    float micro = (hash(vec2(floor(uv.y * bands * 5.0), frame + 18.0)) - .5) * u_p3 * .18 * gate;
    vec2 shiftedUv = uv + vec2(shift + micro, 0.0);
    float split = u_p4 / u_resolution.x * gate;
    vec4 glitched = source(shiftedUv);
    glitched.r = source(shiftedUv + vec2(split, 0)).r;
    glitched.b = source(shiftedUv - vec2(split, 0)).b;
    float scan = sin(uv.y * u_resolution.y * 3.14159265) * .5 + .5;
    glitched.rgb *= 1.0 - scan * u_p5 * gate;
    c = glitched;
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
  } else if (u_effect == 25) {
    vec4 original = c;
    vec2 d = vec2(max(.5, u_p1)) / u_resolution;
    vec4 bloom = bloomExtract(uv) * .08;
    bloom += bloomExtract(uv + vec2( d.x, 0.0)) * .09;
    bloom += bloomExtract(uv + vec2(-d.x, 0.0)) * .09;
    bloom += bloomExtract(uv + vec2(0.0,  d.y)) * .09;
    bloom += bloomExtract(uv + vec2(0.0, -d.y)) * .09;
    bloom += bloomExtract(uv + d) * .065;
    bloom += bloomExtract(uv - d) * .065;
    bloom += bloomExtract(uv + vec2( d.x, -d.y)) * .065;
    bloom += bloomExtract(uv + vec2(-d.x,  d.y)) * .065;
    vec2 d2 = d * 2.25;
    bloom += bloomExtract(uv + vec2( d2.x, 0.0)) * .04;
    bloom += bloomExtract(uv + vec2(-d2.x, 0.0)) * .04;
    bloom += bloomExtract(uv + vec2(0.0,  d2.y)) * .04;
    bloom += bloomExtract(uv + vec2(0.0, -d2.y)) * .04;
    bloom += bloomExtract(uv + d2) * .02;
    bloom += bloomExtract(uv - d2) * .02;
    bloom += bloomExtract(uv + vec2( d2.x, -d2.y)) * .02;
    bloom += bloomExtract(uv + vec2(-d2.x,  d2.y)) * .02;
    vec2 d4 = d * 4.5;
    bloom += bloomExtract(uv + vec2( d4.x, 0.0)) * .02;
    bloom += bloomExtract(uv + vec2(-d4.x, 0.0)) * .02;
    bloom += bloomExtract(uv + vec2(0.0,  d4.y)) * .02;
    bloom += bloomExtract(uv + vec2(0.0, -d4.y)) * .02;
    float bloomLum = lum(bloom.rgb);
    bloom.rgb = mix(vec3(bloomLum), bloom.rgb, u_p4);
    vec4 bloomed = original;
    bloomed.rgb += bloom.rgb * u_p2;
    bloomed.a = max(original.a, bloom.a * min(1.0, u_p2));
    c = bloomed;
  }
  if (u_effect != 0) c = mix(source(v_uv), c, clamp(u_mix, 0.0, 1.0));
  outColor = clamp(c, 0.0, 1.0);
}`;


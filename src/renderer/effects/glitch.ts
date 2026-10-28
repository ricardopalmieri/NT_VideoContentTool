import type { EffectModule } from "./types";

// Glitch em rajadas, no espírito do GlitchEffect do pmndrs/postprocessing (zlib, © 2015 Raoul van Rüschen):
// rajadas esporádicas e irregulares, faixas horizontais espelhadas, blocos deslocados e separação RGB.
// Diferença: o original guarda temporizadores e sorteios entre quadros; aqui tudo vem de hash(tempo), então
// o mesmo instante dá sempre o mesmo quadro (necessário para exportar, buscar e desfazer).
const FRAGMENT = `
uniform float u_amount;
uniform float u_rate;
uniform float u_block;
uniform float u_shift;
uniform float u_split;
uniform float u_scan;
void main() {
  vec2 uv = v_uv;
  vec4 src = texture(u_input, uv);
  float tick = floor(u_time * max(.1, u_rate));
  // Rajadas: grupos de ~4 passos ligam e desligam em intervalos irregulares (pmndrs: delay/duration sorteados).
  float cluster = floor(u_time * max(.1, u_rate) * .25 + hash(vec2(tick * .25, 3.1)) * .5);
  float burst = step(hash(vec2(cluster, 9.1)), .3 + .7 * u_amount);
  float on = burst * step(hash(vec2(tick, 1.7)), .35 + .65 * u_amount) * step(.0001, u_amount);
  if (on < .5) { outColor = src; return; }
  float seed = hash(vec2(tick, 5.3));
  vec2 px = uv * u_frame;
  // Tamanho dos blocos sorteado a cada passo: largura entre 35% e 100% do máximo; altura de faixa fina a bloco.
  float bw = u_block * u_scale * mix(.35, 1., hash(vec2(seed, 7.1)));
  float bh = bw * mix(.1, .8, hash(vec2(seed, 3.3)));
  if (hash(vec2(seed, 11.9)) < .35) bw = u_frame.x;
  bw = max(2., bw); bh = max(1., bh);
  vec2 cell = floor(px / vec2(bw, bh));
  float h0 = hash(cell + seed * 17.0);
  float hit = step(h0, .18 + .6 * u_amount);
  float dx = (hash(cell * 1.7 + seed) - .5) * 2. * u_shift * hit;
  float dy = (hash(cell * 2.3 + seed * 3.) - .5) * u_shift * .25 * step(.8, hash(cell + seed * 5.)) * hit;
  // Faixa espelhada (a "coluna" do pmndrs).
  float bandCenter = hash(vec2(seed, 13.3));
  float bandHalf = (.01 + .04 * u_amount) * hash(vec2(seed, 2.9));
  if (abs(uv.y - bandCenter) < bandHalf && hash(vec2(seed, 21.7)) > .5) uv.y = bandCenter - (uv.y - bandCenter);
  vec2 moved = uv + vec2(dx, dy);
  float split = u_split * u_scale / u_frame.x * (hit + .15) ;
  vec4 mid = texture(u_input, moved);
  vec4 red = texture(u_input, moved + vec2(split, 0.0));
  vec4 blue = texture(u_input, moved - vec2(split, 0.0));
  vec4 c = vec4(red.r, mid.g, blue.b, max(mid.a, max(red.a * step(.0001, split), blue.a * step(.0001, split))));
  float scan = sin(uv.y * u_frame.y * 3.14159265) * .5 + .5;
  c.rgb *= 1.0 - scan * u_scan * hit;
  outColor = c;
}`;

export const glitch: EffectModule = {
  kind: "glitch",
  passes(params) {
    return [{
      id: "glitch",
      fragment: FRAGMENT,
      uniforms: {
        u_amount: Math.max(0, Math.min(1, params.amount ?? 0)),
        u_rate: params.frequency ?? 8,
        u_block: params.blockSize ?? 36,
        u_shift: params.shift ?? .12,
        u_split: params.rgbSplit ?? 7,
        u_scan: params.scanlines ?? .18,
      },
    }];
  },
};

import type { EffectModule } from "./types";

// Cor: brilho, contraste, saturação, gamma e, opcionais, exposição, temperatura/tint e vibrance.
// - Exposição (rgb * 2^stops) e balanço de branco (tint no eixo Q do YIQ; temperatura com filtro
//   quente/frio em "overlay") seguem o GPUImage de Brad Larson (BSD-3-Clause): GPUImageExposureFilter e
//   GPUImageWhiteBalanceFilter, com a matriz YIQ inversa corrigida.
// - Vibrance vem do glfx.js de Evan Wallace (MIT).
// Com os quatro parâmetros novos em 0 (todo projeto antigo), a conta é a do shader da 0.6.2, feita sobre a cor
// pré-multiplicada, para a imagem exportada continuar idêntica (há teste de paridade por pixel). Com qualquer um
// deles ligado, a conta passa a ser em cor reta (despremultiplicada): não tinge pixels transparentes.
const FRAGMENT = `
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_gamma;
uniform float u_exposure;
uniform float u_temperature;
uniform float u_tint;
uniform float u_vibrance;
float overlay(float base, float blend) {
  return base < .5 ? 2.0 * base * blend : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}
void main() {
  if (u_exposure == 0.0 && u_temperature == 0.0 && u_tint == 0.0 && u_vibrance == 0.0) {
    vec4 p = texture(u_input, v_uv);
    vec3 legacy = p.rgb + u_brightness;
    legacy = (legacy - .5) * u_contrast + .5;
    legacy = mix(vec3(luma(legacy)), legacy, u_saturation);
    outColor = vec4(pow(max(legacy, 0.0), vec3(1.0 / max(.05, u_gamma))), p.a);
    return;
  }
  vec4 c = unpremul(texture(u_input, v_uv));
  vec3 rgb = c.rgb;
  rgb *= exp2(u_exposure);
  if (u_temperature != 0.0 || u_tint != 0.0) {
    vec3 yiq = vec3(dot(rgb, vec3(.299, .587, .114)), dot(rgb, vec3(.596, -.274, -.322)), dot(rgb, vec3(.212, -.523, .311)));
    yiq.z = clamp(yiq.z + u_tint * .5226 * .1, -.5226, .5226);
    rgb = vec3(yiq.x + .956 * yiq.y + .621 * yiq.z, yiq.x - .272 * yiq.y - .647 * yiq.z, yiq.x - 1.106 * yiq.y + 1.703 * yiq.z);
    vec3 filterColor = u_temperature > 0.0 ? vec3(.93, .54, 0.0) : vec3(0.0, .54, .93);
    vec3 processed = vec3(overlay(clamp(rgb.r, 0., 1.), filterColor.r), overlay(clamp(rgb.g, 0., 1.), filterColor.g), overlay(clamp(rgb.b, 0., 1.), filterColor.b));
    rgb = mix(rgb, processed, abs(u_temperature) * .6);
  }
  rgb += u_brightness;
  rgb = (rgb - .5) * u_contrast + .5;
  rgb = mix(vec3(luma(rgb)), rgb, u_saturation);
  if (u_vibrance != 0.0) {
    float average = (rgb.r + rgb.g + rgb.b) / 3.0;
    float peak = max(rgb.r, max(rgb.g, rgb.b));
    rgb = mix(rgb, vec3(peak), (peak - average) * (-u_vibrance * 3.0));
  }
  rgb = pow(max(rgb, 0.0), vec3(1.0 / max(.05, u_gamma)));
  outColor = premul(vec4(rgb, c.a));
}`;

export const color: EffectModule = {
  kind: "levels",
  passes(params) {
    return [{
      id: "color",
      fragment: FRAGMENT,
      uniforms: {
        u_brightness: params.brightness ?? 0,
        u_contrast: params.contrast ?? 1,
        u_saturation: params.saturation ?? 1,
        u_gamma: params.gamma ?? 1,
        u_exposure: params.exposure ?? 0,
        u_temperature: params.temperature ?? 0,
        u_tint: params.tint ?? 0,
        u_vibrance: params.vibrance ?? 0,
      },
    }];
  },
};

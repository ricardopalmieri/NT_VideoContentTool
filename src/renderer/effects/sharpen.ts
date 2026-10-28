import { gaussianPasses } from "./common";
import type { EffectModule } from "./types";

// Máscara de nitidez (unsharp mask), como o unsharpMask do glfx.js (MIT, Evan Wallace): borra a imagem,
// e soma a diferença entre original e borrado vezes a quantidade. O borrado é a gaussiana separável.
// Só o RGB é afiado; o alpha segue o original e o resultado fica no intervalo [0, alpha].
const COMBINE = `
uniform float u_amount;
void main() {
  vec4 src = texture(u_src, v_uv);
  vec4 soft = texture(u_blur, v_uv);
  vec3 rgb = src.rgb + (src.rgb - soft.rgb) * u_amount;
  outColor = vec4(clamp(rgb, vec3(0.0), vec3(src.a)), src.a);
}`;

export const sharpen: EffectModule = {
  kind: "sharpen",
  passes(params, frame) {
    const amount = Math.max(0, params.amount ?? 0);
    const sigma = Math.max(.3, params.radius ?? 1.5) * frame.scale;
    if (amount <= 0) return [];
    return [
      ...gaussianPasses("sharpen-blur", "src", sigma, 1, "blurred"),
      { id: "combine", fragment: COMBINE, inputs: { u_src: "src", u_blur: "blurred" }, uniforms: { u_amount: amount } },
    ];
  },
};

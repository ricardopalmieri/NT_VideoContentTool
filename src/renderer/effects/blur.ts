import { gaussianPasses } from "./common";
import type { EffectModule } from "./types";

/**
 * Desfoque gaussiano separável. `radius` é o sigma em pixels da composição (como o blur() do CSS),
 * multiplicado pela escala de render para o preview ter a mesma aparência da exportação.
 * `quality` repete o par de passes com sigma / raiz(quality): a soma das variâncias dá o mesmo
 * desfoque, mas as amostras ficam mais densas quando o raio é grande.
 */
export const blur: EffectModule = {
  kind: "blur",
  passes(params, frame) {
    const sigma = Math.max(0, params.radius ?? 0) * frame.scale;
    if (sigma < .25) return [];
    const repeats = Math.max(1, Math.min(3, Math.round(params.quality || 1)));
    const passes = [];
    let input = "src";
    for (let index = 0; index < repeats; index++) {
      const output = `blur-${index}`;
      passes.push(...gaussianPasses(`blur-${index}`, input, sigma / Math.sqrt(repeats), 1, output));
      input = output;
    }
    return passes;
  },
};

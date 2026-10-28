// Estilo escolhido no diálogo da legenda automática (tamanho, posição, sombra),
// convertido nos `props` do comando text.fromSrt. Puro: sem DOM.
import { safeArea } from "../model/lint";
import { charsPerLine, subtitleBox } from "../model/macros";
import type { ProjectDocument } from "../model/types";
import { DEFAULT_MAX_CHARS } from "./cues";

export type SubtitleSize = "small" | "medium" | "large";
export type SubtitlePosition = "bottom" | "middle" | "top";

export interface SubtitleStyleChoice {
  size: SubtitleSize;
  position: SubtitlePosition;
  shadow: boolean;
}

type Settings = Pick<ProjectDocument["settings"], "width" | "height">;

/** P 4,5% · M 5,5% · G 7% do LADO MENOR da composição (altura em 16:9, largura em 9:16). */
export const SUBTITLE_SIZE_RATIO: Record<SubtitleSize, number> = { small: .045, medium: .055, large: .07 };

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleChoice = { size: "medium", position: "bottom", shadow: true };

export function subtitleStyleProps(settings: Settings, choice: SubtitleStyleChoice): Record<string, unknown> {
  // Caixa de 2 linhas (altura de linha 1,2) com respiro, como o padrão do macro.
  const { fontSize, height, width } = subtitleBox(settings, SUBTITLE_SIZE_RATIO[choice.size]);
  const margin = safeArea(settings);
  const gap = settings.height * .01;
  const y = choice.position === "top" ? Math.round(margin.top + gap + height / 2)
    : choice.position === "middle" ? Math.round(settings.height / 2)
      : Math.round(settings.height - margin.bottom - gap - height / 2);
  const props: Record<string, unknown> = { fontSize, width, height, y };
  if (choice.shadow) {
    Object.assign(props, {
      shadowColor: "#000000", shadowOpacity: .8,
      shadowBlur: Math.max(2, Math.round(fontSize * .14)), shadowX: 0, shadowY: Math.max(1, Math.round(fontSize * .05)),
    });
  }
  return props;
}

/**
 * Máximo de caracteres por linha para o estilo escolhido: o que cabe na largura da caixa com a fonte do
 * tamanho (cerca de 0,55 em por caractere), limitado a 42 para a leitura ficar confortável. Em 9:16 isso
 * dá umas 28 colunas no tamanho M; em 16:9, 42.
 */
export function subtitleMaxChars(settings: Settings, choice: SubtitleStyleChoice = DEFAULT_SUBTITLE_STYLE) {
  const { fontSize, width } = subtitleBox(settings, SUBTITLE_SIZE_RATIO[choice.size]);
  return Math.max(10, Math.min(DEFAULT_MAX_CHARS, charsPerLine(width, fontSize)));
}

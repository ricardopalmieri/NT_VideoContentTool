import type { EffectKind } from "../../model/types";

export type UniformValue = number | readonly number[];

/** Tamanho do quadro em pixels reais e a escala de render (1 = tamanho da composição). */
export interface EffectFrame {
  time: number;
  width: number;
  height: number;
  scale: number;
}

/**
 * Um passe de GPU. `fragment` é o corpo GLSL ES 3.00 sem cabeçalho: o runtime acrescenta
 * versão, precisão, `v_uv`, `outColor`, os uniforms automáticos (`u_size`, `u_frame`, `u_scale`,
 * `u_time`), as funções de `common.ts` e um `uniform sampler2D` para cada chave de `inputs`.
 * Texturas chegam e saem em alpha pré-multiplicado; bordas usam CLAMP_TO_EDGE.
 */
export interface PassSpec {
  /** Nome único dentro do módulo; também é o nome do buffer de saída por padrão. */
  id: string;
  fragment: string;
  /** sampler → buffer. "src" é a entrada do efeito. Padrão: { u_input: <saída do passe anterior ou "src"> }. */
  inputs?: Record<string, string>;
  /** Buffer escrito por este passe (padrão: `id`). O último passe escreve no alvo final. */
  output?: string;
  /** Tamanho do buffer de saída em fração do quadro (0.5 = metade). Padrão 1. */
  size?: number;
  uniforms?: Record<string, UniformValue>;
}

export interface EffectModule {
  kind: EffectKind;
  /** Passes deste quadro. Pode variar com os parâmetros (ex.: nº de repetições do blur); [] = sem efeito. */
  passes(params: Readonly<Record<string, number>>, frame: EffectFrame): PassSpec[];
}

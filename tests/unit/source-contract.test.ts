import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { strFromU8, unzipSync } from 'fflate';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { vertexSource, fragmentSource } from '../../src/renderer/shaders';
import { translate, type TranslationKey } from '../../src/i18n';
import { fadeEnvelope } from '../../src/timeline/timing';
import { sourceTimeFor } from '../../src/renderer/source-time';
import { createLayer } from '../../src/model/types';

// Oráculo independente: funções do ZIP que gerou o build original byte a byte.
const archive = unzipSync(readFileSync('archives/0.6.2/NoisetupiVideoContentToolWeb-Source-0.6.2.zip'));
const renderer = strFromU8(archive['src/renderer.ts']);
const tree = ts.createSourceFile('renderer.ts', renderer, ts.ScriptTarget.Latest, true);
const classNode = tree.statements.find(ts.isClassDeclaration)!;

function method(name: string) {
  const node = classNode.members.find((member) => member.name?.getText(tree) === name)!;
  const text = node.getText(tree).replace('private ', 'function ');
  const javascript = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(`(${javascript.trim()})`) as (this: unknown, ...args: unknown[]) => number;
}

// Rodada 1: a única mudança permitida no fragment shader é o composite final
// (opacidade × fade depois dos efeitos e o modo darken composto sobre branco).
const ROUND1_FRAGMENT_PATCHES: Array<[string, string]> = [
  ['uniform float u_mix;\n', 'uniform float u_mix;\n// Composite final: opacidade × fade aplicados depois dos efeitos; u_darken compõe sobre branco para o MIN.\nuniform float u_opacity;\nuniform float u_darken;\n'],
  ['  outColor = clamp(c, 0.0, 1.0);\n}', '  c = clamp(c, 0.0, 1.0) * u_opacity;\n  if (u_darken > 0.5) c = vec4(c.rgb + (1.0 - c.a), 1.0);\n  outColor = c;\n}'],
  // Batch 4: color key on straight color (premultiplied fix), luma key (10) and YCbCr chroma key (11).
  [
    '    float dist = distance(c.rgb, key);\n    c.a *= smoothstep(u_p1, u_p1 + max(.001, u_p2), dist);\n  } else if (u_effect == 9) {',
    fragmentSource.slice(fragmentSource.indexOf('    // Textures are premultiplied'), fragmentSource.indexOf('  } else if (u_effect == 9) {') + '  } else if (u_effect == 9) {'.length),
  ],
];

// Pacote de efeitos modular: estes efeitos saíram do shader único (agora são módulos em src/renderer/effects).
// 3 níveis/cor, 5 blur, 21 ruído, 22 glitch, 25 bloom; o auxiliar bloomExtract só servia ao bloom.
function withoutModularEffects(source: string) {
  let result = source;
  for (const code of [3, 5, 21, 22, 25]) {
    result = result.replace(new RegExp(String.raw`  \} else if \(u_effect == ${code}\) \{
[\s\S]*?(?=  \} else if \(u_effect == |  \}
  if \(u_effect != 0\))`), '');
  }
  return result.replace(/vec4 bloomExtract[\s\S]*?(?=float edgeAt)/, '');
}

it('preserva os shaders GLSL originais, exceto o composite da Rodada 1 e os efeitos que viraram módulos', () => {
  for (const [name, expected] of [['vertexSource', vertexSource], ['fragmentSource', fragmentSource]]) {
    const start = renderer.indexOf(`const ${name} = \``) + `const ${name} = \``.length;
    const end = renderer.indexOf('`;', start);
    let original = renderer.slice(start, end).replaceAll('\r\n', '\n');
    if (name === 'fragmentSource') {
      for (const [from, to] of ROUND1_FRAGMENT_PATCHES) {
        expect(original).toContain(from);
        original = original.replace(from, to);
      }
      original = withoutModularEffects(original);
    }
    expect(original).toBe(expected);
  }
});

it('todas as traduções coincidem com os dicionários originais', () => {
  const original = strFromU8(archive['src/i18n.ts']);
  const start = original.indexOf('const strings =');
  const end = original.indexOf('export type TranslationKey');
  const javascript = ts.transpileModule(original.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const strings = runInNewContext(`${javascript}\nstrings`) as Record<'pt-BR' | 'en', Record<TranslationKey, string>>;
  for (const language of ['pt-BR', 'en'] as const) {
    for (const key of Object.keys(strings[language]) as TranslationKey[]) expect(translate(language, key)).toBe(strings[language][key]);
  }
});

it('tempo de mídia e fade coincidem com os métodos originais em casos de borda', () => {
  const sourceOracle = method('sourceTimeFor');
  const fadeOracle = method('fadeEnvelope');
  const settings = { name: 'Oráculo', width: 320, height: 180, fps: 30, duration: 10, background: '#000000', transparent: true };
  for (const loop of [false, true]) for (const reverse of [false, true]) {
    for (const sourceIn of [0, 1, 3]) for (const speed of [0, .01, -2, 1, 4]) {
      // Desvio intencional da 0.6.2: sourceIn 0 não cai mais para sourceOffset (ver timing.test.ts).
      const layer = createLayer('video', settings, { loop, reverse, sourceIn, sourceOffset: sourceIn ? 2 : 0, sourceOut: 8, startTime: 1, fadeInStart: 1, fadeInEnd: 3, fadeOutStart: 6, fadeOutEnd: 8 });
      for (const time of [-1, 0, 1, 2.5, 3, 6, 7.5, 8, 20]) for (const duration of [0, .001, 4, 10]) {
        expect(sourceTimeFor(layer, time, duration, speed)).toBe(sourceOracle.call({ evaluated: () => speed }, layer, time, duration));
        expect(fadeEnvelope(layer, time)).toBe(fadeOracle.call({}, layer, time));
      }
    }
  }
});

# Mapa do build 0.6.2 para o fonte recuperado

O fonte original foi recuperado do ZIP e reproduziu o bundle de produção byte a
byte. Os nomes abaixo são os originais, não nomes inferidos por decompilação.
As faixas correspondem a `legacy/0.6.2/assets/index-BZJa5JOo.js` formatado com
Prettier 3.3.3. A cópia de trabalho fica fora de `src/`, em `.work/`.

| Símbolo/escopo legado | Nome original | Destino atual |
|---|---|---|
| `xn`, classe do renderer | `ComposerRenderer` | `src/renderer/composer-renderer.ts` |
| `xn.sourceTimeFor` | `sourceTimeFor` | método delega a `src/renderer/source-time.ts` |
| `xn.fadeEnvelope` | `fadeEnvelope` | método delega a `src/timeline/timing.ts` |
| `sf`, alvos da timeline | `timelineSnapCandidates` | `src/timeline/snapping.ts`; wrapper em `src/ui/editor.ts` |
| `Qt`, normalização de fades | `normalizeFades` | `src/timeline/timing.ts` |
| `Zt`, snap da timeline | `snapTimelineTime` | `src/timeline/snapping.ts`; wrapper em `src/ui/editor.ts` |
| `jn`, retângulo da timeline | `timelineContentRect` | `src/ui/editor.ts` |
| `Vr`, ponteiro → tempo | `timelineTimeFromPointer` | `src/ui/editor.ts` |
| `be`, reconstrução de painéis/canvas | `renderEditorPreservingCanvas` | `src/ui/editor.ts` |

Os exemplos `collectSnapTargets`, `clampLayerTiming` e `rebuildEditor` do prompt
não eram nomes do fonte original: correspondem, respectivamente, a
`timelineSnapCandidates`, `normalizeFades` e `renderEditorPreservingCanvas`.
`normalizeFades` não faz clamp do intervalo inteiro do clipe. Apesar do nome,
`renderEditorPreservingCanvas` continua recriando o renderer; isso foi preservado.

| Faixa da referência formatada | Responsabilidade restaurada |
|---|---|
| 31–143 | `src/i18n/index.ts` |
| 144–1343 | fflate 0.8.3 via npm; sem cópia em `src/` |
| 1344–2785 | I/O, shaders, compositor e áudio |
| 2786–11575 | Mediabunny 1.52.3 via npm; sem cópia em `src/` |
| 11576–15955 | exportação, modelo, migração, timeline e UI |

O ZIP preservado e o commit de restauração permitem rastrear todos os nomes
originais. Esta tabela destaca os símbolos citados pela auditoria; não lista
variáveis locais minificadas das bibliotecas de terceiros.

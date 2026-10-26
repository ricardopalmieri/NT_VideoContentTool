# Rodada 0 — restauração e fundação

Data: 26/10/2026. Versão funcional mantida: **0.6.2**.

## Fonte recuperado e referência

O chat “video content tool” continha o link do fonte original 0.6.2. O titular
recuperou o ZIP e o colocou no repositório. Por isso, a reconstrução por
engenharia reversa foi substituída pela restauração do TypeScript original.

- Build publicado preservado em `legacy/0.6.2/`, sem alteração de bytes.
- ZIP original preservado em `archives/0.6.2/`.
- Commit original: `41af6f6`, tag local `v0.6.2-prod`.
- Commit com o fonte restaurado antes de modularizar: `e94e701`.
- `npm ci` com o lockfile original seguido de `npm run build` reproduziu os
  **19 arquivos da distribuição byte a byte**. Isso inclui HTML, JS, CSS,
  fontes, logos, manifest, `.htaccess` e `version.json`.
- Hashes completos e hash do ZIP: [BASELINE-0.6.2.json](BASELINE-0.6.2.json).

Não foi necessário copiar ou adaptar o fonte desktop 0.1.11. Não foram
introduzidos Tauri, FFmpeg, backend ou outra engine.

## Organização executada

O projeto Vite/TypeScript strict está na raiz, com saída em `dist/`.
Foram organizados os módulos `i18n`, `io`, `model`, `renderer`, `audio`,
`export`, `timeline` e `ui`. `src/main.ts` importa estilos e inicializa o editor.

Shaders foram extraídos preservando seu conteúdo. Os cálculos de fade,
normalização de fades, source time, snap e migração histórica foram extraídos
para funções testáveis e continuam sendo usados pelo produto. O estado e a
maior parte dos handlers ficam em `ui/editor.ts`, evitando uma reescrita de
closures e ordem de inicialização nesta rodada.

O [mapa de símbolos](MAPA-MINIFICADO.md) usa os nomes recuperados, como
`timelineSnapCandidates`, `normalizeFades` e `renderEditorPreservingCanvas`.
O último continua recriando o renderer, apesar do nome.

Dependências de produção fixadas: Mediabunny 1.52.3, fflate 0.8.3 e os cinco
pacotes Fontsource 5.3.0. TypeScript 5.9.3 e Vite 7.3.6 permanecem nas versões
do lockfile original. Ferramentas de teste também foram fixadas.

Foram adicionados `.editorconfig`, `.gitattributes`, `.npmrc`, `.nvmrc`,
comandos de verificação e CI. Builds, dependências instaladas e relatórios
temporários ficam fora do Git. O ZIP original é pequeno e foi mantido no Git
como referência recuperável.

## Validação executada

Ambiente local: Windows, Node 24.19.0, npm 11.17.0, Playwright 1.56.1,
Chromium Headless Shell 141.0.7390.37 e SwiftShader. Mesmas condições de
renderização para legado e atual; viewport 1440×1000, DPR 1.

| Verificação | Resultado |
|---|---|
| Integridade SHA-256 do legado e do ZIP | Aprovada |
| Typecheck strict do app, testes e configurações | Aprovado |
| Vitest | 23 testes aprovados |
| Build Vite | Aprovado |
| Playwright | 2 testes aprovados |
| Compatibilidade `.ntvct` legado → atual | Aprovada |
| Compatibilidade `.ntvct` atual → legado | Aprovada |
| Empacotamento Hostinger e verificação de recursos/avisos | Aprovados |

Os unitários cobrem fade linear e sobreposto, duração zero, limites, clamp,
reverse/loop/source offsets, velocidade, snap desligado com arredondamento,
self-snap, empate pelo último alvo, migração v1/v2 e i18n. Os métodos de tempo
de mídia e fade também são comparados diretamente com os métodos do ZIP
original em **2.160 combinações**. Os dois shaders e todas as traduções são
conferidos contra o fonte original.

O primeiro teste Playwright cria, pela UI de cada build, uma composição de
320×180, 8 fps e 1 segundo com texto, geometria, fade e efeito Levels. Salva
arquivos reais por download, exporta PNGs e os compara. Depois abre os arquivos
no outro build, salva de novo e repete a comparação. No round-trip, somente
`modifiedAt` é desconsiderado: IDs e os demais dados são preservados. Na criação
independente das duas cenas, também são desconsiderados IDs e datas gerados.

O segundo teste gera um vídeo contador VP8/WebM com WebCodecs, importa o mesmo
arquivo nos dois editores e compara a sequência PNG exportada. O teste verifica
variação entre frames; não corrige nem mascara eventuais defeitos de seek.

Foram comparados **32 pares de frames**, em t=0, 0,125, 0,250, 0,375, 0,500,
0,625, 0,750 e 0,875 s, nas quatro comparações:

- criação independente;
- abertura do arquivo legado no atual;
- abertura do arquivo atual no legado;
- vídeo contador.

**Resultado: zero canais RGBA divergentes, delta máximo zero, tolerância zero.**
O teste confirma conteúdo visível, transparência e mudança visual durante o fade.
Não se trata de comparar duas telas vazias. Métricas estão em
[PARIDADE-0.6.2.json](PARIDADE-0.6.2.json). Arquivos `.ntvct`, vídeo contador e
métricas da última execução ficam em `test-results/`; imagens comparativas
ficam incorporadas ao relatório HTML em `playwright-report/`.

### Prova de que os testes falham

Foi alterado temporariamente o código real de `src/timeline/timing.ts`,
multiplicando o envelope por 0,9. Os unitários falharam e o build mutante
foi reprovado pelo Playwright: **602 canais divergentes no frame 0**.
O código foi restaurado em `finally`, o build foi refeito e a validação completa
passou novamente. Evidência: [PROVA-MUTACAO.json](PROVA-MUTACAO.json).

## Diferenças e decisões de escopo

- O primeiro build original é byte-identical. O build final tem outro hash JS
  devido às extrações de módulos e aos comentários legais preservados.
- CSS, dez fontes, logos, manifest, `.htaccess` e `version.json` mantêm os
  arquivos originais. O HTML referencia o novo hash JS.
- A distribuição passa a incluir licenças e avisos completos, sem alterar a UI.
- Não foram adicionados imports dinâmicos, tela Sobre/Créditos, cache immutable
  ou CSP. Esses itens do plano antigo alterariam carregamento, interface ou
  comportamento HTTP e foram separados para preservar a paridade desta rodada.
- Nenhum bug conhecido foi corrigido. Foram mantidos self-snap, fades absolutos,
  zero-duration fades, recriação de renderer, limitações de seek e demais
  comportamentos do fonte original. Testes específicos registram parte deles.
- `docs/ANALISE-E-PLANO.md` recebeu uma nota de atualização. Os documentos
  originais do ZIP estão em `docs/historico/`, como registros históricos.

## Limites e trechos com dúvida

Não há trecho de lógica reconstruído por suposição: o fonte original foi
recuperado e sua identidade foi comprovada antes de extrair módulos. Isso não
comprova ausência de bugs; os casos da auditoria continuam para a Rodada 1.

A matriz visual cobre as cenas descritas, não todas as combinações de efeitos,
formatos de mídia, GPU e navegador. O vídeo contador foi validado via exportação
PNG; o encoder MP4 H.264/AAC e a escuta de áudio não receberam teste funcional
dedicado nesta execução. O código desses caminhos foi reorganizado sem
correção funcional.

Não houve teste em iPad físico nem validação de toque. A CI foi configurada para
Linux, mas ainda não executou no GitHub porque nenhum push foi feito. Não
afirmamos paridade de pixels entre sistemas diferentes; em cada execução,
legado e atual são comparados no mesmo ambiente.

Subagentes fizeram inventário, análise de arquitetura e preparação de licenças.
Dois atingiram limite de uso durante a implementação; o coordenador completou
os testes, a integração e a revisão final. Não houve uma segunda revisão
independente completa após a integração.

## Entrega

- Desenvolvimento: `npm ci` e `npm run dev`.
- Validação: instalar Chromium e executar `npm run check`.
- Build para publicar: conteúdo de `dist/`.
- Pacote local: `release/NoisetupiVideoContentToolWeb-Hostinger-0.6.2.zip`.
- Código e artefatos organizados em commits locais na branch
  `codex/rodada0-restauracao`.
- **Nenhum push ou deploy realizado.**

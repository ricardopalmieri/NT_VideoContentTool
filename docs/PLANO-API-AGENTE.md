# Especificação: API do agente com menos tokens

Data: 27/10/2026 · Base: 0.7.1 (`1e5388a`)

Objetivo: um agente de IA no navegador (Claude in Chrome) edita o projeto
inteiro por `window.vct`, **sem clicar na interface**, e gasta no máximo
metade dos tokens gastos no desafio "loop de 30 s com 10 vídeos".

Este documento traz o diagnóstico e a especificação de cada item (A1…G3).
**A ordem de execução fica em `PLANO-DE-ACAO.md`.** Lá, estes itens estão
distribuídos pelos batches 1 a 5, junto com as mudanças de interface.

---

## 1. Diagnóstico: o relatório da IA conferido com o código

| Queixa da IA | Confere? | Onde está |
|---|---|---|
| `describe()` lista 7 comandos, o motor aceita 19 | Sim. Os 12 sem documentação são `layer.setNumeric`, `layer.setName`, `keyframe.*`, `effect.*` e `audioEffect.*` | `window-vct.ts:113`, `commands.ts:39-52` |
| Nomes de campo só por tentativa (`ownerId`, `parameter`, `__post__`) | Sim. O guia não cita nenhum tipo de comando | `agent-guide.ts`, `effect-catalog.ts:21-26` |
| Tempo do keyframe e efeito de `hold` sem resposta | Tempo **absoluto** da composição. O easing pertence ao keyframe da **esquerda**. `hold` segura o valor e salta no keyframe seguinte | `composer-renderer.ts:331-357` |
| Não há bin de mídia | Sim. Toda mídia precisa estar num clipe, e duração, resolução e hasAudio não ficam salvos | `editor.ts:536`, `types.ts:161-167` |
| Faixa sem nome e sem comando de criação | Sim. O id da faixa é `trackId` ou o id do primeiro clipe. Faixa vazia some | `clip-tracks.ts:8-37,101` |
| Áudio sem controle | Parcial. O modelo **já tem** `volume`, `muted` e `linked`, mas só a interface altera esses campos | `types.ts:102-124`, `editor.ts:963,1552,1566` |
| Duração da composição fora da API | Sim. Só a interface altera a duração | `editor.ts:2962` |
| Sem região de trabalho nem in/out de export | Sim. O export sempre vai de 0 à duração | `editor.ts:4245` |
| `blendMode` não editável | Sim. O renderer **já faz** add, multiply, screen, lighten e darken; falta só o comando | `composer-renderer.ts:744-760` |
| colorKey não remove preto | Sim. A chave é por matiz e não há luma key | `shaders.ts:102-107` |
| Fontes verticais exigem conta manual | Sim. O clipe entra no tamanho nativo, sem `fit` | `composer-renderer.ts:127-138` |
| `captureFrame` antes do decode | **Bug confirmado.** `renderFrame()` retorna na hora se já há um render em andamento, e um vídeo cujo seek falha é ignorado em silêncio no preview | `editor.ts:3979-4000,4436`, `composer-renderer.ts:593-621` |
| Saída do Chrome bloqueia `?&=` e corta em cerca de 1000 caracteres | Limite do Claude in Chrome, não do VCT. **A API precisa ser desenhada para ele** | — |

Achados extras dos agentes de mapeamento:

- **Bug:** `layer.setNumeric` em `startTime` e `endTime` não verifica a duração, o
  alinhamento a frames nem a sobreposição. Um clipe pode passar do fim da
  composição (`commands.ts:200-214`).
- Os comandos que não são de edição **ignoram campos desconhecidos em
  silêncio**, e os de edição os rejeitam (`commands.ts:80-111` × `editing-commands.ts:28`).
- `describe().methods` anuncia `guide`, `query`, `dispatch` e `onChange`, mas a
  ponte MCP não os permite (`agent-bridge.ts:11-14`).
- **A ponte MCP está dormente.** `connectAgentBridge` não tem quem a chame, e o
  servidor `mcp/` não consegue se conectar ao editor atual. Hoje o caminho real
  é o agente executar JS na aba.
- O curve do `bezier` não é configurável pela API.
- O rótulo do lote só aparece na linha de status. O desfazer não guarda o rótulo.

### Onde os tokens foram gastos (estimativa da própria IA)

| Gasto | % | O que corta |
|---|---:|---|
| Ver o material | ~30% | C2 `assetSheet`/`contactSheet` + C1 captura confiável |
| Descobrir a API | ~25% | A1–A3 registro único e `describe` completo |
| Montar comandos | ~15% | B3 `clip.place`, F1 lotes maiores |
| Análise de áudio | ~10% | D2 `analyzeMix`, D3 `analyzeAudio` |
| Contornar a saída do Chrome | ~10% | A4 saída segura e paginada |
| Revisão e ajuste | ~10% | C1, F2 `lint` |

**As fases A, B e C eliminam cerca de 75% das causas.**

---

## 2. Princípios (valem para todas as tarefas)

1. **Fonte única.** Cada comando é declarado uma vez num registro (campos,
   tipos, faixas, descrição, exemplo). Parser, `describe()`, `guide()`,
   validação e docs saem desse registro. Nenhuma lista é mantida à mão.
2. **Texto compacto antes de JSON.** Toda leitura tem uma versão em texto curto,
   uma linha por item, **sem `?`, `&` nem `=`**. Use `:` e `|` como separadores.
   O JSON completo continua disponível.
3. **Um passo, um comando.** O agente descreve a intenção ("coloque o asset X na
   faixa Y de 2 s a 4 s, cobrindo o quadro") e o motor resolve os detalhes.
4. **Macros expandem para comandos base.** `dryRun` mostra a expansão. Nada fica
   escondido, e o desfazer continua sendo um passo por lote.
5. **Atômico e desfazível.** Mantém o que funcionou: `dryRun`, lote tudo ou
   nada, ids legíveis e erros específicos em PT-BR.
6. **Compatível.** `.ntvct` v2 continua abrindo. Campos novos são opcionais.
7. **TDD.** Cada comando novo entra com teste unitário em `tests/unit/` antes da
   implementação. Cada fase fecha com `npm test`, `npm run typecheck` e o E2E do agente.
8. **Medir.** O benchmark de tokens ganha o cenário "loop de 30 s"
   (G1), medido antes e depois de cada fase.
9. **Sem release.** Cada fase vira commits locais. O usuário decide versão,
   tag, push e deploy.

---

## 3. Tarefas da Rodada 6b, em ordem

### Fase A: contrato e descoberta (corta ~25% + ~10%)

- **A1 Registro único de comandos** (`src/model/command-registry.ts`). Os 19
  comandos atuais passam para o registro. Parser estrito para todos: campo
  desconhecido vira erro.
- **A2 `describe()` completo.** `describe()` devolve um texto curto (meta: menos
  de 1.500 tokens) com todos os comandos e uma linha cada.
  `describe('clip.place')` devolve o detalhe e um exemplo. A semântica entra no
  texto: tempo absoluto, easing do keyframe da esquerda, `hold`, `__post__`,
  propriedades numéricas e faixas de valor.
- **A3 Métodos verdadeiros.** `methods` lista só o que existe, e a ponte expõe o
  mesmo conjunto. `guide()` passa a ser gerado do registro e fica mais curto.
- **A4 Saída segura para o navegador.** Toda leitura aceita `{ text: true }`. A
  saída grande vai para `vct.more()` em páginas de até 900 caracteres. Um teste
  garante que nenhuma saída de texto tenha `?`, `&` ou `=`.
- **A5 Correções.** `layer.setNumeric` em tempos passa a ter as mesmas checagens
  do `clip.move`. `layer.setName` rejeita em vez de truncar.

### Fase B: montar em um comando (corta ~15% e o risco de mexer no projeto)

- **B1 Bin de mídia.** Novo campo `project.assets[]` (opcional no `.ntvct`) com
  `id`, `name`, `kind`, `duration`, `width`, `height`, `orientation`, `hasAudio`
  e `size`. A importação registra o asset no bin sempre; colocar na timeline
  passa a ser opcional. `vct.assets({ text: true })` dá uma linha por asset.
- **B2 Faixas como entidade leve.** Novo `project.tracks[]` com `id`, `name` e
  `order`. Comandos `track.create`, `track.rename` e `track.remove` (este só se
  a faixa estiver vazia). Faixa vazia deixa de sumir.
- **B3 `clip.place`.** `{ layerId, asset, trackId, start, end | duration,
  sourceIn, rate, fit, audio, props, effects }`. Substitui 6 a 8 comandos e não
  precisa de clipe existente.
- **B4 `composition.set`.** `{ duration, workArea: { in, out } }`. O export usa
  a `workArea` quando ela existe (quem exporta continua sendo o usuário).
- **B5 `fit`.** `cover`, `contain` e `rotate-cover` em `clip.place` e num
  comando `layer.fit`, para fontes de outra proporção.

### Fase C: revisão visual confiável e barata (corta ~30%)

- **C1 `captureFrame` confiável.** Usa o caminho estrito do renderer, espera o
  `seeked`/decode de cada vídeo e devolve `ready: false` com a lista de camadas
  que não decodificaram, em vez de entregar um quadro velho.
- **C2 Folhas de contato.** `vct.contactSheet({ times | every, cols, width })`
  junta a composição numa só imagem, com o tempo impresso em cada célula.
  `vct.assetSheet(assetId, { count })` mostra o material bruto **sem colocá-lo
  na timeline**. Com `{ show: true }`, a folha cobre a aba num painel temporário,
  e o agente gasta **um** screenshot. `vct.hideSheet()` fecha o painel.
- **C3 `vct.summary()`.** A timeline em texto curto, por exemplo
  `0.0-2.5 torre:V1 push | 2.0 flash f_ower:V2 | ...`.

### Fase D: áudio

- **D1 Comandos de áudio** sobre campos que já existem no modelo: `audio.set
  { trackId, volume, muted }`, `audio.unlink`, `audio.link`, fades de áudio por
  `audio.setNumeric`.
- **D2 `vct.analyzeMix(start, end)`.** Usa a mixagem offline que já existe
  (`mixProjectAudio`). Devolve RMS e pico a cada 0,5 s, quais fontes soam em
  cada trecho e um alerta de clipping. É o jeito do agente "ouvir".
- **D3 `vct.analyzeAudio(asset)`.** Perfil de energia, onsets e BPM estimado,
  com cache por asset, em texto compacto.
- **D4 Keyframes de ganho** (depois de D1).

### Fase E: composição e expressividade

- **E1 `layer.setBlendMode`.** Só valida e expõe o que o renderer já faz.
  `validate()` passa a rejeitar valor desconhecido.
- **E2 Luma key.** Efeito novo para remover preto (partículas sobre preto).
- **E3 Grade musical.** `composition.set({ grid: { bpm, offset } })` e tempos
  aceitos como `"bar:3.2"` ou `"beat:14"`, com snap ao frame.
- **E4 Keyframes com `timeBase: 'clip'`** e `curve` configurável no `bezier`.

### Fase F: planos longos, checagem e macros

- **F1 Planos longos.** `vct.plan([lote1, lote2, ...])` simula lotes em
  sequência e aplica tudo como um passo de desfazer. O limite sobe de 100 para
  500 comandos.
- **F2 `vct.lint()`.** Aponta áudio sobreposto, buracos, texto fora da área
  segura, clipe fora da composição e **flashes** (mais de 3 por segundo é risco
  de fotossensibilidade, WCAG 2.3.1).
- **F3 Macros.** `loop.seam`, `fx.stutter`, `fx.strobe` e `fx.spike`, expandidos
  em comandos base.
- **F4 `vct.analyzeVideo(asset)`.** Cortes de cena, brilho, cor dominante e
  movimento por trecho.

### Fase G: medição e regressão (em paralelo às outras fases)

- **G1 Benchmark "loop de 30 s".** Novo cenário em
  `tests/unit/token-benchmark.test.ts` com 10 assets de durações e proporções
  diferentes. Mede o fluxo atual e o fluxo novo.
- **G2 E2E do agente.** Teste Playwright que executa um roteiro só por
  `window.vct` (montar, revisar, desfazer), sem nenhum clique.
- **G3 Decidir a ponte MCP.** Reativar com a nova API ou remover
  `agent-bridge.ts` e `mcp/`. Recomendação: manter só o caminho na página até a
  fase C fechar, e então decidir.

**Meta de aceite da Rodada 6b:** o desafio de 30 s refeito por um agente com
menos de 50% dos tokens, sem nenhum clique, sem clipes "estacionados" e com a
duração ajustada pela própria IA.

---

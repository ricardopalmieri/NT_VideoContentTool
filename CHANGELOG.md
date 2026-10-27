# Histórico de alterações

## Não lançado — batches 0 a 4 de `docs/PLANO-DE-ACAO.md`

### Batch 0 — arrumação

- A versão é lida só do `package.json` (editor, `index.html`, `version.json`
  gerado no build e servidor MCP).
- Copyright: © 2026 Noisetupi.
- Formatos de export declarados: só MP4 e sequência PNG (transparência só em PNG).

### Batch 1 — núcleo de comandos

- Registro único de comandos (`src/model/command-registry.ts`): parser
  estrito, `describe()` e guia saem dele. Campo desconhecido vira erro em
  todos os comandos.
- Comandos novos: `layer.set` (várias propriedades, com checagem de tempo),
  `audio.create/set/move/link/unlink/remove/reorderLane`, `composition.set`
  (tamanho, fps, duração, fundo), `effect.set/reorder`,
  `audioEffect.set/reorder`, `keyframe.set`, `effect.keyframe.set`,
  `track.reorder`, `clip.paste`; `layer.create` aceita mídia, faixa e
  propriedades; `clip.split` aceita `sourceDuration`.
- Lotes de até 500 comandos. O desfazer guarda o nome do passo (dica do botão
  e linha de status).
- `window.vct.describe()` devolve texto curto com todos os comandos, campos,
  limites e regras de tempo; `describe(tipo)` dá o detalhe com exemplo;
  `more()` pagina textos longos. Nenhuma saída de texto tem `?`, `&` ou `=`.
- Correção: `layer.setNumeric` em tempos não deixa o clipe passar do fim da
  composição; `layer.setName` rejeita nomes longos em vez de cortar.

### Batch 2 — mídia, faixas e "ver"

- Bin de mídia no `assetMetadata` (duração, resolução, áudio, impressão
  digital), sem mudar o formato: o arquivo continua `.ntvct` v2.
- Faixas com nome (`project.tracks`), que continuam existindo vazias.
- Comandos: `clip.place` (mídia do bin na timeline num passo, com trecho do
  arquivo, enquadramento e áudio vinculado), `layer.fit`
  (contain/cover/rotate-cover/none), `track.create/rename/remove`,
  `asset.add/remove`.
- `window.vct.assets()` e `window.vct.summary()`: bin e timeline em texto curto.
- Relink por conteúdo (impressão digital) quando o arquivo foi renomeado.
- Recuperação e Collect Media incluem as mídias que estão só no bin.
- Quadro confiável: `captureFrame` espera o vídeo decodificar e informa as
  camadas que não decodificaram (`notReady`). `vct.contactSheet()` e
  `vct.assetSheet()` montam folhas de contato numa imagem só; com
  `{ show: true }` a folha cobre a aba para um screenshot.
- Interface: todas as ações e gestos (inspector, canvas, timeline, gravação)
  passam pelo registro de comandos, com um passo de desfazer nomeado cada.
  Atalhos de desfazer e duplicar não disparam enquanto se digita.

### Batch 3 — timeline, tempo e áudio

- Região de trabalho (`composition.set` workArea) e grade musical (grid bpm,
  offset, compasso); tempos como `bar:3.2`, `beat:14`, `bars:2` nos comandos.
- Keyframes com `timeBase: "clip"` e `curve` do bezier.
- Snap também na grade e nas bordas da região de trabalho; tap tempo.
- `vct.analyzeMix()` (nível por trecho, fontes que soam, clipping) e
  `vct.analyzeAudio()` (BPM, offset, onsets, seções).

### Batch 4 — composição, texto e qualidade

- Efeitos novos: luma key e chroma key YCbCr com supressão de spill. A chave
  de cor antiga passa a recortar também a cor (antes deixava um halo).
- Sombra de texto (`shadowColor`, `shadowOpacity`, `shadowBlur`, `shadowX`, `shadowY`).
- `vct.lint()`: flashes acima de 3 por segundo (WCAG 2.3.1), texto fora da
  área segura, tempo de leitura, buracos, áudio sobreposto, clipe fora da composição.
- `vct.plan()`: vários lotes simulados em sequência e aplicados num passo.
- Macros: `loop.seam`, `fx.stutter`, `fx.strobe`, `fx.spike`, `text.animate`,
  `text.fromSrt`. Cada macro mostra a expansão em comandos base.
- `vct.analyzeVideo()`: cortes de cena, brilho, cor e movimento por trecho.

## 0.7.1 — edição com IA (Rodada 6) e Rodada 2

Esta versão publica a Rodada 6 e a Rodada 2 (abaixo). Os scripts de
empacotamento e verificação do release passam a ler a versão do
`package.json`.

### Rodada 6 — edição com IA

- **Editar com IA pelo navegador:** o botão da barra superior abre um passo a
  passo para usar o Claude in Chrome (ou outro agente que execute JavaScript na
  página), com "Copiar instruções". O guia para o agente fica em
  `window.vct.guide()`. A conexão com servidor MCP local saiu da interface.

- **Importar vários arquivos de uma vez:** botão "Importar vários…" (vídeos,
  imagens e áudios) ou arrastar os arquivos para o editor. Visuais entram em
  sequência numa faixa nova a partir do playhead (imagens com 3 s, ordem por
  nome), áudios numa faixa de áudio; um único passo de desfazer. Facilita
  trazer o material para o agente editar.

- **Comandos de edição no `window.vct`:** criar texto e geometria, mudar texto,
  cortar, mover (inclusive entre faixas), duplicar, remover (com ripple) e
  definir transição. Também `describe`, `getTimeline` (compacta), `dryRun`,
  `undo`/`redo` e `captureFrame` (JPEG pequeno do quadro).
- **Servidor MCP local, só no repositório** (`npm run mcp`): as ferramentas
  `vct_*` numa ponte WebSocket em 127.0.0.1, com código, lista de origens
  permitidas e lista fechada de métodos. A interface publicada não oferece mais
  a conexão com esse servidor; o código fica para testes e uso futuro.
- **WebMCP:** registra as ferramentas quando o navegador oferece
  `navigator.modelContext`.
- **Prompt portátil e skills** (`agents/`): fluxo econômico em tokens e
  vocabulário de motion design e VJ.
- **Benchmark reproduzível de tokens** (`npm run benchmark:tokens`): na tarefa
  de referência, o VCT via MCP usou ~2,6× menos tokens que reescrever o
  projeto e ~25× menos que operar a interface por screenshots.

### Rodada 2 — edição com vários clipes por faixa

#### Transições e modo Sobrepor

- **Modo Sobrepor** (botão de dois retângulos na barra da timeline, a escolha
  fica salva): clipes da mesma faixa podem se sobrepor; ao soltar, a
  sobreposição vira automaticamente uma transição Dissolver (como no Vegas).
  Desligado, os clipes param no vizinho, como antes.
- **Transições básicas** no painel do clipe ("Transição de entrada"):
  Dissolver, Fade pelo fundo, Cortina →, Cortina ← e Empurrar. Com
  sobreposição, a duração é o trecho sobreposto; sem sobreposição, o clipe
  entra com a duração escolhida.
- Zona da transição desenhada no início do clipe na timeline, com o tipo e a
  duração no tooltip. Funciona no preview e na exportação.
- Áudio vinculado faz crossfade na mesma janela da transição.

#### Edição

- **Ripple delete:** Shift+Delete apaga o clipe e puxa os seguintes da faixa,
  com keyframes, fades e áudio vinculado.
- **Seleção múltipla:** Ctrl/⌘/Shift+clique nos clipes; Delete apaga todos.
- **Copiar/colar:** Ctrl/⌘+C e Ctrl/⌘+V colam no playhead, na faixa original
  quando ela está livre (senão, numa faixa nova), com o áudio junto.
- **Inserir no playhead:** mídia, texto e geometria novos começam no playhead
  (em 0 s continuam ocupando a composição, como antes).
- Ripple delete fecha corretamente a faixa quando o próximo clipe está
  sobreposto; duração, keyframes, fades e áudio vinculado acompanham o ajuste.
- A validação do projeto cobre os campos opcionais `trackId`, `laneId` e
  `transition`, mantendo o formato `.ntvct` v2.
- Fechamento verificado com 89 testes Vitest e 15 cenários Playwright, além de
  typecheck strict, build e conferência da integridade do legado.

- **Cortar no playhead:** tecla S, Ctrl/⌘+B ou botão de tesoura na timeline.
  O clipe vira dois na mesma faixa, com trecho de origem, velocidade, reverse
  e fades corretos; o áudio vinculado é cortado junto.
- **Faixas com vários clipes:** cada linha da timeline é uma faixa e mostra
  todos os seus clipes (selo com a quantidade). Projetos antigos abrem iguais.
- **Mover entre faixas:** arrastar o clipe para cima/baixo destaca a faixa de
  destino; se o trecho estiver ocupado, o movimento é recusado com aviso.
- Clipes de uma faixa não se sobrepõem: arrastar e aparar param no vizinho.
- Reordenar (▲▼ ou arrastar a linha) move a faixa inteira.
- Thumbnails de vídeo e onda de áudio mostram o trecho que o clipe realmente
  toca e se atualizam ao aparar, cortar ou mudar a velocidade.

## 0.7.0 — legibilidade e equilíbrio da interface

### Inspector minimalista (referência: ui-skills / baseline-ui)

- Parâmetros viraram linhas finas no padrão de inspector profissional: nome à
  esquerda, trilha de 2 px no meio, valor em números tabulares à direita e ◆
  discreto. Sem caixas, bordas nem preenchimento em bloco.
- Trilha neutra; o vermelho da marca só aparece ao arrastar ou quando o
  parâmetro tem keyframe (um acento por vez).
- Painel estreito compacta nome e valor; o nome completo fica no tooltip.
- Botões de seção, zoom e lista de efeitos em estilo "ghost"; cantos
  consistentes; sem gradientes nem glow como sinal (fundo do preview, clipe de
  vídeo, REC, status); números tabulares em tempo, régua e duração.
- Cores e fontes da marca mantidas.

### Ajustes de edição

- Clipes que ocupam a composição inteira agora podem ser arrastados na
  timeline: o clipe pode passar do fim, e a duração da composição é estendida
  ao soltar (antes o arrasto ficava preso entre 0 e o fim).
- Campos numéricos viraram sliders: nome em cima, valor embaixo e trilha fina
  com preenchimento. Arrastar não seleciona mais o texto do campo; duplo
  clique continua abrindo a edição.
- Mídia importada entra no tamanho real em pixels (1:1 com a composição), mesmo
  quando é maior que ela (4K em 1080p fica com o dobro). A imagem guia ocupa a composição.
- Duração da composição em timecode `HH:MM:SS:FF` ou em frames (escolha
  salva no navegador), no lugar de segundos. Valor inválido é recusado com
  aviso na barra de status.

### Interface

- Tipografia mínima de 11 px em toda a interface (antes havia textos de 4 a
  9 px); só as setas ▲▼ de ordenação ficam em 9 px.
- Barra superior compacta (44 px, antes 56 px no desktop e 96 px no tablet),
  numa linha só e com botões apenas com ícone; o nome de cada ação continua no
  tooltip e no rótulo acessível.
- Barra da timeline no padrão de editor clássico: timecode e frame à esquerda,
  transporte ao centro, ferramentas (curva, zoom, snap, duração) à direita.
- Campos numéricos com rótulo acima do valor: "SCALE X", "ROTATION",
  "OPACITY" etc. não são mais cortados. Campos sem ◆ usam a largura toda.
- Painéis se adaptam à própria largura (container queries): propriedades em
  uma coluna e linha de camada compacta quando o painel é estreito.
- Painéis laterais mais largos (284/340 px), timeline mais alta, biblioteca
  menor para a pilha de camadas aparecer.
- Preview reajusta o zoom ao redimensionar a janela enquanto o usuário não
  muda o zoom à mão.
- Alças de fade e de transformação maiores, com área de toque ampliada em
  telas de toque.

## Rodada 1 — fechamento da estabilidade

- **Fade ancorado no clipe.** O fade-in sempre começa no início do clipe e o
  fade-out sempre termina no fim; só a duração é editada. Arrastar a alça a
  partir do canto agora cria uma rampa (antes gravava início = fim, fade de
  duração zero). Mover, aparar ou estender o clipe preserva a duração dos fades
  e não cria trechos invisíveis. Formato `.ntvct` continua v2; projetos antigos
  com fade deslocado são ancorados na abertura, mantendo a duração.
- Timeline mostra uma alça de fade por lado; o painel mostra "Fim do fade in" e
  "Início do fade out". Campos de tempo, fade e trecho de origem não mostram
  mais ◆, porque o renderer não anima esses valores.
- Opacidade e fade são aplicados no composite, depois dos efeitos: chroma key e
  Levels se comportam igual durante o fade. Frames dentro de um fade com efeito
  podem diferir da 0.6.2 (intencional; teste de paridade documenta os frames).
- Blend Add não aplica mais o alpha duas vezes; Darken não escurece mais a área
  fora da camada.
- Fades de áudio usam curva equal-power.
- Erro de render continua visível na barra de status até um render dar certo
  (o aviso de autosave não o encobre mais).
- Painel de Propriedades mantém a rolagem ao editar valores.
- Caixa de texto cresce para caber todas as linhas; com altura animada, o painel
  mostra um aviso de texto cortado.
- Testes: regressões de fade (unitários e Playwright), curva de áudio e contrato
  dos shaders com as mudanças permitidas da Rodada 1.

## Upgrade de UX/UI e automação — Fase 3

- Plano de continuidade e checkpoint das Fases 0–3 em
  `docs/UPGRADE-UX-UI-AUTOMACAO.md`.
- A abertura de projetos agora valida e migra o arquivo antes de substituir as
  mídias da sessão; regressões cobertas por testes unitários.
- Exportação de vídeo evita pular seeks menores que um frame; o teste do
  contador verifica a sequência de frames em vez de reproduzir o defeito do
  legado.
- Extraída a validação mínima do envelope do projeto para o módulo de modelo.
- Undo ignora checkpoints sem alteração e mantém redo; o renderer é descartado
  ao ser substituído e recriado após restauração do contexto WebGL.
- Exportação interrompe com mensagem explícita quando uma mídia não pode ser
  decodificada; atalhos de edição ficam bloqueados durante o processo.
- Snap de clipes e fades não considera mais o próprio item como alvo; scrub
  também não trava no playhead atual e pares A/V ligados são excluídos juntos.
- Projetos passam a salvar metadados de origem das mídias e usam nome, caminho
  relativo disponível, tamanho e data para relink em lote sem escolher matches
  ambíguos. Caminhos absolutos locais não são acessíveis de forma confiável no
  navegador.
- Ação "Coletar mídias" gera pacote ZIP com projeto e assets referenciados,
  corrige referências numa cópia, detecta mídias ausentes e colisões de nomes.
  Quando disponível, grava o ZIP numa pasta escolhida; caso contrário, baixa-o.
- Design system inicial com tokens de cor, tipografia, espaçamento e foco;
  ícones SVG acessíveis na barra de ações; drawers de painéis em tablet,
  layout sem overflow horizontal e controles com tipografia ampliada em telas
  menores.
- Corrigida a sincronização de clipes A/V vinculados ao mover, aparar ou editar
  o áudio: vídeo, fades e automação acompanham o áudio; ao ativar o vínculo,
  o áudio passa a refletir o clipe de vídeo.
- Autosave local com blobs de mídia no IndexedDB e opção de recuperar/descartar
  o projeto na próxima abertura; salvar ou trocar de projeto limpa o snapshot
  anterior.
- Iniciada a extração de operações de domínio: sincronização A/V está em
  `src/model/linked-media.ts`, isolada do DOM e coberta por testes unitários.
- Fades de áudio sobrepostos agora usam ganho separado para fade-in e fade-out,
  multiplicando envelopes como no preview em vez de aproximá-los por uma única
  rampa linear.
- Controles de zoom horizontal/vertical da timeline agora usam ícones SVG com
  rótulos acessíveis e tooltips; gaps internos e espaçamentos de controles do
  inspector/timeline foram compactados sem reduzir a área de toque em tablet.
- Adicionado teste Playwright que marca um keyframe no inspector, altera seu
  valor, cria outro em tempo diferente, verifica os valores salvos no projeto e
  confirma a interpolação exibida no inspector. O fluxo foi reproduzido sem
  falha no estado atual.
- Regras determinísticas para localizar, inserir/atualizar e alternar keyframes
  foram extraídas para `src/model/keyframes.ts`, sem dependência de DOM ou
  estado global. Inspector, automação, cores e parâmetros de efeitos usam as
  mesmas operações; testes unitários cobrem tolerância, ordenação e imutabilidade.
- O catálogo de efeitos e os limites de seus parâmetros passaram a ser a fonte
  única para defaults, rótulos, categorias, opções da biblioteca e inspector.
- A validação após migração agora verifica limites de composição/FPS/duração,
  IDs repetidos, propriedades, timing, keyframes e parâmetros de efeitos. Um
  documento inválido não substitui projeto ou mídias ativos.
- Disponível `window.vct` na aba do editor para consultar/validar o projeto,
  listar catálogo, executar comandos e agrupar até 100 alterações atômicas em
  um único Undo. Edições de keyframe feitas pela própria interface usam esse
  mesmo caminho.
- A API valida comandos e valores pelo domínio, sincroniza edições de timing
  de vídeo com áudio vinculado, persiste via autosave e emite eventos de
  alteração. Remover efeitos exige confirmação visível.
- Publicado o contrato e seus limites em `docs/AUTOMACAO.md`. Não foi criada
  bridge MCP/rede, nem comando de salvar, exportar, importar arquivo ou apagar
  camada; o projeto segue no formato `.ntvct` v2.

## Fundação da 0.6.2 — 26/10/2026

- Recuperado e validado o fonte original: 19 arquivos idênticos à produção.
- Preservados o build em `legacy/0.6.2/` e o ZIP em `archives/0.6.2/`.
- Organizado o TypeScript por módulos, mantendo o comportamento da 0.6.2.
- Fixadas dependências; adicionados testes de caracterização e paridade.
- Preparadas CI, documentação e distribuição de licenças.
- Nenhuma correção dos bugs da Rodada 1 ou mudança de formato `.ntvct`.

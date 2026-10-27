# Histórico de alterações

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
- Mídia importada entra no tamanho real em pixels (1:1 com a composição); só
  é reduzida se for maior que a composição. A imagem guia ocupa a composição.
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

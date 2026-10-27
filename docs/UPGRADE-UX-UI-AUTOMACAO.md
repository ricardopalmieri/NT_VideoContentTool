# Upgrade de UX/UI, edição e automação por IA

## Objetivo e continuidade

Este documento é o checkpoint compartilhado do trabalho. Deve ser atualizado
antes de encerrar cada sessão para que outra IA possa continuar sem depender do
histórico do chat. Ao retomar:

1. Leia este documento, `README.md`, `docs/RODADA0-RELATORIO.md` e o estado do
   worktree (`git status --short`).
2. Confira os itens concluídos, decisões e próximo passo abaixo antes de editar.
3. Preserve mudanças locais de outras pessoas; não reverta arquivos sem
   relação com a tarefa.
4. Execute a menor validação apropriada e registre seu resultado neste
   checkpoint.

O código-fonte web 0.6.2 foi recuperado e organizado na Rodada 0. A ausência
de fonte descrita na análise histórica não é mais um bloqueio. `legacy/0.6.2/`
e `archives/0.6.2/` são referências imutáveis; `npm run check` é a validação
completa quando houver mudanças de compatibilidade, renderização ou exportação.

## Como economizar tokens e custo de modelos

- Faça diretamente leituras pontuais, correções pequenas, documentação e testes
  focados; não inicie agentes/modelos separados para tarefas simples.
- Para inventário, organização de backlog e tarefas mecânicas, prefira o modelo
  econômico disponível na próxima sessão.
- Reserve um modelo de maior capacidade para decisões de formato `.ntvct`,
  desenho da API de comandos, revisão de migrações e regressões complexas de
  renderer/exportação.
- Delegue somente investigações independentes que exijam contexto substancial.
  Não peça a dois modelos que repitam a mesma revisão.
- Em cada handoff, registre a decisão pendente, evidências, arquivos afetados,
  testes e próximo passo. Não repetir análise já documentada.

## Escopo e ordem

### Fase 0 — backlog verificável

- [x] Corrigir o plano antigo quanto ao estado atual da fundação: fonte,
  módulos, testes de caracterização e paridade já existem.
- [x] Usar a análise histórica como inventário; não tratar alegações baseadas
  no bundle como defeitos atuais sem confirmar no TypeScript restaurado.
- [x] Escolher como primeiro caso de estabilidade a preservação da sessão
  quando um arquivo de projeto inválido é aberto.
- [ ] Continuar revisando as demais alegações de estabilidade contra a
  implementação e classificá-las como confirmadas, corrigidas, históricas ou
  ainda não verificadas.

### Fase 1 — estabilidade e proteção do trabalho

Ordem sugerida, ajustável conforme confirmação no código e risco:

1. [x] Evitar que abertura inválida destrua mídias da sessão ativa.
2. [x] Corrigir self-snap confirmado em clipes, fades e playhead, preservando
   o snap entre elementos independentes e excluindo o par ligado de áudio/vídeo.
   Investigar separadamente regressões de fades e sincronização A/V.
3. [x] Descartar renderer substituído, recuperar contexto WebGL, ignorar
   snapshots sem alteração e bloquear atalhos durante exportação.
4. [x] Corrigir o seek que pulava a decodificação quando a diferença era
   menor que um frame; validar progressão por índice no vídeo contador.
   [x] Exportar deve falhar com erro explícito em vez de incluir frames com
   mídia ausente ou não decodificada; a espera de imagem também tem timeout.
5. [x] Implementar e testar autosave/recuperação considerando que projetos
   atuais guardam referências e blobs de mídia em memória.
6. [x] Validar projetos após migração, verificar limites de timing e apresentar
   erros explícitos antes de substituir a sessão ativa.
7. [x] Persistir metadados suficientes para localizar as mídias de origem
   quando o projeto for reaberto: nome original, caminho relativo de pasta
   quando fornecido pelo usuário, tamanho e data de modificação; avaliar
   fingerprint para evitar relink ambíguo e um pacote portátil com as mídias
   como melhorias futuras.
   Em navegadores, caminhos absolutos locais não são expostos de forma
   consistente a arquivos selecionados; handles com permissão são uma opção
   específica da plataforma, não um caminho que possa ser prometido no `.ntvct`.
8. [x] Adicionar "Collect Media" opcional: exportar o projeto e todas as mídias
   referenciadas para um destino escolhido pelo usuário. Gera pacote ZIP
   portátil (project.json + assets/); grava o ZIP na pasta escolhida com a File
   System Access API quando disponível, com download como fallback. O pacote
   usa cópia do documento com referências reescritas para `assets/...`, sem
   alterar o projeto aberto. Verificado tratamento de mídias ausentes, nomes
   duplicados, referências compartilhadas e abertura do ZIP pelo fluxo existente.

Cada correção deve ter teste de regressão antes ou junto da implementação. Não
alterar o formato do projeto sem migração e cobertura de compatibilidade.

### Fase 2 — limites de domínio e arquitetura escalável

- [x] Extrair a verificação mínima do envelope do projeto para
  `src/model/validate-project.ts` e expandir a validação do documento migrado.
- [x] Extrair sincronização A/V para operações puras testáveis; continuar
  extraindo operações de `src/ui/editor.ts` em passos pequenos.
- [x] Extrair operações de keyframes e comandos determinísticos para módulos de
  domínio independentes da interface.
- [x] Centralizar a validação aplicada após migração e preservar o contrato
  `.ntvct` v2.
- [x] Definir catálogo compartilhado de efeitos, parâmetros, limites e defaults.
- [x] Fazer os controles de keyframe da interface e a API de automação usarem
  as operações de domínio.
- [x] Cobrir operações unitariamente e manter Playwright nos fluxos observáveis.
- A extração do restante de `src/ui/editor.ts` permanece incremental; não faz
  parte do critério para a API local inicial.

Não iniciar o modelo de clipes v3 ou integrações MCP antes de fechar os
contratos de domínio necessários e confirmar compatibilidade v2.

### Fase 3 — contrato de automação local

- [x] Expor `window.vct` na página do editor para consulta, validação,
  catálogo, comandos determinísticos e eventos de alteração.
- [x] Aplicar lote de 1–100 comandos como uma transação e um único passo de
  Undo; falhas e cancelamentos não fazem commit.
- [x] Retornar cópias em consultas, validar valores/IDs pelo domínio e exigir
  confirmação para remoção de efeitos.
- [x] Usar o mesmo caminho transacional para toggles de keyframes da interface,
  persistindo as mudanças pelo autosave existente.
- [x] Documentar e testar a API local em `docs/AUTOMACAO.md` e nos testes
  unitários e Playwright.
- Esta fase não inclui servidor MCP, WebMCP, CLI, bridge, conexão de rede,
  operação por outra origem, filesystem, salvar/exportar/importar nem exclusão
  de camadas. A disponibilidade de `window.vct` ainda depende de um agente ou
  ferramenta que já execute código na aba.

## Critérios de aceite transversais

- Projetos `.ntvct` v2 continuam abrindo e salvando, exceto mudança explicitamente
  aprovada e acompanhada por migração.
- Importação, edição, undo/redo, salvar, reabrir e exportar mantêm resultados
  verificáveis.
- Erros não deixam o estado anterior parcialmente destruído nem são convertidos
  silenciosamente em sucesso.
- `npm run typecheck`, `npm test` e `npm run build` passam para alterações
  comuns; `npm run test:parity`/`npm run check` passam quando o escopo toca
  paridade, mídia, renderização ou exportação.
- `legacy/0.6.2/` e o ZIP original permanecem inalterados.

## Registro de decisões

- O trabalho começa pelas Fases 0, 1 e 2, nesta ordem; a Fase 0 não repete a
  restauração já concluída.
- A Fase 1 começa por impedir perda das mídias da sessão durante a abertura de
  arquivo inválido.
- Novas integrações com IA devem usar uma API de domínio comum, não DOM ou
  detalhes internos de `ProjectDocument`.
- Preferir processamento local e nenhuma chave de IA no frontend.
- Referências de mídia devem poder ser resolvidas após reabrir o projeto. O
  `.ntvct` deve preservar metadados de origem; caminhos absolutos só serão
  usados quando o browser os fornecer por um mecanismo consentido. Caso
  contrário, fornecer relink por metadados ou pacote com mídias.
- "Collect Media" é tecnicamente viável no navegador: o app já retém os blobs
  usados pela sessão, o `fflate` já está instalado e o abridor atual já lê ZIP
  com `project.json` e `assets/`. Recomenda-se ZIP como entrega multiplataforma;
  gravar o ZIP numa pasta escolhida depende da File System Access API,
  normalmente restrita a navegadores Chromium em contexto seguro e sujeita a
  permissão do usuário. Em outros navegadores o ZIP é baixado. A pasta escolhida
  nunca deve ser tratada como caminho persistente dentro do projeto. Há um
  detalhe de compatibilidade: o ZIP atual registra os arquivos como `assets/...`;
  a cópia do projeto dentro do pacote precisa referenciar essas mesmas chaves.
  Deduplicar referências repetidas é necessário, e montar ZIPs de mídias grandes
  deve evitar bloquear a UI ou duplicar todo o conteúdo na memória.

## Prioridades após o fechamento da Rodada 2 (26/10/2026)

1. **Congelamento funcional da 0.7.0:** não incluir novas features antes da
   revisão final e do empacotamento. Manter apenas correções de regressão.
2. **Rodada 6 — automação com IA** (diferencial do produto): skills, servidor
   MCP e WebMCP sobre `window.vct`, já com os comandos de clipe. Incluir um
   benchmark reproduzível de tokens e de controle (mesma tarefa via `window.vct`
   × via prompts numa interface web genérica) antes de afirmar economia.
3. **Rodada 3 — navegação e texto**, incluindo revisão do snap automático de
   alinhamento entre bordas e objetos (canvas e timeline).
4. **Rodada 5 — motion design e VJ**, sem exportação com transparência.
5. **Documentação em inglês** (última).
- **Rodada 4 — modo pedagógico: em espera.**

## Checkpoint — release 0.7.1 (27/10/2026)

- A 0.7.1 publica a Rodada 2 e a Rodada 6: comandos de edição no `window.vct`,
  `window.vct.guide()`, importar vários arquivos e o passo a passo "Editar com
  IA" para o Claude in Chrome. A conexão com o servidor MCP local saiu da
  interface; `mcp/` continua no repositório para testes e uso futuro.
- `package-hostinger.mjs` e `verify-release.mjs` leem a versão do
  `package.json`. A versão ainda aparece fixa em `index.html`,
  `public/version.json`, `public/manifest.webmanifest`, `src/ui/editor.ts` e
  `mcp/vct-mcp-server.mjs`.
- `npm run check`: legado íntegro, 16 arquivos/108 testes unitários,
  typecheck, build e 16/16 cenários Playwright. Na primeira execução,
  "mover áudio vinculado" falhou uma vez (trim do áudio sem bounding box);
  passou 3/3 isolado e na segunda execução completa. Tratar como teste
  intermitente a investigar.
- Pacote: `release/NoisetupiVideoContentToolWeb-Hostinger-0.7.1.zip`, com as
  37 verificações de `verify:release` aprovadas. O upload para a Hostinger é
  manual.
- Pendências: teste de ponta a ponta com o Claude in Chrome no site publicado;
  o restante da Rodada 6 (JSON Schema, CLI, `vct_evaluate`, skills `/vct-*`);
  depois as Rodadas 3 e 5.

## Checkpoint — revisão final da 0.7.0 (26/10/2026)

- Congelamento funcional mantido. Correções listadas antes de implementar:
  IDs novos nos efeitos de áudio colados; segunda metade de corte sem repetir
  transição de entrada; corte respeitando áudio com vínculo desligado.
- Três testes de regressão falharam antes e passaram depois. `npm run check`
  aprovado: legado íntegro, 92 testes unitários, typecheck/build e 15 cenários
  Playwright. Execução fora do sandbox para acesso ao servidor de loopback.
- QA direto no Chrome: projeto Full HD/30 fps/10 s com geometria,
  reprodução/pausa, corte, sobreposição, copiar/colar e Undo. MP4 gerado pela
  interface e conferido: AVC, 1920×1080, 10 s, 300 pacotes a 30 fps.
- O usuário permite abandonar a compatibilidade se trouxer simplificação
  comprovada. As correções desta revisão não exigiram novo modelo; v2 mantido.
- **Escopo IA reafirmado:** `window.vct` v1 existe e foi revalidado; comandos
  de montagem, projeto/mídia e adaptadores MCP/WebMCP ainda pertencem à Rodada 6.
  A API local inicial não equivale a controle completo por um cliente MCP.
- Relatório e limites: `docs/RODADA2-RELATORIO.md`, seção de revisão final.
- Próximo passo: revisar o diff local e empacotar a 0.7.0. Nenhum commit,
  push, deploy ou pacote foi feito nesta sessão. Não iniciar features da
  Rodada 6 dentro deste fechamento.

## Checkpoint — Rodada 2 concluída e validada (26/10/2026)

- `src/model/transitions.ts`: `layer.transition` (dissolve, dip, wipe-right,
  wipe-left, push-left); janela = sobreposição com o clipe anterior da faixa
  ou `duration`; estado por frame (opacidade, deslocamento, revelação) para o
  clipe que entra e o que sai; Dissolver automático no modo Sobrepor;
  crossfade do áudio vinculado.
- Renderer desenha por faixa (de baixo para cima) e, dentro da faixa, o clipe
  que começa depois por cima; aplica a transição no preview e na exportação.
- `clip-tracks.ts`: `shiftClip`, `rippleDelete`, `copyClips`, `pasteClips`.
- Editor: botão Sobrepor (persistido), seção "Transição de entrada", seleção
  múltipla, Shift+Delete, Ctrl/⌘+C/V, inserir no playhead.
- `src/model/clip-tracks.ts`: `trackId`/`laneId` opcionais agrupam clipes numa
  faixa (sem o campo, a layer é a própria faixa: projetos v2 abrem iguais).
  Corte (`splitClip`) com trecho de origem, velocidade, reverse, fades e áudio
  vinculado; mover entre faixas sem sobreposição; vizinhos limitam arrasto/trim.
- Timeline: uma linha por faixa com todos os clipes; S, Ctrl/⌘+B e botão de
  tesoura; arrastar na vertical muda de faixa; reordenar move a faixa inteira.
- Thumbnails por arquivo (24 quadros) e onda por arquivo; cada clipe mostra o
  próprio trecho (trim, corte, velocidade, reverse).
- QA manual direto no Chrome: projeto novo, geometria, reprodução/pausa, corte
  no playhead, sobreposição, troca de Dissolver para Empurrar, copiar/colar no
  playhead, criação automática de faixa ocupada, inserção de texto e undo.
- O QA encontrou uma lacuna no ripple delete quando o próximo clipe começava
  dentro da sobreposição. Um teste de regressão foi executado primeiro e
  falhou; o cálculo passou a fechar o espaço até o vizinho anterior, preservando
  duração, keyframes, fades e áudio vinculado.
- A validação `.ntvct` v2 agora verifica também `trackId`, `laneId` e transição
  opcional, sem alterar a versão do formato.
- Validação final: legado íntegro; 13 arquivos/89 testes Vitest; TypeScript
  strict; build Vite; 15/15 testes Playwright, incluindo paridade visual,
  ida e volta `.ntvct`, exportação e os fluxos novos da timeline.
- Relatório detalhado: `docs/RODADA2-RELATORIO.md`.
- Próximo passo: congelar features, revisar a entrega e só então empacotar a
  0.7.0. A Rodada 6 permanece no backlog.

## Checkpoint — Rodada 1 fechada (26/10/2026)

**Branch:** `codex/rodada0-restauracao` (publicada no GitHub).

- Fade ancorado no clipe (`normalizeFades`/`setFadeHandle` em
  `src/timeline/timing.ts`); uma alça por lado; migração ancora projetos v2.
- Opacidade × fade no composite (`u_opacity`), blends Add/Darken corrigidos,
  fade de áudio equal-power, erro de render não é encoberto pelo autosave,
  rolagem do inspector preservada, caixa de texto com altura automática/aviso.
- Paridade: frames 0–3 da cena de teste mudam de propósito
  (`ROUND1_FADE_FRAMES`); os demais seguem com tolerância zero.
- Pendências: teste manual em iPad real; fontes ≥ 11 px e alvos de toque de
  44 px (Rodada 4); a seguir, Rodada 2 (modelo de clipes v3 com split).

## Checkpoint anterior — 26/10/2026

**Branch:** `codex/rodada0-restauracao`  
**Worktree no início desta continuação:** já continha alterações não
commitadas de etapas anteriores; elas foram preservadas.

**Fase atual:** Fase 3 concluída para o escopo local definido acima. A Fase 0
mantém pendente a classificação das alegações históricas restantes; a extração
do restante do editor continua incremental e não bloqueia a API inicial.

**Entregas desta sessão:**

- `src/ui/styles.css`: design tokens de cor, tipografia, espaçamento, foco e
  cantos; layouts responsivos para desktop/tablet, drawers laterais, foco
  visível e respeito a `prefers-reduced-motion`. Tipografia dos controles
  principais foi ampliada em telas até 860px.
- `src/ui/editor.ts`: ícones SVG acessíveis com nomes/labels, tooltips e
  `aria-expanded`; toggles exclusivos para abrir os painéis laterais no tablet.
- `tests/parity/editor.spec.ts`: cobre layout sem overflow em 820px, abertura
  exclusiva dos drawers, presença do ícone e tamanho mínimo da tipografia dos
  controles principais.
- A revisão de fades/A/V encontrou uma regressão reproduzível: ao mover um
  clipe de áudio vinculado, as bordas e fades do vídeo não acompanhavam o
  deslocamento; aparar/editar o áudio também podia desalinhar as propriedades
  sincronizadas. `src/ui/editor.ts` agora sincroniza os dois sentidos para
  timing, mídia e fades; mover o áudio desloca também keyframes/animações do
  vídeo; ativar o vínculo adota os valores do vídeo. O teste Playwright cobre
  mover, editar o fim e aparar o áudio, confirmando o alinhamento de vídeo e
  fades.
- `src/io/web-platform.ts`: JSON/ZIP é analisado e migrado antes de substituir
  os blobs atuais. Falhas de JSON, formato, envelope ou migração mantêm a mídia
  da sessão aberta.
- `src/model/validate-project.ts`: valida o documento migrado e verifica
  settings, IDs, propriedades, timing, keyframes, efeitos e metadados; ainda
  não é um schema completo de `ProjectDocument`.
- `src/model/undo-history.ts`: agrupa snapshots pendentes e só registra uma
  alteração quando o estado realmente mudou; mantém redo após gestos nulos.
- `src/ui/editor.ts`: descarta recursos do renderer nas substituições, recria
  após perda/restauração de WebGL e bloqueia os atalhos enquanto uma exportação
  está em andamento.
- `src/renderer/video-seek.ts` e `src/renderer/composer-renderer.ts`: não
  considerar um intervalo menor que um frame como motivo para pular o seek;
  falhas de seek, imagens sem decode e layers que não rasterizam agora abortam
  a exportação em vez de produzirem um vídeo aparentemente completo.
- `src/renderer/composer-renderer.ts`: `dispose()` chamado nas substituições
  de renderer; contexto WebGL perdido gera erro visível e, após restauração, a
  instância é recriada.
- A exportação bloqueia atalhos de edição/histórico enquanto está ativa.
- `tests/unit/web-platform.test.ts` e `tests/unit/timing.test.ts`: regressões
  para abertura não destrutiva e limiar de seek.
- `tests/unit/undo-history.test.ts`: regressões de undo/redo, snapshot nulo e
  limite de histórico.
- `tests/parity/editor.spec.ts`: o teste do contador exige que a exportação
  atual contenha os 8 frames em ordem. O legado mostrou o frame 6 na posição
  do frame 7; por isso, paridade pixel a pixel com esse caso legado foi
  substituída por uma verificação do comportamento corrigido. Os outros fluxos
  mantêm a comparação estrita de pixels. Também cobre erro de exportação quando
  falta uma mídia e recuperação do contexto WebGL.
- `src/timeline/snapping.ts` e `src/ui/editor.ts`: os candidatos de snap agora
  excluem o elemento editado e, em gestos ligados, seu par de áudio/vídeo.
  Scrubbing exclui o próprio playhead como alvo.
- `tests/unit/timing.test.ts`: cobre exclusões simétricas de clipe/par ligado e
  exclusão do playhead. `npm test -- tests/unit/timing.test.ts` e
  `npm run typecheck` passaram.
- `src/model/types.ts`, `src/io/web-platform.ts` e `src/ui/editor.ts`: projetos
  guardam, por referência de asset, nome original, caminho relativo se o browser
  fornecer, tamanho, data de modificação e MIME type. Relink em lote exige uma
  identidade única; não conecta automaticamente arquivos ambíguos. A edição
  permanece compatível com projetos v2 sem este campo opcional.
- `src/model/validate-project.ts` rejeita campos de metadados malformados;
  `tests/unit/web-platform.test.ts` cobre metadados, compatibilidade com pacote
  e seleção ambígua/única para relink.
- `tests/parity/editor.spec.ts` verifica no navegador a abertura offline,
  relink em lote por metadados e persistência após salvar o projeto.
- `src/io/web-platform.ts`: Collect Media monta ZIP incrementalmente, valida
  referências antes de iniciar, transmite blobs sem primeiro copiá-los para um
  buffer completo, deduplica referências, resolve colisões de nomes e carrega
  metadados para as referências reescritas. Em navegadores com File System
  Access API, grava o ZIP na pasta selecionada; outros recebem ZIP para
  download. Cancelamento da seleção não gera alerta. A saída compactada fica
  retida em memória até concluir a gravação/download, então projetos com mídias
  muito grandes ainda podem exigir otimização para escrita incremental no disco.
- `src/ui/editor.ts` e `src/i18n/index.ts`: ação "Coletar mídias" disponível no
  topo do editor, com rótulos PT/EN e erro visível para mídia ausente/falha.
- `tests/unit/web-platform.test.ts` verifica referências compartilhadas,
  colisão de nome, integridade e reabertura do ZIP, ausência de asset e
  preservação do projeto original. `tests/parity/editor.spec.ts` cobre o fluxo
  de download ZIP na interface.
- `src/io/web-platform.ts`: snapshot de recuperação do projeto e blobs
  referenciados no IndexedDB, com atualização incremental de mídia.
  `src/ui/editor.ts` detecta alterações, faz autosave após breve inatividade e
  oferece recuperar/descartar na tela inicial. Salvar ou trocar/criar projeto
  limpa o snapshot anterior; a recuperação repõe blobs ainda disponíveis e
  deixa refs sem blob abertas para relink. A cópia é local ao navegador/origin
  e depende da quota do IndexedDB; `.ntvct` segue como backup portátil.
- `tests/parity/editor.spec.ts`: abre uma nova página, recupera projeto e blob
  de imagem, confirma que salvar limpa a recuperação e exercita o descarte
  explícito do snapshot.
- `src/model/linked-media.ts`: extraídas operações de sincronização A/V do
  editor para o domínio, com testes unitários de ida/volta e proteção de faixas
  desvinculadas. A interface mantém somente a integração com renderer/DOM.
- `src/timeline/timing.ts` separa os fatores de fade-in e fade-out; `src/audio/audio-engine.ts`
  agenda cada envelope em um ganho próprio. Assim, fades sobrepostos multiplicam
  os ganhos e coincidem com o preview. Testes unitários verificam os fatores e
  o contrato histórico do envelope.
- `src/ui/editor.ts` e `src/ui/styles.css`: os controles de zoom H/V da timeline
  usam ícones SVG, rótulos acessíveis e tooltips; os gaps e paddings de controles
  do inspector, timeline e pilha de camadas foram compactados, mantendo áreas
  de toque maiores em tablet.
- `tests/parity/editor.spec.ts`: o fluxo de keyframes do inspector marca a
  propriedade, edita o valor no mesmo tempo, cria um segundo ponto, confirma os
  dois valores no `.ntvct` salvo e verifica a interpolação no tempo intermediário.
  O comportamento atualmente passa; a falha relatada não foi reproduzida no
  projeto novo do teste, então não foi aplicada uma correção especulativa ao
  modelo de animação.
- `src/model/keyframes.ts`: extraídas operações puras e determinísticas para
  localizar, inserir/atualizar e alternar keyframes com tolerância explícita.
  `src/ui/editor.ts` reutiliza as operações para propriedades, cores e efeitos;
  os valores temporais e a interpolação permanecem no renderer já existente.
  `tests/unit/keyframes.test.ts` cobre tolerância, ordenação, atualização sem
  trocar easing e ausência de mutação de entrada.

**Validação da implementação atual:** `npm run check` passou: legado e ZIP
original íntegros, 59 testes unitários, typecheck, build e 12 testes Playwright.
Os fluxos de sincronização A/V, recuperação de autosave, keyframes e
`window.vct` passaram na execução completa.

**Entregas adicionais da Fase 3:** catálogo central em
`src/model/effect-catalog.ts`; contratos e aplicação transacional em
`src/model/commands.ts`; API da aba em `src/automation/window-vct.ts`;
validação completa aplicada após migração em `src/model/validate-project.ts`;
integração da interface em `src/ui/editor.ts`; documentação em
`docs/AUTOMACAO.md`. `README.md` agora aponta para o contrato local.

**Próximo passo:** planejar a próxima etapa de integração externa (por exemplo,
um host controlado para MCP), após decidir o modelo de confiança, permissões e
confirmação. Não adicionar bridge de rede sem esses requisitos.

**Ainda não feito:** revisar todas as alegações históricas da Fase 0;
fingerprint de conteúdo; validar seek real em navegadores diferentes; extrair
as operações restantes de `src/ui/editor.ts`; implementar adaptador MCP/CLI ou
qualquer mudança do formato `.ntvct`.

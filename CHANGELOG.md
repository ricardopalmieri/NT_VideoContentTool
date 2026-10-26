# Histórico de alterações

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

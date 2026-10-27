# Relatório de fechamento da Rodada 2

**Data:** 26/10/2026  
**Versão em validação:** 0.7.0  
**Escopo:** edição com vários clipes por faixa, sem inclusão de novas features
após o início do fechamento.

## Entregas

- Faixas visuais com vários clipes, mantendo compatibilidade com `.ntvct` v2.
- Corte no playhead por botão, `S` e `Ctrl/⌘+B`, inclusive áudio vinculado.
- Movimento e reordenação de faixas, thumbnails e ondas coerentes com o trecho.
- Modo Sobrepor e transições Dissolver, Fade pelo fundo, Cortinas e Empurrar.
- Crossfade do áudio vinculado na janela da transição.
- Ripple delete, seleção múltipla, copiar/colar e inserção no playhead.
- Renderer e exportação usando a mesma ordem de faixas e transições.
- Validação dos metadados opcionais `trackId`, `laneId` e `transition`.

## Teste direto da interface

O teste foi executado numa janela visível do Chrome em
`http://127.0.0.1:4175/`, como um fluxo contínuo de edição:

1. criar projeto 1920×1080, 30 fps e 10 s;
2. inserir geometria e conferir reprodução/pausa;
3. cortar no playhead e confirmar dois clipes na mesma faixa;
4. ativar Sobrepor, criar sobreposição e trocar Dissolver por Empurrar;
5. copiar e colar no playhead, confirmando a criação de outra faixa quando a
   original estava ocupada;
6. inserir texto no playhead;
7. apagar com ripple e desfazer.

## Defeito encontrado e corrigido

Ao apagar com ripple o primeiro de dois clipes sobrepostos, o segundo mantinha
o tempo original e deixava uma lacuna no início da faixa. A implementação só
deslocava clipes cujo início era posterior ao fim do clipe removido.

Foi adicionado primeiro um teste que reproduziu a falha (`4–10 s` permaneceu
inalterado). Depois, `rippleDelete()` passou a calcular o espaço entre o vizinho
anterior e o início real do próximo clipe. O mesmo teste passou com o clipe em
`0–6 s`, incluindo keyframe e áudio vinculado deslocados em conjunto.

Também foram acrescentados testes que inicialmente falharam para metadados de
faixa/transição malformados. A validação agora rejeita IDs vazios ou não
textuais, tipos de transição desconhecidos e durações negativas ou não finitas.

## Resultado automatizado

| Verificação | Resultado |
|---|---|
| Integridade do legado e ZIP original | Aprovada |
| Vitest | 13 arquivos, 89 testes aprovados |
| TypeScript strict | Aprovado |
| Build Vite | Aprovado |
| Playwright | 15 de 15 cenários aprovados em 1,4 min |

O Playwright cobriu a comparação visual e a compatibilidade `.ntvct` nos dois
sentidos, exportação, mídia ausente, relink, Collect Media, tablet, áudio
vinculado, autosave, restauração WebGL, keyframes, `window.vct`, fades, corte e
modo Sobrepor.

## Diferenças e dúvidas registradas

- O formato continua sendo `.ntvct` v2. Os campos de agrupamento e transição
  são opcionais para que projetos anteriores abram sem migração de versão.
- O teste visual reconstruído após o hot reload chegou novamente ao corte e ao
  agrupamento. A automação nativa do Chrome não disparou de forma confiável a
  alteração numérica do início do clipe; essa tentativa não foi contabilizada
  como aprovação. A regressão do ripple foi comprovada pelo teste unitário que
  falhou antes da correção e passou depois.
- O servidor de paridade não é acessível a partir do sandbox local. O teste foi
  executado no terminal da máquina, restrito a `127.0.0.1`; por isso a configuração
  aceita reutilizar um servidor de paridade já ativo. Em CI, ele continua sendo
  iniciado automaticamente quando a porta está livre.
- Não foi feito push, deploy nem pacote Hostinger nesta rodada.

## Estado de fechamento

A Rodada 2 está funcionalmente fechada. A 0.7.0 entra em congelamento de
features: os próximos passos são revisão final das mudanças, commits locais
descritivos e empacotamento somente após essa revisão.

## Revisão final da 0.7.0 — 26/10/2026

Escopo mantido em correções de regressão, apresentadas antes da implementação.
O usuário dispensou a compatibilidade antiga caso outro modelo fosse mais
simples; nesta revisão, as correções foram locais e não justificaram trocar
o formato v2. Nenhuma feature ou integração externa foi adicionada.

### Correções comprovadas

- **Colagem de vídeo com efeitos de áudio:** `pasteClips()` repetia os IDs
  dos efeitos do áudio vinculado. Duas colagens produziram duas ocorrências
  de ID duplicado na validação. Agora cada cópia recebe IDs novos; original
  e clipboard permanecem intactos.
- **Transição repetida após corte:** a segunda metade herdava a transição
  de entrada. O teste de corte aos 4 s, após uma entrada de 1 s, encontrou
  opacidade zero na nova borda. Agora a entrada pertence à primeira metade
  e a nova borda é um corte seco.
- **Áudio desvinculado cortado junto:** o corte usava `linkedLayerId` sem
  verificar `linked`. Agora o áudio com vínculo desligado permanece intacto.

Os três testes em `tests/unit/clip-tracks.test.ts` falharam antes das
correções e passaram depois. Alteração de produção restrita a
`src/model/clip-tracks.ts`.

### Validação desta revisão

- `npm run check`: legado íntegro, 13 arquivos/92 testes unitários,
  TypeScript, build e 15/15 cenários Playwright aprovados (1,4 min).
- A primeira tentativa no sandbox não avançou na conexão com o servidor
  de paridade e foi interrompida. A execução completa acima ocorreu fora
  do sandbox, com servidor restrito ao loopback.
- QA direto no Chrome em `http://127.0.0.1:4176/`, origem separada para
  preservar a recuperação existente em 4175: composição 1920×1080, 30 fps,
  10 s; geometria, reprodução/pausa, corte aos 5,4 s, sobreposição por arrasto,
  copiar/colar no playhead com nova faixa e Undo restaurando a montagem.
- Exportação manual MP4 H.264 concluída e salva em
  `test-results/revisao-070-manual.mp4`. Inspeção do arquivo com Mediabunny:
  AVC, 1920×1080, 10 s, 300 pacotes de vídeo, taxa média de 30 fps.
- O teste manual usou geometria; mídia real, seek, relink e sincronização
  A/V foram exercitados pelos cenários automatizados. Não houve escuta
  crítica de áudio, teste em iPad físico ou revisão de todos os codecs.
  A inspeção do MP4 confirma estrutura/timing, não comparação visual de
  cada frame. Cortar durante uma transição já em andamento não recebeu
  cobertura específica nesta revisão.

### Automação por IA/MCP: escopo preservado

A base simplificada já entregue é `window.vct` v1: consultas, validação,
catálogo, propriedades, keyframes, efeitos, lotes atômicos e um Undo por lote.
O cenário Playwright dessa API passou novamente. O contrato está em
`docs/AUTOMACAO.md`.

A operação completa por IA/MCP **ainda não está entregue**: faltam comandos
de montagem (corte, movimento, ripple e colagem), operações de projeto/mídia
e um adaptador externo. A Rodada 6 continua como próxima prioridade após
a entrega 0.7.0, reutilizando as operações do domínio por meio da API comum,
com contratos de permissões e resultados verificáveis. MCP/WebMCP e o
benchmark de tokens permanecem backlog, não critérios já aprovados.

Revisão encerrada no escopo acima; alterações locais prontas para revisão
do diff. Empacotamento, commit, push e deploy não foram feitos nesta sessão.

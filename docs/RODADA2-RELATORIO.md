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

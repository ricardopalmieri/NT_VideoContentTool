# Benchmark de tokens: editar com o VCT via MCP

Pergunta: editar vídeo com uma IA **usando o VCT** gasta menos tokens, e dá mais
controle, do que fazer só com prompts numa interface web?

## Tarefa medida

Reels vertical de 30 s para uma aula, com 18 comandos no total:
- um vídeo cortado em 6 trechos;
- 5 transições;
- título e crédito;
- depois, 2 rodadas de ajuste: trocar uma transição, mover o título, corrigir o crédito e apagar um trecho fechando o espaço.

## Abordagens

| | Como a IA trabalha | O que entra no contexto |
|---|---|---|
| **A. VCT via MCP** | lotes de comandos `vct_*` | `describe` uma vez; por rodada: timeline compacta, lote, resultado e uma miniatura de 270×480 |
| **B. Só prompts** | a IA lê e reescreve o projeto inteiro a cada pedido | projeto completo de entrada e de saída, por rodada |
| **C. Agente de interface** | clica na interface vendo screenshots | ~3 ações por comando, cada uma com um screenshot de 1366×768 |

## Resultado (`npm run benchmark:tokens`)

| Abordagem | Tokens estimados | Em relação ao VCT |
|---|---:|---:|
| A. VCT via MCP | **3.080** | 1× |
| B. Reescrever o projeto | 8.104 | 2,6× |
| C. Interface por screenshots | 78.786 | 25,6× |

Números gerados pelo código real do editor (`window.vct`, comandos e timeline) em
`tests/unit/token-benchmark.test.ts`. Saída bruta em `docs/BENCHMARK-TOKENS.json`.

## Premissas e limites (leia antes de citar)

- **Texto:** 1 token ≈ 4 caracteres de JSON.
- **Imagem:** tokens ≈ largura × altura / 750 (regra publicada pela Anthropic).
- **Envelope:** ~60 tokens por chamada de ferramenta.
- **B é otimista:** supõe que a IA reescreve o projeto sem erro. Projetos reais, com keyframes e efeitos, são maiores, e a diferença cresce com o tamanho, porque a abordagem A só envia a timeline compacta e o lote.
- **Não medido:** tokens de raciocínio do modelo e da conversa com o usuário, que são parecidos nas três abordagens.

## Controle e customização (além de tokens)

- **Transação:** cada lote é tudo ou nada e vira um passo de desfazer. O usuário vê e reverte na hora.
- **Validação:** comandos são validados (ids, frames, limites, faixa ocupada) e `vct_dry_run` mostra o resultado antes de aplicar.
- **Resultado editável:** o usuário continua a edição à mão no mesmo projeto, inclusive o que a IA fez.

## Como afirmar com segurança

> "Na tarefa de referência, editar com uma IA pelo VCT via MCP usou cerca de
> 2,6× menos tokens do que pedir à IA para reescrever o projeto e cerca de 25×
> menos do que operar a interface por screenshots (estimativa reproduzível no
> repositório)."

Para um número de produção, repita a tarefa com o Claude registrando `usage` da
API nas três abordagens.

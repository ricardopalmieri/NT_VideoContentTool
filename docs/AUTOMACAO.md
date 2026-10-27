# Automação local do VCT

## Disponibilidade e segurança

Com um projeto aberto, a página expõe `window.vct`, uma API síncrona para
consultar, validar e editar o projeto ativo. Ela é destinada a agentes de
navegador e ferramentas que já executam JavaScript na própria aba.

Por si só, a API não abre porta, servidor, WebSocket ou conexão externa; a
ponte com agentes fora do navegador só existe quando o usuário conecta o
servidor MCP local (veja "Agentes de IA fora do navegador"). Não oferece
acesso ao sistema de arquivos, salvar, exportar, abrir projetos, importar
mídias nem apagar camadas. A remoção de efeitos pede confirmação do usuário na
página. Comandos bem-sucedidos entram no histórico Undo/Redo e no autosave
local existente.

Todos os tempos são segundos. Keyframes respeitam a tolerância de meio frame
da composição. Projetos retornados por `getProject()` e `query()` são cópias;
alterá-los não muda a sessão. Erros de validação são lançados, sem commit
parcial.

## Leitura e catálogo

```js
const project = window.vct.getProject();
const layers = window.vct.query("layers");
const layer = window.vct.query({ layerId: layers[0].id });
const catalog = window.vct.listCatalog();
const validation = window.vct.validate();
```

`query()` aceita `"project"`, `"layers"` ou `{ layerId }`. O catálogo reúne
efeitos de camada/pós-produção e efeitos de áudio, rótulos, valores padrão e
parâmetros com limites usados pelo inspector.

## Comandos

`dispatch(command)` aplica um comando. `batch(commands, { label })` aplica de
1 a 100 comandos numa transação: todos passam ou nenhum é gravado, e o lote
cria um único passo de Undo.

Comandos disponíveis:

| Tipo | Campos | Resultado |
|---|---|---|
| `layer.setNumeric` | `layerId`, `property`, `value` | Altera propriedade numérica permitida e sincroniza timing de áudio ligado. |
| `layer.setName` | `layerId`, `name` | Renomeia camada não bloqueada. |
| `keyframe.upsert` / `keyframe.toggle` | `layerId`, `property`, `time`, `value`, `easing?` | Insere/atualiza ou alterna uma trilha numérica/cor permitida. |
| `effect.add` | `kind`, `ownerId`, `effectId` | Cria efeito de camada ou pós com ID fornecido pelo cliente. Para pós, `ownerId` é `"__post__"`. |
| `effect.setParam` | `effectId`, `parameter`, `value` | Atualiza parâmetro dentro dos limites do catálogo. |
| `effect.keyframe.upsert` / `effect.keyframe.toggle` | `effectId`, `property`, `time`, `value`, `easing?` | Anima parâmetro de efeito. |
| `effect.remove` | `effectId` | Remove efeito após confirmação do usuário. |
| `audioEffect.add` | `trackId`, `kind`, `effectId` | Adiciona efeito de áudio com ID determinístico. |
| `audioEffect.setParam` | `effectId`, `parameter`, `value` | Atualiza parâmetro de efeito de áudio dentro dos limites do catálogo. |
| `audioEffect.remove` | `effectId` | Remove efeito de áudio após confirmação do usuário. |

O executor aceita apenas esses tipos e campos, verifica IDs, limites, bloqueio,
keyframes e integridade v2 antes de gravar. IDs de efeitos são fornecidos pelo
cliente para que o resultado não dependa de geração aleatória.

```js
const layer = window.vct.query("layers").find((item) => item.kind === "text");
if (!layer) throw new Error("Adicione uma camada de texto antes.");

window.vct.batch([
  { type: "layer.setNumeric", layerId: layer.id, property: "x", value: 540 },
  { type: "keyframe.upsert", layerId: layer.id, property: "x", time: 0, value: 540 },
  { type: "keyframe.upsert", layerId: layer.id, property: "x", time: 1, value: 900, easing: "easeInOut" },
], { label: "Animar entrada do texto" });
```

## Mudanças

```js
const unsubscribe = window.vct.onChange((event) => {
  console.log(event.revision, event.label, event.commands);
});
// Ao encerrar o observador:
unsubscribe();
```

`revision` é local à página, aumenta após cada commit e não substitui a versão
do projeto. Eventos são emitidos para commits feitos por `window.vct`; edições
manuais continuam disponíveis normalmente pela interface.

## Limites atuais

- API versionada como `window.vct.version === "1"`.
- Sem servidor MCP, WebMCP, ponte local, WebSocket ou autenticação: ainda não
  existe canal externo para disparar a API.
- Sem edição de mídia/arquivos, clipe split/ripple, salvar/exportar ou apagar
  camadas; essas operações exigem contratos e confirmação próprios.
- O modelo de projeto continua `.ntvct` v2. A API não muda seu formato.

## Editar com IA no navegador (recomendado)

O caminho para quem usa o site é um agente que roda no próprio navegador e
executa JavaScript na página, como a extensão **Claude in Chrome**:

1. No editor, clique no botão **Editar com IA** (robô) da barra superior.
2. Siga o passo a passo e clique em **Copiar instruções**.
3. Cole no painel do Claude nesta aba e complete com o pedido.

O agente lê `window.vct.guide()` (fluxo, regras, motion design e VJ) e edita
pela API (`getTimeline`, `dryRun`, `batch`). Cada lote é um passo de desfazer.
Nada é enviado para servidores da Noisetupi. Agentes que só clicam e veem
screenshots também funcionam, mas gastam muito mais tokens
(`docs/BENCHMARK-TOKENS.md`).

**WebMCP:** se o navegador oferecer `navigator.modelContext` (Chrome, em
teste), a página registra as ferramentas `vct_*` para agentes do navegador.

## Servidor MCP local (só no repositório)

`mcp/vct-mcp-server.mjs` (`npm run mcp`) expõe as ferramentas `vct_*`, o guia
(`vct://guia`) e os prompts `vct-edit`/`vct-critique` para clientes MCP, numa
ponte WebSocket local com código. **A interface do editor não oferece mais a
conexão com esse servidor**; o código fica para uso futuro e para testes
(`tests/unit/mcp-bridge.test.ts`). `npm run build:mcp` gera um pacote `.tgz`
instalável com `npx`.

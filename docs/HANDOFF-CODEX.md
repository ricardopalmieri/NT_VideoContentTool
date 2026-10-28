# Passagem para o Codex (27/10/2026)

Documento para continuar o trabalho em outra ferramenta. O plano mestre é
`PLANO-DE-ACAO.md`; aqui está o estado exato, as regras do projeto e as
próximas tarefas com especificação suficiente para executar.

## 1. Estado

- `main` em `837220a` (no GitHub até `4a844a7`; `f903b1d` e `837220a` são
  locais). Batches 0–5 e 7 prontos e testados; pacote Hostinger testado pelo
  usuário.
- **Batch 11 em andamento** (sem commit), dividido em três partes:
  - **11A – API da IA e comandos:** ver a seção 3.1 (status no fim deste
    arquivo).
  - **11B – renderer:** `setDiagnostics` e correção da base por onde passam os
    efeitos (cache de textura, framebuffers, wrap/filtro). Status no fim.
  - **11C – interface:** não começou. Especificação na seção 3.2.
- Ordem depois: **pacote de efeitos novo** (seção 3.3, pedido do usuário:
  substituir os efeitos atuais) → Batch 12 → resto do 13 → 8 → 9 → 10 → 6.

## 2. Regras do projeto (valem para toda tarefa)

- **Versão, tag, push e deploy são do usuário.** Não mude a versão, não faça
  push, não suba para o Hostinger. Commit só quando o usuário pedir.
- Textos da interface bilíngues: `language === "pt-BR" ? "…" : "…"`
  (português primeiro). Comentários e estilo iguais ao código em volta.
- **Toda edição do projeto passa pelo registro de comandos**
  (`src/model/command-registry.ts`): a interface chama `applyCommands` /
  `beginGesture` em `src/ui/editor.ts`; a IA chama `window.vct`. Nada de
  mexer no documento direto. Um gesto = um passo de desfazer com nome.
- **Saídas de `window.vct` nunca têm `?`, `&` ou `=`** (a extensão do Chrome
  bloqueia) e ficam curtas (a ferramenta de JS corta perto de 1000
  caracteres; textos longos são paginados com `vct.more()`).
- Nenhuma chamada de `window.vct` espera clique da pessoa (o JS do agente
  expira em ~45 s): pedidos são não bloqueantes (`vct.request` +
  `vct.status`).
- Strings vindas do agente ou do projeto entram no HTML só via
  `escapeHtml` (`src/ui/escape-html.ts`).
- CSP de produção em `public/.htaccess`; os testes rodam sob ela
  (`scripts/serve-parity.mjs`). Nada de script de CDN.
- Tablet: alvos de 44 px em `@media (pointer: coarse)`.
- Depois de mudar o registro: `DOCS_WRITE=1 npx vitest run tests/unit/api-docs.test.ts`
  para regenerar `docs/API-AGENTE.md` (há teste que falha se estiver velho).

## 3. Próximas tarefas

### 3.1 Batch 11A – API da IA (conferir o que já foi feito)

Esperado: `describe()` em uma página; `describe('tipo')` em texto e
`{ format: 'json' }`; `describe('props texto')` etc.; `batch`/`plan`/
`dryRun`/`dispatch` devolvem `ok · N comandos · desfazer: …` ou
`erro no comando N (tipo): …` sem lançar exceção, e `{ ok, errors, warnings,
results }` com `{ format: 'json' }`; filtro de ? & = em toda saída (com
teste); comandos `layer.setMany` (ids, `trackId` ou `kind`, `props`,
`multiply`) e `clip.fade` (vídeo + áudio vinculado); `text.fromSrt` com
fonte de 5,5% da altura; `clip.place` sem `fit` = tamanho original;
`vct.view({ solo, bypassEffects })` via `host.setDiagnostics`;
`captureFrame({ show: true })` usando o overlay da folha de contato.

### 3.2 Batch 11C – interface (`src/ui/editor.ts`, `media-bin.ts`, `styles.css`, `src/transcribe/transcribe-dialog.ts`)

1. **Tamanho original sempre** (decisão do usuário): colocar mídia do bin
   (arrastar, tocar, "No playhead", "Nova faixa") usa o tamanho em pixels do
   arquivo, centralizado. Remover a preferência `nt-vct-default-fit` e o
   `<select data-asset-fit>`. Na seção Transformação de camadas de
   mídia, três botões: **Original · Inteiro · Preencher** (comando
   `layer.fit` com `none`/`contain`/`cover`).
2. **Seleção múltipla:** Shift/Ctrl+clique na lista de camadas e na
   timeline; clique no nome da faixa seleciona todos os clipes dela. O
   inspector mostra só as propriedades comuns; mudar uma aplica a todas com
   `layer.setMany` (um passo de desfazer). Valores diferentes aparecem como
   "—".
3. **Estilo da faixa de legenda:** com a faixa de legendas selecionada,
   tamanho, fonte, peso, cor, contorno, sombra e posição Y valem para todas
   (via `layer.setMany` com `trackId`). Botões rápidos −10% / +10% no
   tamanho (`multiply`).
4. **Diálogo da legenda automática:** antes de inserir, escolher tamanho
   (P 4,5% · M 5,5% · G 7% da altura), posição (embaixo/meio/em cima) e
   sombra ligada por padrão; passar em `props` do `text.fromSrt`.
5. **Faixa "IA editando" por cima:** hoje `body.has-agent-strip` vira flex e
   empurra o layout (`styles.css`, `.agent-strip`). Fazer `position: fixed`
   no topo, com fundo semitransparente, sem mudar o tamanho do preview.
6. Testes Playwright: colocar 1280×720 em 1920×1080 resulta em 1280×720;
   seleção múltipla + mudar tamanho = um desfazer; faixa não altera a
   posição do canvas.

### 3.3 Pacote de efeitos novo (substitui os atuais; pedido do usuário)

Problema: todos os efeitos vivem num shader único com `if (u_effect == N)`
(`src/renderer/shaders.ts`); o blur é amostragem em grade num passo
(quadriculado); o glitch usa blocos de tamanho fixo; o bloom estoura
fundos claros.

1. **Arquitetura:** pasta `src/renderer/effects/`, um módulo por efeito:
   `{ kind, passes: [{ fragment, uniforms(params, time, size) }], params }`.
   O renderer compila cada programa sob demanda e faz ping-pong entre
   framebuffers (de preferência RGBA16F com `EXT_color_buffer_float`,
   senão RGBA8). Entrada e saída em alpha pré-multiplicado
   (despremultiplicar dentro do shader quando a cor importa). Bordas com
   CLAMP_TO_EDGE. Manter `EffectKind` e os nomes de parâmetros atuais
   (`src/model/effect-catalog.ts`) para os projetos `.ntvct` antigos
   abrirem; parâmetros novos ganham padrão.
2. **Fontes a portar** (baixar com `npm pack` numa pasta temporária, ler e
   adaptar; atribuição em `THIRD_PARTY_LICENSES.md` + texto da licença em
   `LICENSES/`):
   - **glfx.js** (MIT, Evan Wallace): `triangleBlur` (2 passes),
     `zoomBlur`, `tiltShift`, `lensBlur`, `vignette`, `brightnessContrast`,
     `hueSaturation`, `vibrance`, `unsharpMask`, `noise`, `dotScreen`,
     `colorHalftone`, `hexagonalPixelate`, `ink`, `edgeWork`.
   - **pmndrs/postprocessing** (zlib): `GlitchEffect` (blocos de tamanho e
     posição aleatórios por rajada, intervalos irregulares, separação RGB),
     `ChromaticAberration`, `Noise`/grão, `Vignette`, `BloomEffect`.
   - **three.js** `UnrealBloomPass` (MIT): limiar com joelho suave + cadeia
     de mip blur + soma.
   - **GPUImage** (BSD-3, Brad Larson): `WhiteBalance` (temperatura/tint),
     `HighlightShadow`, `Exposure`, `Levels`, `ToneCurve`, `LookupFilter`.
   - Fórmulas **W3C Compositing and Blending** para os modos de mesclagem;
     **ASC CDL**/lift-gamma-gain para cor; **LUT 3D `.cube`** depois.
   - Evitar fontes sem licença livre para uso comercial (ex.: lygia).
3. **Mapa dos efeitos atuais → novos:** `blur` → gaussiano separável
   (raio em px reais; `quality` vira número de passes); `glow` → bloom
   Unreal; `glitch` → glitch pmndrs (manter `amount`, `frequency`,
   `rgbSplit`, `mix`; `blockSize` vira tamanho máximo); `noise` → grão de
   filme; `levels` → cor (brilho, contraste, saturação, gamma, mais
   exposição/temperatura/tint opcionais). Novos: `vignette`,
   `chromaticAberration`, `sharpen`, `zoomBlur`, `tiltShift`, `halftone`,
   `colorBalance` (lift/gamma/gain). Atualizar `effect-catalog.ts`
   (rótulos pt/en, padrões, faixas em `EFFECT_PARAMETERS`), o registro
   (enum de `effect.add` usa o catálogo) e `docs/API-AGENTE.md`.
4. **Testes** só dos efeitos novos: para cada um, um teste Playwright que
   renderiza um quadro conhecido e confere propriedades (blur: gradiente
   monotônico sem padrão periódico, inclusive em camada maior que o
   quadro; bloom: quadro quase branco não satura com intensidade 0,35;
   glitch: tamanhos de bloco variam entre dois instantes). Atualizar
   `tests/parity/editor.spec.ts` (contagem de efeitos do catálogo) e
   `tests/unit/source-contract.test.ts` (patch do shader) conforme a nova
   estrutura.

### 3.4 Batch 12 e restante do 13

Ver `PLANO-DE-ACAO.md` (seções "Batch 12" e "Batch 13"): painel de
propriedades em sanfona, caixa de fundo/entrelinha/espaçamento no texto,
legenda karaokê, guia de área segura; pipeline em luz linear, LUT `.cube`,
looks, letterbox.

## 4. Como verificar

```bash
npx tsc --noEmit && npx tsc -p tsconfig.tests.json
npx vitest run
npm run build
npx playwright test
npm run test:browsers
```

Antes de rodar o Playwright, encerre servidores antigos na porta 4174
(`scripts/serve-parity.mjs`); `reuseExistingServer` reaproveitaria um
servidor sem a CSP atual. O pacote do Hostinger é
`npm run package:hostinger` (só quando o usuário pedir).

## 5. Status das partes em andamento

(preenchido abaixo quando 11A e 11B terminarem)

### 11B – renderer (concluído)

- Causa do quadriculado: o shader de blur usa 5 amostras com passo igual ao
  `radius` (11 a 500 px entre amostras), desenhando cópias fantasmas da borda;
  `source()` devolve transparente fora da textura (o blur escurece nas bordas)
  e o passo não acompanha a escala do preview. Glow: soma a cor inteira
  filtrada só pelo canal máximo, sem subtrair o limiar, e estoura fundo claro.
  **A base (cache, framebuffers, wrap) está correta**: passes identidade dão
  pixels idênticos nos dois caminhos.
- `ComposerRenderer.setDiagnostics({ soloLayerId, bypassEffects })` pronto
  (export ignora). Falta ligar a `window.vct.view` se o 11A não ligou.
- `tests/parity/effects-regression.spec.ts`: 7 testes ativos da base; os de
  blur/bloom estão em `test.fixme` até o pacote novo (seção 3.3) chegar.
  Projetos novos começam transparentes: os testes usam `transparent: false`.

### 11A – API da IA (status)

Feito (sem commit; `tsc` dos meus arquivos limpo, `vitest` 237 testes verdes;
Playwright não rodado):

- `describe()` virou índice (~1,3 mil caracteres: 2 páginas, com os ponteiros
  na primeira); `describe('tipo')` devolve texto; `'props texto|forma|imagem|
  video|guia|audio|composicao|camada'`, `'regras'`, `'tudo'`;
  `{ format: 'json' }` devolve objeto. Código em `src/automation/describe.ts`;
  tabelas por tipo em `property-tables.ts` (`LAYER_KIND_PROPERTIES`).
- `batch`, `plan`, `dryRun` e `dispatch` devolvem texto curto (`ok · N comandos
  · desfazer: … · criados: … · avisos: …`) ou `erro no comando N (tipo): …`
  sem lançar; `{ format: 'json' }` dá `{ ok, errors, warnings, results }`.
  `runProjectCommands` lança `CommandError` com índice e tipo. Pausa,
  exportação em andamento e argumentos inválidos ainda lançam. A ponte
  (`agent-bridge.ts`) continua marcando falha como erro para o MCP.
- Filtro de `? & =` em tudo que `window.vct` devolve (`safe-text.ts`; objetos
  e mensagens de erro; `dataUrl` fica intacto). Teste que percorre todos os
  métodos: `tests/unit/api-cheap.test.ts`.
- Comandos novos `layer.setMany` (layerIds/trackId/kind, `props`, `multiply`)
  e `clip.fade`; `text.fromSrt` com 5,5% da altura, caixa de 2 linhas, dentro
  da área segura; `clip.place` sem `fit` usa o tamanho original centralizado.
- `vct.view({ solo, bypassEffects })` liga `host.setDiagnostics` a
  `renderer.setDiagnostics` em `editor.ts`; reseta com `view({})`, ao criar
  novo renderer (abrir, desfazer, refazer) e quando a camada isolada some.
  `captureFrame({ show: true })` usa `showFrame` em `contact-sheet.ts`.
- `docs/API-AGENTE.md` regenerado (`describe('tudo')`), `docs/AUTOMACAO.md`,
  `agent-guide.ts`, descrições do MCP e do WebMCP atualizados; specs
  `tests/parity/agent.spec.ts` e `editor.spec.ts` ajustados ao novo retorno.

Falta / atenção:

- Conferir no navegador (`vct.view`, `captureFrame({ show: true })`, legendas
  novas) e rodar Playwright; `docs/BENCHMARK-TOKENS.*` não foi regenerado.
- O índice não cabe em 900 caracteres com os campos obrigatórios; se quiser
  uma página só, tirar os campos do índice.
- A parte de interface do tamanho original (botões Inteiro/Preencher,
  preferência de enquadramento) é do 11C.
- `tsc` reclama de `src/renderer/effects/*` (tipos de `EffectKind` do pacote
  de efeitos em andamento); não é desta parte.

### Pacote de efeitos (status)

Prioridades 1 a 6 da seção 3.3 feitas, sem commit. O que existe:

- **Arquitetura** (`src/renderer/effects/`): `types.ts` (`EffectModule`, `PassSpec`),
  `runtime.ts` (`EffectRuntime`: compila cada passe sob demanda, pool de buffers
  por tamanho, ping-pong, alvos RGBA16F quando há `EXT_color_buffer_float` e RGBA8
  senão, DRY / WET como passe final automático), `common.ts` (hash, premultiplicar,
  gaussiana separável), `index.ts` (`EFFECT_MODULES`). O `composer-renderer.ts`
  chama `runModule` quando o `EffectKind` está em `EFFECT_MODULES` e usa o shader
  único (`shaders.ts`) para os demais. Alpha pré-multiplicado de ponta a ponta,
  CLAMP_TO_EDGE, parâmetros sem valor no projeto caem no padrão do catálogo.
  Um módulo que não compila vira passagem direta e registra o erro no console.
- **Módulos** (um arquivo cada): `blur` (gaussiana separável, sigma = `radius` ×
  escala de render, `quality` = repetições), `glow` (bloom: filtro com joelho suave,
  5 mips gaussianos, soma em "screen" exponencial que não estoura fundo claro),
  `glitch` (rajadas irregulares sem estado: o mesmo instante dá o mesmo quadro;
  blocos de tamanho e posição sorteados por passo, faixa espelhada, separação RGB,
  scanlines), `noise` (grão de filme em meios-tons, 24 Hz), `levels` (ganhou
  `exposure`, `temperature`, `tint`, `vibrance`, todos 0 = neutro), e os novos
  `vignette`, `chromaticAberration` (pós), `sharpen`, `zoomBlur`, `tiltShift`,
  `halftone` (camada). Os cinco efeitos migrados saíram do shader único.
- **Catálogo/tipos:** `EffectKind` e `effect-catalog.ts` (23 efeitos). Nomes e
  parâmetros antigos intactos. `docs/API-AGENTE.md` regenerado.
- **Licenças:** `THIRD_PARTY_LICENSES.md` + `LICENSES/` (glfx MIT, postprocessing
  zlib, three MIT, GPUImage BSD-3). O texto do GPUImage foi transcrito do modelo
  BSD-3 do projeto (não está no npm): conferir com o repositório antes de publicar.
- **Testes:** `tests/parity/effects-regression.spec.ts` (blur e bloom ativos; um teste
  por efeito novo, glitch compara tamanhos de bloco entre instantes);
  `tests/unit/source-contract.test.ts` tira do original os cinco blocos que saíram do
  shader; `editor.spec.ts` espera 23 efeitos.

**Não feito / pendente**

- `colorBalance` (lift/gamma/gain), `lensBlur`, `ink`, `edgeWork`, `hexagonalPixelate`,
  GPUImage `HighlightShadow`/`Levels`/`ToneCurve`/`LookupFilter` e LUT `.cube`.
- Os efeitos antigos que seguem no shader único (mirror, kaleidoscope, crop, edge,
  chaves, animaTracer, rgbDelay, vhs, cameraShake) não viraram módulos.
- Pipeline em luz linear (Batch 13).
- `src/model/macros.ts` (`expandSpike`) tem a lista fixa de efeitos de pós
  (`rgbDelay noise glitch vhs cameraShake glow`): `vignette` e `chromaticAberration`
  são de pós mas `fx.spike` exige `ownerId` para eles. Trocar a lista por
  `EFFECT_CATALOG[kind].category === "post"` (arquivo do 11A, não mexi). O texto de
  `describe.ts` também lista só os pós antigos.
- Interface: a descrição "GPU shader effect" no inspector é genérica; só o bloom tem
  texto próprio. `tiltShift`, `sharpen`, `zoomBlur` e `halftone` são efeitos de
  camada (não aparecem na lista de pós).

**Como adicionar um efeito**

1. `src/model/types.ts`: incluir o nome em `EffectKind`.
2. `src/model/effect-catalog.ts`: entrada em `EFFECT_CATALOG` (categoria `layer` ou
   `post`, rótulos pt/en, padrões) e em `EFFECT_PARAMETERS` (faixas). 0 deve ser o
   neutro de parâmetros novos de efeitos que já existem em projetos antigos.
3. `src/renderer/effects/<nome>.ts`: `export const x: EffectModule = { kind, passes(params, frame) { return [{ id, fragment, inputs?, size?, uniforms }] } }`.
   O fragmento só traz `uniform`s próprios e `void main()`; `v_uv`, `outColor`,
   `u_size`, `u_frame`, `u_scale`, `u_time`, `hash`, `luma`, `unpremul`, `premul` e um
   sampler por chave de `inputs` já vêm declarados (`u_input` é o padrão e lê o passe
   anterior; `"src"` é a entrada do efeito). Pixels em px reais: multiplique por
   `frame.scale`. Devolver `[]` = efeito sem efeito (o runtime passa a entrada adiante).
   Passes intermediários podem ter `size` fracionário (ver `bloom.ts`). Não declare
   variável chamada `step` nem redeclare samplers.
4. Registrar em `src/renderer/effects/index.ts` (lista de `EFFECT_MODULES`).
5. Teste em `tests/parity/effects-regression.spec.ts` (`run`, `rect`, `addEffect`,
   `capture`), atualizar a contagem em `tests/parity/editor.spec.ts`, rodar
   `DOCS_WRITE=1 npx vitest run tests/unit/api-docs.test.ts`.
6. Se portar código de terceiros: linha em `THIRD_PARTY_LICENSES.md` e texto em
   `LICENSES/`, e cite a origem no cabeçalho do módulo.

### Transcrição longa (status)

Feito (sem commit; `tsc` dos dois projetos limpo, `vitest` 263 testes verdes,
`npm run build` ok, `playwright tests/parity/transcribe.spec.ts` 7 de 7). Causa
do caso dos 30 min: o áudio inteiro ia numa chamada só, o `catch` do
`return_timestamps: 'word'` recomeçava tudo (engolindo até falta de memória) e
o erro do worker nunca chegava à interface.

- **Blocos** (`src/transcribe/blocks.ts`, puro): `planBlocks` fatia o áudio de
  16 kHz em blocos de ~5 min com 5 s de sobreposição (resto < 30 s é anexado ao
  último); `mergeBlockSegments` junta no meio da sobreposição, palavra a
  palavra quando há `words`; `chunksTotal` = número real de blocos. O motor
  real (`engine.ts`) manda um bloco por vez ao worker (cópia transferida), o
  worker (`whisper.worker.ts`) mantém o modelo carregado e responde por bloco;
  a página guarda o áudio inteiro para poder retomar.
- **Parcial:** cada bloco pronto atualiza `cues`/`srt` no estado
  (`vct.transcript()` e o diálogo mostram o que existe, com "Parar e revisar").
  `etaSeconds` vem da velocidade medida (`estimateRemainingSeconds`).
- **Erros** (`errors.ts`): só o erro de tempos por palavra do Transformers.js
  (`isWordTimestampError`) cai para frases; qualquer outro erro refaz só aquele
  bloco uma vez (no WASM se foi WebGPU) e depois vira `failed` com texto legível
  (memória tem mensagem própria). `error`, `unhandledrejection` e
  `messageerror` do worker chegam como erro. A fase de erro do app é `failed`.
- **Watchdog:** no diálogo (`runBlocks`): 90 s sem mudar o progresso encerra o
  worker, fase nova `stalled`, botão "Retomar do bloco N" (mantém as legendas).
  Teste: `globalThis.__VCT_TRANSCRIBE_TUNING__ = { stallMs, blockSeconds,
  overlapSeconds, minTailSeconds }` antes da página carregar.
- **Tempo por palavra** só por padrão até 5 min; checkbox no diálogo e `words`
  na API. **Mídia > 10 min:** aviso "vai demorar ~X min nesta máquina", campo
  Trecho (tudo / região de trabalho / início–fim), "Só o clipe selecionado" e
  "Usar o modelo Rápido" sem WebGPU. Silêncios internos ≥ 15 s e pontas mudas
  não vão ao modelo (`findSpeechRanges` sobre `levelProfile`).
- **API:** `vct.transcribe({ start, end, words, … })`,
  `vct.cancelTranscribe()`; `status()` mostra "bloco N de M, ~X min
  restantes" e as legendas até agora. Saídas sem `? & =`.

Falta / atenção:

- Nunca rodou com o Whisper de verdade neste ambiente (só o motor falso): vale
  um teste manual com 30 min em máquina sem GPU e conferir a emenda dos blocos.
- A decodificação do arquivo (`decodeAsset`) ainda carrega a mídia inteira em
  memória antes de reamostrar; vídeos de horas continuam pesados nessa etapa.
- O estimador prévio ("vai demorar ~X min") usa fatores fixos
  (`REAL_TIME_FACTOR` em `blocks.ts`); ajuste com medidas reais.
- Retomar depende do diálogo aberto; fechar o diálogo cancela e descarta o
  áudio guardado.

## 6. Verificação integrada (27/10/2026, sem commit)

Com 11A, 11B, pacote de efeitos e transcrição longa juntos: `tsc` limpo,
vitest 263/263, `npm run build` ok, Playwright 82 passaram (0 falhas),
`test:browsers` 5 passaram / 3 pulados (pinça só no Chromium com toque).

**Próximo passo:** Batch 11C (seção 3.2), depois Batch 12. Pendências
conhecidas: conferir o texto da licença do GPUImage contra o repositório
original; `decodeAsset` ainda decodifica o arquivo inteiro antes de reamostrar
(transcrição de vídeos muito longos); estimativa de tempo da transcrição usa
fatores fixos; teste real de 30 min sem GPU e de `vct.view` /
`captureFrame({ show: true })` num navegador de verdade.

### Decodificação em partes (status)

Feito (sem commit). Módulos novos: `src/transcribe/stream-resample.ts` (puro:
`StreamResampler` sinc/Blackman com banco de 512 fases, corte em 0,47 × Nyquist
da saída; `downmixInto`; `placeDecoded`; `decodeRange`) e
`src/transcribe/stream-decode.ts` (mediabunny por `import()` dinâmico:
`Input` + `BlobSource` + `AudioBufferSink`, uma passada pelo trecho, janelas de
30 s para o reamostrador, escreve direto num `Float32Array` do tamanho final;
`streamProbeAudio` lê duração/presença de áudio sem decodificar). Em
`src/audio/audio-engine.ts`: `decodeAssetTo16kMono(asset, { from, length,
signal, onProgress })` (usada só pela transcrição; cai em `decodeAsset` +
`resampleTo16kMono` se o mediabunny não lê o contêiner/codec, se erra no meio
ou se o arquivo já está decodificado em cache) e `probeAudioInfo(asset)`
(`{ hasAudio, duration }` sem decodificar tudo; cai em `probeAudio`).
`globalThis.__VCT_AUDIO_PREP__` guarda `{ path: "stream" | "fallback", windows,
inputFrames, outputSamples, windowFrames, reason }` da última preparação
(diagnóstico e teste).

Medido (Chromium, WAV 44,1 kHz estéreo de 10 min, 106 MB, pico do processo do
renderer): antes 796 MB; depois 275 MB (a linha de base do app é ~110 MB; a
saída de 16 kHz tem 38 MB). Cerca de 4,7 s para preparar os 10 min.

**Ligações pendentes (arquivos de outro dono; sem elas o ganho não aparece e o
teste Playwright "arquivo longo é decodificado em janelas…" falha):**

1. `src/transcribe/transcribe-dialog.ts`: importar `decodeAssetTo16kMono` no
   lugar de `decodeAsset`, tirar `resampleTo16kMono` do import, e em
   `prepareAudio(choice, signal)` trocar a última linha por
   `return decodeAssetTo16kMono(choice.asset, { from: choice.from, length: choice.length, signal });`
   (e chamar `prepareAudio(choice, signal)` em `run`).
2. `src/ui/media-probe.ts`: a importação chama `probeAudio`, que decodifica o
   arquivo inteiro e guarda em cache para sempre (um vídeo de 30 min fica com
   ~600 MB antes mesmo de transcrever, e a transcrição reaproveita esse cache).
   Trocar por `probeAudioInfo`: no vídeo,
   `metadata.hasAudio = await probeAudioInfo(asset).then((info) => info.hasAudio, () => false)`;
   no áudio, `const info = await probeAudioInfo(asset); metadata.duration = info.duration; metadata.hasAudio = true;`.
   Isso também permite tirar o limite `AUDIO_PROBE_LIMIT`.

Atenção: colocar o clipe na timeline faz o motor de reprodução
(`AudioTimelineEngine`) decodificar o arquivo inteiro e guardar em cache;
`editor.ts` (linhas ~2001, ~3539, ~3597) também usa `probeAudio`. Nesses casos a
transcrição reaproveita o buffer (`reason: "cache"`) e a memória já foi gasta
por eles. Esvaziar isso exige trocar a reprodução por leitura em partes, fora
deste escopo. Não testado com MP4/MP3/OGG reais (só WAV); o fallback cobre o
que o WebCodecs do navegador não decodifica.

### 11C – interface (status)

Feito (sem commit): tsc dos dois projetos limpo, vitest 276/276, build ok, Playwright 87/87.

1. **Tamanho original:** `placeAsset` não manda mais `fit` (o `clip.place` usa o tamanho do arquivo, centralizado). Saíram `defaultFit`, `nt-vct-default-fit` e o `<select data-asset-fit>` (o inspector de mídia do bin ganhou só uma nota). A seção Transformação de camadas de mídia (e a seleção múltipla de mídia) tem **Original · Inteiro · Preencher** (`[data-fit]`, `layer.fit` none/contain/cover; `aria-pressed` mostra o que a camada já é).
2. **Seleção múltipla:** Shift/Ctrl+clique (lista de camadas, nome do clipe na timeline, clipes) alterna a camada em `selectedClipIds`; clique no nome da faixa de vídeo (ou Enter nele; F2 renomeia, duplo clique também) seleciona todos os clipes dela. `renderMultiInspector` mostra só o comum (transformação, mídia, texto, sombra, blend); valores diferentes aparecem vazios com "—"; cada mudança é um `layer.setMany` (`applyToSelection`, camadas bloqueadas são ignoradas, caixas de texto crescem para caber). Atualiza os campos no lugar (`syncMultiInspector`), sem perder o foco.
3. **Faixa de legendas:** com a faixa selecionada o inspector múltiplo de texto tem fonte, tamanho (−10% / +10% via `multiply`), peso, cor, contorno, sombra (ligar/desligar, opacidade, blur, X, Y) e Y.
4. **Diálogo da legenda automática:** na revisão, tamanho P 4,5% / M 5,5% / G 7%, posição (embaixo/meio/em cima) e sombra ligada; `src/transcribe/subtitle-style.ts` gera os `props` (fonte, altura da caixa de 2 linhas, y, sombra) para `text.fromSrt` via `host.insertSrt(srt, props)`. A preparação do áudio usa `decodeAssetTo16kMono` (pedido da coordenação).
5. **Faixa "IA editando":** `position: fixed` no topo, fundo semitransparente; o body não é mais flex, então o canvas e a barra superior não se mexem.
6. **Testes:** `tests/parity/interface-11c.spec.ts` (1280×720 em 1920×1080, botões de enquadramento, seleção múltipla com um desfazer, faixa de legenda, faixa que não move o canvas), asserções de estilo em `transcribe.spec.ts`, `tests/unit/subtitle-style.test.ts`.

Atenção: Shift e Ctrl alternam (não há seleção por intervalo); a seleção múltipla não move/apara em grupo; o inspector múltiplo não cobre keyframes, efeitos nem tempo.

## 7. Fechamento do Batch 11 (27/10/2026, sem commit)

11A, 11B, 11C, pacote de efeitos, transcrição longa e decodificação em partes
integrados. `media-probe.ts` passou a usar `probeAudioInfo` (sem decodificar o
arquivo inteiro na importação). Licença do GPUImage substituída pelo
`License.txt` original. Verificação: tsc limpo, vitest 276/276, Playwright
87 passaram, `test:browsers` 5 passaram / 3 pulados, `package:hostinger` com
todas as checagens OK. Próximo: Batch 12 (seção 3.4).

### Transcrição: desempenho e inserção (status)

Feito (sem commit). Achados de uso real (Chrome, RTX 4060, WebGPU com `shader-f16`, site num subcaminho do Hostinger):

1. **Arquivos por dispositivo** (`model-catalog.ts`: `ModelProfile` = `wasm` | `webgpu` | `webgpu-f16`; `gpu.ts`: `detectProfile`). O q8 só vale no WASM (encoder e decoder q8). Na WebGPU: encoder fp16 (com `shader-f16`) ou fp32 e decoder `decoder_model_merged_q4`, como o exemplo whisper-webgpu. Tamanhos medidos em huggingface.co: base 80 / 168 / 209 MB, small 252 / 413 / 589 MB (wasm / webgpu-f16 / webgpu). `whisperModel(size, profile)` dá a lista de arquivos; cache (`missingFromBrowserCache`), pasta `models/` (`isOnServer`, por perfil), importação manual (`storeModelFiles(size, files, profile)`, aceita pasta com todos os perfis), aviso de download (diz "versão para placa de vídeo" ou "para processador") e `scripts/fetch-whisper-model.mjs` (`base|small [wasm|webgpu-f16|webgpu|recomendado|all] [pasta]`, padrão `recomendado` = wasm + webgpu-f16) seguem o perfil. Interface do motor: `availability(model, profile)`, `importFiles(model, files, profile)` e `request.profile`. Se a WebGPU falha ao carregar ou num bloco, o worker recomeça no `wasm` (permite baixar o q8 se faltar).
2. **Watchdog.** O worker manda `heartbeat` a cada 3 s e `put()` do streamer (cada token) manda progresso dentro do bloco; no WASM de uma thread o timer quase não roda durante a conta (medido: 1 heartbeat em 28 s), então **qualquer mensagem do worker** conta como vida (`request.onAlive`). `STALL_MS` = 60 s sem sinal de vida; vivo mas sem progresso: 4x isso (no mínimo 2x a estimativa do bloco); motor sem heartbeat (o falso dos testes): 60 s ou a estimativa do bloco sem progresso. Mensagens distintas: "sem responder", "sem avançar", "sem progresso".
3. **COOP/COEP** em `public/.htaccess` (`same-origin` e `credentialless`) e em `scripts/serve-parity.mjs` (lidos do `.htaccess`, só para `current`). Medido: `crossOriginIsolated` verdadeiro na página e no worker, download do Hugging Face com fetch/CORS e a suíte inteira continuam funcionando; **Revertido em 28/10:** com 2 ou mais threads o `InferenceSession.create` nunca termina no Chrome 156 do site publicado (WebGPU e WASM; medido no Chrome do usuário: 1 thread pronto em 2-3 s). `numThreads = 1` sempre; o isolamento continua ligado.
4. **Longa duração.** Já era 30 s / stride 5 dentro de blocos de 5 min; o `batch_size` não existe no pipeline de fala do Transformers.js 4.3.1 (pedaços em sequência). Tempo por frase por padrão acima de 5 min (já era). Estimativas (`REAL_TIME_FACTOR`, s de relógio por s de áudio), medidas no navegador real com a fala sintética em pt-BR: base webgpu-f16 0,11-0,16 (usado 0,12), small webgpu-f16 0,17 (0,2), base wasm 0,47 com 1 thread e 0,24 com 4, small wasm 0,61 com 4 threads (usado 0,65; 1 thread, 1,3, não medido). 170 s de áudio: small na WebGPU 29 s, base 19 s. Carregar o modelo na primeira vez: 20-45 s (WebGPU), com download.
5. **Inserir na timeline com a mídia** (`insert-media.ts`, puro): `mediaPlacementCommands(project, { asset, from, length })` devolve `clip.place` (tamanho original, `startTime = sourceIn = início do trecho`, áudio vinculado, termina no fim do trecho, do arquivo ou da composição) ou `audio.create` para áudio, só se o arquivo do bin não está na timeline; id livre (`transcrito`, `transcrito_audio`). O diálogo chama `host.insertSrt(srt, props, before)`; `before` entra no mesmo lote, antes de `text.fromSrt` (legendas ficam por cima).
6. **Legendas em 9:16** (`macros.ts`: `subtitleBox`, `charsPerLine`; `subtitle-style.ts`): fonte = 5,5% (P 4,5 / G 7) do **lado menor**, caixa de 86% da largura; `subtitleMaxChars` = `min(42, floor((largura - respiro) / (0,55 × fonte)))` (M em 9:16: 28 colunas). O diálogo monta as cues com esse limite e refaz as linhas ao trocar o tamanho na revisão, se o texto não foi editado. Resumo do `text.fromSrt` em `command-registry.ts` e `docs/API-AGENTE.md` corrigidos ("lado menor"); `api-cheap.test.ts` ajustado (esperava a altura em 9:16).

**Ligação pendente em `src/ui/editor.ts` (outro dono; sem ela o teste Playwright "Inserir na timeline coloca também a mídia…" falha e a mídia não entra):**

```ts
function insertSubtitles(target: ProjectDocument, srt: string, label: string, props?: Record<string, unknown>, media: readonly VctCommand[] = []) {
  // ...
  if (!applyCommands([...media, { type: "text.fromSrt", srt, idPrefix: prefix, ...(props ? { props } : {}) }], label)) return { created: -1, skipped: 0 };
  const created = project ? project.layers.length - before - media.filter((command) => command.type === "clip.place").length : 0;
  // ...
}
// transcribeHost:
insertSrt(srt, props, media) {
  if (!project || exportInProgress) return 0;
  const { created } = insertSubtitles(project, srt, editLabel("Legenda automática", "Auto subtitles"), props, media);
  return Math.max(0, created);
},
```

Verificado com esse patch numa cópia do repositório: `transcribe.spec.ts` 12/12.

Medido com o Whisper de verdade (script fora do repo, Chrome real, WebGPU RTX 4060): base e small na WebGPU e no WASM transcrevem em pt-BR corretamente; o `return_timestamps: 'word'` cai para frases nos modelos onnx-community (também no WASM q8; antes e depois desta mudança). Falta: teste de 30 min de ponta a ponta; GPU sem `shader-f16` (perfil `webgpu`, fp32) e Safari/Firefox não testados com o modelo real; `verify-release.mjs` não confere os cabeçalhos COOP/COEP; o ambiente de 4174 precisa ser reiniciado depois de mudar o `.htaccess` (o servidor lê o arquivo ao subir).

Verificação (28/10/2026, sem commit): `tsc` do app limpo; `tsconfig.tests.json` só reclama de `tests/parity/zz-audit.spec.ts` (`openLibraryDrawer` sem uso, arquivo do agente da interface, o que também quebra `npm run build`); vitest 291/291; `vite build` ok. Playwright inteiro numa cópia isolada do repositório (porta 4175, com o patch do editor acima): 102 de 105; as 3 falhas são testes novos da interface (`ux-review.spec.ts` rolagem 768×1024 e divisores de colunas, `zz-audit.spec.ts` 768×1024), que falham também sem COOP/COEP. `test:browsers` (Firefox, WebKit, iPad, Chromium tablet) sob COOP/COEP: 5 passaram, 3 pulados. No repositório principal, sem o patch do editor, só o teste Playwright "Inserir na timeline coloca também a mídia…" falha.

### Revisão de UX/UI (status)

Feito (sem commit; `src/ui/editor.ts`, `styles.css`, `info-panels.ts` e `tests/parity/ux-review.spec.ts`). O patch do `insertSrt`/`insertSubtitles` com `media` (seção da transcrição) também está aplicado.

**Achados do usuário**
1. **Rolagem.** Causas: o inspector de seleção múltipla era um `div` solto na grade do `#inspector` (a linha `auto` crescia, o `.right-panel` cortava e o botão Excluir sumia); janelas sem `max-height`; telas inicial/de projeto sem rolagem; o `.left-top` de altura fixa podia passar da coluna. Agora `#inspector` é flex (cabeçalho, `.inspector-scroll` com `flex: 1 1 0; min-height: 0`, ações), `[data-multi-inspector]` é `display: contents`, `.effect-chain.global-chain` rola, `.export-modal` (exportar, composição, mídia ausente) tem `max-height: calc(100dvh - 24px)` com cabeçalho/rodapé fixos, `.welcome-screen`/`.setup-screen` e `.timeline-panel` têm `overflow`. Barras de rolagem estilizadas para o app todo (`::-webkit-scrollbar` 10 px, 14 px em toque; `scrollbar-color` no Firefox), contraste 3:1.
2. **Divisores** (`bindSplitters`, `SPLITTERS`, `splitterHtml` em `editor.ts`): `role="separator"`, `aria-orientation`, `aria-valuemin/max/now/valuetext`, foco por Tab. Cinco: `left`, `right` (colunas, só acima de 1180 px como antes), `timeline` (preview × timeline, agora com teclado), **`left-top`** (abas Mídia/Efeitos × Layers) e **`inspector-fx`** (propriedades × efeitos: os efeitos saíram do fim da rolagem para uma área própria, `.inspector-effects`). Mouse e toque (pointer events com captura; dois toques restauram), setas 16 px (Shift 64), Home/End, Enter e duplo clique restauram, tamanhos em `nt-vct-left-width`, `-right-width`, `-timeline-height`, `-left-top-height`, `-inspector-fx-height` (`readSplit`/`writeSplit` com try/catch; valor inválido ou fora do limite é ignorado/contido, também ao renderizar). Alvo de 44 px com `pointer: coarse` (pseudo-elemento). No ≤ 860 px a altura da timeline passou a seguir `--timeline-height` (`--timeline-h-small`).
3. **Bug da faixa de legendas.** O clique na linha da faixa (nome do clipe `.timeline-label-name` ou a própria linha) usava a seleção de uma camada só (a primeira); só o pequeno `.track-name` ("V9") selecionava a faixa. Agora, nas linhas da timeline, nome, linha e `.track-name` selecionam todos os clipes (`selectTimelineTrackOf`), e um clique sem arrastar num espaço vazio da faixa com vários clipes também (`laneClick` no scrub; a playhead continua indo ao ponto). Shift/Ctrl+clique continua alternando um clipe; a lista Layers continua selecionando uma camada. Faixa selecionada: `is-track-selected` (barra vermelha na linha, `.track-name` vermelho, faixa realçada, clipes com contorno cheio). O nome do clipe na linha encolhia a 0–36 px: ganhou `min-width`.
4. **Revisão geral.** Janelas do `#modal-root`: `role="dialog"`, `aria-modal`, `aria-labelledby`, foco no diálogo, Tab preso, Esc fecha (respeita o botão desabilitado durante a exportação) e o foco volta ao botão que abriu; `info-panels.ts` ganhou Tab preso, `aria-modal` e retorno do foco. Itens da lista Layers com `aria-label` por camada, `aria-pressed` em visível/bloqueada e títulos bilíngues (antes só em inglês). Foco visível nos campos que tinham `outline: 0`. Tooltips com o nome completo (clipe na timeline, nome do projeto, caminho na barra de estado). Retorno de toque (`scale(.98)`, desligado com movimento reduzido), `tabular-nums` nos contadores, `text-wrap: pretty/balance`, alvos de 44 px (lista de camadas, abas, setas da timeline, fechar das janelas) em toque, hover nas abas/camadas/cartões, `-webkit-font-smoothing`. Altura padrão das abas de 46vh → 40vh (mais espaço para Layers).

**Testes** (`tests/parity/ux-review.spec.ts`, 10 testes): faixa de legendas (nome, linha, espaço vazio, um desfazer, Ctrl+clique); rolagem 1440×900, 1280×720, 1024×1366 e 768×1024 (Mídia, Efeitos, Layers, inspector simples e múltiplo, exportar, composição, atalhos, avisos, transcrição; barra estilizada); janelas (foco, Esc, retorno); divisores (arrastar, teclado, limites, restaurar, persistência depois de recarregar, valores inválidos, toque com CDP e área de 44 px).

**Notas.** `[data-multi-inspector]` é `display: contents` (o Playwright o vê como "hidden"; use `.inspector-header` ou `toHaveCount`). No Playwright, vários `playwright test` ao mesmo tempo disputam `test-results/` (use `--output`). Fora do escopo: colunas arrastáveis abaixo de 1180 px; seleção múltipla não move/apara em grupo; modal da transcrição (`src/transcribe`) usa o próprio foco.

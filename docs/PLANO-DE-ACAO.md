# Plano de ação por batches

Data: 27/10/2026 · Base: 0.7.1 (`1e5388a`)

Este é o plano mestre. Ele substitui a ordem de `ANALISE-E-PLANO.md` §9 e de
`UPGRADE-UX-UI-AUTOMACAO.md`. Esses dois documentos ficam como histórico e
referência. A especificação técnica da API do agente está em
`PLANO-API-AGENTE.md`.

## Estado em 27/10/2026

Batches 0 a 4 implementados, testados e enviados (`4a844a7`): 0 erros de tipo,
162 testes unitários, build, 35 testes Playwright (inclui E2E do agente só
por `window.vct` e dois testes em tablet 1024×1366 com toque). Detalhes no
`CHANGELOG.md` ("Não lançado") e na referência gerada `docs/API-AGENTE.md`.

Decisões tomadas durante a execução (revisar):
- **Bin sem `.ntvct` v3:** as mídias ficam em `assetMetadata` (campos novos
  opcionais) e as faixas em `tracks`; o arquivo continua v2 e abre na 0.7.1.
- **Coluna esquerda:** abas **Mídia | Efeitos**; a lista de Camadas fica
  sempre visível embaixo (não virou terceira aba).
- **Miniaturas do bin** ficam em memória e são refeitas ao abrir o projeto.
- **Camadas travadas:** apagar, cortar, mover, aparar e renomear passam a ser
  recusados (antes funcionavam); redimensionar a composição continua valendo.
- **Duplicar** coloca a cópia numa faixa nova no topo.
- **Gravação (REC)** gera dois passos de desfazer: a gravação e a suavização.
- **J/L:** L toca, J volta 1 s (não há reprodução reversa).
- **Áudio de vídeos acima de 400 MB:** "tem áudio" fica desconhecido no import
  (decodificar tudo gastaria memória demais).
- Não testado: pinça em tela real, iPad físico, Safari/Firefox.

**Ordem a partir daqui (decidida em 27/10/2026):**
1. **Revisão forte** na interface e com o agente, antes de subir para o
   servidor: confirmar as decisões acima, criar as skills que faltaram do
   Batch 4, corrigir os testes instáveis (export de frames, áudio vinculado,
   `TODO(rodada1)`) e testar Firefox, WebKit/iPad emulado e pinça.
2. **Batch 5.**
3. **Batch 7** (legenda automática).
4. Parada para testes do usuário e commit. **Feito** (`f903b1d`, `837220a`).

**Teste real do usuário (27/10/2026):** depoimento em vídeo 1280×720 numa
composição 1920×1080, legenda automática com Whisper small e depois o Claude
in Chrome fazendo um "tratamento de diretor de arte" com +40% nas legendas.
A transcrição saiu fiel e a IA concluiu o trabalho, mas o teste mostrou:

- **Legendas pequenas** (3,5% da altura, 38 px em 1080p) e nenhuma forma de
  mudar o estilo de todas de uma vez: na interface é uma camada por vez.
- **Mídia entra em tela cheia:** o enquadramento só oferece "Inteiro" e
  "Preencher"; falta "Tamanho original" (o 1280×720 foi ampliado).
- **Efeitos abaixo do nível profissional:** blur em camada de forma gera grade
  de blocos e retângulos concêntricos; glow estoura fundos claros; faltam
  vinheta, temperatura/tint, curvas, LUT e letterbox.
- **Painel de propriedades longo demais** para a tela; pede seções em sanfona.
- **Pedidos da IA:** `describe()` em 12 páginas e `describe('tipo')` como
  objeto; retorno de `batch`/`dryRun` sem `ok`/`errors` claros; uma saída
  com ? & = bloqueada pela extensão; não achou a sombra de texto (existe, mas
  não aparece onde ela procurou); faltam caixa de fundo, entrelinha e
  espaçamento de letras; `captureFrame` sem modo de ver na tela; faltam
  `solo`/bypass para diagnóstico e `clip.fade` de vídeo+áudio; a faixa
  "IA editando" empurra o layout e muda as coordenadas entre screenshots.

**Nova ordem (27/10/2026):** 11 → pacote de efeitos novo (substitui os atuais) → 12 → resto do 13 → 8 → 9 → 10 → 6. Estado detalhado e especificações para continuar em `HANDOFF-CODEX.md`.

---

## 1. Visão

O editor passa a ter **um núcleo**, e a interface e a IA são dois clientes dele.

| Peça do núcleo | O que é | Quem usa |
|---|---|---|
| **Comandos** | Registro único de todas as ações: validação, desfazer com nome, descrição | Todos os botões da interface, a IA e os testes |
| **Mídia** | O bin: cada arquivo com duração, resolução, orientação, áudio, miniaturas, forma de onda e análises, em cache | Painel Mídia, timeline, folhas de contato, `clip.place`, relink |
| **Faixas** | Faixas reais, com nome e ordem, que existem mesmo vazias | Cabeçalhos da timeline, "+ faixa", `track.*` |
| **Quadro confiável** | Um só caminho de render, que espera o vídeo decodificar | Preview, miniaturas, `captureFrame`, folha de contato, export |

Cada recurso é feito uma vez e aparece nos dois lados.

## 2. Decisões tomadas (27/10/2026)

1. **Importação:** um só botão **Importar mídia**. A janela do sistema aceita
   vários arquivos de todos os tipos compatíveis (vídeo, imagem, áudio). Tudo
   entra no **painel Mídia**. Não há diálogo de modo; o usuário arrasta para a
   timeline o que quer usar. Durante a importação aparece um **modal de
   carregamento** com progresso ("3 de 10 · selva.mov"), porque hoje a janela
   parece travada.
2. **Botões atuais:** **todos** passam para o registro de comandos de uma vez,
   seguidos de um teste geral da interface.
3. **Transparência:** o export com alpha fica **só em sequência PNG** por ora.
   WebM VP9 com alpha e HAP saem do plano.
4. **Copyright:** o titular é a **Noisetupi**.
5. **Release:** quem faz versão, tag, push e deploy é o usuário. Os batches
   terminam em commits locais.

## 3. Regras que valem para todo batch

- **TDD:** teste unitário antes do código em `tests/unit/`. Comportamento de
  interface ganha teste Playwright em `tests/`.
- **Portão de saída do batch (todos obrigatórios):**
  1. `npm test`, `npm run typecheck` e a suíte Playwright verdes.
  2. **E2E do agente:** roteiro só por `window.vct`, sem nenhum clique.
  3. **Passada de harmonização da UI:** regras `baseline-ui` (as mesmas da
     0.7.0: sem gradiente nem glow, números tabulares, um acento por vez,
     cantos consistentes) e `ecc:make-interfaces-feel-better`.
  4. **Tablet:** Playwright em 768×1024 e 1024×1366 com toque emulado; alvos de
     no mínimo 44 px; tudo o que é arrastar tem alternativa por toque
     (toque longo ou menu).
  5. Revisão com `ecc:typescript-reviewer`.
  6. Docs atualizados (`AUTOMACAO.md`, `CHANGELOG.md` em "Não lançado").
- **Compatibilidade:** `.ntvct` v2 continua abrindo. Campos novos são opcionais.
- **Commits pequenos dentro do batch**, um por entrega, em PT-BR.

## 4. Orquestração dentro de um batch

| Papel | Quem | Entrega |
|---|---|---|
| Mapa do código (file:line) antes de cada frente | Explore com **Haiku** | Mapa curto. Ninguém relê arquivo grande à toa |
| Desenho do modelo, do formato e dos contratos | Sessão principal (**Opus**) | Tipos, comandos e testes de contrato |
| Frentes paralelas sem arquivos em comum | **Sonnet**, cada uma em worktree | Diff + resultado dos testes, em poucas linhas |
| Revisão | `ecc:typescript-reviewer`, `ecc:a11y-architect` nos batches de UI | Achados priorizados |
| Teste em tablet e E2E | **Sonnet** com Playwright | Relatório de falhas |

Regra: duas frentes nunca escrevem nos mesmos arquivos ao mesmo tempo. A
frente que cria o contrato (tipos e comandos) termina antes das que o usam.

---

## 5. Batches

A ordem **0 → 1 → 2** é fixa. Do 3 em diante dá para trocar a ordem.

### Batch 0: arrumação (curto)

- Registrar as decisões acima. Marcar em `ANALISE-E-PLANO.md` o que já foi
  entregue. Corrigir `AUTOMACAO.md`, que diz que não há split nem ripple.
- Copyright Noisetupi em `LICENSE`, `NOTICE` e cabeçalhos.
- Tirar do `ExportOptions` os formatos que não existem. Deixar MP4 e PNG, com
  alpha só no PNG.
- Versão lida do `package.json` em vez de fixa em 5 arquivos.

### Batch 1: núcleo de comandos (longo)

**Objetivo:** toda ação, da interface ou da IA, passa pelo mesmo registro.

- Registro único (`src/model/command-registry.ts`) com os 19 comandos atuais.
  Parser estrito: campo desconhecido vira erro.
- **Migrar todos os botões e gestos da interface** para comandos: adicionar,
  mover, aparar, dividir, ripple, transições, propriedades, keyframes, efeitos,
  pós, áudio (volume, mute, vínculo), composição, ordem de camadas e
  copiar/colar.
- Comandos novos que a migração exige e a IA herda: `audio.set`, `audio.link`,
  `audio.unlink`, `layer.setBlendMode`, `composition.set` (duração), `layer.reorder`.
- O desfazer passa a guardar o nome do passo ("Mover clipe", "Lote: cortes no ritmo").
- `describe()` e `guide()` gerados do registro, com a semântica completa. Saída
  em texto curto, sem `?&=`, com `vct.more()` para paginar.
- Correções: `setNumeric` em tempos com as checagens do `clip.move`;
  `setName` rejeita em vez de truncar; métodos anunciados iguais aos expostos.
- Separar de `src/ui/editor.ts` os manipuladores que viram comandos.
- `data-testid` e ARIA estáveis nos controles tocados.
- **Teste geral da interface:** suíte Playwright cobrindo cada botão migrado,
  no desktop e no tablet.

### Batch 2: mídia, faixas e "ver" (longo)

**Objetivo:** o fluxo de entrada de material, para pessoas e para a IA.

*Modelo e formato*
- `project.assets[]` com `id`, `name`, `kind`, `duration`, `width`, `height`,
  `fps`, `orientation`, `hasAudio`, `size` e `hash`.
- `project.tracks[]` com `id`, `name` e `order`. Faixa vazia persiste.
- `.ntvct` v3, que abre o v2 e converte. Relink por hash.
- Miniaturas e forma de onda em cache no IndexedDB, por asset.

*Interface*
- Coluna esquerda com abas **Mídia | Camadas | Efeitos**. No tablet, o botão
  "MÍDIA" que já existe abre essa coluna.
- **Importar mídia:** um botão, seleção múltipla, todos os tipos compatíveis
  e modal de carregamento com progresso. Arrastar arquivos para a janela faz o
  mesmo.
- Cartões com miniatura, duração, orientação, ícone de áudio e "em uso".
  Busca e filtro por tipo. Prévia ao passar o mouse.
- Arrastar do bin para uma faixa ou para "+ faixa". **No tablet:** tocar no
  cartão abre "Adicionar no playhead" e "Adicionar em nova faixa".
- O inspector mostra os detalhes do asset selecionado e o enquadramento padrão
  (cobrir ou conter, com ajuste automático para verticais).
- A timeline mostra os nomes das faixas, editáveis, e o botão "+ faixa".
- "Criar" (Texto, Forma, Guia) fica na aba Mídia.

*Quadro confiável e revisão*
- Um caminho de render estrito para preview parado, miniaturas, captura e
  export. Acaba o quadro velho e o vídeo ignorado sem aviso.
- Miniaturas da timeline saem do mesmo pipeline, sem timeout.

*IA*
- `vct.assets()`, `clip.place`, `track.create/rename/remove`, `layer.fit`.
- `captureFrame` confiável, com `ready: false` e motivo.
- `vct.contactSheet`, `vct.assetSheet` (material bruto, sem timeline) e
  `vct.summary()`. A folha pode cobrir a aba num painel temporário, para gastar
  um screenshot só.

*Medição*
- Benchmark "loop de 30 s com 10 assets" antes e depois. **Meta: menos de 50%
  dos tokens**, sem clique, sem clipe estacionado.

### Batch 3: timeline, tempo e áudio (longo)

- **Timeline (R3):** zoom com Ctrl+roda e pinça no tablet, régua mm:ss:ff,
  playhead acompanha o play, minimapa, snap com linha-guia (Alt desliga),
  J/K/L, setas por frame, Home/End, M e painel "?".
- **Clipes:** fechar espaço, faixa magnética, Ctrl+X, Alt+arrastar duplica e
  arrastar keyframes no tempo. No tablet: toque longo com "Dividir aqui",
  "Duplicar" e "Remover".
- **Região de trabalho (in/out):** na interface, no export e em `composition.set`.
- **Áudio:** fades e ganho por keyframe, medidor de nível; relógio mestre no
  AudioContext; reprogramar ao editar durante o play.
- **Ritmo:** grade BPM com tap e quantização; tempos `bar:beat` aceitos pela
  API; snap na grade.
- **IA:** `analyzeMix` (o "ouvir"), `analyzeAudio` (BPM, energia, onsets),
  keyframes com `timeBase: 'clip'` e `curve` do bezier.
- **Estabilidade:** teste intermitente do áudio vinculado, corte durante
  transição e o `TODO(rodada1)` de `source-time.ts`.

### Batch 4: composição, texto e qualidade (longo)

- **Composição:** luma key, chroma YCbCr com supressão de spill. Máscaras e
  track matte, se couberem; senão vão para o Batch 6.
- **Texto (R3):** edição inline no canvas, alinhamento, sombra, estilos
  salvos, animações de entrada e saída, importar SRT.
- **Painel de avisos** (interface) e `vct.lint()` (IA), com a mesma regra:
  flashes acima de 3 por segundo (WCAG 2.3.1), texto fora da área segura,
  buracos, áudio sobreposto e clipe fora da composição.
- **IA:** `vct.plan()` para lotes longos (até 500 comandos, um desfazer),
  macros (`loop.seam`, `fx.stutter`, `fx.strobe`, `fx.spike`) e
  `analyzeVideo` (cenas, brilho, cor, movimento).
- Skills `/vct-template` e `/vct-how-to`.

### Batch 5: sessão do agente, export e desempenho (longo)

- **Agente:** faixa "agente ativo" com botão de parar; confirmação antes de
  salvar ou exportar; abrir, salvar e pedir importação pela API; modelo de
  confiança. Decidir entre reativar e remover a ponte MCP. CLI e modo arquivo,
  se a ponte ficar.
  - Decisão: a ponte MCP fica dormente no repositório (fora da interface);
    o canal principal é o Claude in Chrome com `window.vct`.
  - Feito: faixa "IA editando" com Parar/Retomar, `vct.request` (`save`,
    `export`, `import`, `open`) sem espera e `vct.status()`; confiança por
    tipo só na memória da sessão.
- **Export:** resolução de saída, dimensões pares, `document.fonts.load()`
  antes de exportar, export em streaming no disco e PNG com alpha.
- **Desempenho (R7):** textura por camada, cache de `evaluated()`; PWA offline.
- Build: legalComments, cache immutable e CSP no `.htaccess`.

### Batch 6: pedagogia, acessibilidade e docs (longo)

- **R4:** modo Simples/Avançado, onboarding por objetivo e tutoriais.
- i18n completo, erros sem `alert()`, "Interface grande" (125% e 150%) e foco
  visível.
- **Teste em iPad físico** (os batches anteriores testam em tablet emulado).
- Graph editor de curvas, e máscaras se não couberam no Batch 4.
- Tela Sobre/Créditos.
- Docs finais bilíngues: guia do usuário, guia do professor, glossário,
  atalhos, formato `.ntvct`, `README.en.md`.

### Batch 7: legenda automática

- **Whisper no navegador** (Transformers.js, WebGPU com fallback WASM), num
  Web Worker. O áudio nunca sai da máquina.
- **Aviso antes do primeiro download** do modelo, com tamanho. Baixou uma vez,
  fica no cache do navegador e não baixa de novo.
- **Rede restrita:** o modelo e os arquivos WASM podem vir do próprio servidor
  (pasta `models/` no deploy), da internet (Hugging Face) ou de um pacote
  importado à mão a partir de um arquivo local.
- Resultado vira SRT e entra pela macro `text.fromSrt`; tempos por palavra
  permitem legenda estilo karaokê. IA: `vct.transcribe()` em texto curto.
  - Feito (27/10/2026): botão na aba Mídia, worker `src/transcribe/`, aviso e
    cache, três fontes do modelo (cache, `models/`, arquivos escolhidos à mão),
    revisão do SRT, `vct.transcribe()`/`vct.transcript()`/`vct.status()`.
    Detalhes em `docs/AUTOMACAO.md`. Falta o karaokê (os tempos por palavra só
    quebram as legendas por enquanto) e testar Firefox/Safari com Whisper real.

### Batch 8: transparência e mídia animada

- GIF, APNG e WebP animado seguindo a timeline (`ImageDecoder`, com gifuct-js
  de reserva), com loop.
- Vídeo com alpha: WebM VP9 (Chrome, Firefox) e HEVC (Safari), alpha
  detectado na importação e marcado no bin; instrução de conversão para
  ProRes 4444.
- Sequência de PNG importada como um clipe.
- Testar export WebM com alpha pelo Mediabunny; o usuário decide se reabre.

### Batch 9: biblioteca de mídia livre

- Botão "Mídia livre" no bin: Openverse, Wikimedia Commons, Internet Archive,
  NASA, ccMixter e Freesound (com chave do usuário).
- O arquivo é baixado e vira mídia local, com licença, autor e link guardados.
- ND escondido, NC com aviso, BY gera créditos; aviso de crédito faltando.
- Teste de CORS por fonte; decidir entre proxy PHP no Hostinger com lista de
  fontes permitidas e "baixar e arrastar".

### Batch 10: animação estilo After Effects

- Parentesco, ponto de âncora e caminho de movimento (recortes de PNG).
- Máscaras e track matte (saem do Batch 6).
- `wiggle` e `loop` nas keyframes; pré-composições.
- Importar Lottie (Bodymovin) como camada, via lottie-web.

### Batch 11: correções do teste real e API da IA (médio)

- **Legenda automática maior e com estilo:** tamanho padrão proporcional à
  composição (≈ 5,5% da altura, 59 px em 1080p) e, no diálogo, tamanho
  (P/M/G), posição e caixa de fundo antes de inserir.
- **Edição em massa:**
  - selecionar várias camadas (Shift/Ctrl+clique, ou a faixa inteira pelo
    cabeçalho) e editar uma propriedade comum aplica a todas, num passo de
    desfazer;
  - "Estilo da faixa" para faixas de legenda: tamanho, fonte, cor, sombra e
    caixa valem para todas as legendas da faixa;
  - comandos `layer.setMany` (lista de ids ou `trackId`) para a IA.
- **Tamanho original sempre:** toda mídia entra no tamanho em pixels do
  arquivo, centralizada (decisão do usuário, 27/10/2026). Depois a pessoa
  ajusta com escala, à mão com o snap/alinhador, ou com os botões "Inteiro" e
  "Preencher" na seção Transformação. A preferência de enquadramento padrão
  sai; `clip.place` sem `fit` também usa o tamanho original.
- **Faixa "IA editando" sobreposta:** não empurra mais o layout (posição
  fixa, sem mudar as coordenadas do preview).
- **API mais barata para a IA:**
  - `describe()` vira um índice de uma página (grupos, comandos e campos
    obrigatórios); `describe('tipo')` volta texto; `describe({ format:
    'json' })` para quem quer objeto;
  - `describe('layer.set')` lista as propriedades por tipo de camada
    (texto mostra sombra, contorno, caixa…);
  - `batch`, `plan` e `dryRun` devolvem texto curto `ok · N comandos ·
    avisos: …` ou `erro no comando 3: …`; com `{ format: 'json' }`,
    `{ ok, errors, warnings, results }`;
  - toda saída da API passa pelo filtro de ? & =, inclusive objetos;
  - `captureFrame({ show: true })` mostra o quadro na tela para screenshot,
    como a folha de contato;
  - `view.solo(layerId)` e `view.bypassEffects()` para diagnóstico: só mudam
    a visualização, não o projeto nem o desfazer;
  - `clip.fade` aplica fade de entrada/saída ao vídeo e ao áudio vinculado.
- **Investigar primeiro o blur em forma:** reproduzir com teste de pixels;
  checar se vem do cache de textura ou do shader sem efeito do Batch 5.

### Batch 12: painel de propriedades e texto profissional (médio)

- **Painel em sanfona:** seções Transformação, Texto, Aparência (cor,
  contorno, sombra, caixa), Tempo e fades, Transição e Efeitos; abre a seção
  em uso, lembra o estado, "abrir/fechar tudo", alvos de 44 px no tablet.
- **Texto:** caixa de fundo (cor, opacidade, padding, raio), entrelinha,
  espaçamento entre letras, alinhamento vertical, quebra automática pela
  largura; estilos salvos aplicáveis a várias camadas.
- **Legenda karaokê** com os tempos por palavra do Whisper (ficou do Batch 7).
- Guia de área segura para legendas (liga/desliga no preview).

### Batch 13: base de efeitos profissional (longo)

- **Pipeline:** texturas intermediárias de 16 bits (RGBA16F, quando o
  navegador suportar) para não criar faixas; blur, glow e mesclagem em luz
  linear; alpha pré-multiplicado conferido em cada passo; borda da camada
  configurável (transparente, estender, espelhar).
- **Fontes validadas para portar** (licenças permissivas, com atribuição em
  `THIRD_PARTY_LICENSES.md`):
  - **GPUImage** (BSD-3): níveis, curvas, balanço de branco
    (temperatura/tint), sombras/realces, vibrance, exposição, LUT, vinheta,
    nitidez (unsharp mask), halftone;
  - **glfx.js** (MIT): blur triangular, zoom blur, tilt-shift, lens blur,
    denoise, ink, hexágonos, dot screen;
  - **pmndrs/postprocessing** (zlib) e o UnrealBloom do three.js (MIT): bloom
    com limiar suave e cadeia de mipmaps, vinheta, aberração cromática, grão
    de filme;
  - **W3C Compositing and Blending**: fórmulas dos modos de mesclagem, iguais
    às do Photoshop;
  - **ASC CDL** e lift/gamma/gain (padrão de correção de cor) e **LUT 3D
    .cube** (padrão Adobe/Resolve), para importar LUTs livres;
  - evitar fontes sem licença livre para uso comercial (ex.: lygia).
- **Efeitos:**
  - Cor: exposição, temperatura/tint, lift/gamma/gain, curvas, HSL e
    vibrance, LUT;
  - Desfoque: gaussiano separável (2 passes), direcional, zoom, tilt-shift;
  - Luz: bloom e glow com limiar suave (não estoura fundo claro);
  - Estilo: vinheta (intensidade, raio, suavidade, forma), grão de filme,
    aberração cromática, nitidez;
  - letterbox pronto (2:1, 2,39:1, 1:1, 4:5) e "looks" como macros.
- **Validação:** cada shader tem uma versão de referência em JS (CPU) e um
  teste compara pixels com tolerância; imagens de referência para o blur e o
  glow em camadas maiores que o quadro.

## 6. Itens que acompanham todos os batches

- Seek e codecs em outros navegadores (Safari e Firefox), sempre que um batch
  mexer em mídia.
- A CI do GitHub roda no push que o usuário fizer.
- O benchmark de tokens é medido de novo no fim de cada batch a partir do 2.

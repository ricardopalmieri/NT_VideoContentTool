# Noisetupi Video Content Tool: análise da versão 0.6.2 e plano de upgrade

> **Atualização de 26/10/2026:** o fonte web 0.6.2 foi recuperado do chat
> “video content tool”. O primeiro build reproduziu os 19 arquivos de produção
> byte a byte. A fundação passa a ser restauração e modularização, conforme
> `BASELINE-0.6.2.json` e `RODADA0-RELATORIO.md`. A análise abaixo é histórica;
> hipóteses e afirmações sobre ausência de fonte não descrevem mais o estado atual.

*26/10/2026 · análise do build 0.6.2 em produção (noisetupi.com.br/laboratorio)*

Para fazer esta análise:

- Juntei quatro auditorias especializadas: UI de editores de áudio e vídeo, bugs e arquitetura, licenciamento, e automação com MCP + motion design + VJ.
- Testei o app no navegador em desktop (1366×850) e tablet (1024×768 e 768×1024).
- Li o projeto `ai-vj-generator` da Giulia Ribeiro (GYULYIA) e a skill `noisetupi-video-lab` que já existe.

> **Como ler as referências `app.js:NNNN`.** Elas apontam para o bundle 0.6.2 (`assets/index-BZJa5JOo.js`) depois de formatado com
> `npx prettier@3.3.3 assets/index-BZJa5JOo.js`. Os nomes curtos (`sf()`, `Qt`, `be()`…) são os nomes minificados desse build. Quando o fonte for recuperado, este documento será atualizado para apontar para os arquivos `.ts`.

---

## 1. Resumo

O VCT tem uma base técnica rara entre editores online:

- pipeline WebGL2 com 15 efeitos GLSL próprios (animaTracer, Bloom multiescala, RGB Delay, Glitch, VHS…);
- keyframes com curvas;
- modo REC de automação;
- exportação com alpha (sequência PNG);
- funciona 100% local, sem conta, e é bilíngue.

Isso é um diferencial forte para videomapping e para a escola: privacidade e zero cadastro.

O que impede o app de ser "simples, funcional e sem bugs" hoje:

| # | Problema | Gravidade |
|---|---|---|
| 1 | **Não existe código-fonte da 0.6.2.** O repositório tem só o build minificado; o fonte mais novo no disco é a 0.1.11 (desktop/Tauri, julho). | Bloqueante |
| 2 | **Fade quebra no gesto mais natural.** A alça "gruda" sozinha, gera fade de duração zero e não acompanha o trim (confirmado no navegador). | Crítico |
| 3 | **Não dá para cortar nem rearranjar trechos.** O modelo é 1 camada = 1 clipe; S, B e Ctrl+K não fazem nada (confirmado). | Crítico |
| 4 | **Tablet inviável.** `body{min-width:1180px}`: no iPad o botão Exportar fica fora da tela (confirmado). A timeline tem `touch-action:none`, então o dedo não rola nada. | Crítico |
| 5 | **Perda de trabalho.** Não há autosave; recarregar a página apaga o projeto (confirmado). Ao reabrir um projeto, é preciso relocalizar todas as mídias. | Crítico |
| 6 | **Interface minúscula.** Metade dos textos tem entre 4 e 9 px; 134 de 149 controles têm menos de 32 px (medido). | Alto |
| 7 | **Licenças.** Não há LICENSE; faltam os avisos obrigatórios do Mediabunny (MPL-2.0), do fflate (MIT) e das 5 fontes (OFL). | Alto (fácil de resolver) |

A recomendação é trabalhar em **rodadas curtas, cada uma publicável no Hostinger**:

1. Recuperar o fonte e criar testes.
2. Corrigir os bugs graves.
3. Trocar o modelo para clipes múltiplos por faixa (corte e rearranjo).
4. Navegação e texto.
5. Tablet e modo pedagógico.
6. Motion e VJ.
7. Automação com agentes.
8. Documentação bilíngue no fim, como você pediu.

---

## 2. O que foi verificado na prática (navegador)

| Teste | Resultado |
|---|---|
| Criar projeto, adicionar texto e geometria | OK. O texto padrão "NOISETUPI" nasce *atrás* da geometria adicionada depois. |
| Trim pela borda do clipe | OK |
| Mover clipe na timeline | OK. Fades e keyframes acompanham. |
| Cortar no playhead (S, B, Ctrl+K) | **Não existe** |
| Arrastar a alça de fade a partir do canto do clipe | **Bug.** Gravou `FADE IN START = 3,1` e `FADE IN END = 3,1` (duração zero), e nenhum fade aparece. |
| Digitar fade 1,75 → 3,1 no painel | O fade funciona (camada semitransparente em 2,4 s). |
| Editar um valor no painel de Propriedades | O painel **volta ao topo** depois de cada edição. |
| Duplo clique no texto do canvas | Não edita; só dá para editar pela caixa do painel. |
| Viewport 1024×768 (iPad deitado) | O documento fica com 1180 px; **Exportar fica fora da tela**. |
| Viewport 768×1024 (iPad em pé) | Até a tela de idioma fica cortada ("English" some). |
| Recarregar a página | Projeto perdido. O `localStorage` só guarda `nt-vct-language`. |
| Diálogo de exportação | Só **MP4 H.264** e **PNG + alpha (.zip)**. A 0.1.11 desktop tinha WebM VP9 alpha, ProRes 4444, HAP, FFV1, APNG e GIF. |
| Escolha de idioma | O idioma fica salvo, mas a tela de escolha aparece de novo; o splash fica por cima dela por cerca de 2 s. Os botões de idioma são `div`, não `button` (sem teclado). |

---

## 3. Arquitetura atual (resumo técnico)

- **Projeto `.ntvct` v2:** `{format, version:2, settings, layers[], audioTracks[], postEffects[]}`.
  - Uma layer é ao mesmo tempo camada e clipe: `startTime/endTime`, `sourceIn/Out`, `playbackRate`, `reverse`, `loop`.
  - Os fades usam **quatro tempos absolutos** (`fadeInStart/End`, `fadeOutStart/End`).
  - Os keyframes ficam em tempo absoluto, em `keyframes[prop]`.
- **Render (`xn`, app.js:1692–2555):**
  - cada camada é rasterizada num canvas 2D do tamanho da composição, onde o fade entra como `globalAlpha`;
  - esse canvas sobe como textura (`texImage2D`);
  - os efeitos rodam num uber-shader em ping-pong e depois vêm o blend, os efeitos de pós e a tela.
- **Playback:** relógio por `requestAnimationFrame`. Os `<video muted>` tocam sozinhos com correção de drift de ±180–320 ms. O áudio usa WebAudio com relógio separado.
- **Exportação:** frame a frame, com seek em cada vídeo.
  - MP4 via **Mediabunny** (WebCodecs) + AAC renderizado em `OfflineAudioContext`.
  - PNG via **fflate**.
  - Tudo fica em memória (RAM).
- **Persistência:** JSON salvo por `showSaveFilePicker` ou download. A mídia fica só em memória (blobs). Não há autosave.
- **Undo:** snapshot JSON do projeto inteiro, 60 níveis. Restaurar recria o DOM *e* o renderer WebGL.
- **UI:** templates `innerHTML` com rebuild total ou parcial; pointer events com `setPointerCapture` (boa base para toque).
- **Bundle:** 376 KB, sendo cerca de 52% Mediabunny e cerca de 18 KB fflate. Os dois só são usados na exportação.

---

## 4. Bugs e riscos (consolidado)

P0 = quebra o uso ou perde dados · P1 = comportamento errado visível · P2 = acabamento ou risco.

### 4.1 Fade: por que parece bugado

O cálculo em si está certo: `fadeEnvelope` (app.js:1893) e o equivalente de áudio (app.js:2601) são lineares e protegidos contra divisão por zero. O problema está no que acontece em volta.

| Sev | Causa | Evidência | Efeito para o usuário |
|---|---|---|---|
| P0 | **Self-snap.** A lista de alvos do snap `sf()` inclui o próprio valor da alça e o playhead (`[0, duração, S, …]`), com limiar de 9 px e SNAP ligado por padrão. | app.js:14424, 14878, 14916, 14467 | A alça e o playhead "grudam" e depois pulam. É a sensação de timeline "dura". |
| P0 | **Quatro alças sobrepostas.** Arrastar a de cima empurra a de baixo pelo clamp `Qt`. | app.js:13135–13146, 12605 | O fade fica com duração zero e nada aparece (reproduzido). |
| P0 | Arrastar o **clipe de áudio vinculado** move o vídeo, mas não os fades nem os keyframes dele; depois `Ke()` sobrescreve os fades do áudio. | app.js:14775–14790 | Trechos ficam invisíveis ou mudos, e isso é salvo no arquivo. |
| P1 | **Trim ou edição de START/END não move os fades.** | app.js:14644–14660, 13478–13491 | Estender o clipe deixa a parte nova invisível; encurtar apaga o fade sem aviso. |
| P1 | O fade é aplicado **antes** dos efeitos (alpha pré-multiplicado). | app.js:2179, 1579–1609 | O Chroma key falha durante o fade; Levels clareia o quadro inteiro. |
| P1 | O blend **Add** usa `SRC_ALPHA` sobre cor já pré-multiplicada. | app.js:2431–2446 | Fade de 50% vira 25% de intensidade. |
| P1 | O fade de áudio é rampa linear de amplitude, e arrastar a alça durante o play não reprograma o áudio. | app.js:2697–2706 | O fim soa abrupto; o que se ouve não bate com a tela. |
| P2 | O botão de keyframe ◆ aparece em FADE, START, END e SOURCE, mas o render ignora esses keyframes. | app.js:12679–12704 | O painel mostra um valor e o vídeo usa outro. |
| P2 | As alças de fade (8 px, z-index 10) cobrem as pontas da alça de trim (9 px). | app.css:2235–2266 | O usuário pega o fade quando queria aparar. |

**Correção definitiva:** fade **relativo ao clipe** (`fadeIn: 0,5 s`, `fadeOut: 0,5 s`), com:

- uma alça por lado, no canto superior;
- tooltip "Fade 0,50 s" e a curva desenhada sobre o clipe;
- curva equal-power no áudio;
- o fade aplicado no composite, depois dos efeitos.

O fade relativo sobrevive a mover, aparar e cortar.

### 4.2 Demais bugs

| Sev | Área | Evidência | Sintoma | Correção |
|---|---|---|---|---|
| P0 | Exportação | app.js:2071–2080 | `seekVideo` pula o seek se a diferença for menor que 1/fps, e o tempo em ponto flutuante cai nisso em cerca de 2/3 dos frames. **Hipótese forte:** frames duplicados no MP4. | Comparar o índice de frame, ou decodificar com WebCodecs (`VideoSampleSink`). Validar com um vídeo de contador. |
| P0 | Persistência | app.js:1446–1472, 15945 | Sem autosave nem recuperação, e sem handler `webglcontextlost`. | Autosave em IndexedDB/OPFS com as mídias, e "Recuperar sessão" na tela inicial. |
| P0 | Tablet | app.css:96–104, 1978, 1236 | `min-width:1180px`; `touch-action:none` na timeline e nos campos (rolar o painel com o dedo muda valores). | Breakpoints; scrub só na régua; pan com o dedo. |
| P1 | Áudio | app.js:2750–2754 | `start()` sem `duration`: o áudio passa do SOURCE OUT enquanto o vídeo congela. | `start(when, offset, dur)`. |
| P1 | A/V vinculado | app.js:13582–13598 | Editar START/SPEED do áudio vinculado pelo painel tira de sincronia, e a próxima edição reverte. | Uma única função de edição para o grupo vinculado. |
| P1 | Memória | app.js:13830–13838, 12024 | `be()`, undo e abrir projeto criam um **novo renderer WebGL sem `dispose()`**. Vazam contextos e decoders de vídeo; vídeos antigos continuam tocando. | Renderer único e persistente. |
| P1 | Sync A/V | app.js:15500–15516, 2086 | Relógios separados; o áudio começa atrasado no primeiro play. | O relógio mestre passa a ser `audioContext.currentTime`; pré-decodificar o áudio. |
| P1 | Exportação | app.js:2079, 2244 | Seek acima de 500 ms desenha um frame velho; vídeo não pronto **some do frame** sem aviso. | Decodificar com WebCodecs; repetir ou abortar em vez de pular. |
| P1 | Memória | app.js:2563, 11610, 11653 | O MP4 e o ZIP inteiros ficam em RAM, e o áudio de vídeo é decodificado em cópia dupla. | Gravar o arquivo em streaming (`StreamTarget` + File System Access). |
| P1 | Abrir projeto | app.js:1476 | Apaga toda a mídia **antes** de validar o arquivo escolhido. | Validar primeiro, trocar depois. |
| P1 | Teclado | app.js:15904–15944 | Espaço, Ctrl+Z e Delete continuam ativos durante a exportação. | Bloquear os atalhos enquanto exporta. |
| P1 | Undo | app.js:14633, 14706, 15340 | Tira snapshot no `pointerdown` mesmo sem mudança: cria passos vazios e apaga o redo. | Snapshot só ao confirmar a mudança. |
| P1 | Texto | app.js:2208 | Linhas que não cabem na caixa **somem sem aviso** (a caixa padrão comporta 1 linha). | Altura automática e aviso de "texto cortado". |
| P1 | Blend | app.js:2431–2446 | **Darken** usa `MIN` num quad de tela cheia: tudo fora da camada fica preto. | Fazer darken e lighten no shader. |
| P1 | Segurança | app.js:12400, 12518, 13225, 12459 | Campos do `.ntvct` entram em `innerHTML` sem escape: XSS armazenado com um projeto malicioso. | Escapar sempre (`pe()`) e usar CSP. |
| P2 | Timeline | app.js:2501, 1830 | `endTime` inclusivo: num corte seco, um frame mostra os dois clipes. | Intervalo `[start, end)`. |
| P2 | Exportação | app.js:15857–15893 | Cancelar a exportação gera um TypeError não tratado. | AbortController e optional chaining. |
| P2 | Exportação | app.js:11693 | Tamanho de exportação diferente do projeto estica a imagem (sem re-render). Dimensões ímpares podem falhar no H.264. | Renderizar na resolução de saída e forçar dimensões pares. |
| P2 | Velocidade | app.js:1887 | Keyframe de speed dá saltos; o áudio ignora. | Integrar a curva de velocidade, ou proibir keyframe de speed. |
| P2 | Preview | app.js:1593 | Blur, glow e glitch em qualidade reduzida ficam diferentes do export. | Escalar os parâmetros pela escala ativa. |
| P2 | Thumbnails | app.js:13040 | `await seeked` sem timeout: um vídeo com defeito trava a fila de thumbnails para sempre. | Timeout. |
| P2 | Feedback/Trail | app.js:2512 | Re-seek de até 32 vezes por frame em vídeo. | Usar histórico de frames. |
| P2 | Duração | app.js:14553 | Reduzir a duração deixa clipes fora do range ou com início negativo. | Clamp ou corte dos clipes. |
| P2 | Relink | app.js:12210 | Relink só pelo nome do arquivo. | Guardar tamanho e hash. |
| P2 | Fontes | app.js:15949 | **Hipótese:** uma fonte ainda não usada sai com fallback nos primeiros frames do export. | `document.fonts.load()` antes de exportar. |
| P2 | Cache | `.htaccess` | Assets com hash recebem `no-cache`, e não há CSP. | `immutable, max-age=31536000`; adicionar CSP. |

---

## 5. UI/UX: avaliação para "simples, funcional, todas as idades"

### 5.1 Pontos fortes a preservar

- Snap no canvas com guias.
- Campos de arrastar com detent no valor neutro.
- REC de automação com suavização.
- Áudio e vídeo vinculados com waveform e thumbnails.
- Copiar/colar por seção.
- Preview com qualidade adaptativa.
- Presets sociais.
- Efeitos GLSL.
- Uso sem conta.

### 5.2 Principais problemas

1. **É um compositor (estilo After Effects), não um editor (estilo CapCut).** Um clipe por camada, sem corte, sem mover entre faixas, sem ripple, sem transições.
2. **Navegação na timeline:**
   - o zoom vai só de 1× a 10× da duração, ancorado no centro;
   - Ctrl+roda dá zoom no *navegador*, não na timeline;
   - o playhead não acompanha o play;
   - a régua não tem timecode nem frames;
   - as setas movem a camada em vez do frame;
   - os atalhos param de funcionar quando o foco fica num botão.
3. **Texto:** só se edita pelo painel; linhas extras somem; não há alinhamento na UI (a propriedade existe); não há estilos, animações nem legendas. As alças redimensionam a caixa, não a fonte.
4. **Keyframes:** não dá para arrastá-los no tempo, e um duplo toque *apaga* o keyframe.
5. **Inserção:** toda mídia entra no topo, em t=0, ocupando a duração toda.
6. **Legibilidade:** fontes de 4 a 9 px, cinzas abaixo do contraste 4,5:1, e cerca de 45 strings traduzidas contra muitas fixas em inglês e caixa-alta (FADE IN START, DRY/WET, BLEND MODE, SOURCE IN, PLAY QUALITY).
7. **Padrões ruins para iniciantes:**
   - fundo **transparente ligado por padrão**, então a exportação padrão vira um ZIP de PNGs;
   - nome padrão "Mapping Project";
   - tela de boas-vindas com jargão ("shaders", "keyframes");
   - erros mostrados com `window.alert(String(e))`.
8. **Tablet:** além do `min-width`, os alvos de toque são de 8 a 19 px; não há pinça, menu de toque longo nem roda; a reordenação de camadas usa drag-and-drop HTML5, que falha no toque.

### 5.3 Comparação com concorrentes (resumo)

| Função | VCT 0.6.2 | CapCut Web | Clipchamp | Canva | Kapwing | VEED |
|---|---|---|---|---|---|---|
| Cortar / rearranjar | Não | Sim | Sim | Sim | Sim | Sim |
| Transições | Não | Sim | Sim | Sim | Sim | Sim |
| Texto inline, animado, legendas | Não | Sim | Sim | Sim | Sim | Sim |
| Keyframes com curvas | **Sim** | Sim | Limitado | Limitado | Parcial | — |
| Efeitos shader / motion | **Forte** | Predefinidos | Básicos | Básicos | Básicos | Básicos |
| Exportação com alpha | **Sim (PNG)** | Não | Não | — | Não | Não |
| Sem conta, 100% local | **Sim** | Não | Parcial | Não | Não | Não |
| Tablet | Ruim | Bom | Médio | Bom | Médio | Médio |
| Autosave | Não | Nuvem | Sim | Nuvem | Nuvem | Nuvem |

**Posicionamento sugerido:** "o editor de motion graphics e videomapping que roda no navegador da escola, sem conta e sem nuvem". Para competir, basta alcançar os concorrentes no básico (cortar, rearranjar, texto, autosave, tablet) e manter a vantagem em motion, alpha e privacidade.

---

## 6. Material da Giulia (`gyulyia3d-cloud/ai-vj-generator`, MIT)

**Regra principal: não fundir os motores.**

- O motor da Giulia gera **loops** generativos, organizados em quadros.
- O VCT é uma **timeline linear**, organizada em segundos.
- O roadmap dela deixa fora de escopo MCP, OSC, MIDI, Resolume e mapping, que é exatamente o território do VCT. Os dois produtos se complementam.

**Reaproveitar como padrão:**

- **Schema-first:** "o contrato é o arquivo". A IA escreve um JSON, um validador explica os erros em texto simples, e é o motor que desenha.
- **Registry como fonte única:** um catálogo gera a UI, o JSON Schema, as ferramentas MCP e a documentação, e um teste falha se houver divergência.
- **Migração declarativa** (`migrate.js` + `versions.json`), que substitui a cadeia de `??=` atual.
- **Prompt portátil** (`PROMPT.md`), com `CLAUDE.md`/`AGENTS.md` como ponteiros e skills curtas com `references/` lidas sob demanda.
- **Avaliar e depois criticar:** `evaluate.js` mede quadros reais; `/vj-critique` propõe mudanças sem aplicar nada.
- **Rótulos honestos de capacidade** (SUPPORTED / EXPORTABLE / NOT SUPPORTED) e a regra "um teste só vale se puder falhar".
- **README bilíngue:** tabela de instalação, tabela de comandos e a seção "Se algo não aparece".

**Reaproveitar como código, mantendo copyright e texto MIT da Giulia:**

- `onset.js`: detecção de onset por fluxo espectral, mais Kalman para o BPM.
- A matemática de mola e overshoot de `animation.js`, para as easings spring e back e para stagger musical.
- O parser `isf.js`. **No VCT, os ISF com `inputImage` viram efeitos de camada.**
- O replay e pré-aquecimento de efeitos com histórico (Trail, RGB Delay), que resolve o salto na timeline e a emenda de loop.

**Ponte entre os produtos:**

- **Agora:** PNG com alpha ou MP4 do aivj importados como camada de vídeo no VCT.
- **Depois:** uma camada "Gerador AIVJ" (iframe + `postMessage({renderFrame:n})`).

**Atenção a licenças nos shaders da biblioteca ISF:**

- `glslop-gstbkfmm.fs`, `glslop-jx54ed2e.fs` e `glslop-vdstz3q9.fs` dizem ser *ports do Shadertoy*. O padrão do Shadertoy é CC BY-NC-SA. Não use esses três em contexto comercial antes de verificar a origem.
- A marca GYULYIA e a fonte Martian Mono não estão sob o MIT.

---

## 7. Automação com MCP e agentes de navegador

### 7.1 O que já existe

A skill `noisetupi-video-lab` (em `~/.claude/skills/synced/...`):

1. opera o app pela extensão Claude in Chrome;
2. analisa vídeo e áudio (BPM, beats, contact sheet);
3. monta um plano de edição;
4. gera o `.ntvct` com `ntv-builder.js`;
5. injeta o projeto com `open-project.js`.

Isso já é a "rodada 0" da automação. Mas ela depende do formato interno e do DOM, que quebram a cada build.

### 7.2 Arquitetura proposta (em camadas)

1. **Barramento de comandos determinístico: `window.vct`.**
   - Superfície: `dispatch({type:'clip.split', …})`, `batch([...], {label})`, `query`, `getProject`, `validate`, `renderFrame(t)`, `on('change')`.
   - Um `batch` vira **um** passo de undo: um Ctrl+Z desfaz a macro inteira do agente.
   - Os tempos aceitam segundos, frames (`"f:120"`) ou notação musical (`"bar:3.2.0"`).
   - **A própria UI passa a chamar esses comandos.** É o pré-requisito de tudo.
2. **Formato `.ntvct` v3 com JSON Schema e migrações:** `tracks[].clips[]`, `tempo`, `markers`, easing como objeto (cubic, spring, preset), `textAnimators`, `masks`, `regions[]` para mapping e `safeArea`.
3. **Canais para agentes, em ordem de implementação:**
   1. **Agentes de navegador** (Claude in Chrome, Playwright, Chrome DevTools MCP): `data-testid` e ARIA estáveis, e chamadas a `window.vct` via `javascript_tool`. A skill atual passa a usar a API em vez de cliques.
   2. **Skills** `/vct-edit`, `/vct-template`, `/vct-critique` e `/vct-how-to`, no modelo do `/vj`.
   3. **MCP local (Node, stdio):**
      - **modo arquivo:** validar, transformar e renderizar `.ntvct` headless; serve para lote e CI;
      - **modo ponte:** stdio ↔ WebSocket ↔ página, com token e allowlist de Origin.
   4. **WebMCP** (`registerTool` no próprio site): está em origin trial e só funciona no Chrome. Ativar por detecção de recurso.
4. **Segurança:**
   - nenhuma chave de LLM no front: o agente é sempre do usuário;
   - export, salvar por cima e apagar pedem confirmação dentro da página;
   - faixa visível "agente ativo" com botão de parar;
   - o download final sempre depende de um clique do usuário.

### 7.3 Catálogo de ferramentas (vocabulário de motion design e VJ)

- **Leitura:** `vct_get_project`, `vct_list_catalog`, `vct_render_frame`, `vct_contact_sheet`, `vct_validate`.
- **Edição:** `vct_add_layer`, `vct_split_clip`, `vct_move_clip`, `vct_trim_clip` (com ripple), `vct_set_fade`, `vct_add_transition` (crossfade, dip-black, whip-pan, glitch-cut, wipe, zoom-through), `vct_delete`*.
- **Animação:**
  - `vct_animate`;
  - `vct_set_easing`, com os presets `ease-out-expo (0.16,1,0.3,1)`, `ease-in-back`, `ease-out-back (0.34,1.56,0.64,1)`, `elastic`, `bounce`, `spring(k,d,m)`, `steps`, `hold`;
  - `vct_anticipate`, `vct_follow_through`, `vct_hold`, `vct_stagger`, `vct_motion_preset` (pop-in, slide-up, drop-bounce, whip-in, breathe, wiggle).
- **Texto:**
  - `vct_text_animate`, por letra, palavra ou linha: typewriter, fade-up, scale-pop, mask-reveal, tracking-in, blur-in;
  - `vct_captions` (SRT, destaque por palavra), `vct_lower_third`;
  - `vct_safe_area` (Reels, TikTok, Shorts, 4:5, 16:9), `vct_check_layout`, `vct_reframe`.
- **Ritmo:** `vct_set_tempo`, `vct_detect_tempo`, `vct_add_markers`, `vct_quantize` (grid e swing), `vct_cut_to_beat` (every(n), euclid(k,n), onsets).
- **QA e saída:**
  - `vct_evaluate`: safe area, contraste, palavras por segundo, flash (WCAG 2.3.1) e salto na emenda do loop;
  - `vct_export`* e `vct_save`*.

(*) = ação consequente, que pede confirmação.

### 7.4 Conhecimento de VJ embutido

- **Loops perfeitos.** A duração é `n` compassos: `s = n × tempos × 60 / BPM`.
  - 8 compassos a 128 BPM = 15 s = 450 quadros a 30 fps (fecha).
  - 4 compassos a 125 BPM = 230,4 quadros (não fecha): o app deve avisar e sugerir fps ou duração.
  - Movimentos periódicos precisam de um número inteiro de ciclos.
  - Efeitos com histórico exportam com **pré-roll** de 1 loop.
- **Audio-reactive determinístico:** analisar offline e **gravar** como keyframes (`vct_bake_audio`). Só 1 a 3 camadas devem "escutar" o áudio (regra pedagógica da Giulia).
- **Mapping:** `regions[]`, corner-pin, máscaras e track matte; exportação por região; XML de slices do Resolume (existia no aivj e foi removido; dá para recuperar do histórico).
- **Saída para Resolume:**
  - hoje: PNG + alpha, convertido no Alley para DXV3;
  - próximo passo: **HAP / HAP Alpha** (formato aberto, viável em JS/WASM);
  - WebM VP9 alpha via WebCodecs;
  - ProRes só via ffmpeg.wasm ou um helper local.
- **Sinais de controle:** Web MIDI de saída (clock e CC) funciona no Chrome. OSC, NDI e Spout precisam de uma ponte local ou do OBS/TouchDesigner.

### 7.5 Fluxos-alvo

- **Professor:** "vídeo vertical de 30 s com legenda animada e cortes no beat".
  - `/vct-template reels …`, depois detecção de BPM, `cut_to_beat`, safe area, legenda palavra a palavra e lower third.
  - Tudo num `batch` só; depois `evaluate`, contact sheet e exportação com confirmação.
- **VJ:** "loop de 8 compassos a 128 BPM com alpha para o Resolume".
  - `set_tempo`, depois rotação de 1 volta por loop, pulso no beat e quantização 1/16.
  - Trail com pré-roll, `evaluate` da emenda e PNG com alpha (HAP quando existir).

---

## 8. Licenciamento

*Análise técnica, não parecer jurídico. Base: Leis 9.609/98, 9.610/98 e 9.279/96.*

### 8.1 Componentes de terceiros no build web

| Componente | Licença | Situação | O que fazer |
|---|---|---|---|
| Mediabunny (Vanilagy), muxer e encoders | MPL-2.0 | Cabeçalhos apagados pelo minificador; nenhum aviso | Aviso + link para o fonte da versão exata (MPL §3.2); preservar os comentários legais no build |
| fflate (Arjun Barrett), zip | MIT | Sem aviso | Copyright + texto MIT |
| IBM Plex Sans/Mono, Inter, Space Grotesk, Syne | OFL-1.1 | Sem os OFL.txt | Copiar o `LICENSE` de cada pacote `@fontsource/*` |
| Desktop 0.1.11: FFmpeg (build GPL v3) | GPL-3.0+ | Se voltar a distribuir: o script aponta para `latest` | Fixar o build, incluir a GPLv3 e oferecer o fonte correspondente |

### 8.2 Situação atual

- **O repositório público não tem LICENSE**, o que significa "todos os direitos reservados". Alunos e professores não têm permissão clara para estudar, copiar ou adaptar o código, o que vai contra o objetivo pedagógico.
- Só existe o código minificado, que não é "forma preferida para modificação".
- Falta definir o **titular**: pessoa física (Ricardo Palmieri) ou Noisetupi (se houver CNPJ; nesse caso, formalizar a cessão).

### 8.3 Recomendação

- **Código: MPL-2.0.**
  - É copyleft por arquivo: melhorias no código do VCT voltam abertas.
  - Permite uso comercial por VJs e escolas.
  - Combina com o Mediabunny.
  - Não impede vender cursos, hospedagem ou uma edição pro com módulos separados.
  - Alternativas: AGPL-3.0 + licença comercial + CLA, se o foco for vender licenças; Apache-2.0, se o foco for adoção máxima.
- **Documentação, tutoriais e templates: CC BY 4.0**, que tem tradução oficial para o português. Evitar NC, porque bloqueia escolas e cursos pagos.
- **Conteúdo criado pelos usuários pertence a eles.** Deixar isso explícito no README e na tela Sobre.
- **Marca:** "Noisetupi" e os logos ficam fora das licenças. Criar `TRADEMARKS.md` e registrar no INPI (classes 9, 41 e 42).

---

## 9. Plano de alterações em rodadas

Cada rodada termina com:

1. build (`npm run build` → `dist/`);
2. testes verdes;
3. checklist manual em desktop e iPad;
4. atualização do CHANGELOG e da documentação **em português**;
5. commit local → **você faz o push e sobe o `dist/` no Hostinger manualmente**.

A tradução para inglês fica para a última rodada.

### Rodada 0: Fundação (bloqueante)

**Objetivo:** ter código-fonte confiável, testes e o lado legal em dia, sem mudar nenhum comportamento.

- [ ] **Antes de reconstruir, verificar se o fonte 0.2–0.6 existe** em ChatGPT/Codex, Downloads, OneDrive ou numa sandbox de IA. Se existir, pula-se boa parte desta rodada.
- [ ] Reconstruir o TypeScript a partir do bundle 0.6.2. É viável porque propriedades e métodos não foram minificados, e a 0.1.11 serve de "pedra de Roseta". Módulos: `i18n`, `io`, `model`, `renderer`, `audio`, `export`, `timeline`, `ui`.
- [ ] Mediabunny e fflate passam a ser dependências npm com versão fixada.
- [ ] **Nova estrutura do repositório:** fonte na raiz (`src/`, `public/`, `index.html`, `vite.config.ts`). O build vai para `dist/`, e **só o `dist/` sobe para o Hostinger**. O build atual é preservado como tag `v0.6.2-prod`.
- [ ] **Testes de paridade:**
  - unitários de `fadeEnvelope`, `sourceTimeFor`, snap e `Qt`;
  - render de frames em Chrome headless comparado com o build 0.6.2 (ouro);
  - um vídeo de contador de frames para testar a exportação.
- [ ] **Legal:** `LICENSE` (MPL-2.0, depois de você decidir), `THIRD_PARTY_LICENSES.md`, `LICENSES/` (padrão REUSE), OFL das fontes, `NOTICE`, `TRADEMARKS.md`, `docs/LICENSE` (CC BY 4.0) e tela **Sobre/Créditos** no app.
- [ ] **Build:** preservar comentários legais (`legalComments`), carregar Mediabunny e fflate com `import()` dinâmico e corrigir os headers de cache no `.htaccess` (`immutable` para assets com hash).
- [ ] CI (GitHub Actions): typecheck, testes e build.

### Rodada 1: Estabilidade (0.6.3, "sem bugs graves")

- [ ] **Self-snap:** excluir o próprio valor, o grupo vinculado e o playhead dos alvos; histerese de entrada e saída; linha-guia de snap; Alt desliga temporariamente.
- [ ] **Fade relativo** (`fadeIn`/`fadeOut` em duração):
  - uma alça por lado, sem sobrepor o trim, com área de toque de 44 px;
  - tooltip com a duração;
  - inspetor "Aparecer/Sumir suavemente (s)", sem ◆;
  - migração da v2 que converte os quatro tempos absolutos.
- [ ] Fade e opacidade aplicados **no composite**, depois dos efeitos. Corrigir os blends Add e Darken/Lighten.
- [ ] Áudio: `start()` com duração; curva equal-power; reprogramar o áudio ao editar durante o play; relógio mestre = AudioContext.
- [ ] Uma única função de edição para o grupo A/V vinculado (mover, aparar, velocidade).
- [ ] **Renderer persistente com `dispose()`**, sem recriar o WebGL em `be()`/undo; tratar `webglcontextlost`.
- [ ] Exportação:
  - seek por índice de frame (ou decode WebCodecs);
  - não omitir camadas;
  - bloquear atalhos;
  - cancelamento sem erro;
  - render na resolução de saída e dimensões pares;
  - `document.fonts.load()` antes de começar.
- [ ] Abrir projeto: validar antes de descartar a mídia.
- [ ] Undo só com mudança real.
- [ ] Painel de Propriedades preserva a posição de rolagem.
- [ ] **Autosave** em IndexedDB/OPFS (projeto e mídias) a cada 10 s, "Recuperar sessão" e "Salvar pacote (.zip com mídias)".
- [ ] **Segurança:** escape consistente em todo `innerHTML` e CSP no `.htaccess`.
- [ ] Texto: altura automática da caixa e aviso de linhas cortadas.
- [ ] Intervalo de clipe `[start, end)`; clamp ao reduzir a duração e ao colar timing; timeout nos thumbnails.

### Rodada 2: Edição de verdade (0.7, modelo de clipes v3)

- [ ] Formato **v3** com `tracks[].clips[]`. Clipes têm `sourceIn/Out`, fades e keyframes **relativos ao clipe**. Migração v2→v3: cada layer vira uma faixa com um clipe, e o A/V vinculado vira um grupo.
- [ ] **Cortar no playhead:** S, Ctrl/⌘+B, botão ✂ na timeline e "Dividir aqui" no menu de toque longo.
- [ ] Mover clipes **entre faixas** (fantasma de arraste); Alt+arrastar duplica.
- [ ] Ripple delete (Shift+Delete), "Remover espaço vazio" e faixa principal magnética (opcional; ligada no Modo Simples).
- [ ] Multi-seleção (Shift/Ctrl+clique e laço); Ctrl+C/X/V de clipes no playhead.
- [ ] Transições entre clipes: crossfade, dip to black e wipe, que geram fades nos dois clipes.
- [ ] Inserir mídia no playhead (ou no fim da faixa principal) e estender a duração automaticamente.
- [ ] Keyframes: arrastar no tempo com snap; Delete exclui; duplo toque deixa de apagar.

### Rodada 3: Navegação e texto (0.8)

- [ ] **Zoom** com Ctrl/⌘+roda e pinça ancorados no ponteiro; "ajustar tudo" (tecla `\`); zoom até cerca de 20 px por frame.
- [ ] Playhead acompanha o play (rolagem por página).
- [ ] Régua com timecode `mm:ss:ff`.
- [ ] **Atalhos:**
  - J/K/L; ←/→ = 1 frame; Shift+←/→ = 1 s; Home/End; ↑/↓ = ponto de edição anterior/próximo; M = marcador;
  - funcionam mesmo com um botão focado;
  - não interferem em campos de texto;
  - painel "?" com a lista de atalhos.
- [ ] Minimapa acima da régua.
- [ ] **Texto:**
  - edição inline no canvas (duplo clique ou duplo toque);
  - alinhamento, entrelinha e espaçamento;
  - sombra e caixa de fundo;
  - Shift+canto escala a fonte;
  - estilos prontos: Título, Legenda, Lower third, Crédito;
  - animações de entrada/saída por letra, palavra ou linha (geram keyframes editáveis);
  - importação de legendas SRT;
  - rótulo legível na timeline (≥ 11 px).

### Rodada 4: Tablet, acessibilidade e modo pedagógico (0.9)

- [ ] Remover `min-width:1180px`. Breakpoints em 1366, 1024 e 834:
  - Propriedades viram gaveta;
  - INPUTS, EFEITOS e LAYERS viram abas;
  - a timeline ganha altura ajustável.
- [ ] `touch-action` correto: scrub só na régua e na "aba" do playhead (44 px); dois dedos rolam; pinça faz zoom.
- [ ] Alvos ≥ 44 px (via pseudo-elementos); menu de toque longo; stepper/slider grande ao tocar num campo; reordenação de camadas por pointer em vez de drag-and-drop HTML5.
- [ ] Fontes de no mínimo 11–12 px e opção **Interface grande** (125% / 150%); contraste AA; foco visível; botões de idioma como `<button>`; `lang` dinâmico.
- [ ] i18n completo pt-BR/en, sem strings fixas; erros amigáveis no lugar de `alert`.
- [ ] **Modo Simples** (padrão) e **Modo Avançado:**
  - no Simples, termos amigáveis: "Aparecer suavemente", "Intensidade", "Fundo transparente", "Mistura";
  - no Simples, keyframes, curvas e REC ficam ocultos.
- [ ] **Onboarding por objetivo:** Reels/TikTok, YouTube, Apresentação, Videomapping (transparente), Animação de logo. Transparência **desligada** por padrão fora do modo videomapping.
- [ ] Tutoriais embutidos (coachmarks de 3 a 5 passos), glossário com "?" ao lado dos termos e templates de aula em `.zip` com mídia.

### Rodada 5: Motion design e VJ (1.0)

- [ ] **Curvas:** cubic-bezier real com alças; presets back, elastic, bounce e spring; depois um graph editor (valor e velocidade).
- [ ] **Ritmo:**
  - BPM manual, tap tempo e detecção automática (porta do `onset.js` da Giulia);
  - grade de compassos;
  - snap ao beat;
  - quantização com swing;
  - assistente de loop que avisa quando o loop não fecha em quadros inteiros.
- [ ] Audio-reactive **gravado** (envelope, onset, bandas → keyframes).
- [ ] Guias de safe area por plataforma e `check_layout`.
- [ ] Máscaras, track matte (alpha/luma) e **corner-pin**; chroma key YCbCr com despill e visão de matte.
- [ ] Pré-roll e replay para efeitos com histórico (determinismo ao saltar na timeline).
- [ ] **Exportação:** WebM VP9 com alpha; **HAP/HAP Alpha**; exportação por região; arquivo em streaming no disco.
- [ ] (P2) Motion blur na exportação, LUT `.cube`, mais modos de mesclagem, parenting/null, importação de fontes e efeitos ISF.

### Rodada 6: Automação (1.1)

- [ ] `window.vct` (barramento de comandos) com **a própria UI migrada para usá-lo**; `registry/` como fonte única (efeitos, parâmetros, ferramentas, schema e docs).
- [ ] `data-testid` e ARIA estáveis nos controles principais.
- [ ] JSON Schema v3 publicado e CLI `npx vct validate|render`.
- [ ] Atualizar a skill `noisetupi-video-lab` para usar `window.vct` em vez do DOM.
- [ ] Skills `/vct-edit`, `/vct-template`, `/vct-critique` e `/vct-how-to`, com `PROMPT.md` portátil.
- [ ] Servidor MCP stdio, primeiro em modo arquivo e depois em modo ponte (token + allowlist de Origin).
- [ ] WebMCP por detecção de recurso; faixa "agente ativo"; confirmação para ações consequentes.
- [ ] `vct_evaluate` (safe area, contraste, palavras por segundo, flash e emenda de loop).

### Rodada 7: Plataforma (contínua)

- [ ] PWA offline (service worker), ícones 192/512/maskable, `id`/`scope` no manifest.
- [ ] Performance: textura por camada em vez de canvas da composição inteira por frame; cache de `evaluated()`; desligar `preserveDrawingBuffer` fora da captura.
- [ ] Testes E2E (Playwright) nos fluxos principais em desktop e iPad, com eventos de ponteiro reais.

### Rodada final: Documentação bilíngue

| Documento | PT-BR (atualizado a cada rodada) | EN (rodada final) |
|---|---|---|
| `README.md`: o que é, como usar online, como rodar local, licença | ✓ | resumo no fim + `README.en.md` |
| `docs/guia-do-usuario`: passo a passo com imagens | ✓ | ✓ |
| `docs/guia-do-professor`: planos de aula, templates, modo simples | ✓ | ✓ |
| `docs/glossario` | ✓ | ✓ |
| `docs/atalhos` | ✓ | ✓ |
| `docs/automacao`: `window.vct`, MCP, skills | ✓ | ✓ |
| `docs/formato-ntvct` (schema v3 + migrações) | ✓ | ✓ |
| `CHANGELOG.md`, `CONTRIBUTING.md` (DCO), `THIRD_PARTY_LICENSES.md`, `TRADEMARKS.md` | ✓ | ✓ |
| Textos da interface (i18n) | ✓ | revisão final |

---

## 10. Decisões que dependem de você

1. **O fonte da 0.2–0.6 existe em algum lugar** (ChatGPT/Codex, outra máquina, nuvem)? Isso muda o tamanho da Rodada 0.
2. **Licença do código:** MPL-2.0 (recomendada), Apache-2.0, ou AGPL + licença comercial?
3. **Titular do copyright:** Ricardo Palmieri (pessoa física) ou Noisetupi (empresa)?
4. **Estrutura do repositório:** fonte na raiz e build em `dist/` para o Hostinger (recomendado)?
5. **Compatibilidade:** projetos `.ntvct` v2 precisam abrir na 0.7+? A recomendação é sim, via migração automática.

---

## Anexo: arquivos e fontes consultados

- Este repositório (build 0.6.2) e `version.json`.
- Fonte 0.1.11: `Desktop\noisetupi\Lab_Tools\NT_VCTool\videoContentTool\NoisetupiVideoContentToolSource0111-Windows`, incluindo `README.md` e `QA_REPORT.md`.
- Build web intermediário de 06/08: `Desktop\noisetupi\Lab_Tools\NT_VCTool\ntVideoContentTool`.
- Skill `noisetupi-video-lab` (`~/.claude/skills/synced/.../noisetupi-video-lab`).
- `github.com/gyulyia3d-cloud/ai-vj-generator` (MIT, © 2026 Giulia Ribeiro).
- WebMCP: developer.chrome.com/docs/ai/webmcp/imperative-api

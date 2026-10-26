# Prompt para o Codex: Rodada 0 (reconstruir o fonte da 0.6.2)

Copie tudo abaixo da linha e cole no Codex, com o repositório `NT_VideoContentTool` aberto.

---

Você vai reconstruir o código-fonte TypeScript do **Noisetupi Video Content Tool Web v0.6.2**. O repositório atual contém só o build Vite minificado (`assets/index-BZJa5JOo.js` e `assets/index-CXAokcqt.css`). Leia `docs/ANALISE-E-PLANO.md` inteiro antes de começar: a seção 9 ("Rodada 0") é o escopo deste trabalho.

## Material

- **Build de produção (verdade absoluta do comportamento):** `assets/index-BZJa5JOo.js`. Formate-o com `npx prettier@3.3.3` numa pasta de trabalho fora de `src/`. Faixas do arquivo formatado:
  - 31–143: i18n;
  - 144–1343: fflate (biblioteca, não reconstruir);
  - 1344–2785: I/O, shaders, renderer, áudio;
  - 2786–11575: Mediabunny (biblioteca, não reconstruir);
  - 11576–15955: exportação, modelo e UI.
- **Fonte antigo v0.1.11 (desktop Tauri), usado como "pedra de Roseta" para nomes e tipos:**
  `C:\Users\veeja\Desktop\noisetupi\Lab_Tools\NT_VCTool\videoContentTool\NoisetupiVideoContentToolSource0111-Windows\src` (main.ts, renderer.ts, types.ts, i18n.ts, styles.css).
  - Cerca de 40% do código ainda se aplica, principalmente o renderer: 36 de 40 métodos têm o mesmo nome.
  - **Não use** Tauri, FFmpeg nem nada de `src-tauri`.
- **Build web intermediário (06/08), para diff:** `C:\Users\veeja\Desktop\noisetupi\Lab_Tools\NT_VCTool\ntVideoContentTool\assets\index-CLYizs2l.js`.

## Entregáveis

1. **Projeto Vite + TypeScript (strict)** na raiz do repositório: `src/`, `public/` (logos, manifest, `.htaccess`), `index.html`, `vite.config.ts`, `package.json`.
   - `npm run build` gera `dist/` com o app idêntico ao atual.
   - Mova o build antigo para `legacy/0.6.2/` (não apague; ele é a referência dos testes).
2. **Módulos:** `src/i18n`, `src/io`, `src/model` (tipos do formato `.ntvct` v2), `src/renderer` (WebGL2 + shaders), `src/audio`, `src/export`, `src/timeline`, `src/ui`, `src/main.ts`.
   - Dê nomes legíveis a todas as funções e variáveis.
   - Mantenha um arquivo `docs/MAPA-MINIFICADO.md` com o mapeamento nome minificado → nome novo (ex.: `sf()` → `collectSnapTargets()`, `Qt` → `clampLayerTiming`, `be()` → `rebuildEditor`).
3. **Dependências npm com versão fixada:** `mediabunny` e `fflate` (descubra a versão mais próxima do código embutido), mais `@fontsource/*`. Nada de código de biblioteca copiado para `src/`.
4. **Paridade de comportamento (requisito principal: zero mudança de comportamento nesta rodada, nem bugs conhecidos devem ser corrigidos):**
   - testes unitários (Vitest) de `fadeEnvelope`, `sourceTimeFor`, snap e clamp de timing, a migração `.ntvct` e o i18n;
   - teste de paridade com Playwright: abrir `legacy/0.6.2/index.html` e o novo `dist/index.html`, criar o mesmo projeto (texto + geometria + fade + efeito), renderizar os mesmos frames e comparar os pixels, com tolerância mínima;
   - salvar um `.ntvct` no build legado, abrir no novo, e vice-versa.
5. **Arquivos legais:**
   - `LICENSE` (MPL-2.0, titular "Ricardo Palmieri / Noisetupi"; ajuste se eu disser outro);
   - `THIRD_PARTY_LICENSES.md` (Mediabunny MPL-2.0 com link do fonte da versão exata; fflate MIT; 5 fontes OFL-1.1);
   - `LICENSES/` com os textos completos;
   - `TRADEMARKS.md`;
   - build com `legalComments` preservados.
6. **CI** no GitHub Actions: typecheck, testes e build.
7. **Relatório final** `docs/RODADA0-RELATORIO.md` com:
   - o que foi reconstruído;
   - trechos com dúvida;
   - resultado da paridade;
   - diferenças encontradas.

## Equipe de agentes (subagentes) a montar

Trabalhe com estes papéis em paralelo onde não houver dependência:

1. **Arqueólogo de código / reverse engineer:** de-minifica módulo por módulo, cruzando com a 0.1.11, e mantém o `MAPA-MINIFICADO.md`. Um agente por faixa: renderer+shaders, áudio+exportação, UI+timeline, I/O+modelo+i18n.
2. **Arquiteto TypeScript:** define os tipos do modelo (`Project`, `Layer`, `AudioTrack`, `Effect`, `Keyframe`), a estrutura de pastas e o `tsconfig` strict, e revisa as fronteiras entre módulos.
3. **Engenheiro de build e dependências:** Vite, npm (Mediabunny/fflate/fontes), `legalComments`, `.htaccess`, CI.
4. **Engenheiro de testes / QA:** Vitest e o teste de paridade com Playwright contra `legacy/0.6.2`. Regra: **um teste só vale se puder falhar**; prove isso quebrando o código de propósito uma vez.
5. **Especialista em licenciamento:** arquivos legais e conferência das versões e links.
6. **Revisor (code reviewer):** revisa cada módulo antes do merge. Bloqueia qualquer mudança de comportamento.

## Regras

- Não corrija bugs nesta rodada; só registre os que encontrar no relatório. Eles estão listados no `docs/ANALISE-E-PLANO.md` e serão corrigidos na Rodada 1.
- Não faça push nem deploy. Deixe commits locais pequenos e descritivos; eu faço o push e subo o `dist/` no Hostinger manualmente.
- Comentários e documentação em português.
- Se algum trecho do bundle for ambíguo, prefira reproduzir exatamente o comportamento minificado e marque `// TODO(rodada1):`.
- A rodada termina quando `npm run build`, os testes unitários e o teste de paridade passarem, e o relatório estiver escrito.

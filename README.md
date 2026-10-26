# Noisetupi Video Content Tool Web

Editor de motion graphics e videomapping com processamento local no navegador,
interface PT/EN, WebGL2 e exportação por WebCodecs.
Código próprio: **MPL-2.0 — Ricardo Palmieri / Noisetupi**.

O fonte **0.6.2 foi recuperado**. Antes da reorganização, seu build reproduziu
os **19 arquivos de produção byte a byte**. Veja [a evidência](docs/BASELINE-0.6.2.json)
e [o relatório da Rodada 0](docs/RODADA0-RELATORIO.md).

## Desenvolvimento

Use Node.js 24 (`.nvmrc`; mínimo 22.12) e npm:

```sh
npm ci
npm run dev
```

Abra `http://127.0.0.1:1420`. Dependências diretas têm versões exatas; o lockfile
registra as transitivas. Não use `npm update` para reproduzir esta versão.

| Comando | Finalidade |
|---|---|
| `npm run dev` | Desenvolvimento com Vite |
| `npm run typecheck` | TypeScript strict do app, testes e configurações |
| `npm test` | Testes unitários de caracterização |
| `npm run build` | Typecheck, build em `dist/` e avisos legais |
| `npm run preview` | Inspeção local do build |
| `npm run verify:legacy` | Integridade SHA-256 do legado e ZIP original |
| `npm run test:parity` | Comparação do legado com `dist/` via Playwright |
| `npm run check` | Integridade, unitários, build e paridade |
| `npm run package:hostinger` | Build e ZIP verificado em `release/` |

Antes do primeiro teste de paridade:

```sh
npx playwright install chromium --only-shell
npm run check
```

No Linux, acrescente `--with-deps` à instalação do Chromium.
A paridade precisa de HTTP em loopback, processo de navegador e WebGL2.
Não exige conta nem acesso às mídias pessoais.

## Organização

```text
src/
  main.ts                 entrada do aplicativo
  model/                  tipos v2, fábricas e migração histórica
  io/                     arquivos, blobs, salvar, abrir e relink
  i18n/                   traduções existentes
  renderer/               compositor WebGL2, shaders e tempo de mídia
  audio/                  reprodução, efeitos e mixagem
  export/                 MP4 e sequência PNG/ZIP
  timeline/               fades, clamp e snap
  ui/                     estado, DOM, eventos e CSS
public/                   logos, manifest, version.json e .htaccess
tests/                    unitários e paridade
scripts/                  empacotamento, integridade e servidor de testes
legacy/0.6.2/             distribuição original imutável
archives/0.6.2/           ZIP original recuperado
docs/                     plano, evidências e instruções
LICENSES/                 textos completos das licenças
dist/                     build gerado, fora do Git
release/                  ZIP gerado, fora do Git
```

Estado e handlers permanecem em `src/ui/editor.ts` para preservar ordem de
inicialização e closures. A Rodada 0 mantém os bugs conhecidos; as correções
estão planejadas na Rodada 1.

## Publicação e colaboração

Publique **somente o conteúdo de `dist/`**, incluindo arquivos legais e
`.htaccess`. A CI valida, mas não publica. Veja
[Hostinger](docs/HOSTINGER-DEPLOY.md) e [contribuição](CONTRIBUTING.md).

O build original tem a tag local `v0.6.2-prod`. Evidências temporárias ficam em
`test-results/` e `playwright-report/`. `scripts/verify-baseline.mjs` serve para
o fonte original antes da modularização; agora use `verify:legacy` e paridade.

WebGL2 é obrigatório. MP4 H.264/AAC depende dos codecs WebCodecs do navegador;
PNG/ZIP preserva alpha. Projetos `.ntvct` guardam referências e podem exigir
relink ao reabrir.

Veja [LICENSE](LICENSE), [terceiros](THIRD_PARTY_LICENSES.md), [NOTICE](NOTICE)
e [marcas](TRADEMARKS.md). Documentação própria: CC BY 4.0 ([texto](docs/LICENSE)).
Conteúdos dos usuários continuam pertencendo aos respectivos titulares.

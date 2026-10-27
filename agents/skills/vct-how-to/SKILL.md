---
name: vct-how-to
description: Explica como fazer algo no Noisetupi VCT (na interface ou pela API window.vct), em passos curtos, sem editar o projeto. Use quando o usuário perguntar "como faço…", "onde fica…", "dá para…" sobre o editor.
---

# /vct-how-to

1. Confirme a pergunta em uma linha se ela for ambígua (interface ou API?).
2. Fontes, nesta ordem:
   - `vct.guide()` e `vct.describe()` / `vct.describe('tipo')` para o que a API faz;
   - `docs/API-AGENTE.md` (gerado do registro de comandos, sempre atual);
   - `docs/AUTOMACAO.md` e o painel de atalhos do editor (tecla **?**) para a interface.
3. Responda com no máximo 6 passos. Para a interface, nomeie os botões como aparecem na
   tela (ex.: **Importar mídia**, **+ faixa**, aba **Efeitos**). Para a API, mostre um
   lote curto pronto para `vct.plan(..., { dryRun: true })`.
4. Se a função não existir, diga isso claramente e sugira o caminho mais próximo.
   Não invente comandos nem campos: confira em `describe`.
5. Não altere o projeto. Se o usuário quiser que você faça, passe para `/vct-edit` ou `/vct-template`.

# Referência de produção

`0.6.2/` contém o build que estava na raiz, sem alterações nos bytes dos arquivos.
Não reformatar nem reconstruir por cima dele. O commit original é `41af6f6`,
marcado pela tag local `v0.6.2-prod`.

`npm run verify:legacy` verifica SHA-256 contra `docs/BASELINE-0.6.2.json`.
O teste Playwright serve essa pasta separadamente do build atual.

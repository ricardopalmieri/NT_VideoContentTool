# Publicar manualmente no Hostinger

1. Execute `npm ci`, instale o Chromium dos testes e rode `npm run check`.
2. Execute `npm run package:hostinger`.
3. Faça backup da publicação anterior no servidor.
4. Envie o conteúdo de `dist/` ou extraia o ZIP de `release/` na pasta de publicação.
5. Inclua `.htaccess`, `LICENSE`, `NOTICE`, `THIRD_PARTY_LICENSES.md`,
   `TRADEMARKS.md` e `LICENSES/`, além dos assets, manifest e logos.
6. Abra o site, confirme `BUILD 0.6.2` e teste abrir/salvar/exportar.

Não envie `src/`, `node_modules/`, `.git/`, `legacy/`, `archives/` nem a raiz
inteira. O fonte correspondente deve estar disponível no repositório indicado
em `NOTICE` ao distribuir o build.

`base: "./"` permite domínio ou subpasta. HTTPS é necessário para WebCodecs
fora de localhost. Os headers de cache do `.htaccess` foram preservados;
mudanças de cache/CSP ficam para trabalho separado. A CI não publica.

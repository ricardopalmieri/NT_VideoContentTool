# Contribuir

Comentários e documentação novos são escritos em português. Instale com
`npm ci`, trabalhe em uma branch e execute `npm run check` antes de integrar.

Durante a Rodada 0, preserve o comportamento 0.6.2, inclusive os defeitos
documentados. Registre dúvidas com `TODO(rodada1)` e explique-as no relatório.
Não misture correções funcionais com movimentos de arquivo ou extrações.

`legacy/0.6.2/` e o ZIP em `archives/0.6.2/` são referências imutáveis;
não os reformate. Não versionar dependências instaladas, builds, dados pessoais,
projetos com mídia do usuário ou relatórios temporários.

Mantenha versões exatas no manifest e o lockfile atualizado. Mudanças em
dependências precisam passar pela comparação de comportamento.
Não adicione Tauri, FFmpeg ou serviços remotos ao app nesta rodada.

Use commits pequenos e revise os arquivos incluídos. Push e publicação são
feitos manualmente pelo mantenedor; nenhum script deste projeto os executa.

Testes devem cobrir limites ou regressões concretas. Não basta verificar que
a página abriu: compare pixels e resultados observáveis, incluindo `.ntvct`.

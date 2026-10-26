# Publicar na Hostinger

## Pacote pronto

1. Abra o Gerenciador de Arquivos da Hostinger.
2. Entre na pasta `public_html` do domínio ou subdomínio escolhido.
3. Envie `NoisetupiVideoContentToolWeb-Hostinger-0.6.2.zip`.
4. Extraia o conteúdo diretamente nessa pasta. O arquivo `index.html` deve ficar na raiz publicada.
5. Abra a URL usando HTTPS e faça uma atualização forçada com `Ctrl+F5`.

Não é necessário Node.js no servidor. O app é estático e todo projeto, render e mídia permanecem no computador do usuário.

## Desenvolvimento local

```powershell
npm install
npm run dev
```

Abra o endereço mostrado pelo Vite. As alterações de código aparecem sem reinstalar o aplicativo.

## Gerar uma nova publicação

```powershell
npm run package:hostinger
```

O ZIP será criado em `release/NoisetupiVideoContentToolWeb-Hostinger-0.6.2.zip`.

## Compatibilidade

- Chrome ou Edge atualizados são recomendados.
- O exportador MP4 depende de WebCodecs e requer HTTPS no servidor.
- A sequência PNG preserva alpha e é baixada como um ZIP.
- Safari e Firefox podem abrir o editor, mas o suporte à exportação MP4 varia.
- O navegador pode pedir permissão para downloads de vários arquivos. Esta versão evita isso agrupando a sequência PNG em um único ZIP.

# Componentes de terceiros

Versões confirmadas no lockfile do fonte original recuperado e fixadas no projeto.
O primeiro build restaurado reproduziu os 19 arquivos publicados byte a byte;
a evidência está em `docs/BASELINE-0.6.2.json`.

| Componente | Versão | Licença | Fonte e aviso completo |
|---|---|---|---|
| Mediabunny, Vanilagy | 1.52.3 | MPL-2.0 | [Fonte da versão](https://github.com/Vanilagy/mediabunny/tree/v1.52.3), [licença](LICENSES/MPL-2.0.txt) |
| fflate, Arjun Barrett | 0.8.3 | MIT | [Fonte da versão](https://github.com/101arrowz/fflate/tree/v0.8.3), [aviso e licença](LICENSES/fflate-MIT.txt) |
| IBM Plex Mono | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/ibm-plex-mono/v/5.3.0), [aviso e licença](LICENSES/ibm-plex-mono-OFL-1.1.txt) |
| IBM Plex Sans | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/ibm-plex-sans/v/5.3.0), [aviso e licença](LICENSES/ibm-plex-sans-OFL-1.1.txt) |
| Inter | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/inter/v/5.3.0), [aviso e licença](LICENSES/inter-OFL-1.1.txt) |
| Space Grotesk | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/space-grotesk/v/5.3.0), [aviso e licença](LICENSES/space-grotesk-OFL-1.1.txt) |
| Syne | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/syne/v/5.3.0), [aviso e licença](LICENSES/syne-OFL-1.1.txt) |

Os textos de licença e copyrights foram copiados dos pacotes instalados nas
versões acima. As versões Fontsource identificam os pacotes de distribuição,
não necessariamente a versão interna do desenho tipográfico.

Mediabunny e fflate são dependências npm sem alterações locais; nenhum código
dessas bibliotecas foi copiado para `src/`. Os dez WOFF2 latinos são empacotados
pelo Vite. As ferramentas de desenvolvimento não fazem parte do aplicativo
publicado; suas dependências completas estão registradas no `package-lock.json`.

O build preserva comentários legais e distribui este arquivo, `NOTICE`, `LICENSE`
e `LICENSES/`. Ao distribuir uma versão modificada, publique também o fonte
correspondente e atualize os avisos pertinentes.

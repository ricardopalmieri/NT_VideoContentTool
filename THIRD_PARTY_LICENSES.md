# Componentes de terceiros

Versões confirmadas no lockfile do fonte original recuperado e fixadas no projeto.
O primeiro build restaurado reproduziu os 19 arquivos publicados byte a byte;
a evidência está em `docs/BASELINE-0.6.2.json`.

| Componente | Versão | Licença | Fonte e aviso completo |
|---|---|---|---|
| Mediabunny, Vanilagy | 1.52.3 | MPL-2.0 | [Fonte da versão](https://github.com/Vanilagy/mediabunny/tree/v1.52.3), [licença](LICENSES/MPL-2.0.txt) |
| fflate, Arjun Barrett | 0.8.3 | MIT | [Fonte da versão](https://github.com/101arrowz/fflate/tree/v0.8.3), [aviso e licença](LICENSES/fflate-MIT.txt) |
| Transformers.js, Hugging Face | 4.3.1 | Apache-2.0 | [Fonte da versão](https://github.com/huggingface/transformers.js/tree/4.3.1), [licença](LICENSES/transformers-js-Apache-2.0.txt) |
| ONNX Runtime Web (arquivos em `ort/`), Microsoft | 1.31.0-dev.20260914 | MIT | [Pacote](https://www.npmjs.com/package/onnxruntime-web/v/1.31.0-dev.20260914-8d85527a0), [aviso e licença](LICENSES/onnxruntime-MIT.txt) |
| Whisper (pesos `onnx-community/whisper-base` e `-small`), OpenAI | — | MIT | [Modelo base](https://huggingface.co/onnx-community/whisper-base), [aviso e licença](LICENSES/whisper-MIT.txt) |
| IBM Plex Mono | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/ibm-plex-mono/v/5.3.0), [aviso e licença](LICENSES/ibm-plex-mono-OFL-1.1.txt) |
| IBM Plex Sans | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/ibm-plex-sans/v/5.3.0), [aviso e licença](LICENSES/ibm-plex-sans-OFL-1.1.txt) |
| Inter | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/inter/v/5.3.0), [aviso e licença](LICENSES/inter-OFL-1.1.txt) |
| Space Grotesk | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/space-grotesk/v/5.3.0), [aviso e licença](LICENSES/space-grotesk-OFL-1.1.txt) |
| Syne | 5.3.0 do pacote Fontsource | OFL-1.1 | [Pacote](https://www.npmjs.com/package/@fontsource/syne/v/5.3.0), [aviso e licença](LICENSES/syne-OFL-1.1.txt) |
| glfx.js, Evan Wallace (shaders portados: desfoque triangular/tilt-shift, zoom blur, meio-tom colorido, vibrance, vinheta, nitidez) | 0.0.4 | MIT | [Pacote](https://www.npmjs.com/package/glfx/v/0.0.4), [aviso e licença](LICENSES/glfx-MIT.txt) |
| postprocessing, Raoul van Rüschen / pmndrs (ideias e fórmulas portadas: glitch, aberração cromática, vinheta, grão) | 6.39.5 | zlib | [Pacote](https://www.npmjs.com/package/postprocessing/v/6.39.5), [aviso e licença](LICENSES/postprocessing-zlib.txt) |
| three.js, autores do three.js (estrutura do UnrealBloomPass: filtro de brilho, mips gaussianos, soma) | 0.186.1 | MIT | [Pacote](https://www.npmjs.com/package/three/v/0.186.1), [aviso e licença](LICENSES/three-MIT.txt) |
| GPUImage, Brad Larson e colaboradores (exposição e balanço de branco, reescritos a partir das fórmulas; não está no npm) | — | BSD-3-Clause | [Fonte](https://github.com/BradLarson/GPUImage), [aviso e licença](LICENSES/GPUImage-BSD-3-Clause.txt) |

Os textos de licença e copyrights foram copiados dos pacotes instalados nas
versões acima. As versões Fontsource identificam os pacotes de distribuição,
não necessariamente a versão interna do desenho tipográfico.

Os efeitos de `src/renderer/effects/` são shaders GLSL escritos para este projeto
com base nos algoritmos dos projetos acima (glfx.js, postprocessing, three.js e
GPUImage). Nenhum arquivo deles é distribuído: nem os pacotes npm nem os
repositórios entram no build; só a atribuição acima. Cada módulo cita sua origem
no comentário de cabeçalho. O texto da licença do GPUImage é cópia do `License.txt` do
repositório original (conferido em 27/10/2026).

Transformers.js e ONNX Runtime Web rodam só quando a pessoa pede a legenda
automática, num Web Worker; os arquivos WebAssembly do ONNX Runtime são
distribuídos em `ort/` (sem CDN). Os pesos do Whisper não vêm no pacote: o
navegador os baixa do Hugging Face, ou vêm da pasta `models/` que o dono do
servidor publicar (`npm run models:whisper`).

Mediabunny e fflate são dependências npm sem alterações locais; nenhum código
dessas bibliotecas foi copiado para `src/`. Os dez WOFF2 latinos são empacotados
pelo Vite. As ferramentas de desenvolvimento não fazem parte do aplicativo
publicado; suas dependências completas estão registradas no `package-lock.json`.

O build preserva comentários legais e distribui este arquivo, `NOTICE`, `LICENSE`
e `LICENSES/`. Ao distribuir uma versão modificada, publique também o fonte
correspondente e atualize os avisos pertinentes.

# QA - Noisetupi Video Content Tool Web 0.6.2

Data: 2026-08-25

## Verificações executadas

- TypeScript em modo estrito: aprovado
- Build Vite de produção: aprovado
- Auditoria das dependências de produção: 0 vulnerabilidades
- Referências Tauri removidas do frontend e das dependências: aprovado
- Build servido por HTTP local com `index.html`, JavaScript e assets acessíveis: aprovado
- Caminhos relativos para publicação em domínio ou subpasta: aprovado
- ZIP de publicação gerado e testado integralmente: aprovado
- Verificador do pacote confirma build 0.6.2, reprodução estável, seleção unificada e fontes otimizadas: aprovado
- `.htaccess`, manifest, logo e fontes incluídos no build: aprovado
- Fontes reduzidas de 98 arquivos e 1,5 MB para 10 arquivos WOFF2 e cerca de 200 KB: aprovado

## Fluxos cobertos na implementação

- Novo projeto e abertura de `.ntvct`
- Importação local de imagem, vídeo e imagem guia por Blob URL, sem CORS/tainted canvas
- Importação de áudio independente e detecção de áudio embutido em vídeos compatíveis
- Timeline dividida em vídeo e áudio, clips móveis, trim, extensão com loop e vínculo A/V
- Reordenação de vídeo e áudio na própria timeline por arraste e botões
- Fades de todas as layers visuais e de áudio com início e fim configuráveis e envelope aplicado na reprodução e exportação
- Thumbnails de vídeo e waveform de áudio gerados localmente
- Cadeado proporcional para escala e tamanho e cópia de parâmetros por seção
- Cadeia de efeitos de áudio e blur gaussiano separável com qualidade configurável
- Presets sociais na criação do projeto e mudança de composição dentro do editor
- Adaptação proporcional de camadas e keyframes ao novo tamanho da composição
- Trim, arraste e fades em texto, geometria, imagem, vídeo e áudio
- Quatro alças de fade na timeline com sincronização do painel
- Snap de timeline e alinhamento de objetos no canvas
- Sincronização da ordem de áudio vinculado com as layers de vídeo
- Alturas independentes das tracks de vídeo e áudio
- Redimensionamento centralizado e edição do fundo da composição
- Coordenadas de trim, clipes, fades e cursor consistentes em todos os níveis de zoom
- Salvamento sem incorporar mídias e abertura compatível com projetos ZIP antigos
- Relink em lote e individual de mídias ausentes
- Substituição independente de áudio e substituição A/V vinculada
- Waveform centralizada dentro da track de áudio
- Caixa de transformação para tamanho e rotação sincronizada ao painel
- Texto com caixa real, quebra de linha e fonte sem deformação horizontal
- Geometria criada inicialmente como quadrado
- Salvamento leve em `.ntvct`, somente com JSON e referências de mídia
- Confirmação antes de Novo/Abrir e confirmação nativa do navegador ao fechar
- Preview WebGL2, timeline, REC, keyframes, layers e efeitos preservados da versão desktop
- Reprodução contínua usa tolerância de drift, cache do último frame válido e histerese no preview AUTO
- Seleção mutuamente exclusiva entre layer visual e áudio, com destaque sincronizado em todos os painéis
- Layer escolhida na timeline preservada durante o hit-test do canvas e `Alt + clique` para sobreposições
- MP4 H.264 + áudio AAC mixado por WebCodecs/Mediabunny, sem alpha
- Sequência PNG com alpha em ZIP por streaming de frames
- Exportação quadro a quadro independente da qualidade do preview
- Cancelamento, progresso, restauração do frame atual e som de conclusão

## Limites do navegador

- O teste final do encoder H.264 deve ser repetido no Chrome/Edge do ambiente publicado, pois codec e aceleração disponíveis dependem do navegador e da GPU do usuário.
- O MP4 exige WebCodecs. A interface bloqueia o fluxo com uma mensagem clara quando a API não existe.
- A leitura de áudio depende dos codecs que o Chrome/Edge oferece. Um vídeo com codec visual compatível e codec de áudio incompatível continua disponível como imagem, mas sua faixa sonora não é criada.
- O navegador controla o texto da confirmação ao fechar/recarregar a aba.
- Projetos ZIP antigos continuam abrindo com seus assets incorporados. Ao salvar novamente, o formato passa a ser leve e exigirá relink das mídias em outra sessão ou computador.
- Renders extensos em PNG ocupam memória até a conclusão do ZIP. Para projetos longos, MP4 é a opção mais eficiente.

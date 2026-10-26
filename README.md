# Noisetupi Video Content Tool Web

Versão 0.6.2 estabiliza o preview de vídeo, unifica a seleção de layers entre canvas e timeline e reduz o pacote de fontes para arquivos WOFF2 com subconjunto latino.

Versão web bilíngue do editor de motion graphics e conteúdo para videomapping da Noisetupi. A interface, timeline, inputs e shaders vêm da versão Tauri, mas arquivos e exportação usam APIs do navegador. Nenhuma mídia é enviada ao servidor.

## Recursos

- Canvas com dimensão, proporção, FPS, duração, fundo e alpha configuráveis
- Presets para Instagram, TikTok, YouTube, Facebook, LinkedIn e X na criação do projeto
- Alteração da composição durante a edição, mantendo as camadas ou adaptando-as proporcionalmente
- Cor de fundo e transparência alteráveis no menu de composição
- Redimensionamento do canvas sempre calculado pelo centro, com ou sem escala das layers
- Imagem, vídeo, imagem guia, geometria e texto
- Layers e efeitos reordenáveis
- Transform, composição, preenchimento, contorno, opacidade e edição direta no preview
- Timeline com keyframes, easing linear/Bezier, zoom, thumbnails de vídeo, waveform de áudio, trim, loop e modo REC
- Camadas reordenáveis diretamente na timeline por arraste ou botões
- Fade in e fade out editáveis para todas as layers visuais e de áudio, aplicados no preview e na exportação
- Cadeado proporcional para escala e tamanho
- Cópia e colagem de Transform, Timing, Efeitos e parâmetros de Áudio entre tracks
- Velocidade, reverso e corte de vídeo
- Vídeos entram sem loop e ocupam sua duração original na timeline
- Clipes de vídeo e áudio movidos por arraste, com crop pelas alças e loop ao estender
- Texto, geometria e imagem também possuem trim, arraste e fades na timeline
- Quatro marcadores de fade ajustáveis diretamente com o mouse
- Arraste de fade, trim, cursor e clipes calculado no espaço real da timeline ampliada
- Snap de tempo para frames, bordas, clipes e keyframes
- Snap no canvas para centro, bordas e alinhamento com outras layers
- Alturas independentes para as tracks de vídeo e áudio
- A ordem do áudio vinculado acompanha a ordem das layers de vídeo
- Projeto `.ntvct` leve, contendo apenas JSON e caminhos lógicos das mídias
- Relink em lote por nome ou localização individual para arquivos ausentes
- Substituição de imagem, vídeo e áudio preservando composição e duração da track
- O áudio embutido vinculado é substituído automaticamente junto com o vídeo
- Caixa de transformação no canvas com oito alças de tamanho e controle de rotação
- Caixa de texto redimensionável sem alterar ou comprimir a fonte
- Geometria inicial quadrada
- Área de áudio separada abaixo do vídeo, com volume, mute, velocidade, reverso e loop
- Áudio embutido vinculado ao vídeo por cadeado e suporte a trilhas de áudio independentes
- Mixagem das faixas de áudio incluída no MP4 final
- Preview adaptativo ou com resolução manual, sem reduzir a qualidade final
- Reprodução de vídeo com correção de sincronismo amortecida e retenção do último frame válido
- Seleção única e sincronizada entre pilha de layers, timeline, canvas e propriedades
- Seleção escolhida na timeline permanece ativa ao manipular objetos sobrepostos no canvas
- Fontes locais WOFF2 limitadas ao subconjunto latino, sem dependência externa durante edição ou exportação
- Mirror, Trail, Levels/Color, Kaleidoscope, Blur Gaussiano, Crop, Edge, Color Key e animaTracer
- Efeitos de áudio: low-pass, high-pass, EQ de 3 bandas, delay, compressor e reverb
- RGB Delay, Noise, Glitch, VHS, Camera Shake e Bloom
- Interface em português e inglês
- Projeto `.ntvct` leve, com referências de mídia e relink quando necessário
- Exportação MP4 H.264 ou sequência PNG com alpha dentro de ZIP

## Rodar em desenvolvimento

Requer Node.js 20 ou mais recente.

```powershell
npm install
npm run dev
```

Abra o endereço exibido no terminal. O Vite atualiza a interface automaticamente quando o código muda.

## Build e pacote Hostinger

```powershell
npm run package:hostinger
```

O comando valida TypeScript, cria o build otimizado e gera:

```text
release/NoisetupiVideoContentToolWeb-Hostinger-0.6.2.zip
```

As instruções de publicação estão em `HOSTINGER-DEPLOY.md`.

## Compatibilidade

Chrome e Edge atualizados são a combinação recomendada. WebGL2 é necessário para o compositor. O MP4 usa WebCodecs e deve ser executado em HTTPS. A sequência PNG preserva transparência e funciona como alternativa para alpha.

## Controles principais

- `Espaço`: play/pause
- `Ctrl+S`: salvar projeto
- `Ctrl+Z`: desfazer
- `Ctrl+Shift+Z`: refazer
- `Ctrl+D`: duplicar Layer
- `Setas`: mover 1 pixel
- `Shift+Setas`: mover 10 pixels
- `Delete`: excluir Layer
- Duplo clique em Layer: renomear
- Duplo clique em keyframe: excluir
- Arrastar no preview: mover a Layer selecionada
- `Alt` + clique no preview: percorrer layers sobrepostas
- `REC` + Play: gravar alterações como keyframes suavizados

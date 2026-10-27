---
name: vct-template
description: Monta a base de um vídeo no Noisetupi VCT a partir de um modelo (reels vertical com legenda, loop de VJ no BPM, lower third, slideshow de fotos), usando a mídia que já está no bin. Use quando o usuário pedir "monta um reels", "faz um loop de 8 compassos", "começa um vídeo de…" ou um formato pronto.
---

# /vct-template

Canal: `window.vct` pelo Claude in Chrome (ou as ferramentas `vct_*` do MCP, com os mesmos comandos).
Detalhes de cada comando: `vct.describe('tipo')`. Referência completa: `docs/API-AGENTE.md`.

1. Leia o que existe: `vct.assets()` e `vct.summary()`. Sem mídia no bin, peça ao usuário
   para usar **Importar mídia** e espere. Não invente nomes de arquivo.
2. Se houver música, `vct.analyzeAudio('media/…')` e use o BPM e o offset sugeridos no grid.
3. Escolha o modelo e diga ao usuário em até 4 linhas o que vai montar.
4. Monte com `vct.plan([...], { label: 'Modelo …', dryRun: true })`, corrija os erros
   (eles listam os campos válidos) e rode de novo sem `dryRun`. Um passo de desfazer.
5. Confira com `vct.contactSheet({ show: true })` + um screenshot, depois `vct.hideSheet()`,
   e `vct.lint()`. Relate o resultado e o que o usuário pode trocar.

## Modelos

**Reels vertical (30 s, legenda, cortes no beat)**
- `composition.set` com `width 1080, height 1920, fps 30, duration 30, grid {bpm, offset}`.
- `track.create` Base e Títulos; `clip.place` por trecho com `startTime/endTime` em `bar:N.1`
  e `fit: 'cover'`; `audio.create` com a música.
- Título com `layer.create` (kind text, y perto de 1/4 da altura, dentro da área segura) e
  `text.animate` (in `slide-up`, out `fade`). Legenda: `text.fromSrt` se o usuário tiver o SRT.

**Loop de VJ (8 compassos no BPM)**
- `composition.set` com `duration` = 8 compassos (`bars:8` em segundos: 8 × 4 × 60/BPM) e o grid.
- Clipes alinhados a compassos; `fx.spike` (glitch ou cameraShake) em batidas fortes;
  `loop.seam` no fim para a emenda. Exportação com alpha: sequência PNG.

**Lower third**
- Faixa Títulos no topo; `layer.create` geometry (barra) + text (nome e função), y na faixa
  inferior da área segura; `text.animate` com `slide-up` e `fade`, 0,4 s.

**Slideshow de fotos**
- `clip.place` de cada imagem com a mesma duração (2 a 4 s, ou 1 compasso), `fit: 'cover'`;
  transição no clipe que entra com `clip.setTransition`; música com `audio.create`.

Não salve, não exporte e não importe pelo usuário: peça a ele.

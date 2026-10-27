---
name: vct-critique
description: Revisa a edição aberta no Noisetupi VCT (ritmo, hierarquia, legibilidade, safe area, transições) e propõe ajustes ordenados, sem aplicar nada. Use quando o usuário pedir revisão, crítica ou "o que melhorar" no vídeo do VCT.
---

# /vct-critique

1. `vct_get_timeline` e 3 a 5 `vct_capture_frame` (`maxWidth` 320): começo, cada transição e cada texto.
2. Avalie, citando tempo e clipe:
   - **ritmo:** cortes no tempo forte, trechos curtos demais (menos de 0,6 s) ou longos sem variação;
   - **hierarquia:** um foco por vez;
   - **texto:** pelo menos 1 s + 0,3 s por palavra, contraste e safe area;
   - **transições:** coerentes com o tom, duração adequada.
3. Proponha no máximo 5 mudanças, da maior para a menor, cada uma com o lote de comandos pronto, mas **não aplique**. Pergunte quais o usuário quer.

---
name: vct-edit
description: Edita o projeto aberto no Noisetupi Video Content Tool pelas ferramentas MCP vct_* (cortes, faixas, transições, textos, efeitos). Use quando o usuário pedir para editar, cortar, montar, legendar ou ajustar um vídeo no VCT.
---

# /vct-edit

Siga `agents/PROMPT.md` (fluxo, vocabulário e limites). Resumo:

1. `vct_connection_info`. Se não estiver conectado, mostre o link e o código ao usuário e espere.
2. `vct_describe`, uma vez por sessão. Depois `vct_get_timeline`.
3. Escreva o plano em até 5 linhas: trechos, transições, textos, tempos em segundos e no ritmo, se houver BPM.
4. `vct_dry_run`, corrija o que der erro e depois `vct_apply` com um `label` claro.
5. `vct_capture_frame` (`maxWidth` 360) em 2 ou 3 momentos-chave. Confira o texto legível, a safe area e as transições.
6. Relate o que mudou e onde, e lembre que Ctrl+Z desfaz o lote inteiro.

Não salve, exporte nem importe mídia: peça ao usuário. Não remova clipes sem dizer quais.

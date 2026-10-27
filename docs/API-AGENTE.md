# API do agente (window.vct)

Gerado do registro de comandos (`src/model/command-registry.ts`). É o mesmo texto que
`window.vct.describe()` devolve ao agente. Não edite à mão: rode
`DOCS_WRITE=1 npx vitest run tests/unit/api-docs.test.ts`.

```text
VCT API 1 · lote 1 a 500 comandos, tudo ou nada, um passo de desfazer
Métodos: guide describe more assets summary lint plan contactSheet assetSheet hideSheet analyzeMix analyzeAudio analyzeVideo getTimeline getProject query validate listCatalog dryRun dispatch batch undo redo captureFrame request status transcribe transcript onChange
Campos com ! são obrigatórios. Detalhe e exemplo: describe(tipo).
- Tempos em segundos da composição, alinhados a frames (frame dividido por fps).
- Fluxo curto: assets() e summary() para ler; clip.place para montar; dryRun ou plan com dryRun; batch ou plan; lint(); captureFrame para conferir.
- Keyframe: time em s da composição; com timeBase clip conta do início do clipe. O easing de um keyframe vale do key até o próximo; hold segura o valor e salta no próximo key.
- Tempos musicais: com grid definido (composition.set grid bpm), startTime endTime time duration e at aceitam bar:3.2, beat:14, bars:2 e beats:4.
- Efeitos de pós (rgbDelay noise glitch vhs cameraShake glow) usam ownerId __post__; os demais vão numa camada.
- Faixa visual: id da faixa é trackId do clipe ou o id do primeiro clipe. Índice 0 é o topo (desenhado por cima).
- Remoções pedem confirmação ao usuário no commit. dryRun não pede.
- Ids novos: curtos e legíveis. Ids derivados de corte e duplicação: novoId:audio:N e novoId:fx:N.
## mídia
clip.place layerId!:id asset!:string startTime!:number 0..7200 endTime:number 0..7200 duration:number 0.001..7200 trackId:id sourceIn:number 0..7200 playbackRate:number 0.05..8 fit:contain|cover|rotate-cover|none audio:linked|none name:string props:object | Põe uma mídia do bin na timeline num passo: tempo, trecho do arquivo, enquadramento e áudio vinculado. Sem endTime nem duration usa o resto do arquivo. Sem trackId cria faixa nova no topo.
layer.fit layerId!:id fit!:contain|cover|rotate-cover|none | Reenquadra imagem ou vídeo: contain (inteiro), cover (preenche), rotate-cover (gira 90 e preenche), none (tamanho real).
asset.add asset!:string metadata!:object | Registra uma mídia no bin (uso interno da importação; a IA não importa arquivos).
asset.remove asset!:string | Tira do bin uma mídia que não está em uso.
## camada
layer.create layerId!:id kind!:text|geometry|image|video|guide name!:string startTime!:number 0..7200 endTime!:number 0..7200 asset:string trackId:id props:object | Cria camada na faixa nova do topo (ou em trackId livre). image/video/guide exigem asset.
layer.set layerId!:id props!:object allowOverlap:boolean | Muda várias propriedades de uma camada de uma vez. Tempos checam ordem e duração da composição.
layer.setNumeric layerId!:id property!:string value!:number | Atalho de layer.set para uma propriedade numérica.
layer.setName layerId!:id name!:string | Renomeia a camada (1–200 caracteres).
layer.setText layerId!:id text!:string | Troca o texto de uma camada de texto (até 10000 caracteres).
## clipe
clip.move layerId!:id startTime!:number 0..7200 trackId:id allowOverlap:boolean | Move no tempo (e para trackId existente), com keyframes, fades e áudio vinculado.
clip.split layerId!:id time!:number 0..7200 newLayerId!:id sourceDuration:number 0.001..7200 | Corta num frame. Vídeo exige sourceOut definido e loop desligado, ou sourceDuration (duração do arquivo).
clip.duplicate layerId!:id startTime!:number 0..7200 newLayerId!:id | Copia o clipe (com áudio vinculado) para startTime, na mesma faixa se livre.
clip.paste clipboard!:object startTime!:number 0..7200 | Cola clipes copiados (formato de copyClips) a partir de startTime.
clip.remove layerId!:id ripple:boolean | Remove o clipe e o áudio vinculado; ripple fecha o espaço.
clip.setTransition layerId!:id transition!:object | Transição de entrada {type:dissolve|dip|wipe-right|wipe-left|push-left, duration} ou null.
## faixa
track.create trackId!:id kind!:video|audio name:string index:int 0..10000 | Cria faixa com nome (vazia até receber clipes). index 0 é o topo (vídeo) ou a primeira (áudio).
track.rename trackId!:id name!:string | Renomeia uma faixa.
track.remove trackId!:id | Remove uma faixa vazia.
track.reorder trackId!:id index!:int 0..10000 | Move a faixa visual para index (0 é o topo, desenhada por cima).
## keyframe
keyframe.upsert layerId!:id property!:string time!:number 0..7200 value!:number easing:linear|bezier|easeIn|easeOut|easeInOut|hold curve:number 0..1 timeBase:composition|clip | Cria ou atualiza keyframe. time em s da composição (ou do clipe com timeBase clip). easing vale do key até o próximo.
keyframe.toggle layerId!:id property!:string time!:number 0..7200 value!:number easing:linear|bezier|easeIn|easeOut|easeInOut|hold curve:number 0..1 timeBase:composition|clip | Liga/desliga o keyframe no tempo (remove se existir).
keyframe.set layerId!:id property!:string keys!:array timeBase:composition|clip | Substitui a trilha inteira de keyframes; lista vazia remove a animação.
effect.keyframe.upsert effectId!:id property!:string time!:number 0..7200 value!:number easing:linear|bezier|easeIn|easeOut|easeInOut|hold curve:number 0..1 timeBase:composition|clip | Keyframe de parâmetro de efeito (mesmas regras).
effect.keyframe.toggle effectId!:id property!:string time!:number 0..7200 value!:number easing:linear|bezier|easeIn|easeOut|easeInOut|hold curve:number 0..1 timeBase:composition|clip | Liga/desliga keyframe de parâmetro de efeito.
effect.keyframe.set effectId!:id property!:string keys!:array timeBase:composition|clip | Substitui a trilha de keyframes de um parâmetro de efeito.
## efeito
effect.add kind!:mirror|feedback|levels|kaleidoscope|blur|crop|edge|colorKey|lumaKey|chromaKey|animaTracer|rgbDelay|noise|glitch|vhs|cameraShake|glow ownerId!:id effectId!:id | Adiciona efeito. Efeitos de pós usam ownerId "__post__".
effect.setParam effectId!:id parameter!:string value!:number | Muda um parâmetro (veja listCatalog para nomes e limites; mix 0..1).
effect.set effectId!:id enabled:boolean name:string | Liga/desliga ou renomeia um efeito.
effect.reorder effectId!:id index!:int 0..1000 | Muda a posição do efeito na cadeia (0 é o primeiro).
effect.remove effectId!:id | Remove um efeito de camada ou de pós.
## áudio
audio.create trackId!:id asset!:string name!:string startTime!:number 0..7200 endTime!:number 0..7200 laneId:id props:object | Cria clipe de áudio a partir de uma mídia já importada (asset).
audio.set trackId!:id props!:object | Muda propriedades do clipe de áudio (volume 0..2, muted, tempos, fades).
audio.move trackId!:id startTime!:number 0..7200 laneId:id | Move o clipe de áudio no tempo e, com laneId, para outra faixa de áudio.
audio.link trackId!:id layerId:id | Vincula o áudio a um vídeo (segue tempos e cortes).
audio.unlink trackId!:id | Desvincula o áudio do vídeo para editar separado.
audio.remove trackId!:id | Remove um clipe de áudio.
audio.reorderLane laneId!:id index!:int 0..10000 | Move a faixa de áudio para index (0 é a primeira).
audioEffect.add trackId!:id kind!:lowpass|highpass|eq3|delay|compressor|reverb effectId!:id | Adiciona efeito de áudio ao clipe (trackId é o id do clipe de áudio).
audioEffect.setParam effectId!:id parameter!:string value!:number | Muda parâmetro de efeito de áudio.
audioEffect.set effectId!:id enabled!:boolean | Liga/desliga efeito de áudio.
audioEffect.reorder effectId!:id index!:int 0..1000 | Muda a posição do efeito de áudio na cadeia.
audioEffect.remove effectId!:id | Remove efeito de áudio.
## macro
loop.seam fade:number 0.04..10 trackId:id newLayerId:id | Costura de loop: cópia do plano de abertura entra em fade nos últimos fade s e termina no quadro em que o loop começa.
fx.stutter layerId!:id at!:number 0..7200 pattern!:string beat:number 0.05..10 newLayerId:id | Repete o trecho do vídeo que começa em at; pattern em tempos (1/2 1/4 …), flip espelha os próximos. Precisa de grid ou beat.
fx.strobe times!:array frames:int 1..30 color:color opacity:number 0..1 id:id | Flashes de tela cheia de frames frames em cada tempo de times. Mais de 3 por segundo é risco de fotossensibilidade.
fx.spike effect!:mirror|feedback|levels|kaleidoscope|blur|crop|edge|colorKey|lumaKey|chromaKey|animaTracer|rgbDelay|noise|glitch|vhs|cameraShake|glow at!:number 0..7200 dur:number 0.02..10 intensity:number 0..1 ownerId:id effectId:id parameter:string | Efeito sobe a intensity em at e volta a 0 em dur s (glitch, rgbDelay, cameraShake…). Efeito de camada exige ownerId.
text.animate layerId!:id in:fade|slide-up|pop|none out:fade|slide-up|pop|none duration:number 0.04..10 | Entrada e saída prontas (fade, slide-up, pop, none) como keyframes, com duration s cada.
text.fromSrt srt!:string trackId:id idPrefix:id props:object | Cria uma legenda de texto por bloco SRT numa faixa nova, acima da área de interface das redes.
## composição
composition.set props!:object resize:adapt|keep | Muda nome, tamanho, fps, duração, fundo ou transparência. resize: adapt|keep ao mudar tamanho.
## props layer
name:string text:string fontFamily:string fontSize:number 4..2000 fontWeight:number 100..900 align:left|center|right|start|end geometry:rectangle|ellipse|triangle|polygon|line asset:string fill:color stroke:color fillOpacity:number 0..1 strokeOpacity:number 0..1 strokeWidth:number 0..1000 fillEnabled:boolean strokeEnabled:boolean shadowColor:color shadowOpacity:number 0..1 shadowBlur:number 0..200 shadowX:number -500..500 shadowY:number -500..500 x:number -32768..32768 y:number -32768..32768 width:number 1..16384 height:number 1..16384 scaleX:number -20..20 scaleY:number -20..20 rotation:number -3600..3600 opacity:number 0..1 blendMode:normal|add|multiply|screen|lighten|darken visible:boolean locked:boolean exportable:boolean startTime:number 0..7200 endTime:number 0.001..7200 sourceIn:number 0..7200 sourceOut:number 0..7200 playbackRate:number 0.05..8 reverse:boolean loop:boolean fadeInStart:number 0..7200 fadeInEnd:number 0..7200 fadeOutStart:number 0..7200 fadeOutEnd:number 0..7200 scaleLocked:boolean sizeLocked:boolean
## props audio
name:string asset:string volume:number 0..2 muted:boolean startTime:number 0..7200 endTime:number 0.001..7200 sourceIn:number 0..7200 sourceOut:number 0..7200 playbackRate:number 0.05..8 reverse:boolean loop:boolean fadeInStart:number 0..7200 fadeInEnd:number 0..7200 fadeOutStart:number 0..7200 fadeOutEnd:number 0..7200
## props composition
name:string width:int 16..8192 height:int 16..8192 fps:int 1..240 duration:number 0.1..7200 background:color transparent:boolean workArea:object grid:object
Legenda automática: vct.transcribe começa na hora (Whisper local; o áudio não sai da máquina). Sem o modelo no navegador a pessoa vê o aviso de download. Confira status, leia o SRT com vct.transcript e aplique com text.fromSrt.
Limites: projeto aberto pela pessoa. Salvar, exportar, importar e abrir só com vct.request (a pessoa confirma na tela); depois confira vct.status().
Se a pessoa pausar o agente, batch plan dispatch undo redo e request falham até ela clicar em Retomar; leituras seguem.
```

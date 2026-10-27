// Guia embutido para agentes de IA que rodam no navegador (Claude in Chrome e
// similares) e executam JavaScript nesta aba. Devolvido por window.vct.guide().
export const AGENT_GUIDE = `# Noisetupi Video Content Tool — guia para agentes de IA

Você está no editor de vídeo Noisetupi VCT, aberto nesta aba. Edite o projeto
executando JavaScript na página com a API window.vct. Não clique na interface
para editar: a API é exata, desfazível e gasta muito menos tokens.

## Fluxo
1. window.vct.describe() — uma vez: texto curto com todos os comandos, campos
   (! obrigatório), limites e regras de tempo. Se terminar em "[continua",
   chame window.vct.more(). Detalhe e exemplo de um comando: describe("clip.move").
2. window.vct.getTimeline() — faixas, clipes (id, nome, tipo, início/fim em s),
   transições e áudio. Use esses ids; ids novos curtos e legíveis ("titulo").
3. Explique o plano ao usuário em poucas linhas.
4. window.vct.dryRun([...comandos]) — simula; corrija erros antes de aplicar.
5. window.vct.batch([...comandos], { label: "Cortes no ritmo" }) — até 500
   comandos, tudo ou nada, num único passo de desfazer com esse nome.
6. Para conferir, chame await window.vct.captureFrame({ time }) (move o playhead
   e renderiza) e tire um screenshot do preview em momentos-chave.
7. Ajuste com novos lotes; window.vct.undo() desfaz o último.
8. Para salvar, exportar ou importar use vct.request e confira vct.status().

## Regras do editor
- Tempos em segundos, alinhados a frames (frame / fps da composição).
- Uma faixa tem vários clipes sem sobreposição; a transição fica no clipe que
  entra (dissolve, dip, wipe-right, wipe-left, push-left). Com sobreposição, a
  duração da transição é a sobreposição.
- Remover clipes pede confirmação ao usuário.
- Propriedades: layer.set, audio.set (volume, mudo) e composition.set (duração,
  tamanho) mudam várias de uma vez.
- Salvar, exportar, importar e abrir dependem da pessoa: vct.request("save"),
  vct.request("export", { format: "mp4-h264", scale: 0.5 }) (format também
  "png-sequence"; scale 1, 0.75, 0.5 ou 0.25), vct.request("import", { message })
  e vct.request("open", { message }). A chamada volta na hora (a pessoa
  responde na tela, não espere): confira vct.status() de poucos em poucos
  segundos até aparecer done, refused ou failed. Peça uma vez só e diga à
  pessoa o que ela deve clicar.
- A pessoa pode pausar você pela faixa "IA editando" (botão Parar). Em pausa,
  batch, plan, dispatch, undo, redo e request falham com a mensagem "Pausado
  pelo usuário"; leituras seguem. Pare e peça que ela clique em Retomar.

## Legenda automática
- await window.vct.transcribe({ source: "mix", language: "pt", model: "base" })
  transcreve no navegador (Whisper local; o áudio não sai da máquina). source:
  "mix" (mixagem da timeline, padrão) ou o caminho de uma mídia do bin (veja
  vct.assets(); os tempos são os do arquivo). language: pt, en, es ou auto.
  model: base (rápido, 80 MB) ou small (preciso, 252 MB). Volta na hora.
- Se o modelo ainda não está neste navegador, a pessoa vê um aviso de download
  e decide: diga o que ela deve clicar e confira vct.status() de poucos em
  poucos segundos (baixando, transcrevendo, pronta, cancelada ou falhou).
- Pronta: vct.transcript() devolve o SRT em páginas (more()). Aplique com
  batch([{ type: "text.fromSrt", srt, idPrefix: "leg" }], { label: "Legenda
  automática" }). Os caracteres de pergunta, e comercial e igual saem em
  versão larga neste texto; a pessoa também pode usar o botão Inserir na
  timeline do diálogo, que usa o texto original.

## Motion design
- Corte no tempo forte: a 120 BPM, 1 tempo dura 0,5 s e 1 compasso 4/4 dura 2 s.
- Um foco por vez; título antes do apoio.
- Texto: 0,2–0,5 s de entrada; mínimo 1 s + 0,3 s por palavra na tela; até 2
  linhas; fonte ≥ 48 px em 1080×1920.
- Vertical 1080×1920: deixe livres 220 px no topo e 380 px na base (interface
  das redes).
- Dissolver 0,5–1 s entre planos; Empurrar/Cortina para mudar de assunto.

## VJ
- Quantize cortes ao beat (1/4 ou 1/8 de compasso). Loop de 8 compassos a
  128 BPM dura 15 s, ou 450 quadros a 30 fps.
`;

// Texto curto para o usuário colar no agente do navegador.
export function agentStarterPrompt(language: "pt-BR" | "en") {
  return language === "pt-BR"
    ? "Você está no Noisetupi Video Content Tool, um editor de vídeo aberto nesta aba. Para editar, execute JavaScript na página: primeiro rode window.vct.guide() e siga o guia (use window.vct.getTimeline, dryRun e batch; não clique na interface para editar). Meu pedido: "
    : "You are in the Noisetupi Video Content Tool, a video editor open in this tab. To edit, run JavaScript in the page: first run window.vct.guide() and follow the guide (use window.vct.getTimeline, dryRun and batch; do not click the interface to edit). My request: ";
}

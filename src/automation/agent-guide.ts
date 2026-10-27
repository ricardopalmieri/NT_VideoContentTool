// Guia embutido para agentes de IA que rodam no navegador (Claude in Chrome e
// similares) e executam JavaScript nesta aba. Devolvido por window.vct.guide().
export const AGENT_GUIDE = `# Noisetupi Video Content Tool — guia para agentes de IA

Você está no editor de vídeo Noisetupi VCT, aberto nesta aba. Edite o projeto
executando JavaScript na página com a API window.vct. Não clique na interface
para editar: a API é exata, desfazível e gasta muito menos tokens.

## Fluxo
1. window.vct.describe() — uma vez: comandos, campos e limites.
2. window.vct.getTimeline() — faixas, clipes (id, nome, tipo, início/fim em s),
   transições e áudio. Use esses ids; ids novos curtos e legíveis ("titulo").
3. Explique o plano ao usuário em poucas linhas.
4. window.vct.dryRun([...comandos]) — simula; corrija erros antes de aplicar.
5. window.vct.batch([...comandos], { label: "Cortes no ritmo" }) — aplica tudo
   ou nada, num único passo de desfazer (o usuário desfaz com Ctrl+Z).
6. Para conferir, chame await window.vct.captureFrame({ time }) (move o playhead
   e renderiza) e tire um screenshot do preview em momentos-chave.
7. Ajuste com novos lotes; window.vct.undo() desfaz o último.

## Regras do editor
- Tempos em segundos, alinhados a frames (frame / fps da composição).
- Uma faixa tem vários clipes sem sobreposição; a transição fica no clipe que
  entra (dissolve, dip, wipe-right, wipe-left, push-left). Com sobreposição, a
  duração da transição é a sobreposição.
- Remover clipes pede confirmação ao usuário.
- Você não importa mídia, não salva nem exporta: peça ao usuário (ele pode
  arrastar vários arquivos de uma vez para o editor).

## Motion design
- Corte no tempo forte: a 120 BPM, 1 tempo = 0,5 s; 1 compasso 4/4 = 2 s.
- Um foco por vez; título antes do apoio.
- Texto: 0,2–0,5 s de entrada; mínimo 1 s + 0,3 s por palavra na tela; até 2
  linhas; fonte ≥ 48 px em 1080×1920.
- Vertical 1080×1920: deixe livres 220 px no topo e 380 px na base (interface
  das redes).
- Dissolver 0,5–1 s entre planos; Empurrar/Cortina para mudar de assunto.

## VJ
- Quantize cortes ao beat (1/4 ou 1/8 de compasso). Loop de 8 compassos a
  128 BPM = 15 s = 450 quadros a 30 fps.
`;

// Texto curto para o usuário colar no agente do navegador.
export function agentStarterPrompt(language: "pt-BR" | "en") {
  return language === "pt-BR"
    ? "Você está no Noisetupi Video Content Tool, um editor de vídeo aberto nesta aba. Para editar, execute JavaScript na página: primeiro rode window.vct.guide() e siga o guia (use window.vct.getTimeline, dryRun e batch; não clique na interface para editar). Meu pedido: "
    : "You are in the Noisetupi Video Content Tool, a video editor open in this tab. To edit, run JavaScript in the page: first run window.vct.guide() and follow the guide (use window.vct.getTimeline, dryRun and batch; do not click the interface to edit). My request: ";
}

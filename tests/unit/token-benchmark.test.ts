// Benchmark reproduzível de tokens: a mesma tarefa de edição em três abordagens.
// Rode com: npm run benchmark:tokens  (BENCH_WRITE=1 grava docs/BENCHMARK-TOKENS.json)
//
// Estimativas (documentadas em docs/BENCHMARK-TOKENS.md):
// - texto: 1 token ≈ 4 caracteres de JSON;
// - imagem: tokens ≈ largura × altura / 750 (regra publicada pela Anthropic);
// - cada chamada de ferramenta custa ~60 tokens de envelope (nome, args, ids).
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createVctApi } from '../../src/automation/window-vct';
import { createLayer, createProject, type ProjectDocument } from '../../src/model/types';

const textTokens = (value: unknown) => Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / 4);
const imageTokens = (width: number, height: number) => Math.ceil(width * height / 750);
const CALL_OVERHEAD = 60;

// Tarefa: Reels de 30 s para aula. Um vídeo de 30 s cortado em 6 trechos no ritmo,
// transições entre eles, título e crédito. Depois, 2 rodadas de ajuste.
function startingProject(): ProjectDocument {
  const settings = { name: 'Aula Reels', width: 1080, height: 1920, fps: 30, duration: 30, background: '#000000', transparent: false };
  const project = createProject(settings);
  project.layers.push(createLayer('video', settings, {
    id: 'video', name: 'aula.mp4', asset: 'media/aula.mp4', startTime: 0, endTime: 30, sourceIn: 0, sourceOut: 30,
    fadeInStart: 0, fadeInEnd: 0, fadeOutStart: 30, fadeOutEnd: 30,
  }));
  return project;
}

const firstPass = [
  ...[5, 10, 15, 20, 25].map((time, index) => ({ type: 'clip.split', layerId: index ? `parte-${index}` : 'video', time, newLayerId: `parte-${index + 1}` })),
  ...[1, 2, 3, 4, 5].map((index) => ({ type: 'clip.setTransition', layerId: `parte-${index}`, transition: { type: 'dissolve', duration: .5 } })),
  { type: 'layer.create', layerId: 'titulo', kind: 'text', name: 'Título', startTime: 0, endTime: 4 },
  { type: 'layer.setText', layerId: 'titulo', text: 'Fotossíntese em 30 segundos' },
  { type: 'layer.create', layerId: 'credito', kind: 'text', name: 'Crédito', startTime: 26, endTime: 30 },
  { type: 'layer.setText', layerId: 'credito', text: 'Prof. Ana · Ciências 7º ano' },
];
const revisions = [
  [{ type: 'clip.setTransition', layerId: 'parte-3', transition: { type: 'push-left', duration: .5 } },
    { type: 'layer.setNumeric', layerId: 'titulo', property: 'y', value: 420 }],
  [{ type: 'layer.setText', layerId: 'credito', text: 'Prof. Ana · Ciências · 7º ano B' },
    { type: 'clip.remove', layerId: 'parte-5', ripple: true }],
];

function measure() {
  let project = startingProject();
  const api = createVctApi({
    getProject: () => project, keyframeTolerance: () => 1 / 60, confirmConsequential: () => true,
    commitProject: (next) => { project = next; },
  });
  const thumbnail = imageTokens(270, 480);
  const screenshot = imageTokens(1366, 768);
  const rounds = [firstPass, ...revisions];

  // A — VCT via MCP: describe uma vez; por rodada: timeline compacta, lote, resultado, 1 miniatura.
  let vctMcp = CALL_OVERHEAD + textTokens(api.describe());
  // B — só prompts: a IA lê o projeto inteiro (.ntvct) e o reescreve a cada rodada.
  let fullProjectRewrite = 0;
  // C — agente de interface: ~3 ações com screenshot (1366×768) por comando.
  let guiScreenshots = 0;

  for (const commands of rounds) {
    vctMcp += CALL_OVERHEAD + textTokens(api.getTimeline());
    const projectBefore = textTokens(project);
    const results = api.batch(commands as unknown as Parameters<typeof api.batch>[0], { label: 'benchmark' });
    vctMcp += CALL_OVERHEAD + textTokens(commands) + textTokens(results) + CALL_OVERHEAD + thumbnail;
    fullProjectRewrite += projectBefore + textTokens(project);
    guiScreenshots += commands.length * 3 * (screenshot + CALL_OVERHEAD);
  }
  return {
    task: 'Reels 30 s: 6 trechos com transições, título e crédito + 2 rodadas de ajuste',
    commands: rounds.reduce((sum, round) => sum + round.length, 0),
    projectJsonTokens: textTokens(project),
    tokens: { vctMcp, fullProjectRewrite, guiScreenshots },
    ratio: { vsFullProjectRewrite: +(fullProjectRewrite / vctMcp).toFixed(1), vsGuiScreenshots: +(guiScreenshots / vctMcp).toFixed(1) },
  };
}

it('VCT via MCP gasta menos tokens que reescrever o projeto ou operar a interface por screenshots', () => {
  const report = measure();
  console.log(JSON.stringify(report));
  if (process.env.BENCH_WRITE) writeFileSync('docs/BENCHMARK-TOKENS.json', `${JSON.stringify(report, null, 2)}\n`);
  expect(report.tokens.vctMcp).toBeLessThan(report.tokens.fullProjectRewrite);
  expect(report.tokens.vctMcp).toBeLessThan(report.tokens.guiScreenshots);
});

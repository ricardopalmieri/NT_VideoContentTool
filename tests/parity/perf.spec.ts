import { expect, test } from '@playwright/test';

// Benchmark do renderer (R7): ms por quadro de uma composição 1080x1920 com várias
// camadas estáticas e duas animadas. Só registra números; o limite é folgado para
// não ficar instável em máquinas lentas (SwiftShader em CI).
test.describe.configure({ mode: 'serial' });

const BASE_URL = process.env.VCT_PERF_URL || 'http://127.0.0.1:4174/current/';

test('render 1080x1920 com camadas estáticas e animadas: ms por quadro', async ({ browser }) => {
  test.setTimeout(55_000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  try {
    await page.goto(BASE_URL);
    await page.locator('[data-language="pt-BR"]').click();
    await page.locator('#new-project').click();
    for (const [name, value] of Object.entries({ name: 'Perf', width: '1080', height: '1920', fps: '30', duration: '4' })) {
      await page.locator(`#setup-form [name="${name}"]`).fill(value);
    }
    await page.locator('#setup-form button[type="submit"]').click();
    await page.locator('#preview-quality').selectOption('1');
    await page.evaluate(async () => { await document.fonts.ready; });

    const report = await page.evaluate(async () => {
      const vct = window.vct;
      const commands: Array<Record<string, unknown>> = [];
      const shapes = ['rectangle', 'ellipse', 'triangle', 'polygon'];
      // Quatro textos e quatro formas estáticas, cada uma na sua faixa.
      for (let i = 0; i < 4; i++) {
        commands.push({ type: 'layer.create', layerId: `texto${i}`, kind: 'text', name: `Texto ${i}`, startTime: 0, endTime: 4,
          props: { text: `Camada estática ${i}`, y: 200 + i * 160, fontSize: 90, fill: '#f0f0e0', shadowColor: '#000000', shadowBlur: 18 } });
        commands.push({ type: 'layer.create', layerId: `forma${i}`, kind: 'geometry', name: `Forma ${i}`, startTime: 0, endTime: 4,
          props: { geometry: shapes[i], x: 200 + i * 220, y: 1200 + (i % 2) * 300, width: 260, height: 260, fill: ['#e04050', '#40a0e0', '#50d080', '#e0c040'][i], strokeEnabled: true, stroke: '#ffffff', strokeWidth: 6 } });
      }
      // Uma estática com efeito (levels) para exercitar o caminho com shader.
      commands.push({ type: 'effect.add', kind: 'levels', ownerId: 'forma0', effectId: 'perf_levels' });
      // Duas animadas.
      commands.push({ type: 'layer.create', layerId: 'move', kind: 'geometry', name: 'Move', startTime: 0, endTime: 4,
        props: { geometry: 'ellipse', y: 960, width: 200, height: 200, fill: '#ff8040' } });
      commands.push({ type: 'keyframe.set', layerId: 'move', property: 'x', keys: [{ time: 0, value: 100 }, { time: 4, value: 980 }] });
      commands.push({ type: 'layer.create', layerId: 'gira', kind: 'text', name: 'Gira', startTime: 0, endTime: 4,
        props: { text: 'GIRA', y: 760, fontSize: 160, fill: '#ffffff' } });
      commands.push({ type: 'keyframe.set', layerId: 'gira', property: 'rotation', keys: [{ time: 0, value: 0 }, { time: 4, value: 360 }] });
      vct.batch(commands as never, { label: 'Perf' });

      const times = Array.from({ length: 5 }, (_, i) => i / 30 + 0.05);
      // FNV-1a do JPEG inteiro: serve para conferir que otimizações não mudam pixels.
      const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16); };
      const frame = async (time: number) => (await vct.captureFrame({ time, maxWidth: 96 })).dataUrl;
      // Aquecimento: fontes, JIT e a primeira alocação de texturas (SwiftShader leva segundos).
      await frame(times[0]);

      const rounds: number[] = [];
      const hashes: string[] = [];
      for (let round = 0; round < 2; round++) {
        const start = performance.now();
        for (const time of times) {
          const url = await frame(time);
          if (round === 0) hashes.push(hash(url));
        }
        rounds.push((performance.now() - start) / times.length);
      }
      // Determinismo: o mesmo instante, duas vezes, dá o mesmo quadro (com ou sem cache).
      const first = await frame(1.05);
      await frame(0.2);
      const second = await frame(1.05);
      // Editar uma layer parada invalida a textura em cache; desfazer volta ao quadro original.
      vct.dispatch({ type: 'layer.set', layerId: 'forma1', props: { fill: '#00ff00' } } as never);
      const edited = await frame(1.05);
      vct.undo();
      const reverted = await frame(1.05);
      return { rounds, hashes, deterministic: first === second, invalidated: edited !== first, reverted: reverted === first, layers: vct.getProject().layers.length };
    });

    const best = Math.min(...report.rounds);
    console.log(`PERF ms/quadro (2 rodadas de 5): ${report.rounds.map((v) => v.toFixed(1)).join(' · ')} · melhor ${best.toFixed(1)}`);
    console.log(`PERF hashes: ${report.hashes.join(',')}`);
    expect(report.layers).toBe(10);
    expect(report.deterministic).toBe(true);
    expect(report.invalidated).toBe(true);
    expect(report.reverted).toBe(true);
    expect(best).toBeLessThan(15_000);
  } finally {
    await context.close();
  }
});

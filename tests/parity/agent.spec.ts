import { expect, test } from '@playwright/test';

// The agent never clicks to edit: after the person opens a project, every edit,
// read and review goes through window.vct.
test('agente edita só por window.vct: montar, revisar, desfazer', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  try {
    await page.goto('http://127.0.0.1:4174/current/');
    await page.locator('[data-language="pt-BR"]').click();
    await page.locator('#new-project').click();
    for (const [name, value] of Object.entries({ name: 'Agente', width: '320', height: '568', fps: '30', duration: '4' })) {
      await page.locator(`#setup-form [name="${name}"]`).fill(value);
    }
    await page.locator('#setup-form button[type="submit"]').click();

    const report = await page.evaluate(async () => {
      const vct = window.vct;
      let describe = vct.describe() as string;
      while (describe.endsWith('[continua: vct.more()]')) describe = describe.replace('\n[continua: vct.more()]', '') + vct.more();
      // Musical times (bar:beat) are strings the parser converts; the TS types only list numbers.
      const batches: unknown = [
        [
          { type: 'composition.set', props: { duration: 8, grid: { bpm: 120 } } },
          { type: 'track.create', trackId: 'base', kind: 'video', name: 'Base' },
          { type: 'track.create', trackId: 'titulos', kind: 'video', name: 'Títulos', index: 0 },
        ],
        [
          { type: 'layer.create', layerId: 'fundo', kind: 'geometry', name: 'Fundo', startTime: 0, endTime: 'bar:5.1', trackId: 'base', props: { fill: '#203040' } },
          { type: 'layer.create', layerId: 'titulo', kind: 'text', name: 'Título', startTime: 'bar:1.1', endTime: 'bar:3.1', trackId: 'titulos', props: { text: 'Olá', y: 284 } },
          { type: 'text.animate', layerId: 'titulo', in: 'slide-up', out: 'fade' },
          { type: 'fx.spike', effect: 'glitch', at: 'beat:4', dur: .25, intensity: .6 },
        ],
      ];
      const plan = vct.plan(batches as never, { label: 'Montagem do agente' });
      const summary = vct.summary();
      const lint = vct.lint();
      const frame = await vct.captureFrame({ time: 1, maxWidth: 160 });
      const undone = vct.undo();
      const afterUndo = vct.summary();
      vct.redo();
      return { describeLength: describe.length, unsafe: /[?&=]/.test(describe + summary + lint), summary, lint, frameWidth: frame.width, undone, afterUndo, plan: plan.results.length };
    });

    expect(report.unsafe).toBe(false);
    expect(report.describeLength).toBeGreaterThan(2000);
    expect(report.plan).toBe(2);
    expect(report.summary).toContain('Títulos [titulos]: 0-4 titulo');
    expect(report.summary).toContain('Base [base]: 0-8 fundo');
    expect(report.summary).toContain('pós: glitch_spike_2000 glitch');
    expect(report.frameWidth).toBe(160);
    expect(report.undone).toBe(true);
    expect(report.afterUndo).not.toContain('titulo');
  } finally {
    await context.close();
  }
});

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

// A pessoa vê quando a IA edita, pode parar, e decide o que a IA salva ou exporta.
test('faixa IA editando: parar bloqueia edições, pedidos esperam a pessoa', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4174/current/');
    await page.locator('[data-language="pt-BR"]').click();
    await page.locator('#new-project').click();
    await page.locator('#setup-form button[type="submit"]').click();
    await page.evaluate(() => window.vct.batch([{ type: 'layer.create', layerId: 'oi', kind: 'text', name: 'Oi', startTime: 0, endTime: 1 }] as never, { label: 'Texto da IA' }));
    const strip = page.locator('.agent-strip-row').first();
    await expect(strip).toContainText('Texto da IA');
    await page.screenshot({ path: info.outputPath('faixa.png') });
    await page.locator('[data-agent-action="stop"]').click();
    const blocked = await page.evaluate(() => {
      try { window.vct.batch([{ type: 'layer.setName', layerId: 'oi', name: 'x' }] as never); return 'passou'; } catch (error) { return (error as Error).message; }
    });
    expect(blocked).toContain('Pausado pelo usuário');
    expect(await page.evaluate(() => window.vct.summary())).toContain('oi');
    await page.locator('[data-agent-action="resume"]').click();

    const answer = await page.evaluate(() => window.vct.request('import', { message: '<b>Importe</b> a trilha' }));
    expect(answer).not.toMatch(/[?&=]/);
    const request = page.locator('.agent-strip-row.is-request');
    await expect(request).toContainText('<b>Importe</b> a trilha');
    // O script do agente não consegue aprovar o próprio pedido.
    await page.evaluate(() => document.querySelector<HTMLElement>('.agent-strip-row.is-request button')?.click());
    expect(await page.evaluate(() => window.vct.status())).toMatch(/import/i);
    await expect(request).toBeVisible();
  } finally {
    await context.close();
  }
});

import { expect, test, type Browser, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

type Vct = {
  batch(commands: unknown[], options?: { label?: string }): unknown[];
  getProject(): { layers: Array<{ id: string; text?: string; fontSize?: number; align?: string; shadowColor?: string; shadowOpacity?: number; shadowBlur?: number; keyframes: Record<string, unknown[]>; effects: Array<{ kind: string }> }>; settings: { duration: number } };
};
const getLayers = (page: Page) => page.evaluate(() => (window as unknown as { vct: Vct }).vct.getProject().layers);

async function openEditor(browser: Browser, options: { viewport?: { width: number; height: number }; touch?: boolean } = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, hasTouch: options.touch, deviceScaleFactor: 1, acceptDownloads: true });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.goto('http://127.0.0.1:4174/current/');
  await page.locator('[data-language="pt-BR"]').click();
  await page.locator('#new-project').click();
  for (const [name, value] of Object.entries({ name: 'Texto', width: '640', height: '360', fps: '10', duration: '4' })) {
    await page.locator(`#setup-form [name="${name}"]`).fill(value);
  }
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator('#composition-canvas')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  return { context, page };
}

async function addTitle(page: Page, text = 'Ola') {
  await page.evaluate((value) => {
    const api = (window as unknown as { vct: Vct }).vct;
    api.batch([{ type: 'layer.create', layerId: 'titulo', kind: 'text', name: 'Titulo', startTime: 0, endTime: 3, props: { text: value, x: 320, y: 180, width: 400, height: 120, fontSize: 60 } }], { label: 'Titulo' });
  }, text);
  await page.locator('.layer-item [data-select-layer]').filter({ hasText: 'Titulo' }).click();
  await expect(page.locator('[data-layer-text="text"]')).toBeVisible();
}

async function numeric(page: Page, property: string, value: number) {
  const input = page.locator(`[data-layer-property="${property}"]`);
  await input.dblclick();
  await input.fill(String(value));
  await input.press('Enter');
}

test('texto no canvas: duplo clique edita, Ctrl+Enter confirma, Esc cancela e desfazer restaura', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await addTitle(page);
    const editor = page.locator('.text-inline-editor');
    await page.locator('#composition-canvas').dblclick();
    await expect(editor).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Novo');
    await page.keyboard.press('Enter');
    await page.keyboard.type('texto');
    expect((await getLayers(page))[0].text).toBe('Novo\ntexto');
    await expect(page.locator('[data-layer-text="text"]')).toHaveValue('Novo\ntexto');
    await page.keyboard.press('Control+Enter');
    await expect(editor).toHaveCount(0);
    expect((await getLayers(page))[0].text).toBe('Novo\ntexto');

    await page.locator('body').press('Control+z');
    expect((await getLayers(page))[0].text).toBe('Ola');

    // Esc volta ao texto de antes sem deixar passo no histórico.
    await page.locator('#composition-canvas').dblclick();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Descartado');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    expect((await getLayers(page))[0].text).toBe('Ola');

    // Clicar fora confirma.
    await page.locator('#composition-canvas').dblclick();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Fora');
    await page.locator('.panel-title').first().click();
    await expect(editor).toHaveCount(0);
    expect((await getLayers(page))[0].text).toBe('Fora');
  } finally {
    await context.close();
  }
});

test('sombra e estilos do texto: ligar sombra, salvar, aplicar e excluir um estilo', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await addTitle(page);
    await page.locator('[data-text-align="left"]').click();
    expect((await getLayers(page))[0].align).toBe('left');

    await expect(page.locator('.shadow-fields')).toBeHidden();
    await page.locator('[data-shadow-toggle]').check();
    await expect(page.locator('.shadow-fields')).toBeVisible();
    let layer = (await getLayers(page))[0];
    expect(layer.shadowColor).toBe('#000000');
    expect(layer.shadowOpacity).toBeGreaterThan(0);
    await page.locator('[data-shadow-color]').fill('#ff0000');
    await numeric(page, 'shadowBlur', 20);
    layer = (await getLayers(page))[0];
    expect(layer.shadowColor).toBe('#ff0000');
    expect(layer.shadowBlur).toBe(20);

    await page.locator('[data-text-style-name]').fill('Meu estilo');
    await page.locator('[data-text-style-save]').click();
    await expect(page.locator('[data-text-style-list] option')).toHaveText(['Meu estilo']);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nt-vct-text-styles') || '[]'));
    expect(stored).toHaveLength(1);
    expect(stored[0].props).toMatchObject({ fontSize: 60, shadowBlur: 20, shadowColor: '#ff0000', align: 'left' });

    await numeric(page, 'fontSize', 30);
    await page.locator('[data-shadow-toggle]').uncheck();
    expect((await getLayers(page))[0]).toMatchObject({ fontSize: 30, shadowOpacity: 0 });
    await page.locator('[data-text-style-apply]').click();
    layer = (await getLayers(page))[0];
    expect(layer).toMatchObject({ fontSize: 60, shadowBlur: 20, shadowColor: '#ff0000' });
    expect(layer.shadowOpacity).toBeGreaterThan(0);
    // Aplicar é um passo só.
    await page.locator('body').press('Control+z');
    expect((await getLayers(page))[0]).toMatchObject({ fontSize: 30, shadowOpacity: 0 });

    await page.locator('[data-text-style-delete]').click();
    await expect(page.locator('[data-text-style-apply]')).toBeDisabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nt-vct-text-styles') || '[]'))).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test('Animação do inspector aplica text.animate e cria keyframes de opacidade', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await addTitle(page);
    expect((await getLayers(page))[0].keyframes.opacity ?? []).toHaveLength(0);
    await page.locator('[data-anim-in]').selectOption('fade');
    await page.locator('[data-anim-out]').selectOption('slide-up');
    await page.locator('[data-anim-duration]').fill('0.5');
    await page.locator('[data-anim-apply]').click();
    const layer = (await getLayers(page))[0];
    expect(layer.keyframes.opacity).toHaveLength(4);
    expect(layer.keyframes.y).toHaveLength(2);
    await page.locator('body').press('Control+z');
    expect((await getLayers(page))[0].keyframes.opacity ?? []).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test('Importar legendas (SRT) cria um clipe por fala num só passo e informa a contagem', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    const srt = '1\n00:00:00,500 --> 00:00:01,500\nPrimeira\n\n2\n00:00:01,600 --> 00:00:02,400\nSegunda\n\n3\n00:00:02,500 --> 00:00:03,500\nTerceira\n';
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-import-srt]').click();
    await (await chooser).setFiles({ name: 'falas.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
    await expect(page.locator('#status-text')).toContainText('LEGENDAS · 3 IMPORTADAS');
    const layers = await getLayers(page);
    expect(layers.map((layer) => layer.text)).toEqual(['Primeira', 'Segunda', 'Terceira']);
    await page.locator('body').press('Control+z');
    expect(await getLayers(page)).toHaveLength(0);

    // Texto sem falas válidas vai para a barra de status.
    const again = page.waitForEvent('filechooser');
    await page.locator('[data-import-srt]').click();
    await (await again).setFiles({ name: 'vazio.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:09,000 --> 00:00:10,000\nFora\n') });
    await expect(page.locator('#status-text')).toContainText('Nenhuma legenda válida');
  } finally {
    await context.close();
  }
});

test('botão de avisos aparece com flashes em excesso e o painel leva ao problema', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await expect(page.locator('#open-warnings')).toHaveCount(0);
    await page.evaluate(() => {
      (window as unknown as { vct: Vct }).vct.batch([{ type: 'fx.strobe', times: [0.5, 0.7, 0.9, 1.1, 1.3], frames: 1 }], { label: 'Strobe' });
    });
    const button = page.locator('#open-warnings');
    await expect(button).toBeVisible();
    await expect(button).toHaveClass(/has-errors/);
    await button.click();
    const panel = page.locator('#warnings-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.is-error')).toContainText(['flashes em 1 s']);
    await panel.locator('.is-error').first().click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.layer-item.is-selected')).toHaveCount(1);
    await expect(page.locator('.time-display')).toContainText('00:00.50');
    // Desfazer tira os avisos da barra.
    await page.locator('body').press('Control+z');
    await expect(page.locator('#open-warnings')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('Luma key aparece na aba Efeitos, entra na camada e mostra seus parâmetros', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await addTitle(page);
    await page.locator('[data-left-tab="effects"]').click();
    await expect(page.locator('[data-add-effect="lumaKey"]')).toBeVisible();
    await expect(page.locator('[data-add-effect="chromaKey"]')).toBeVisible();
    await page.locator('[data-add-effect="lumaKey"]').click();
    expect((await getLayers(page))[0].effects.map((effect) => effect.kind)).toEqual(['lumaKey']);
    await expect(page.locator('[data-effect-param="threshold"]')).toBeVisible();
    await expect(page.locator('[data-effect-param="softness"]')).toBeVisible();
    await expect(page.locator('[data-effect-param="invert"]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('tablet 1024x1366: importar e colocar mídia, editar texto no inspector e abrir avisos por toque', async ({ browser }) => {
  const { context, page } = await openEditor(browser, { viewport: { width: 1024, height: 1366 }, touch: true });
  try {
    const openLibrary = async () => {
      const toggle = page.locator('#toggle-library');
      if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.tap();
    };
    await openLibrary();
    const png = PNG.sync.write(new PNG({ width: 4, height: 4 }));
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-bin-import]').first().tap();
    await (await chooser).setFiles([{ name: 'foto.png', mimeType: 'image/png', buffer: png }]);
    await expect(page.locator('[data-bin-asset]')).toHaveCount(1);
    await page.locator('[data-bin-asset]').tap();
    await page.locator('[data-bin-place="new-track"]').tap();
    await expect(page.locator('[data-move-layer-clip]')).toHaveCount(1);

    await addTitle(page);
    await page.locator('[data-layer-text="text"]').fill('Tablet');
    await page.locator('[data-layer-text="text"]').blur();
    expect((await getLayers(page)).find((layer) => layer.id === 'titulo')?.text).toBe('Tablet');

    // Novos controles têm alvo de toque de pelo menos 44 px.
    for (const selector of ['[data-text-align="left"]', '[data-text-style-save]', '[data-anim-apply]', '[data-shadow-toggle]']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = await page.locator(selector).boundingBox();
      expect(box?.height, selector).toBeGreaterThanOrEqual(22);
      const target = await page.locator(selector).evaluate((element) => {
        const rect = (element.closest('label') || element).getBoundingClientRect();
        return Math.max(rect.height, element.getBoundingClientRect().height);
      });
      expect(target, selector).toBeGreaterThanOrEqual(44);
    }

    // Duplo toque no texto abre a edição no canvas.
    const canvas = await page.locator('#composition-canvas').boundingBox();
    if (!canvas) throw new Error('canvas sem caixa');
    const point = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    await page.touchscreen.tap(point.x, point.y);
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator('.text-inline-editor')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      (window as unknown as { vct: Vct }).vct.batch([{ type: 'fx.strobe', times: [0.5, 0.7, 0.9, 1.1, 1.3], frames: 1 }], { label: 'Strobe' });
    });
    const warnings = page.locator('#open-warnings');
    await expect(warnings).toBeVisible();
    expect((await warnings.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await warnings.tap();
    await expect(page.locator('#warnings-panel')).toBeVisible();
    await expect(page.locator('#warnings-panel .is-error').first()).toBeVisible();
  } finally {
    await context.close();
  }
});

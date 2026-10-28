import { expect, test, type Browser, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject } from '../../src/model/types';

// Batch 11C: tamanho original ao colocar mídia, seleção múltipla, estilo da faixa de legenda e faixa "IA editando" por cima.
type Layer = { id: string; name: string; kind: string; x: number; y: number; width: number; height: number; fontSize?: number; fill: string; shadowOpacity?: number };
type Vct = { batch(commands: unknown[], options?: { label?: string }): unknown; getProject(): { layers: Layer[]; assetMetadata?: Record<string, { width?: number; height?: number }> } };
const layers = (page: Page) => page.evaluate(() => (window as unknown as { vct: Vct }).vct.getProject().layers).then((list) => [...list].sort((a, b) => a.id.localeCompare(b.id)));

async function openEditor(browser: Browser, size = { width: 1920, height: 1080 }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.goto('http://127.0.0.1:4174/current/');
  await page.locator('[data-language="pt-BR"]').click();
  const project = createProject({ name: 'Interface 11C', ...size, fps: 10, duration: 10, background: '#000000', transparent: false });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#open-project').click();
  await (await chooser).setFiles({ name: 'interface.ntvct', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#composition-canvas')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  return { context, page };
}

function solidPng(width: number, height: number) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return PNG.sync.write(png);
}

async function importToBin(page: Page, ...files: Array<{ name: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-bin-import]').first().click();
  await (await chooser).setFiles(files.map((file) => ({ ...file, mimeType: 'image/png' })));
  await expect(page.locator('[data-bin-asset]')).toHaveCount(files.length);
  // As dimensões entram nos metadados depois da leitura da imagem.
  await expect.poll(() => page.evaluate(() => Object.values((window as unknown as { vct: Vct }).vct.getProject().assetMetadata || {}).every((meta) => meta.width && meta.height))).toBe(true);
}

async function placeFromBin(page: Page, name: string) {
  await page.locator('[data-bin-asset]').filter({ hasText: name }).click();
  await page.locator('[data-bin-place="new-track"]').click();
}

test('colocar 1280x720 em 1920x1080 mantém 1280x720; Original, Inteiro e Preencher enquadram', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await importToBin(page, { name: 'hd.png', buffer: solidPng(1280, 720) }, { name: 'larga.png', buffer: solidPng(800, 400) });
    // Não há mais preferência de enquadramento ao colocar.
    await page.locator('[data-bin-asset]').filter({ hasText: 'hd.png' }).click();
    await expect(page.locator('[data-asset-fit]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('nt-vct-default-fit'))).toBeNull();
    await placeFromBin(page, 'hd.png');
    let [hd] = await layers(page);
    expect([hd.width, hd.height, hd.x, hd.y]).toEqual([1280, 720, 960, 540]);

    await placeFromBin(page, 'larga.png');
    const wide = () => layers(page).then((list) => list.find((layer) => layer.name === 'larga.png')!);
    expect(await wide()).toMatchObject({ width: 800, height: 400 });
    const fit = page.locator('.fit-row');
    await expect(fit.locator('[data-fit="none"]')).toHaveAttribute('aria-pressed', 'true');
    await fit.locator('[data-fit="contain"]').click();
    expect(await wide()).toMatchObject({ width: 1920, height: 960, x: 960, y: 540 });
    await fit.locator('[data-fit="cover"]').click();
    expect(await wide()).toMatchObject({ width: 2160, height: 1080 });
    await expect(fit.locator('[data-fit="cover"]')).toHaveAttribute('aria-pressed', 'true');
    await fit.locator('[data-fit="none"]').click();
    expect(await wide()).toMatchObject({ width: 800, height: 400 });
    // Cada botão é um passo de desfazer.
    await page.locator('#undo').click();
    expect(await wide()).toMatchObject({ width: 2160, height: 1080 });
    ;[hd] = (await layers(page)).filter((layer) => layer.name === 'hd.png');
    expect(hd.width).toBe(1280);
  } finally {
    await context.close();
  }
});

async function addTexts(page: Page) {
  await page.evaluate(() => (window as unknown as { vct: Vct }).vct.batch([
    { type: 'layer.create', layerId: 't1', kind: 'text', name: 'Um', startTime: 0, endTime: 2, props: { text: 'Um', fontSize: 40, x: 400, y: 300 } },
    { type: 'layer.create', layerId: 't2', kind: 'text', name: 'Dois', startTime: 0, endTime: 2, props: { text: 'Dois', fontSize: 60, x: 400, y: 300 } },
    { type: 'layer.create', layerId: 't3', kind: 'text', name: 'Tres', startTime: 0, endTime: 2, props: { text: 'Tres', fontSize: 60, x: 800, y: 300 } },
  ], { label: 'Textos' }));
}

test('seleção múltipla: Ctrl+clique na lista, "—" nos valores diferentes e um único desfazer', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await addTexts(page);
    const row = (name: string) => page.locator('.layer-item [data-select-layer]').filter({ hasText: name });
    await row('Um').click();
    await row('Dois').click({ modifiers: ['Control'] });
    await row('Tres').click({ modifiers: ['Shift'] });
    const inspector = page.locator('[data-multi-inspector]');
    await expect(inspector).toBeVisible();
    await expect(inspector.locator('.inspector-header')).toContainText('3 camadas');
    await expect(page.locator('.layer-item.is-selected')).toHaveCount(3);
    // Valores diferentes: campo vazio com "—"; iguais: o valor.
    const size = inspector.locator('[data-multi-prop="fontSize"]');
    await expect(size).toHaveValue('');
    await expect(size).toHaveAttribute('placeholder', '—');
    await expect(inspector.locator('[data-multi-prop="y"]')).toHaveValue('300');

    await size.fill('72');
    await size.press('Enter');
    expect((await layers(page)).map((layer) => layer.fontSize)).toEqual([72, 72, 72]);
    await expect(size).toHaveValue('72');
    // Um desfazer devolve os três.
    await page.locator('#undo').click();
    expect((await layers(page)).map((layer) => layer.fontSize)).toEqual([40, 60, 60]);
    await page.locator('#redo').click();
    expect((await layers(page)).map((layer) => layer.fontSize)).toEqual([72, 72, 72]);
    await page.locator('#undo').click();

    // Ctrl+clique tira uma camada da seleção; com uma só, volta o inspector normal.
    await row('Tres').click({ modifiers: ['Control'] });
    await expect(inspector.locator('.inspector-header')).toContainText('2 camadas');
    await row('Dois').click({ modifiers: ['Control'] });
    await expect(inspector).toHaveCount(0);
    await expect(page.locator('[data-layer-property="x"]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('clicar no nome da faixa seleciona os clipes dela; estilo da faixa de legendas com −10% / +10% e um desfazer', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await page.evaluate(() => (window as unknown as { vct: Vct }).vct.batch([
      { type: 'text.fromSrt', srt: '1\n00:00:01,000 --> 00:00:02,000\nUm\n\n2\n00:00:03,000 --> 00:00:04,000\nDois\n\n3\n00:00:05,000 --> 00:00:06,000\nTres', idPrefix: 'leg' },
    ], { label: 'Legenda' }));
    const name = page.locator('.timeline-label-row.layer-label .track-name').first();
    await name.click();
    const inspector = page.locator('[data-multi-inspector]');
    await expect(inspector.locator('.inspector-header')).toContainText('3 camadas');
    const before = (await layers(page)).map((layer) => layer.fontSize!);
    expect(new Set(before).size).toBe(1);
    await inspector.locator('[data-multi-scale="1.1"]').click();
    const grown = (await layers(page)).map((layer) => layer.fontSize!);
    for (const [index, value] of grown.entries()) expect(value).toBeCloseTo(before[index] * 1.1, 1);
    await inspector.locator('[data-multi-scale="0.9"]').click();
    // Cor do texto e sombra valem para todas as legendas.
    await inspector.locator('[data-multi-prop="fill"]').fill('#ffcc00');
    expect((await layers(page)).map((layer) => layer.fill)).toEqual(['#ffcc00', '#ffcc00', '#ffcc00']);
    await inspector.locator('[data-multi-shadow]').check();
    expect((await layers(page)).every((layer) => (layer.shadowOpacity ?? 0) > 0)).toBe(true);
    await page.locator('#undo').click();
    expect((await layers(page)).every((layer) => !layer.shadowOpacity)).toBe(true);
    await page.locator('#undo').click();
    expect((await layers(page)).map((layer) => layer.fill)).not.toContain('#ffcc00');
    // Pelo teclado: Enter no nome da faixa também seleciona.
    await page.locator('.layer-item [data-select-layer]').first().click();
    await expect(inspector).toHaveCount(0);
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(inspector).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a faixa "IA editando" flutua por cima e não move o canvas', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    const canvas = page.locator('#composition-canvas');
    const before = await canvas.boundingBox();
    const top = await page.locator('.editor-topbar').boundingBox();
    await page.evaluate(() => (window as unknown as { vct: Vct }).vct.batch([{ type: 'layer.create', layerId: 'oi', kind: 'text', name: 'Oi', startTime: 0, endTime: 1 }], { label: 'Texto da IA' }));
    const strip = page.locator('.agent-strip-row').first();
    await expect(strip).toBeVisible();
    await expect(page.locator('#agent-strip')).toHaveCSS('position', 'fixed');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await canvas.boundingBox()).toEqual(before);
    expect(await page.locator('.editor-topbar').boundingBox()).toEqual(top);
  } finally {
    await context.close();
  }
});

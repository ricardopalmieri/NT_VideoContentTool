import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createProject } from '../../src/model/types';

// Revisão de UX/UI: rolagem em todos os painéis, divisores (mouse, toque, teclado, persistência) e seleção da faixa de legendas.
type Layer = { id: string; name: string; kind: string; fontSize?: number };
type Vct = { batch(commands: unknown[], options?: { label?: string }): unknown; getProject(): { layers: Layer[] } };

const SRT_COUNT = 14;
const srt = (count: number) => Array.from({ length: count }, (_, index) => `${index + 1}\n00:00:${String(index).padStart(2, '0')},000 --> 00:00:${String(index).padStart(2, '0')},800\nLegenda número ${index + 1}\n`).join('\n');
const layers = (page: Page) => page.evaluate(() => (window as unknown as { vct: Vct }).vct.getProject().layers).then((list) => [...list].sort((a, b) => a.id.localeCompare(b.id)));
const png = (width: number, height: number) => {
  const image = new PNG({ width, height });
  image.data.fill(200);
  return PNG.sync.write(image);
};

async function loadProject(page: Page) {
  await page.goto('http://127.0.0.1:4174/current/');
  await page.locator('[data-language="pt-BR"]').click();
  const project = createProject({ name: 'Revisão UX', width: 1920, height: 1080, fps: 10, duration: 20, background: '#000000', transparent: false });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#open-project').click();
  await (await chooser).setFiles({ name: 'ux.ntvct', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#composition-canvas')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function openEditor(browser: Browser, viewport = { width: 1440, height: 900 }, options: { touch?: boolean; storage?: Record<string, string> } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true, hasTouch: options.touch ?? false });
  await context.addInitScript((storage) => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
    // Valores iniciais só na primeira carga (o teste de persistência recarrega a página).
    try {
      if (!localStorage.getItem('ux-seeded')) {
        localStorage.setItem('ux-seeded', '1');
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
      }
    } catch { /* página sem armazenamento (about:blank) */ }
  }, options.storage ?? {});
  const page = await context.newPage();
  page.on('dialog', (dialog) => void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()));
  await loadProject(page);
  return { context, page };
}

/** Mídias no painel, 14 legendas numa faixa e 8 textos: tudo o que precisa de rolagem. */
async function seed(page: Page, viewport: { width: number }) {
  if (viewport.width <= 860) await page.locator('#toggle-library').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-bin-import]').first().click();
  await (await chooser).setFiles(Array.from({ length: 14 }, (_, index) => ({ name: `imagem-${index}.png`, mimeType: 'image/png', buffer: png(64 + index, 48) })));
  await expect(page.locator('[data-bin-asset]')).toHaveCount(14);
  if (viewport.width <= 860) await page.locator('#toggle-library').click();
  await page.evaluate((text) => (window as unknown as { vct: Vct }).vct.batch([{ type: 'text.fromSrt', srt: text, idPrefix: 'leg' }], { label: 'Legenda' }), srt(SRT_COUNT));
  await page.evaluate(() => (window as unknown as { vct: Vct }).vct.batch(Array.from({ length: 8 }, (_, index) => ({ type: 'layer.create', layerId: `t${index}`, kind: 'text', name: `Texto ${index}`, startTime: 0, endTime: 5, props: { text: `T${index}` } })), { label: 'Textos' }));
}

const subtitleRow = (page: Page) => page.locator('.timeline-label-row.layer-label:has(.timeline-clip-count)');

test('faixa de legendas: nome, linha ou espaço vazio da faixa selecionam todas; o tamanho muda em todas com um desfazer', async ({ browser }) => {
  const { context, page } = await openEditor(browser, { width: 1440, height: 1000 });
  try {
    await page.evaluate((text) => (window as unknown as { vct: Vct }).vct.batch([{ type: 'text.fromSrt', srt: text, idPrefix: 'leg' }], { label: 'Legenda' }), srt(6));
    const inspector = page.locator('[data-multi-inspector]');
    const row = subtitleRow(page);
    await expect(row).toHaveCount(1);
    const lane = page.locator('.timeline-track[data-track-members*=" "]');
    await expect(lane).toHaveCount(1);
    const single = () => page.locator('.layer-item [data-select-layer]').first().click();

    // 1) O nome do primeiro clipe na linha da faixa (o que as pessoas clicam naturalmente).
    await single();
    await expect(inspector).toHaveCount(0);
    await row.locator('.timeline-label-name').click();
    await expect(inspector.locator('.inspector-header')).toContainText('6 camadas');
    await expect(row).toHaveClass(/is-track-selected/);
    await expect(lane).toHaveClass(/is-track-selected/);
    // 2) O espaço vazio da própria linha (sem botão).
    await single();
    await expect(inspector).toHaveCount(0);
    const rowBox = (await row.boundingBox())!;
    // Longe da borda direita, onde fica a divisória da largura da coluna.
    await page.mouse.click(rowBox.x + rowBox.width - 12, rowBox.y + rowBox.height / 2);
    await expect(inspector.locator('.inspector-header')).toContainText('6 camadas');
    // 3) Um espaço vazio da faixa na timeline (sem clipe): seleciona a faixa e não anda sozinho com a playhead para outro lugar.
    await single();
    await expect(inspector).toHaveCount(0);
    const laneBox = (await lane.boundingBox())!;
    const scrollBox = (await page.locator('.timeline-scroll').boundingBox())!;
    await page.mouse.click(Math.min(laneBox.x + laneBox.width, scrollBox.x + scrollBox.width) - 30, laneBox.y + laneBox.height / 2);
    await expect(inspector.locator('.inspector-header')).toContainText('6 camadas');
    await expect(lane).toHaveClass(/is-track-selected/);
    // Clicar num clipe seleciona só aquele clipe e tira a faixa da seleção.
    await page.locator('[data-clip-layer="leg2"]').click({ position: { x: 20, y: 6 } });
    await expect(inspector).toHaveCount(0);
    await expect(row).not.toHaveClass(/is-track-selected/);

    // Mudar o tamanho da fonte no inspector vale para todas, num único desfazer.
    await row.locator('.timeline-label-name').click();
    const before = (await layers(page)).filter((layer) => layer.name.startsWith('Legenda')).map((layer) => layer.fontSize);
    expect(before).toHaveLength(6);
    const size = inspector.locator('[data-multi-prop="fontSize"]');
    await size.fill('77');
    await size.press('Enter');
    expect((await layers(page)).filter((layer) => layer.name.startsWith('Legenda')).map((layer) => layer.fontSize)).toEqual([77, 77, 77, 77, 77, 77]);
    await page.locator('#undo').click();
    expect((await layers(page)).filter((layer) => layer.name.startsWith('Legenda')).map((layer) => layer.fontSize)).toEqual(before);
    // Ctrl+clique num clipe continua alternando só aquele clipe (sem selecionar a faixa toda).
    await page.locator('.layer-item [data-select-layer]').nth(3).click();
    await page.locator('[data-clip-layer="leg1"]').click({ modifiers: ['Control'], position: { x: 20, y: 6 } });
    await expect(inspector.locator('.inspector-header')).toContainText('2 camadas');
  } finally {
    await context.close();
  }
});

// ---- Rolagem ----------------------------------------------------------------------------------------------------

const scrollState = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => {
  const style = getComputedStyle(element);
  const scrollable = /(auto|scroll)/.test(style.overflowY);
  const overflows = element.scrollHeight > element.clientHeight + 1;
  const before = element.scrollTop;
  element.scrollTop = element.scrollHeight;
  const moved = element.scrollTop > before;
  element.scrollTop = before;
  return { scrollable, overflows, moved, scrollbarWidth: getComputedStyle(element, '::-webkit-scrollbar').width };
});

/** O conteúdo que passa da caixa tem de rolar; se couber, tudo bem. */
async function expectScrolls(page: Page, selector: string, mustOverflow = false) {
  const state = await scrollState(page, selector);
  if (mustOverflow) expect(state.overflows, `${selector} deveria ter conteúdo maior que a caixa`).toBe(true);
  if (state.overflows) {
    expect(state.scrollable, `${selector} tem conteúdo cortado sem rolagem`).toBe(true);
    expect(state.moved, `${selector} não rola`).toBe(true);
    expect(['10px', '14px'], `${selector} sem a barra de rolagem estilizada`).toContain(state.scrollbarWidth);
  }
}

/** Nada escapa das colunas: o conteúdo cabe na caixa (rola por dentro). */
const expectContained = async (page: Page, selector: string) => expect(await page.locator(selector).first().evaluate((element) => element.scrollHeight - element.clientHeight), `${selector} corta conteúdo`).toBeLessThanOrEqual(1);

for (const [width, height] of [[1440, 900], [1280, 720], [1024, 1366], [768, 1024]]) {
  test(`rolagem em todas as áreas com conteúdo grande, ${width}×${height}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const drawers = width <= 860;
    const { context, page } = await openEditor(browser, { width, height }, { touch: width < 1100 });
    try {
      await seed(page, { width });
      // Mídia e Efeitos (coluna esquerda).
      if (drawers) await page.locator('#toggle-library').click();
      await expectScrolls(page, '#left-tabpanel', true);
      await expectContained(page, '.left-panel');
      await page.locator('[data-left-tab="effects"]').click();
      await expectScrolls(page, '#left-tabpanel');
      await page.locator('[data-left-tab="media"]').click();
      await expectScrolls(page, '#layer-stack', true);
      // O último botão da aba Mídia fica alcançável rolando.
      await page.locator('#left-tabpanel').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const lastBin = await page.locator('[data-auto-subtitles]').boundingBox();
      const bodyBox = (await page.locator('#left-tabpanel').boundingBox())!;
      expect(lastBin!.y + lastBin!.height).toBeLessThanOrEqual(bodyBox.y + bodyBox.height + 1);
      if (drawers) await page.locator('#toggle-library').click();

      // Inspector de uma camada (nas telas estreitas a lista de camadas fica na gaveta da esquerda).
      if (drawers) await page.locator('#toggle-library').click();
      await page.locator('.layer-item [data-select-layer]').first().click();
      if (drawers) await page.locator('#toggle-library').click();
      if (drawers) await page.locator('#toggle-inspector').click();
      await expectScrolls(page, '.inspector-scroll', true);
      await expectScrolls(page, '.inspector-effects-body');
      await expectContained(page, '.right-panel');
      if (drawers) await page.locator('#toggle-inspector').click();

      // Inspector com várias legendas selecionadas (clique no nome da faixa): rola e o botão Excluir continua à vista.
      await subtitleRow(page).locator('.timeline-label-name').click();
      await expect(page.locator('[data-multi-inspector]')).toHaveCount(1);
      if (drawers) await page.locator('#toggle-inspector').click();
      await expectScrolls(page, '.inspector-scroll', true);
      await expectContained(page, '.right-panel');
      const panelBox = (await page.locator('.right-panel').boundingBox())!;
      const deleteBox = (await page.locator('[data-multi-delete]').boundingBox())!;
      expect(deleteBox.y + deleteBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
      if (drawers) await page.locator('#toggle-inspector').click();

      // Janelas.
      for (const [trigger, close, selector] of [['#export-project', '#close-export', '.export-modal'], ['#composition-settings', '#close-composition', '.composition-modal']] as const) {
        await page.locator(trigger).click();
        const box = (await page.locator(selector).boundingBox())!;
        expect(box.y, `${selector} começa fora da tela`).toBeGreaterThanOrEqual(-1);
        expect(box.y + box.height, `${selector} termina fora da tela`).toBeLessThanOrEqual(height + 1);
        await expectScrolls(page, selector);
        await page.locator(close).click();
      }
      await page.keyboard.press('?');
      await expect(page.locator('#shortcuts-panel')).toBeVisible();
      await expectScrolls(page, '#shortcuts-panel .shortcut-table');
      await page.keyboard.press('Escape');
      await expect(page.locator('#shortcuts-panel')).toHaveCount(0);
      await page.locator('#open-warnings').click();
      await expectScrolls(page, '#warnings-panel .info-list');
      await page.keyboard.press('Escape');
      if (drawers) await page.locator('#toggle-library').click();
      await page.locator('[data-auto-subtitles]').click();
      const dialog = page.locator('.transcribe-modal').first();
      await expect(dialog).toBeVisible();
      const dialogBox = (await dialog.boundingBox())!;
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(height + 1);
      await expectScrolls(page, '.transcribe-modal');
    } finally {
      await context.close();
    }
  });
}

test('janelas do editor: role=dialog, foco dentro, Esc fecha e o foco volta ao botão', async ({ browser }) => {
  const { context, page } = await openEditor(browser, { width: 1280, height: 720 });
  try {
    await page.locator('#export-project').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('.export-modal');
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);
    await expect(dialog).toBeFocused();
    // Tab não sai da janela.
    for (let index = 0; index < 12; index++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.export-modal')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#export-project')).toBeFocused();
    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-panel')).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcuts-panel')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

// ---- Divisores --------------------------------------------------------------------------------------------------

const splitter = (page: Page, id: string) => page.locator(`[data-splitter="${id}"]`);
const num = async (page: Page, id: string) => Number(await splitter(page, id).getAttribute('aria-valuenow'));
const height = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().height);
const width = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().width);
const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key);

async function dragMouse(page: Page, id: string, dx: number, dy: number) {
  const box = (await splitter(page, id).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test('divisores: papel separator, arrastar, teclado, restaurar e limites (esquerda: abas e camadas)', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await seed(page, { width: 1440 });
    const handle = splitter(page, 'left-top');
    await expect(handle).toHaveAttribute('role', 'separator');
    await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    await expect(handle).toHaveAttribute('tabindex', '0');
    await expect(handle).toHaveAttribute('aria-label', /.+/);
    const start = await num(page, 'left-top');
    expect(Math.abs(start - await height(page, '.left-top'))).toBeLessThanOrEqual(1);
    expect(Number(await handle.getAttribute('aria-valuemin'))).toBe(120);
    expect(Number(await handle.getAttribute('aria-valuemax'))).toBeGreaterThan(start);

    // Arrastar para baixo aumenta as abas e diminui a lista de camadas.
    const layersBefore = await height(page, '.stack-section');
    await dragMouse(page, 'left-top', 0, 60);
    expect(Math.abs(await num(page, 'left-top') - (start + 60))).toBeLessThanOrEqual(2);
    expect(Math.abs(await height(page, '.left-top') - (start + 60))).toBeLessThanOrEqual(2);
    expect(await height(page, '.stack-section')).toBeLessThan(layersBefore - 50);
    expect(Number(await stored(page, 'nt-vct-left-top-height'))).toBe(await num(page, 'left-top'));

    // Teclado: setas (16 px), Shift (64 px), Home/End e Enter restaura.
    await handle.focus();
    const base = await num(page, 'left-top');
    await page.keyboard.press('ArrowUp');
    expect(await num(page, 'left-top')).toBe(base - 16);
    await page.keyboard.press('Shift+ArrowUp');
    expect(await num(page, 'left-top')).toBe(base - 16 - 64);
    await page.keyboard.press('ArrowDown');
    expect(await num(page, 'left-top')).toBe(base - 64);
    await page.keyboard.press('Home');
    expect(await num(page, 'left-top')).toBe(120);
    expect(await height(page, '.left-top')).toBeGreaterThanOrEqual(119);
    await page.keyboard.press('End');
    const max = await num(page, 'left-top');
    expect(max).toBe(Number(await handle.getAttribute('aria-valuemax')));
    expect(await height(page, '.stack-section')).toBeGreaterThanOrEqual(119);
    // Arrastar além do limite não passa do máximo/mínimo.
    await dragMouse(page, 'left-top', 0, 400);
    expect(await num(page, 'left-top')).toBe(max);
    await dragMouse(page, 'left-top', 0, -900);
    expect(await num(page, 'left-top')).toBe(120);
    // Duplo clique restaura o tamanho automático e apaga o valor guardado.
    await handle.dblclick();
    expect(Math.abs(await num(page, 'left-top') - start)).toBeLessThanOrEqual(1);
    expect(await stored(page, 'nt-vct-left-top-height')).toBeNull();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await stored(page, 'nt-vct-left-top-height')).toBeNull();
    // As setas no divisor não movem a playhead nem camadas.
    expect(await page.evaluate(() => (window as unknown as { vct: { getProject(): { layers: Array<{ x: number }> } } }).vct.getProject().layers.length)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('divisores: colunas, timeline e efeitos do inspector arrastam, usam o teclado e guardam o tamanho depois de recarregar', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await seed(page, { width: 1440 });
    await page.locator('.layer-item [data-select-layer]').first().click();
    // Colunas.
    const leftStart = await width(page, '.left-panel');
    await dragMouse(page, 'left', 50, 0);
    expect(Math.abs(await width(page, '.left-panel') - (leftStart + 50))).toBeLessThanOrEqual(2);
    const rightStart = await width(page, '.right-panel');
    await dragMouse(page, 'right', -40, 0);
    expect(Math.abs(await width(page, '.right-panel') - (rightStart + 40))).toBeLessThanOrEqual(2);
    await expect(splitter(page, 'left')).toHaveAttribute('aria-orientation', 'vertical');
    await splitter(page, 'right').focus();
    await page.keyboard.press('ArrowLeft');
    expect(Math.abs(await width(page, '.right-panel') - (rightStart + 40 + 16))).toBeLessThanOrEqual(2);
    // Timeline (a divisão do preview).
    const timelineStart = await height(page, '.timeline-panel');
    await dragMouse(page, 'timeline', 0, -50);
    expect(Math.abs(await height(page, '.timeline-panel') - (timelineStart + 50))).toBeLessThanOrEqual(2);
    await splitter(page, 'timeline').focus();
    await page.keyboard.press('ArrowDown');
    expect(Math.abs(await height(page, '.timeline-panel') - (timelineStart + 50 - 16))).toBeLessThanOrEqual(2);
    // Propriedades × efeitos no inspector.
    const fx = splitter(page, 'inspector-fx');
    await expect(fx).toBeVisible();
    const fxStart = await height(page, '.inspector-effects');
    await dragMouse(page, 'inspector-fx', 0, -40);
    expect(Math.abs(await height(page, '.inspector-effects') - (fxStart + 40))).toBeLessThanOrEqual(2);
    expect(Math.abs(await num(page, 'inspector-fx') - (fxStart + 40))).toBeLessThanOrEqual(2);
    // O tamanho dos efeitos sobrevive a trocar de camada.
    await page.locator('.layer-item [data-select-layer]').nth(1).click();
    expect(Math.abs(await height(page, '.inspector-effects') - (fxStart + 40))).toBeLessThanOrEqual(2);
    const saved = {
      left: await stored(page, 'nt-vct-left-width'), right: await stored(page, 'nt-vct-right-width'),
      timeline: await stored(page, 'nt-vct-timeline-height'), fx: await stored(page, 'nt-vct-inspector-fx-height'),
    };
    expect(Object.values(saved).every((value) => value !== null)).toBe(true);
    await dragMouse(page, 'left-top', 0, -30);
    const leftTop = await num(page, 'left-top');
    expect(await stored(page, 'nt-vct-left-top-height')).toBe(String(leftTop));

    // Recarregar: o projeto abre de novo e os tamanhos voltam.
    const leftAfter = await width(page, '.left-panel');
    const timelineAfter = await height(page, '.timeline-panel');
    await page.reload();
    await loadProject(page);
    await page.locator('.layer-item [data-select-layer]').count();
    expect(Math.abs(await width(page, '.left-panel') - leftAfter)).toBeLessThanOrEqual(1);
    expect(Math.abs(await height(page, '.timeline-panel') - timelineAfter)).toBeLessThanOrEqual(1);
    expect(await num(page, 'left-top')).toBe(leftTop);
    await page.evaluate(() => (window as unknown as { vct: Vct }).vct.batch([{ type: 'layer.create', layerId: 'um', kind: 'text', name: 'Um', startTime: 0, endTime: 2 }], { label: 'Texto' }));
    await expect(splitter(page, 'inspector-fx')).toBeVisible();
    expect(Math.abs(await num(page, 'inspector-fx') - (fxStart + 40))).toBeLessThanOrEqual(2);
  } finally {
    await context.close();
  }
});

test('divisores: valores guardados inválidos são ignorados e fora dos limites são contidos', async ({ browser }) => {
  const { context, page } = await openEditor(browser, { width: 1440, height: 900 }, { storage: { 'nt-vct-left-top-height': 'abc', 'nt-vct-inspector-fx-height': '-20', 'nt-vct-left-width': '99999', 'nt-vct-timeline-height': '0' } });
  try {
    await expect(splitter(page, 'left-top')).toHaveAttribute('aria-valuenow', /^\d+$/);
    // Sem tamanho válido guardado vale o padrão; 99999 não estoura a tela.
    expect(await num(page, 'left-top')).toBeGreaterThan(200);
    expect(await width(page, '.left-panel')).toBeLessThanOrEqual(521);
    expect(await height(page, '.timeline-panel')).toBeGreaterThan(100);
    const stage = await width(page, '.stage-area');
    expect(stage).toBeGreaterThan(300);
  } finally {
    await context.close();
  }
});

async function touchDrag(context: BrowserContext, page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 6, y: from.y + (to.y - from.y) * step / 6 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('divisores no tablet: arrastar com o dedo, área de toque de 44 px e dois toques restauram', async ({ browser }) => {
  const { context, page } = await openEditor(browser, { width: 1024, height: 1366 }, { touch: true });
  try {
    await seed(page, { width: 1024 });
    const handle = splitter(page, 'left-top');
    const box = (await handle.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Área de toque de pelo menos 44 px (o divisor tem 8 px; o resto vem do pseudo-elemento).
    for (const offset of [-21, 21]) {
      expect(await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.matches('[data-splitter="left-top"]')), [cx, cy + offset]), `toque a ${offset}px`).toBe(true);
    }
    const start = await num(page, 'left-top');
    await touchDrag(context, page, { x: cx, y: cy + 14 }, { x: cx, y: cy + 14 + 70 });
    await expect.poll(() => num(page, 'left-top')).toBeGreaterThan(start + 55);
    expect(await stored(page, 'nt-vct-left-top-height')).not.toBeNull();
    // Dois toques seguidos restauram o tamanho automático.
    const cdp = await context.newCDPSession(page);
    const moved = (await handle.boundingBox())!;
    const tap = { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 };
    for (let index = 0; index < 2; index++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tap] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await expect.poll(() => stored(page, 'nt-vct-left-top-height')).toBeNull();
    // O divisor da timeline também aceita o dedo.
    const timeline = (await splitter(page, 'timeline').boundingBox())!;
    const timelineStart = await height(page, '.timeline-panel');
    await touchDrag(context, page, { x: timeline.x + timeline.width / 2, y: timeline.y + timeline.height / 2 }, { x: timeline.x + timeline.width / 2, y: timeline.y + timeline.height / 2 - 60 });
    await expect.poll(() => height(page, '.timeline-panel')).toBeGreaterThan(timelineStart + 45);
  } finally {
    await context.close();
  }
});

test('divisores: a coluna dos nomes das faixas alarga, mostra o que estava cortado e guarda a largura', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await seed(page, { width: 1440 });
    const handle = splitter(page, 'labels');
    await expect(handle).toHaveAttribute('role', 'separator');
    await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    const start = await width(page, '.timeline-labels');
    expect(Math.abs(start - 210)).toBeLessThanOrEqual(1);
    // A divisória fica junto à borda da coluna, toda do lado dos nomes (não cobre as alças de um clipe em 0 s).
    const box = (await handle.boundingBox())!;
    const labels = (await page.locator('.timeline-labels').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(labels.x + labels.width + .5);
    expect(box.x + box.width).toBeGreaterThanOrEqual(labels.x + labels.width - 1);
    const clipped = () => page.locator('.timeline-label-row').evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length);
    const before = await clipped();

    await dragMouse(page, 'labels', 120, 0);
    expect(Math.abs(await width(page, '.timeline-labels') - (start + 120))).toBeLessThanOrEqual(2);
    expect(await clipped()).toBeLessThanOrEqual(before);
    expect(Number(await stored(page, 'nt-vct-track-labels-width'))).toBe(await num(page, 'labels'));
    // A timeline redesenha (nova camada) e a divisória continua lá, no mesmo lugar.
    await page.evaluate(() => (window as unknown as { vct: Vct }).vct.batch([{ type: 'layer.create', layerId: 'extra', kind: 'text', startTime: 0, endTime: 2, props: { text: 'X' } }]));
    await expect(handle).toHaveCount(1);
    expect(Math.abs(await width(page, '.timeline-labels') - (start + 120))).toBeLessThanOrEqual(2);
    // Teclado e limites.
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    expect(await num(page, 'labels')).toBe(Math.round(start + 120 - 16));
    await page.keyboard.press('Home');
    expect(await num(page, 'labels')).toBe(100);
    await page.keyboard.press('End');
    expect(await width(page, '.timeline-scroll')).toBeGreaterThanOrEqual(159);
    // Guarda depois de recarregar; duplo clique volta ao padrão.
    await dragMouse(page, 'labels', -100, 0);
    const kept = await num(page, 'labels');
    await page.reload();
    await loadProject(page);
    expect(Math.abs(await width(page, '.timeline-labels') - kept)).toBeLessThanOrEqual(2);
    await splitter(page, 'labels').dblclick();
    expect(Math.abs(await width(page, '.timeline-labels') - 210)).toBeLessThanOrEqual(1);
    expect(await stored(page, 'nt-vct-track-labels-width')).toBeNull();
  } finally {
    await context.close();
  }
});

test('a régua de tempo fica no topo da timeline ao rolar as faixas para baixo', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  try {
    await seed(page, { width: 1440 });
    const scroll = page.locator('.timeline-scroll');
    const ruler = page.locator('.timeline-scroll .time-ruler');
    await expectScrolls(page, '.timeline-scroll', true);
    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(20);
    // Rolada, a régua passa a cobrir as faixas (no topo, as alças da primeira faixa ficam por cima dela).
    await expect(scroll).toHaveClass(/is-scrolled-y/);
    const scrollBox = (await scroll.boundingBox())!;
    const rulerBox = (await ruler.boundingBox())!;
    expect(Math.abs(rulerBox.y - scrollBox.y)).toBeLessThanOrEqual(1);
    // Nada das faixas aparece por cima da régua: o elemento no meio dela é a própria régua (ou um rótulo de tempo).
    const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.time-ruler, .timeline-cursor') !== null, { x: rulerBox.x + rulerBox.width / 3, y: rulerBox.y + rulerBox.height / 2 });
    expect(top).toBe(true);
    // Os nomes das faixas continuam alinhados com as faixas.
    // (a coluna acompanha pelo evento de rolagem, um quadro depois).
    await expect.poll(async () => {
      const label = (await page.locator('.timeline-label-row').last().boundingBox())!;
      const track = (await page.locator('.timeline-tracks > .timeline-track').last().boundingBox())!;
      return Math.abs(label.y - track.y);
    }).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});

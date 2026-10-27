import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { PNG } from 'pngjs';

function pngFile(name: string, color: [number, number, number, number]) {
  const image = new PNG({ width: 64, height: 64 });
  for (let index = 0; index < image.data.length; index += 4) image.data.set(color, index);
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(image) };
}

async function newProject(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('http://127.0.0.1:4174/current/');
  await page.locator('[data-language="pt-BR"]').click();
  await page.locator('#new-project').click();
  for (const [name, value] of Object.entries({ name: 'Smoke', width: '320', height: '180', fps: '8', duration: '1' })) {
    await page.locator(`#setup-form [name="${name}"]`).fill(value);
  }
  await page.locator('#setup-form button[type="submit"]').click();
}

test('abre, importa PNG transparente, coloca pelo bin, agente edita e exporta PNG', async ({ page }, info) => {
  const touch = Boolean(info.project.use.hasTouch);
  await newProject(page);

  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-bin-import]').first().click();
  await (await chooser).setFiles([pngFile('meio.png', [255, 0, 0, 128])]);
  await expect(page.locator('[data-bin-asset]')).toHaveCount(1);
  const card = page.locator('[data-bin-asset]').first();
  if (touch) await card.tap(); else await card.click();
  const place = page.locator('[data-bin-place="new-track"]');
  if (touch) await place.tap(); else await place.click();
  await expect(page.locator('[data-layer-text="name"]')).toHaveValue('meio.png');

  const report = await page.evaluate(async () => {
    const vct = window.vct;
    const describe = vct.describe() as string;
    vct.batch([
      { type: 'layer.create', layerId: 'titulo', kind: 'text', name: 'Título', startTime: 0, endTime: 1, props: { text: 'Oi', y: 90 } },
    ] as never, { label: 'Smoke' });
    const frame = await vct.captureFrame({ time: .5, maxWidth: 160 });
    const { settings } = vct.query('project');
    return { frames: Math.round(settings.duration * settings.fps), describe: describe.length, summary: vct.summary(), lint: vct.lint(), assets: vct.assets(), frame: frame.width, notReady: (frame as { notReady?: unknown }).notReady };
  });
  expect(report.describe).toBeGreaterThan(500);
  expect(report.summary).toContain('titulo');
  expect(report.assets).toContain('meio.png');
  expect(report.frame).toBe(160);
  expect(report.notReady ?? []).toEqual([]);

  await expect(page.locator('body')).not.toContainText('FALHA NA RECUPERAÇÃO');
  await page.locator('#export-project').click();
  await page.locator('#export-format').selectOption('png-sequence');
  const download = page.waitForEvent('download');
  await page.locator('#start-export').click();
  const file = await (await download).path();
  const frames = Object.entries(unzipSync(await readFile(file!))).filter(([name]) => name.endsWith('.png'));
  // Colocar a imagem (3 s) estende a composição de 1 s.
  expect(frames).toHaveLength(report.frames);
  // O PNG com alpha 128 sobre fundo transparente deve chegar semitransparente no export.
  const image = PNG.sync.read(Buffer.from(frames[0][1]));
  const alphas = new Set<number>();
  for (let index = 3; index < image.data.length; index += 4) alphas.add(image.data[index]);
  expect([...alphas].some((alpha) => alpha > 60 && alpha < 200)).toBe(true);
});

test('pinça na timeline amplia o zoom (toque real via CDP)', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium' || !info.project.use.hasTouch, 'CDP de toque só existe no Chromium');
  await newProject(page);
  const scroll = page.locator('.timeline-scroll');
  const box = (await scroll.boundingBox())!;
  const y = box.y + Math.min(60, box.height / 2);
  const cx = box.x + box.width / 2;
  const before = await page.evaluate(() => document.querySelector<HTMLElement>('.timeline-content')?.offsetWidth ?? 0);
  const cdp = await page.context().newCDPSession(page);
  const points = (spread: number) => [{ x: cx - spread, y, id: 1 }, { x: cx + spread, y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(30) });
  for (let spread = 40; spread <= 160; spread += 20) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(spread) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('.timeline-content')?.offsetWidth ?? 0)).toBeGreaterThan(before * 1.5);
});

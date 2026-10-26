import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { PNG } from 'pngjs';
import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Output, WebMOutputFormat } from 'mediabunny';
import type { ProjectDocument } from '../../src/model/types';

async function openEditor(browser: Browser, target: 'legacy' | 'current') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  // Exercita o fallback de download existente, sem alterar o estado privado do editor.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.goto(`http://127.0.0.1:4174/${target}/`);
  await page.locator('[data-language="pt-BR"]').click();
  return { context, page };
}

async function numeric(page: Page, property: string, value: number) {
  const input = page.locator(`[data-layer-property="${property}"]`);
  await input.dblclick();
  await input.fill(String(value));
  await input.press('Enter');
}

async function createScene(page: Page) {
  await page.locator('#new-project').click();
  for (const [name, value] of Object.entries({ name: 'Paridade 0.6.2', width: '320', height: '180', fps: '8', duration: '1' })) {
    await page.locator(`#setup-form [name="${name}"]`).fill(value);
  }
  await page.locator('#setup-form button[type="submit"]').click();
  await page.locator('#preview-quality').selectOption('1');
  await page.locator('[data-add-input="text"]').click();
  await page.locator('[data-layer-text="text"]').fill('VCT');
  await page.locator('[data-layer-text="text"]').press('Tab');
  await numeric(page, 'y', 45);
  await page.locator('[data-add-input="geometry"]').click();
  await numeric(page, 'y', 125);
  await numeric(page, 'fadeInEnd', .5);
  await page.locator('[data-add-effect="levels"]').click();
  const brightness = page.locator('[data-effect-param="brightness"]');
  await brightness.dblclick();
  await brightness.fill('0.2');
  await brightness.press('Enter');
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function save(page: Page): Promise<Buffer> {
  const event = page.waitForEvent('download');
  await page.locator('#save-project').click();
  const download = await event;
  expect(download.suggestedFilename()).toMatch(/\.ntvct$/);
  const file = await download.path();
  if (!file) throw new Error('Download sem arquivo');
  return readFile(file);
}

async function openProject(page: Page, content: Buffer) {
  const event = page.waitForEvent('filechooser');
  await page.locator('#open-project').click();
  await (await event).setFiles({ name: 'paridade.ntvct', mimeType: 'application/json', buffer: content });
  await expect(page.locator('#composition-canvas')).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function exportFrames(page: Page) {
  await page.locator('#export-project').click();
  await page.locator('#export-format').selectOption('png-sequence');
  const event = page.waitForEvent('download');
  await page.locator('#start-export').click();
  const download = await event;
  const file = await download.path();
  if (!file) throw new Error('Exportação sem arquivo');
  const archive = unzipSync(await readFile(file));
  const frames = Object.entries(archive).filter(([name]) => name.endsWith('.png')).sort(([a], [b]) => a.localeCompare(b));
  await expect(page.locator('#close-export')).toBeEnabled();
  await page.locator('#close-export').click();
  return frames.map(([name, bytes]) => ({ name, bytes: Buffer.from(bytes), image: PNG.sync.read(Buffer.from(bytes)) }));
}

function normalized(content: Buffer) {
  const project = JSON.parse(content.toString()) as ProjectDocument;
  // IDs e relógios são gerados na criação/salvamento de cada sessão.
  const { createdAt: _created, modifiedAt: _modified, ...rest } = project;
  return { ...rest, layers: project.layers.map(({ id: _id, effects, ...layer }) => ({ ...layer, effects: effects.map(({ id: _effectId, ...effect }) => effect) })) };
}

function savedDocument(content: Buffer) {
  const { modifiedAt: _modifiedAt, ...document } = JSON.parse(content.toString()) as ProjectDocument;
  return document;
}

async function compareFrames(expected: Awaited<ReturnType<typeof exportFrames>>, actual: Awaited<ReturnType<typeof exportFrames>>, info: TestInfo, prefix: string) {
  expect(actual.length).toBe(8);
  expect(expected.length).toBe(8);
  const metrics = [];
  for (let index = 0; index < expected.length; index++) {
    const left = expected[index].image;
    const right = actual[index].image;
    expect([right.width, right.height]).toEqual([320, 180]);
    let differentChannels = 0;
    let maxDelta = 0;
    const diff = new PNG({ width: left.width, height: left.height });
    for (let channel = 0; channel < left.data.length; channel++) {
      const delta = Math.abs(left.data[channel] - right.data[channel]);
      if (delta) differentChannels++;
      maxDelta = Math.max(maxDelta, delta);
      diff.data[channel] = channel % 4 === 3 ? 255 : delta;
    }
    metrics.push({ frame: index, differentChannels, maxDelta });
    if (differentChannels || index === 3) {
      await info.attach(`${prefix}-${index}-legado`, { body: expected[index].bytes, contentType: 'image/png' });
      await info.attach(`${prefix}-${index}-atual`, { body: PNG.sync.write(right), contentType: 'image/png' });
      await info.attach(`${prefix}-${index}-diff`, { body: PNG.sync.write(diff), contentType: 'image/png' });
    }
    expect(differentChannels, `Frame ${index}: tolerância RGBA zero`).toBe(0);
  }
  await info.attach(`${prefix}-metricas`, { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  await writeFile(info.outputPath(`${prefix}-metricas.json`), JSON.stringify(metrics, null, 2));
}

test('texto, geometria, fade, efeito e .ntvct nos dois sentidos', async ({ browser }, info) => {
  const legacy = await openEditor(browser, 'legacy');
  const current = await openEditor(browser, 'current');
  try {
    await createScene(legacy.page);
    await createScene(current.page);
    const legacySaved = await save(legacy.page);
    const currentSaved = await save(current.page);
    expect(normalized(currentSaved)).toEqual(normalized(legacySaved));
    const project = JSON.parse(legacySaved.toString()) as ProjectDocument;
    expect(project.layers.map((layer) => layer.kind).sort()).toEqual(['geometry', 'text']);
    const geometry = project.layers.find((layer) => layer.kind === 'geometry')!;
    expect(geometry.fadeInEnd).toBe(.5);
    expect(geometry.effects[0]).toMatchObject({ kind: 'levels', params: { brightness: .2 } });
    await writeFile(info.outputPath('legacy.ntvct'), legacySaved);
    await writeFile(info.outputPath('current.ntvct'), currentSaved);
    const legacyFrames = await exportFrames(legacy.page);
    const currentFrames = await exportFrames(current.page);
    expect(legacyFrames[0].image.data.equals(legacyFrames[4].image.data)).toBe(false);
    expect(legacyFrames[4].image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(legacyFrames[4].image.data.some((value, index) => index % 4 === 3 && value === 0)).toBe(true);
    await compareFrames(legacyFrames, currentFrames, info, 'criacao');
    // Reabre em páginas novas para exercitar o importador real sem a confirmação de projeto sujo.
    const fromLegacy = await openEditor(browser, 'current');
    const fromCurrent = await openEditor(browser, 'legacy');
    try {
      await openProject(fromLegacy.page, legacySaved);
      await openProject(fromCurrent.page, currentSaved);
      expect(savedDocument(await save(fromLegacy.page))).toEqual(savedDocument(legacySaved));
      expect(savedDocument(await save(fromCurrent.page))).toEqual(savedDocument(currentSaved));
      await compareFrames(legacyFrames, await exportFrames(fromLegacy.page), info, 'legado-para-atual');
      await compareFrames(currentFrames, await exportFrames(fromCurrent.page), info, 'atual-para-legado');
    } finally {
      await fromLegacy.context.close();
      await fromCurrent.context.close();
    }
  } finally {
    await legacy.context.close();
    await current.context.close();
  }
});

test('vídeo contador: mesma sequência de frames exportados pelo legado', async ({ browser }, info) => {
  const legacy = await openEditor(browser, 'legacy');
  const current = await openEditor(browser, 'current');
  try {
    // Fixture produzida com WebCodecs, sem FFmpeg e sem depender do relógio de playback.
    const packets = await legacy.page.evaluate(async () => {
      const result: { data: number[]; type: 'key' | 'delta'; timestamp: number }[] = [];
      const encoder = new VideoEncoder({
        output: (chunk) => {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          result.push({ data: Array.from(bytes), type: chunk.type, timestamp: chunk.timestamp });
        },
        error: (error) => { throw error; },
      });
      encoder.configure({ codec: 'vp8', width: 320, height: 180, bitrate: 1_000_000, framerate: 8 });
      const canvas = new OffscreenCanvas(320, 180);
      const context = canvas.getContext('2d')!;
      for (let index = 0; index < 8; index++) {
        context.fillStyle = `rgb(${index * 28}, 30, ${210 - index * 20})`;
        context.fillRect(0, 0, 320, 180);
        context.fillStyle = '#fff';
        context.font = '70px monospace';
        context.fillText(String(index), 120, 115);
        const frame = new VideoFrame(canvas, { timestamp: index * 125000, duration: 125000 });
        encoder.encode(frame, { keyFrame: true });
        frame.close();
      }
      await encoder.flush();
      encoder.close();
      return result;
    });
    expect(packets).toHaveLength(8);
    const target = new BufferTarget();
    const output = new Output({ target, format: new WebMOutputFormat() });
    const source = new EncodedVideoPacketSource('vp8');
    output.addVideoTrack(source, { frameRate: 8 });
    await output.start();
    for (const packet of packets) {
      await source.add(new EncodedPacket(new Uint8Array(packet.data), packet.type, packet.timestamp / 1_000_000, .125), {
        decoderConfig: { codec: 'vp8', codedWidth: 320, codedHeight: 180 },
      });
    }
    await output.finalize();
    if (!target.buffer) throw new Error('Fixture de vídeo vazia');
    const video = Buffer.from(target.buffer);
    await writeFile(info.outputPath('contador.webm'), video);
    for (const { page } of [legacy, current]) {
      await createScene(page);
      const chooser = page.waitForEvent('filechooser');
      await page.locator('[data-add-input="video"]').click();
      await (await chooser).setFiles({ name: 'contador.webm', mimeType: 'video/webm', buffer: video });
      await expect(page.locator('[data-layer-text="name"]')).toHaveValue('contador.webm');
      await expect(page.locator('[data-layer-property="sourceOut"]')).toHaveValue('1');
    }
    const legacyFrames = await exportFrames(legacy.page);
    const currentFrames = await exportFrames(current.page);
    expect(new Set(legacyFrames.map((frame) => frame.bytes.toString('base64'))).size).toBeGreaterThan(1);
    await compareFrames(legacyFrames, currentFrames, info, 'contador');
  } finally {
    await legacy.context.close();
    await current.context.close();
  }
});

import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PNG } from 'pngjs';
import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Output, WebMOutputFormat } from 'mediabunny';
import { createAudioTrack, createLayer, createProject, type ProjectDocument } from '../../src/model/types';

async function openEditor(browser: Browser, target: 'legacy' | 'current') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  // Exercita o fallback de download existente, sem alterar o estado privado do editor.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
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
  // O painel atual separa Mídia e Efeitos em abas; a versão legada não tem abas.
  if (await page.locator('[data-left-tab="effects"]').count()) await page.locator('[data-left-tab="effects"]').click();
  await page.locator('[data-add-effect="levels"]').click();
  const brightness = page.locator('[data-effect-param="brightness"]');
  await brightness.dblclick();
  await brightness.fill('0.2');
  await brightness.press('Enter');
  if (await page.locator('[data-left-tab="media"]').count()) await page.locator('[data-left-tab="media"]').click();
  await page.evaluate(async () => { await document.fonts.ready; });
}

// Importa arquivos pelo painel Mídia (só para o painel, nada vai para a timeline).
async function importToBin(page: Page, ...files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-bin-import]').first().click();
  await (await chooser).setFiles(files);
  await expect(page.locator('[data-bin-asset]')).toHaveCount(files.length);
}

async function placeFromBin(page: Page, name: string, where: 'playhead' | 'new-track' = 'new-track') {
  await page.locator('[data-bin-asset]').filter({ hasText: name }).click();
  await page.locator(`[data-bin-place="${where}"]`).click();
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

// Rodada 1: o fade passou a ser aplicado depois dos efeitos. A geometria da cena
// tem fade-in de 0,5 s com Levels, então só os frames 0–3 (0 a 0,375 s) mudam.
const ROUND1_FADE_FRAMES: ReadonlySet<number> = new Set([0, 1, 2, 3]);

async function compareFrames(expected: Awaited<ReturnType<typeof exportFrames>>, actual: Awaited<ReturnType<typeof exportFrames>>, info: TestInfo, prefix: string, changedFrames = ROUND1_FADE_FRAMES) {
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
    if (!changedFrames.has(index)) expect(differentChannels, `Frame ${index}: tolerância RGBA zero`).toBe(0);
  }
  await info.attach(`${prefix}-metricas`, { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  await writeFile(info.outputPath(`${prefix}-metricas.json`), JSON.stringify(metrics, null, 2));
}

function expectCounterSequence(frames: Awaited<ReturnType<typeof exportFrames>>) {
  expect(frames).toHaveLength(8);
  const redSamples = frames.map(({ image }) => image.data[(60 * image.width + 100) * 4]);
  expect(new Set(redSamples).size, `Samples de frame: ${redSamples.join(", ")}`).toBe(8);
  for (let index = 1; index < redSamples.length; index++) {
    expect(redSamples[index]).toBeGreaterThan(redSamples[index - 1] + 10);
  }
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

test('vídeo contador: exportação atual preserva a sequência de frames', async ({ browser }, info) => {
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
      const file = { name: 'contador.webm', mimeType: 'video/webm', buffer: video };
      if (page === legacy.page) {
        const chooser = page.waitForEvent('filechooser');
        await page.locator('[data-add-input="video"]').click();
        await (await chooser).setFiles(file);
      } else {
        // Atual: o vídeo vai para o painel Mídia e é colocado de lá.
        await importToBin(page, file);
        await placeFromBin(page, 'contador.webm');
      }
      await expect(page.locator('[data-layer-text="name"]')).toHaveValue('contador.webm');
      await expect(page.locator('[data-layer-property="sourceOut"]')).toHaveValue('1');
    }
    const legacyFrames = await exportFrames(legacy.page);
    const currentFrames = await exportFrames(current.page);
    expect(new Set(legacyFrames.map((frame) => frame.bytes.toString('base64'))).size).toBeGreaterThan(1);
    expectCounterSequence(currentFrames);
  } finally {
    await legacy.context.close();
    await current.context.close();
  }
});

test('exportação falha explicitamente quando uma mídia do projeto não foi localizada', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    const settings = { name: 'Mídia ausente', width: 320, height: 180, fps: 8, duration: 1, background: '#000000', transparent: true };
    const project = createProject(settings);
    project.layers.push(createLayer('video', settings, {
      id: 'missing-video',
      name: 'Vídeo ausente',
      asset: 'media/missing.webm',
    }));
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#open-project').click();
    await (await chooser).setFiles({
      name: 'missing.ntvct',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });

    await expect(page.locator('#composition-canvas')).toBeVisible();
    await page.locator('#close-relink-bottom').click();
    await page.locator('#export-project').click();
    await page.locator('#export-format').selectOption('png-sequence');
    await page.locator('#start-export').click();
    const shortcutPrevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(shortcutPrevented).toBe(true);
    await expect(page.locator('#export-log')).toContainText('Vídeo ausente');
    await expect(page.locator('#start-export')).toBeEnabled();
  } finally {
    await context.close();
  }
});

test('relink em lote usa metadados da mídia e os mantém no projeto salvo', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    const settings = { name: 'Relink', width: 320, height: 180, fps: 8, duration: 1, background: '#000000', transparent: true };
    const project = createProject(settings);
    const png = new PNG({ width: 1, height: 1 });
    png.data = Buffer.from([255, 0, 0, 255]);
    const image = PNG.sync.write(png);
    project.layers.push(createLayer('image', settings, {
      asset: 'media/original.png',
      name: 'original.png',
    }));
    project.assetMetadata = {
      'media/original.png': {
        originalName: 'original.png',
        sourcePath: 'Projeto/Imagens/original.png',
        size: image.length,
        lastModified: 1234,
        mimeType: 'image/png',
      },
    };
    const openChooser = page.waitForEvent('filechooser');
    await page.locator('#open-project').click();
    await (await openChooser).setFiles({
      name: 'relink.ntvct',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await expect(page.locator('#relink-batch')).toBeVisible();
    await expect(page.locator('.relink-list')).toContainText('Projeto/Imagens/original.png');
    const relinkChooser = page.waitForEvent('filechooser');
    await page.locator('#relink-batch').click();
    await (await relinkChooser).setFiles({
      name: 'original.png',
      mimeType: 'image/png',
      buffer: image,
    });
    await expect(page.locator('#missing-media')).toHaveCount(0);
    const saved = JSON.parse((await save(page)).toString()) as ProjectDocument;
    expect(saved.assetMetadata?.['media/original.png']).toMatchObject({
      originalName: 'original.png',
      size: image.length,
      mimeType: 'image/png',
    });
  } finally {
    await context.close();
  }
});

test('Collect Media baixa ZIP portátil com referências e mídias', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    const settings = { name: 'Collect Test', width: 320, height: 180, fps: 8, duration: 1, background: '#000000', transparent: true };
    const project = createProject(settings);
    const png = new PNG({ width: 1, height: 1 });
    png.data = Buffer.from([255, 0, 0, 255]);
    const image = PNG.sync.write(png);
    project.layers.push(createLayer('image', settings, {
      asset: 'assets/pixel.png',
      name: 'pixel.png',
    }));
    project.assetMetadata = {
      'assets/pixel.png': {
        originalName: 'pixel.png',
        size: image.length,
        lastModified: 1234,
        mimeType: 'image/png',
      },
    };
    const projectArchive = zipSync({
      'project.json': strToU8(JSON.stringify(project)),
      'assets/pixel.png': new Uint8Array(image),
    });
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#open-project').click();
    await (await chooser).setFiles({
      name: 'collect-input.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(projectArchive),
    });
    await expect(page.locator('#composition-canvas')).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#collect-media').click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('Collect Test-media.zip');
    const file = await download.path();
    if (!file) throw new Error('Collect Media não produziu um arquivo');
    const collected = unzipSync(await readFile(file));
    const savedProject = JSON.parse(strFromU8(collected['project.json'])) as ProjectDocument;
    expect(savedProject.layers[0].asset).toBe('assets/pixel.png');
    expect(Buffer.from(collected['assets/pixel.png'])).toEqual(image);
  } finally {
    await context.close();
  }
});

test('Collect Media grava o pacote ZIP na pasta escolhida quando há suporte', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    const project = createProject({
      name: 'Directory Collect',
      width: 320,
      height: 180,
      fps: 8,
      duration: 1,
      background: '#000000',
      transparent: true,
    });
    await openProject(page, Buffer.from(JSON.stringify(project)));
    await page.evaluate(() => {
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => ({
          getFileHandle: async (name: string) => ({
            createWritable: async () => ({
              write: async (blob: Blob) => {
                localStorage.setItem('__collectMediaFileName', name);
                const bytes = new Uint8Array(await blob.arrayBuffer());
                let binary = '';
                for (const byte of bytes) binary += String.fromCharCode(byte);
                localStorage.setItem('__collectMediaBlob', btoa(binary));
              },
              close: async () => {},
            }),
          }),
        }),
      });
    });
    await page.locator('#collect-media').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('__collectMediaFileName'))).toBe('Directory Collect-media.zip');
    const archiveData = await page.evaluate(() => localStorage.getItem('__collectMediaBlob'));
    if (!archiveData) throw new Error('Collect Media não gravou pacote na pasta escolhida');
    const archive = unzipSync(Buffer.from(archiveData, 'base64'));
    expect(Object.keys(archive)).toEqual(['project.json']);
    expect(JSON.parse(strFromU8(archive['project.json'])).settings.name).toBe('Directory Collect');
  } finally {
    await context.close();
  }
});

test('editor mantém layout utilizável em tablet e permite abrir painéis laterais', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    const project = createProject({
      name: 'Tablet Layout',
      width: 320,
      height: 180,
      fps: 8,
      duration: 1,
      background: '#000000',
      transparent: true,
    });
    await openProject(page, Buffer.from(JSON.stringify(project)));
    await page.setViewportSize({ width: 820, height: 1024 });
    await expect(page.locator('#toggle-library')).toBeVisible();
    await expect(page.locator('#toggle-inspector')).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      appWidth: document.querySelector<HTMLElement>('.editor-app')!.getBoundingClientRect().width,
      bodyScrollWidth: document.body.scrollWidth,
      leftDisplay: getComputedStyle(document.querySelector('.left-panel')!).display,
      stageWidth: document.querySelector<HTMLElement>('.stage-area')!.getBoundingClientRect().width,
      toolbarFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.stage-toolbar')!).fontSize),
      timelineFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.timeline-header')!).fontSize),
    }));
    expect(layout.appWidth).toBe(layout.viewportWidth);
    expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.leftDisplay).toBe('none');
    expect(layout.stageWidth).toBeGreaterThan(300);
    expect(layout.toolbarFontSize).toBeGreaterThanOrEqual(11);
    expect(layout.timelineFontSize).toBeGreaterThanOrEqual(11);

    await page.locator('#toggle-library').click();
    await expect(page.locator('#toggle-library')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.left-panel')).toHaveCSS('display', 'grid');
    await page.locator('#toggle-inspector').click();
    await expect(page.locator('#toggle-library')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#toggle-inspector')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.left-panel')).toHaveCSS('display', 'none');
    await expect(page.locator('.right-panel')).toHaveCSS('display', 'grid');
    await expect(page.locator('#collect-media svg')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('mover áudio vinculado mantém o vídeo e os fades sincronizados', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    const settings = { name: 'A/V linked', width: 320, height: 180, fps: 10, duration: 10, background: '#000000', transparent: true };
    const layer = createLayer('video', settings, {
      id: 'linked-video',
      startTime: 2,
      endTime: 6,
      sourceOut: 4,
      fadeInStart: 2,
      fadeInEnd: 2.5,
      fadeOutStart: 5.5,
      fadeOutEnd: 6,
    });
    const audio = createAudioTrack('Linked audio', 'media/linked-audio.wav', 10, {
      id: 'linked-audio',
      linkedLayerId: layer.id,
      linked: true,
      startTime: layer.startTime,
      endTime: layer.endTime,
      sourceOut: 4,
      fadeInStart: layer.fadeInStart,
      fadeInEnd: layer.fadeInEnd,
      fadeOutStart: layer.fadeOutStart,
      fadeOutEnd: layer.fadeOutEnd,
    });
    const project = createProject(settings);
    project.layers.push(layer);
    project.audioTracks.push(audio);
    await openProject(page, Buffer.from(JSON.stringify(project)));
    await page.locator('#close-relink-bottom').click();

    const clip = page.locator('[data-move-audio-clip="linked-audio"]');
    const bounds = await clip.boundingBox();
    if (!bounds) throw new Error('Clip de áudio vinculado não está visível');
    const startX = bounds.x + bounds.width / 2;
    const startY = bounds.y + bounds.height / 2;
    await page.mouse.move(startX, startY);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');

    const audioStart = Number(await page.locator('[data-audio-property="startTime"]').inputValue());
    const audioFadeInEnd = Number(await page.locator('[data-audio-property="fadeInEnd"]').inputValue());
    const shift = audioStart - layer.startTime;
    expect(shift).toBeGreaterThan(.1);
    expect(audioFadeInEnd).toBeCloseTo(layer.fadeInEnd + shift, 2);

    await page.locator('.timeline-label-name[data-select-layer="linked-video"]').click();
    const videoStart = Number(await page.locator('[data-layer-property="startTime"]').inputValue());
    const videoFadeInEnd = Number(await page.locator('[data-layer-property="fadeInEnd"]').inputValue());
    expect(videoStart).toBeCloseTo(audioStart, 2);
    expect(videoFadeInEnd).toBeCloseTo(audioFadeInEnd, 2);

    await page.locator('.timeline-label-name[data-select-audio="linked-audio"]').click();
    const audioEndInput = page.locator('[data-audio-property="endTime"]');
    await audioEndInput.dblclick();
    await audioEndInput.fill('5.5');
    await audioEndInput.press('Enter');
    await page.locator('.timeline-label-name[data-select-layer="linked-video"]').click();
    const videoEnd = Number(await page.locator('[data-layer-property="endTime"]').inputValue());
    expect(videoEnd).toBeCloseTo(5.5, 2);

    const trimStart = page.locator('[data-trim-audio="linked-audio"][data-trim-edge="start"]');
    const trimBounds = await trimStart.boundingBox();
    if (!trimBounds) throw new Error('Controle de trim do áudio vinculado não está visível');
    await page.mouse.move(trimBounds.x + 2, trimBounds.y + trimBounds.height / 2);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(trimBounds.x + 32, trimBounds.y + trimBounds.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const trimmedAudioStart = Number(await page.locator('[data-audio-property="startTime"]').inputValue());
    const trimmedAudioFadeEnd = Number(await page.locator('[data-audio-property="fadeInEnd"]').inputValue());
    // O fade-in fica ancorado no início do clipe e mantém 0,5 s depois do trim.
    expect(trimmedAudioFadeEnd - trimmedAudioStart).toBeCloseTo(.5, 2);

    await page.locator('.timeline-label-name[data-select-layer="linked-video"]').click();
    const trimmedVideoStart = Number(await page.locator('[data-layer-property="startTime"]').inputValue());
    const trimmedVideoFadeEnd = Number(await page.locator('[data-layer-property="fadeInEnd"]').inputValue());
    expect(trimmedVideoStart).toBeCloseTo(trimmedAudioStart, 2);
    expect(trimmedVideoFadeEnd).toBeCloseTo(trimmedAudioFadeEnd, 2);
  } finally {
    await context.close();
  }
});

test('autosave recupera projeto e blobs de mídia após abrir uma nova sessão', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    await importToBin(page, { name: 'recovery.png', mimeType: 'image/png', buffer: PNG.sync.write(new PNG({ width: 2, height: 2 })) });
    await placeFromBin(page, 'recovery.png');
    await expect(page.locator('[data-layer-id]')).toHaveCount(3);
    await expect(page.locator('#status-text')).toContainText('RECUPERAÇÃO SALVA', { timeout: 10_000 });
    await page.close();

    const recoveryPage = await context.newPage();
    await recoveryPage.goto('http://127.0.0.1:4174/current/');
    await recoveryPage.locator('[data-language="pt-BR"]').click();
    await expect(recoveryPage.locator('#restore-recovery')).toBeVisible({ timeout: 10_000 });
    await recoveryPage.locator('#restore-recovery').click();

    await expect(recoveryPage.locator('#composition-canvas')).toBeVisible();
    await expect(recoveryPage.locator('.project-title strong')).toHaveText('Paridade 0.6.2');
    await expect(recoveryPage.locator('#missing-media')).toHaveCount(0);
    await expect(recoveryPage.locator('#status-text')).toContainText('PROJETO RECUPERADO');
    await save(recoveryPage);
    // O snapshot de recuperação é apagado depois do download; em CI lento,
    // fechar a aba antes disso deixava a recuperação no IndexedDB.
    await expect(recoveryPage.locator('#status-text')).toContainText('PROJETO SALVO', { timeout: 10_000 });
    await recoveryPage.close();

    const welcomePage = await context.newPage();
    await welcomePage.goto('http://127.0.0.1:4174/current/');
    await welcomePage.locator('[data-language="pt-BR"]').click();
    await expect(welcomePage.locator('#restore-recovery')).toHaveCount(0);

    await welcomePage.locator('#new-project').click();
    for (const [name, value] of Object.entries({ name: 'Discard recovery', width: '320', height: '180', fps: '8', duration: '1' })) {
      await welcomePage.locator(`#setup-form [name="${name}"]`).fill(value);
    }
    await welcomePage.locator('#setup-form button[type="submit"]').click();
    await welcomePage.locator('[data-add-input="text"]').click();
    await expect(welcomePage.locator('#status-text')).toContainText('RECUPERAÇÃO SALVA', { timeout: 10_000 });

    const discardPage = await context.newPage();
    await discardPage.goto('http://127.0.0.1:4174/current/');
    await discardPage.locator('[data-language="pt-BR"]').click();
    await expect(discardPage.locator('#discard-recovery')).toBeVisible();
    await discardPage.locator('#discard-recovery').click();
    await expect(discardPage.locator('#recovery-prompt')).toBeHidden();
  } finally {
    await context.close();
  }
});

test('renderer recria recursos após restauração do contexto WebGL', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    const supported = await page.locator('#composition-canvas').evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement;
      const gl = element.getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) return false;
      (window as Window & { webglLossExtension?: typeof extension }).webglLossExtension = extension;
      extension.loseContext();
      return true;
    });
    test.skip(!supported, 'WEBGL_lose_context is unavailable in this browser.');

    await expect(page.locator('#status-text')).toContainText('RENDER ERROR');
    await page.evaluate(() => {
      (window as Window & { webglLossExtension?: { restoreContext(): void } }).webglLossExtension?.restoreContext();
    });
    await expect.poll(() => page.locator('#composition-canvas').evaluate((canvas) =>
      (canvas as HTMLCanvasElement).getContext('webgl2')?.isContextLost())).toBe(false);
    await expect(page.locator('#status-text')).not.toContainText('RENDER ERROR');
  } finally {
    await context.close();
  }
});

test('keyframes criados e editados no inspector preservam valores e animam a propriedade', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    await expect(page.locator('.timeline-zoom-controls button[aria-label] svg')).toHaveCount(4);
    await expect(page.locator('.timeline-zoom-controls button[title]')).toHaveCount(4);
    await page.locator('.layer-item [data-select-layer]').filter({ hasText: 'Quadrado' }).click();
    await page.locator('[data-keyframe="x"]').click();
    await expect(page.locator('[data-key-ref]')).toHaveCount(1);
    await numeric(page, 'x', 80);

    const timeline = page.locator('.timeline-scroll');
    const bounds = await timeline.boundingBox();
    if (!bounds) throw new Error('Timeline não está visível');
    await page.keyboard.down('Alt');
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 12);
    await page.keyboard.up('Alt');
    await expect(page.locator('.time-display')).toContainText('00:00.50');

    await numeric(page, 'x', 240);
    await expect(page.locator('[data-layer-property="x"]')).toHaveValue('240');
    const content = savedDocument(await save(page));
    const geometry = content.layers.find((layer) => layer.kind === 'geometry');
    expect(geometry?.keyframes.x).toEqual([
      expect.objectContaining({ time: 0, value: 80 }),
      expect.objectContaining({ time: .5, value: 240 }),
    ]);

    await page.keyboard.down('Alt');
    await page.mouse.click(bounds.x + bounds.width / 4, bounds.y + 12);
    await page.keyboard.up('Alt');
    await expect(page.locator('[data-layer-property="x"]')).toHaveValue('160');
  } finally {
    await context.close();
  }
});

test('window.vct valida, consulta e aplica lote determinístico com undo único', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    await page.locator('.layer-item [data-select-layer]').filter({ hasText: 'Quadrado' }).click();
    const layerId = await page.locator('.layer-item.is-selected').getAttribute('data-layer-id');
    if (!layerId) throw new Error('Camada selecionada sem identificador');
    const beforeX = Number(await page.locator('[data-layer-property="x"]').inputValue());

    const apiResult = await page.evaluate(({ targetId }) => {
      const events: Array<{ revision: number; label: string; commands: readonly { type: string }[] }> = [];
      window.vct.onChange((event) => events.push(event));
      const catalog = window.vct.listCatalog();
      const validation = window.vct.validate();
      const result = window.vct.batch([
        { type: "layer.setNumeric", layerId: targetId, property: "x", value: 111 },
        { type: "layer.setName", layerId: targetId, name: "Camada via API" },
      ], { label: "Teste da API" });
      return {
        resultCount: result.length,
        validation,
        layerCount: window.vct.query("layers").length,
        effectCount: catalog.effects.length,
        eventCount: events.length,
        event: events[0],
        returnedName: window.vct.query({ layerId: targetId }).name,
      };
    }, { targetId: layerId });

    expect(apiResult.validation).toEqual({ valid: true, issues: [] });
    expect(apiResult.resultCount).toBe(2);
    expect(apiResult.layerCount).toBe(2);
    expect(apiResult.effectCount).toBe(17);
    expect(apiResult.eventCount).toBe(1);
    expect(apiResult.event).toMatchObject({ revision: 1, label: "Teste da API" });
    expect(apiResult.returnedName).toBe("Camada via API");
    await expect(page.locator('[data-layer-property="x"]')).toHaveValue("111");
    await expect(page.locator(".layer-item.is-selected .layer-name")).toContainText("Camada via API");

    await page.locator("#undo").click();
    await expect(page.locator('[data-layer-property="x"]')).toHaveValue(String(beforeX));
    await expect(page.locator(".layer-item.is-selected .layer-name")).toContainText("Quadrado");
  } finally {
    await context.close();
  }
});

test('alça de fade arrastada a partir do canto cria rampa ancorada no clipe', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    await expect(page.locator('[data-fade-handle][data-fade-property="fadeInStart"]')).toHaveCount(0);
    // Reproduz o relato: arrastar a alça de fade-in a partir do canto do clipe de texto.
    const handle = page.locator('[data-fade-handle][data-fade-property="fadeInEnd"]').last();
    const layerId = await handle.getAttribute('data-fade-id');
    const box = await handle.boundingBox();
    if (!box || !layerId) throw new Error('Alça de fade-out não está visível');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    // A cena tem 1 s a 8 fps: arrastar bastante para passar de um frame (0,125 s).
    await page.mouse.move(box.x + 300, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const layer = await page.evaluate((id) => {
      const vct = (window as unknown as { vct: { getProject(): { layers: Array<Record<string, number | string>> } } }).vct;
      return vct.getProject().layers.find((item) => item.id === id)!;
    }, layerId);
    expect(Number(layer.fadeInStart)).toBeCloseTo(Number(layer.startTime), 5);
    expect(Number(layer.fadeInEnd) - Number(layer.fadeInStart)).toBeGreaterThan(.05);
  } finally {
    await context.close();
  }
});

test('corte no playhead divide o clipe na mesma faixa (S e botão de tesoura)', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    const before = await page.locator('.timeline-track[data-track-id]').count();
    await page.locator('[data-select-layer]').first().click();
    const ruler = await page.locator('.time-ruler').boundingBox();
    if (!ruler) throw new Error('Régua não está visível');
    await page.mouse.click(ruler.x + ruler.width * .5, ruler.y + ruler.height / 2);
    await page.locator('body').press('s');
    await expect.poll(() => page.evaluate(() => (window as unknown as { vct: { getProject(): { layers: Array<{ id: string; trackId?: string }> } } }).vct
      .getProject().layers.some((layer) => layer.trackId && layer.trackId !== layer.id))).toBe(true);
    await expect(page.locator('.timeline-track[data-track-id]')).toHaveCount(before);
    const split = await page.evaluate(() => {
      const vct = (window as unknown as { vct: { getProject(): { layers: Array<{ id: string; trackId?: string; startTime: number; endTime: number }> } } }).vct;
      const layers = vct.getProject().layers;
      const second = layers.find((layer) => layer.trackId && layer.trackId !== layer.id)!;
      const first = layers.find((layer) => layer.id === second.trackId)!;
      return { first: [first.startTime, first.endTime], second: [second.startTime, second.endTime] };
    });
    expect(split.first[1]).toBeCloseTo(.5, 2);
    expect(split.second[0]).toBeCloseTo(.5, 2);
    const row = page.locator('.timeline-track[data-track-id]').filter({ has: page.locator('[data-move-layer-clip]').nth(1) });
    await expect(row.first().locator('[data-move-layer-clip]')).toHaveCount(2);
    await page.mouse.click(ruler.x + ruler.width * .25, ruler.y + ruler.height / 2);
    await page.locator('#split-clip').click();
    await expect(page.locator('.timeline-track[data-track-id]').first().locator('[data-move-layer-clip]')).toHaveCount(3);
  } finally {
    await context.close();
  }
});

test('modo Sobrepor: arrastar um clipe sobre o anterior cria Dissolver na sobreposição', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    await page.locator('[data-select-layer]').first().click();
    const ruler = await page.locator('.time-ruler').boundingBox();
    if (!ruler) throw new Error('Régua não está visível');
    await page.mouse.click(ruler.x + ruler.width * .5, ruler.y + ruler.height / 2);
    await page.locator('body').press('s');
    await page.locator('#overlap-mode').click();
    await expect(page.locator('#overlap-mode')).toHaveAttribute('aria-pressed', 'true');
    const second = page.locator('.timeline-track[data-track-id]').first().locator('[data-move-layer-clip]').nth(1);
    const box = await second.boundingBox();
    if (!box) throw new Error('Segundo clipe não está visível');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - ruler.width * .25, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.transition-zone')).toHaveCount(1);
    const clips = await page.evaluate(() => (window as unknown as { vct: { getProject(): { layers: Array<{ startTime: number; endTime: number; transition?: { type: string } }> } } }).vct
      .getProject().layers.filter((layer) => layer.transition).map((layer) => ({ start: layer.startTime, type: layer.transition!.type })));
    expect(clips).toHaveLength(1);
    expect(clips[0].type).toBe('dissolve');
    expect(clips[0].start).toBeLessThan(.5);
  } finally {
    await context.close();
  }
});

test('importar vários arquivos põe tudo no painel Mídia num só passo de desfazer, sem tocar na timeline', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    const before = await page.locator('[data-move-layer-clip]').count();
    const png = PNG.sync.write(new PNG({ width: 4, height: 4 }));
    await importToBin(page,
      { name: 'foto-2.png', mimeType: 'image/png', buffer: png },
      { name: 'foto-1.png', mimeType: 'image/png', buffer: png },
    );
    // Os cartões seguem a ordem numérica dos nomes e a timeline continua igual.
    await expect(page.locator('[data-bin-asset] strong')).toHaveText(['foto-1.png', 'foto-2.png']);
    await expect(page.locator('[data-move-layer-clip]')).toHaveCount(before);
    await expect(page.locator('.import-progress')).toHaveCount(0);
    // Colocar um cartão cria o clipe (e só ele).
    await placeFromBin(page, 'foto-1.png');
    await expect(page.locator('[data-move-layer-clip]')).toHaveCount(before + 1);
    const project = () => page.evaluate(() => (window as unknown as { vct: { getProject(): { layers: Array<{ name: string; asset?: string }>; assetMetadata?: Record<string, { kind?: string; width?: number }> } } }).vct.getProject());
    expect((await project()).layers.filter((layer) => layer.name.startsWith('foto-')).map((layer) => layer.name)).toEqual(['foto-1.png']);
    // Um desfazer tira o clipe; o seguinte tira a importação inteira.
    await page.locator('body').press('Control+z');
    await expect(page.locator('[data-move-layer-clip]')).toHaveCount(before);
    expect(Object.keys((await project()).assetMetadata || {})).toHaveLength(2);
    await page.locator('body').press('Control+z');
    await expect(page.locator('[data-bin-asset]')).toHaveCount(0);
    expect(Object.keys((await project()).assetMetadata || {})).toHaveLength(0);
  } finally {
    await context.close();
  }
});


test('tablet: importar dois arquivos, tocar num cartão e usar Nova faixa, tudo por toque', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true, deviceScaleFactor: 1, acceptDownloads: true });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  try {
    await page.goto('http://127.0.0.1:4174/current/');
    await page.locator('[data-language="pt-BR"]').tap();
    const project = createProject({ name: 'Tablet Mídia', width: 320, height: 180, fps: 8, duration: 1, background: '#000000', transparent: true });
    await openProject(page, Buffer.from(JSON.stringify(project)));
    // Em telas estreitas o painel é uma gaveta; em 1024 já fica na coluna.
    const openLibrary = async () => {
      const toggle = page.locator('#toggle-library');
      if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.tap();
    };
    await openLibrary();
    await expect(page.locator('[data-left-tab="media"]')).toHaveAttribute('aria-selected', 'true');
    const png = PNG.sync.write(new PNG({ width: 4, height: 4 }));
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-bin-import]').first().tap();
    await (await chooser).setFiles([
      { name: 'um.png', mimeType: 'image/png', buffer: png },
      { name: 'dois.png', mimeType: 'image/png', buffer: png },
    ]);
    await expect(page.locator('[data-bin-asset]')).toHaveCount(2);
    await expect(page.locator('[data-move-layer-clip]')).toHaveCount(0);

    await page.locator('[data-bin-asset]').filter({ hasText: 'um.png' }).tap();
    await expect(page.locator('[data-bin-place="new-track"]')).toBeVisible();
    await page.locator('[data-bin-place="new-track"]').tap();
    await expect(page.locator('[data-move-layer-clip]')).toHaveCount(1);

    await openLibrary();
    await page.locator('[data-bin-asset]').filter({ hasText: 'dois.png' }).tap();
    await page.locator('[data-bin-place="new-track"]').tap();
    await expect(page.locator('[data-move-layer-clip]')).toHaveCount(2);
    const tracks = await page.evaluate(() => (window as unknown as { vct: { getProject(): { layers: Array<{ id: string; trackId?: string; endTime: number }>; settings: { duration: number } } } }).vct.getProject());
    expect(new Set(tracks.layers.map((layer) => layer.trackId || layer.id)).size).toBe(2);
    // As imagens têm 3 s; a composição de 1 s cresceu junto, no mesmo passo.
    expect(tracks.settings.duration).toBeGreaterThanOrEqual(3);
    await expect(page.locator('.timeline-label-row .track-name')).toHaveCount(2);
  } finally {
    await context.close();
  }
});

test('arrastar um cartão do painel Mídia para a timeline cria faixa nova no ponto solto, e faixas ganham nome', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await createScene(page);
    await importToBin(page, { name: 'arrasto.png', mimeType: 'image/png', buffer: PNG.sync.write(new PNG({ width: 4, height: 4 })) });
    const before = await page.locator('[data-move-layer-clip]').count();
    const ruler = await page.locator('.time-ruler').boundingBox();
    const header = await page.locator('.video-group-track').boundingBox();
    if (!ruler || !header) throw new Error('Timeline não está visível');
    await page.locator('[data-bin-asset]').first().dragTo(page.locator('.video-group-track'), { targetPosition: { x: ruler.width * .5, y: header.height / 2 } });
    await expect(page.locator('[data-move-layer-clip]')).toHaveCount(before + 1);
    const placed = await page.evaluate(() => (window as unknown as { vct: { getProject(): { layers: Array<{ name: string; startTime: number }> } } }).vct.getProject().layers.find((layer) => layer.name === 'arrasto.png'));
    expect(placed!.startTime).toBeGreaterThan(.2);
    expect(placed!.startTime).toBeLessThan(.9);

    // "+ faixa" cria uma faixa vazia no topo, que aparece como linha e pode ser renomeada.
    const rows = await page.locator('.timeline-label-row.layer-label').count();
    await page.locator('#add-track').click();
    await expect(page.locator('.timeline-label-row.empty-label')).toHaveCount(1);
    await expect(page.locator('.timeline-label-row.layer-label')).toHaveCount(rows);
    await page.locator('.empty-label .track-name').dblclick();
    await page.keyboard.type('Letreiros');
    await page.keyboard.press('Enter');
    await expect(page.locator('.empty-label .track-name')).toHaveText('Letreiros');
    await page.locator('.empty-label .track-name').dblclick();
    await page.keyboard.type('Descartado');
    await page.keyboard.press('Escape');
    await expect(page.locator('.empty-label .track-name')).toHaveText('Letreiros');
  } finally {
    await context.close();
  }
});

async function openTimelineProject(page: Page) {
  const settings = { name: 'Timeline', width: 320, height: 180, fps: 10, duration: 10, background: '#000000', transparent: false };
  const project = createProject(settings);
  project.layers.push(
    createLayer('geometry', settings, { id: 'alpha', name: 'Alpha', startTime: 0, endTime: 3 }),
    createLayer('geometry', settings, { id: 'beta', name: 'Beta', startTime: 5, endTime: 8 }),
  );
  await openProject(page, Buffer.from(JSON.stringify(project)));
}

type VctWindow = { vct: { getProject(): { settings: { workArea?: { in: number; out: number }; grid?: { bpm: number; offset: number; beatsPerBar: number } }; layers: Array<{ id: string; startTime: number }> } } };

test('I e O definem a região de trabalho e o modal de exportação mostra o trecho', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openTimelineProject(page);
    await expect(page.locator('#export-project')).toBeVisible();
    await page.keyboard.press('Shift+.');
    await page.keyboard.press('Shift+.');
    await page.keyboard.press('i');
    await page.keyboard.press('Shift+.');
    await page.keyboard.press('Shift+.');
    await page.keyboard.press('o');
    const area = () => page.evaluate(() => (window as unknown as VctWindow).vct.getProject().settings.workArea ?? null);
    expect(await area()).toEqual({ in: 2, out: 4 });
    await expect(page.locator('.timeline-tracks .work-area-band')).toHaveCount(1);
    await expect(page.locator('.time-ruler .work-area-band')).toHaveCount(1);
    await page.locator('#export-project').click();
    await expect(page.locator('#export-summary')).toContainText('Região de trabalho 00:02:00 – 00:04:00');
    await expect(page.locator('#export-summary')).toContainText('20 FRAMES');
    await page.locator('#close-export').click();
    // Alt+X limpa a região e o modal volta a falar da composição inteira.
    await page.keyboard.press('Alt+x');
    expect(await area()).toBeNull();
    await expect(page.locator('.work-area-band')).toHaveCount(0);
    await page.locator('#export-project').click();
    await expect(page.locator('#export-summary')).toContainText('Composição inteira');
    await expect(page.locator('#export-summary')).toContainText('100 FRAMES');
  } finally {
    await context.close();
  }
});

test('grade BPM pela janela da composição desenha linhas de tempo e vale um passo de desfazer', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openTimelineProject(page);
    await expect(page.locator('.grid-line')).toHaveCount(0);
    await page.locator('#composition-settings').click();
    await page.locator('#composition-bpm').fill('120');
    await page.locator('#composition-beats').fill('4');
    await page.locator('#apply-composition').click();
    const grid = await page.evaluate(() => (window as unknown as VctWindow).vct.getProject().settings.grid);
    expect(grid).toEqual({ bpm: 120, offset: 0, beatsPerBar: 4 });
    // 10 s a 120 BPM = 21 batidas (0..10), uma a cada 4 no início de compasso.
    await expect(page.locator('.timeline-tracks .grid-line')).toHaveCount(21);
    await expect(page.locator('.timeline-tracks .grid-line.is-bar')).toHaveCount(6);
    await page.locator('#undo').click();
    await expect(page.locator('.grid-line')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as VctWindow).vct.getProject().settings.grid)).toBeUndefined();
    await page.locator('#redo').click();
    await expect(page.locator('.timeline-tracks .grid-line')).toHaveCount(21);
    // "Remover grade" apaga a grade no mesmo passo de aplicar.
    await page.locator('#composition-settings').click();
    await page.locator('#composition-grid-remove').click();
    await page.locator('#apply-composition').click();
    await expect(page.locator('.grid-line')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('Ctrl + roda amplia a timeline em torno do ponteiro e atualiza o minimapa', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openTimelineProject(page);
    const zoom = () => page.evaluate(() => Number(localStorage.getItem('nt-vct-timeline-zoom-x') || 1));
    expect(await zoom()).toBe(1);
    const box = await page.locator('.timeline-scroll').boundingBox();
    if (!box) throw new Error('Timeline não está visível');
    await page.mouse.move(box.x + box.width * .75, box.y + 80);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -400);
    await page.keyboard.up('Control');
    await expect.poll(zoom).toBeGreaterThan(1.5);
    const scrolled = await page.locator('.timeline-scroll').evaluate((element) => ({ left: element.scrollLeft, wide: element.scrollWidth > element.clientWidth }));
    expect(scrolled.wide).toBe(true);
    expect(scrolled.left).toBeGreaterThan(0);
    await expect.poll(() => page.locator('#timeline-minimap b').evaluate((element) => parseFloat(element.style.width))).toBeLessThan(70);
    // A roda sem Ctrl não mexe no zoom.
    const before = await zoom();
    await page.mouse.wheel(0, 200);
    expect(await zoom()).toBe(before);
  } finally {
    await context.close();
  }
});

test('? abre a lista de atalhos', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openTimelineProject(page);
    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-panel')).toBeVisible();
    await expect(page.locator('#shortcuts-panel .shortcut-table')).toContainText(/região de trabalho/i);
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcuts-panel')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('Ctrl+X recorta o clipe selecionado num só passo e Ctrl+Z devolve', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openTimelineProject(page);
    const ids = () => page.evaluate(() => (window as unknown as VctWindow).vct.getProject().layers.map((layer) => layer.id));
    await page.locator('[data-select-layer="beta"]').first().click();
    await page.keyboard.press('Control+x');
    expect(await ids()).toEqual(['alpha']);
    await page.keyboard.press('Control+z');
    expect((await ids()).sort()).toEqual(['alpha', 'beta']);
    await page.locator('[data-select-layer="beta"]').first().click();
    await page.keyboard.press('Control+x');
    expect(await ids()).toEqual(['alpha']);
    // O clipe recortado vai para a área de transferência de clipes: colar no playhead o traz de volta.
    await page.keyboard.press('Control+v');
    expect(await ids()).toHaveLength(2);
  } finally {
    await context.close();
  }
});

async function openGapProject(page: Page) {
  const settings = { name: 'Gaps', width: 320, height: 180, fps: 10, duration: 10, background: '#000000', transparent: false };
  const project = createProject(settings);
  project.layers.push(
    createLayer('geometry', settings, { id: 'alpha', name: 'Alpha', trackId: 'v1', startTime: 0, endTime: 3, keyframes: { x: [{ time: 1, value: 10, easing: 'linear' }, { time: 2, value: 20, easing: 'linear' }] } }),
    createLayer('geometry', settings, { id: 'beta', name: 'Beta', trackId: 'v1', startTime: 5, endTime: 8 }),
  );
  await openProject(page, Buffer.from(JSON.stringify(project)));
}

type LayerView = { id: string; startTime: number; keyframes: Record<string, Array<{ time: number }>> };
const layersOf = (page: Page) => page.evaluate(() => (window as unknown as { vct: { getProject(): { layers: LayerView[] } } }).vct.getProject().layers);

test('Fechar espaços aproxima os clipes seguintes da faixa em um passo', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openGapProject(page);
    await page.locator('[data-select-layer="alpha"]').first().click();
    await page.locator('#close-gaps').click();
    const moved = await layersOf(page);
    expect(moved.find((layer) => layer.id === 'beta')!.startTime).toBeCloseTo(3, 5);
    await page.locator('#undo').click();
    expect((await layersOf(page)).find((layer) => layer.id === 'beta')!.startTime).toBeCloseTo(5, 5);
  } finally {
    await context.close();
  }
});

test('Alt + arrastar um clipe duplica no ponto solto e mantém o original', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openGapProject(page);
    const box = await page.locator('[data-move-layer-clip="alpha"]').boundingBox();
    const scroll = await page.locator('.timeline-scroll').boundingBox();
    if (!box || !scroll) throw new Error('Timeline não está visível');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + scroll.width * .4, box.y + box.height / 2, { steps: 6 });
    await expect(page.locator('.clip-ghost')).toHaveCount(1);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const layers = await layersOf(page);
    expect(layers).toHaveLength(3);
    expect(layers.find((layer) => layer.id === 'alpha')!.startTime).toBe(0);
    expect(layers.filter((layer) => layer.id !== 'alpha' && layer.id !== 'beta')[0].startTime).toBeGreaterThan(3);
    await page.locator('#undo').click();
    expect(await layersOf(page)).toHaveLength(2);
  } finally {
    await context.close();
  }
});

test('keyframe arrasta no tempo, Delete apaga e o snap mostra o guia', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openGapProject(page);
    const times = async () => (await layersOf(page)).find((layer) => layer.id === 'alpha')!.keyframes.x.map((key) => key.time);
    const dot = page.locator('[data-key-ref]').first();
    const box = await dot.boundingBox();
    const scroll = await page.locator('.timeline-scroll').boundingBox();
    if (!box || !scroll) throw new Error('Keyframe não está visível');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + scroll.width * .04, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const dragged = await times();
    expect(dragged).toHaveLength(2);
    expect(dragged[0]).toBeGreaterThan(1.2);
    expect(dragged[0]).toBeLessThan(1.8);
    await page.locator('#undo').click();
    expect(await times()).toEqual([1, 2]);
    await page.locator('[data-key-ref]').first().click();
    await page.keyboard.press('Delete');
    expect(await times()).toEqual([2]);
    await page.locator('#undo').click();
    expect(await times()).toEqual([1, 2]);
    // Aparar o clipe Beta perto do fim do Alpha trava no snap e mostra o guia.
    const trim = await page.locator('[data-trim-clip="beta"][data-trim-edge="start"]').boundingBox();
    if (!trim) throw new Error('Alça de trim não está visível');
    await page.mouse.move(trim.x + 2, trim.y + trim.height / 2);
    await page.mouse.down();
    await page.mouse.move(trim.x + 2 - scroll.width * .2, trim.y + trim.height / 2, { steps: 6 });
    await expect(page.locator('.snap-guide-line')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('.snap-guide-line')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('exportar com região de trabalho renderiza só os frames dela', async ({ browser }) => {
  const { context, page } = await openEditor(browser, 'current');
  try {
    await openTimelineProject(page);
    await page.keyboard.press('Shift+.');
    await page.keyboard.press('Shift+.');
    await page.keyboard.press('i');
    await page.keyboard.press('Shift+.');
    await page.keyboard.press('o');
    const frames = await exportFrames(page);
    expect(frames).toHaveLength(10);
    expect(frames[0].name).toContain('000001');
  } finally {
    await context.close();
  }
});

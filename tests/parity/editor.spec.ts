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
      const chooser = page.waitForEvent('filechooser');
      await page.locator('[data-add-input="video"]').click();
      await (await chooser).setFiles({ name: 'contador.webm', mimeType: 'video/webm', buffer: video });
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
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-add-input="image"]').click();
    await (await chooser).setFiles({
      name: 'recovery.png',
      mimeType: 'image/png',
      buffer: PNG.sync.write(new PNG({ width: 2, height: 2 })),
    });
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
    expect(apiResult.effectCount).toBe(15);
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

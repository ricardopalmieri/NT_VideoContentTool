import { expect, test, type Page } from '@playwright/test';

// Regressões visuais de efeitos: leem pixels do quadro devolvido por window.vct.captureFrame.
// Relato: blur num retângulo com traço largo (vinheta) virava grade de blocos e retângulos concêntricos;
// bloom em parede branca lavava a imagem. O pacote modular (src/renderer/effects) substituiu esses shaders:
// os testes de pipeline garantem a base (cache, framebuffers, bordas) e os demais cobrem cada efeito do pacote.

interface Frame { width: number; height: number; luma: number[]; rgb: number[] }

const W = 320;
const H = 180;

async function openProject(page: Page, background = '#ffffff') {
  await page.goto('http://127.0.0.1:4174/current/');
  await page.locator('[data-language="pt-BR"]').click();
  await page.locator('#new-project').click();
  for (const [name, value] of Object.entries({ name: 'Efeitos', width: String(W), height: String(H), fps: '10', duration: '4' })) {
    await page.locator(`#setup-form [name="${name}"]`).fill(value);
  }
  await page.locator('#setup-form button[type="submit"]').click();
  await page.evaluate((bg) => window.vct.batch([{ type: 'composition.set', props: { background: bg, transparent: false } }] as never), background);
}

// Luminância 0..255 do quadro capturado, linha a linha.
async function capture(page: Page, time = 1): Promise<Frame> {
  return page.evaluate(async (t) => {
    const frame = await window.vct.captureFrame({ time: t, maxWidth: 4096 });
    const image = new Image();
    image.src = frame.dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const luma: number[] = [];
    const rgb: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      luma.push(Math.round(data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114));
      rgb.push(data[i], data[i + 1], data[i + 2]);
    }
    return { width: canvas.width, height: canvas.height, luma, rgb };
  }, time);
}

const row = (frame: Frame, y: number) => frame.luma.slice(y * frame.width, (y + 1) * frame.width);
const column = (frame: Frame, x: number) => Array.from({ length: frame.height }, (_, y) => frame.luma[y * frame.width + x]);
const at = (frame: Frame, x: number, y: number) => frame.luma[y * frame.width + x];

// Degraus entre pixels vizinhos e quantas vezes a tendência inverte (ruído de JPEG fica abaixo de `noise`).
function profileStats(values: number[], noise = 3) {
  let maxStep = 0;
  let flips = 0;
  let direction = 0;
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    maxStep = Math.max(maxStep, Math.abs(delta));
    if (Math.abs(delta) < noise) continue;
    const sign = Math.sign(delta);
    if (direction && sign !== direction) flips++;
    direction = sign;
  }
  return { maxStep, flips };
}

const SHAPES = [
  { name: 'menor que o quadro', width: 200, height: 100, stroke: 30 },
  { name: 'igual ao quadro', width: W, height: H, stroke: 60 },
  { name: 'maior que o quadro', width: 560, height: 300, stroke: 200 },
] as const;

// Passes de identidade (levels neutro, recorte total) atravessam o shader de efeitos e o ping-pong
// de framebuffers; o resultado tem de ser idêntico ao composite sem efeito, em qualquer tamanho.
for (const path of ['cache de textura', 'sem cache (rastro)'] as const) {
  for (const shape of SHAPES) {
    test(`pipeline: passes de identidade são idênticos a sem efeito, traço ${shape.name} (${path})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      try {
        await openProject(page);
        const trail = path === 'sem cache (rastro)'
          ? [{ type: 'effect.add', kind: 'feedback', ownerId: 'vinheta', effectId: 'trail1' },
            { type: 'effect.setParam', effectId: 'trail1', parameter: 'count', value: 1 }]
          : [];
        await page.evaluate((commands) => window.vct.batch(commands as never), [
          { type: 'layer.create', layerId: 'vinheta', kind: 'geometry', name: 'Vinheta', startTime: 0, endTime: 4,
            props: { x: W / 2, y: H / 2, width: shape.width, height: shape.height, fillEnabled: false, strokeEnabled: true, stroke: '#000000', strokeWidth: shape.stroke } },
          ...trail,
        ]);
        const plain = await capture(page, 1);
        // Três passes seguidos: o terceiro lê o alvo que o primeiro escreveu.
        await page.evaluate((commands) => window.vct.batch(commands as never), [
          { type: 'effect.add', kind: 'levels', ownerId: 'vinheta', effectId: 'id1' },
          { type: 'effect.add', kind: 'crop', ownerId: 'vinheta', effectId: 'id2' },
          { type: 'effect.add', kind: 'levels', ownerId: 'vinheta', effectId: 'id3' },
        ]);
        const first = await capture(page, 1);
        const second = await capture(page, 1.5);
        for (const frame of [first, second]) {
          let worst = 0;
          for (let i = 0; i < plain.luma.length; i++) worst = Math.max(worst, Math.abs(frame.luma[i] - plain.luma[i]));
          expect(worst, `diferença máxima ${worst}`).toBeLessThanOrEqual(2);
        }
        // O traço aparece (o teste não passa por estar tudo preto ou tudo branco).
        expect(new Set(plain.luma.map((value) => value > 128)).size).toBe(2);
      } finally {
        await context.close();
      }
    });
  }
}

test('pipeline: raster em cache e raster sem cache dão o mesmo quadro', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openProject(page);
    await page.evaluate((commands) => window.vct.batch(commands as never), [
      { type: 'layer.create', layerId: 'vinheta', kind: 'geometry', name: 'Vinheta', startTime: 0, endTime: 4,
        props: { x: W / 2, y: H / 2, width: 560, height: 300, fillEnabled: false, strokeEnabled: true, stroke: '#000000', strokeWidth: 200 } },
    ]);
    const cached = await capture(page, 1);
    await page.evaluate((commands) => window.vct.batch(commands as never), [
      { type: 'effect.add', kind: 'feedback', ownerId: 'vinheta', effectId: 'trail1' },
      { type: 'effect.setParam', effectId: 'trail1', parameter: 'count', value: 1 },
    ]);
    const uncached = await capture(page, 1);
    let worst = 0;
    for (let i = 0; i < cached.luma.length; i++) worst = Math.max(worst, Math.abs(cached.luma[i] - uncached.luma[i]));
    expect(worst).toBeLessThanOrEqual(2);
    // Fora do traço o quadro é branco e dentro dele, preto: sem grade, sem retângulos concêntricos.
    expect(at(cached, W / 2, H / 2)).toBeGreaterThan(250);
    expect(at(cached, W / 2, 2)).toBeLessThan(5);
    expect(profileStats(column(cached, W / 2)).flips).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});

for (const path of ['cache de textura', 'sem cache (rastro)'] as const) {
  for (const shape of SHAPES) {
    for (const { radius, quality } of [{ radius: 8, quality: 2 }, { radius: 30, quality: 1 }, { radius: 12, quality: 3 }]) {
      test(`blur de vinheta ${shape.name}, raio ${radius} q${quality}: gradiente suave (${path})`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        try {
          await openProject(page);
          const effects: unknown[] = [
            { type: 'effect.add', kind: 'blur', ownerId: 'vinheta', effectId: 'blur1' },
            { type: 'effect.setParam', effectId: 'blur1', parameter: 'radius', value: radius },
            { type: 'effect.setParam', effectId: 'blur1', parameter: 'quality', value: quality },
          ];
          if (path === 'sem cache (rastro)') {
            // Trilha com uma amostra: a layer passa pelo raster compartilhado, fora do cache.
            effects.unshift(
              { type: 'effect.add', kind: 'feedback', ownerId: 'vinheta', effectId: 'trail1' },
              { type: 'effect.setParam', effectId: 'trail1', parameter: 'count', value: 1 },
            );
          }
          await page.evaluate((commands) => window.vct.batch(commands as never), [
            { type: 'layer.create', layerId: 'vinheta', kind: 'geometry', name: 'Vinheta', startTime: 0, endTime: 4,
              props: { x: W / 2, y: H / 2, width: shape.width, height: shape.height, fillEnabled: false, strokeEnabled: true, stroke: '#000000', strokeWidth: shape.stroke } },
            ...effects,
          ]);
          // Duas capturas: a segunda reaproveita o raster em cache quando ele existe.
          await capture(page, 1);
          const frame = await capture(page, 1.5);
          expect(frame.width).toBe(W);
          const lines = [row(frame, H / 2), row(frame, 30), column(frame, W / 2), column(frame, 40)];
          for (const line of lines) {
            const { maxStep, flips } = profileStats(line);
            // Gaussiana de sigma ~1.7×raio: o maior degrau de 0 a 255 fica bem abaixo disso.
            expect(maxStep, `degrau ${maxStep}`).toBeLessThanOrEqual(Math.max(20, 255 / (radius * 1.7 * 2.5) * 2.5));
            // A vinheta pequena cruza duas barras de traço (duas depressões = 3 inversões); sem grade nem eco.
            expect(flips, `inversões ${flips}`).toBeLessThanOrEqual(3);
          }
          if (shape.name === 'maior que o quadro') {
            // Da borda preta do quadro até o miolo branco a luminância só sobe.
            const half = column(frame, W / 2).slice(0, H / 2);
            for (let i = 1; i < half.length; i++) expect(half[i]).toBeGreaterThanOrEqual(half[i - 1] - 3);
            expect(half[0]).toBeLessThan(40);
            expect(half.at(-1)).toBeGreaterThan(215);
          }
        } finally {
          await context.close();
        }
      });
    }
  }
}

async function glowScene(page: Page, wall: string, floor: string, glow: Record<string, number>) {
  await openProject(page, '#000000');
  await page.evaluate(([wallColor, floorColor, params]) => window.vct.batch([
    { type: 'layer.create', layerId: 'chao', kind: 'geometry', name: 'Chao', startTime: 0, endTime: 4,
      props: { x: 48, y: 90, width: 96, height: 180, fill: floorColor } },
    { type: 'layer.create', layerId: 'parede', kind: 'geometry', name: 'Parede', startTime: 0, endTime: 4,
      props: { x: 96 + 112, y: 90, width: 224, height: 180, fill: wallColor } },
    { type: 'effect.add', kind: 'glow', ownerId: '__post__', effectId: 'glow1' },
    ...Object.entries(params as Record<string, number>).map(([parameter, value]) => ({ type: 'effect.setParam', effectId: 'glow1', parameter, value })),
  ] as never), [wall, floor, glow] as const);
}

test('bloom: parede quase branca não lava a imagem (limiar .82, intensidade .35)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await glowScene(page, '#ebebeb', '#666666', { threshold: .82, intensity: .35, radius: 14, knee: .22 });
    const frame = await capture(page);
    // Parede (235) fica perto de 235, não estoura em 255.
    expect(Math.abs(at(frame, 250, 90) - 235)).toBeLessThanOrEqual(10);
    expect(at(frame, 250, 90)).toBeLessThan(248);
    // O chão longe da parede (102) quase não muda.
    expect(at(frame, 6, 90) - 102).toBeLessThanOrEqual(6);
    expect(at(frame, 6, 90) - 102).toBeGreaterThanOrEqual(-3);
    // Junto à parede o brilho vaza, mas pouco.
    expect(at(frame, 90, 90) - 102).toBeLessThanOrEqual(30);
  } finally {
    await context.close();
  }
});

test('bloom: nada acima do limiar, nada muda', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await glowScene(page, '#808080', '#404040', { threshold: .82, intensity: 3, radius: 30, knee: .1 });
    const frame = await capture(page);
    expect(Math.abs(at(frame, 250, 90) - 128)).toBeLessThanOrEqual(3);
    expect(Math.abs(at(frame, 20, 90) - 64)).toBeLessThanOrEqual(3);
    expect(Math.abs(at(frame, 96, 90) - 96)).toBeLessThanOrEqual(40);
  } finally {
    await context.close();
  }
});

test('bloom: ponto branco irradia em halo suave e some com a distância', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openProject(page, '#000000');
    await page.evaluate(() => window.vct.batch([
      { type: 'layer.create', layerId: 'luz', kind: 'geometry', name: 'Luz', startTime: 0, endTime: 4,
        props: { x: 160, y: 90, width: 24, height: 24, fill: '#ffffff' } },
      { type: 'effect.add', kind: 'glow', ownerId: '__post__', effectId: 'glow1' },
      { type: 'effect.setParam', effectId: 'glow1', parameter: 'threshold', value: .5 },
      { type: 'effect.setParam', effectId: 'glow1', parameter: 'intensity', value: 1.5 },
      { type: 'effect.setParam', effectId: 'glow1', parameter: 'radius', value: 10 },
    ] as never));
    const frame = await capture(page);
    const profile = row(frame, 90).slice(172);
    expect(at(frame, 160, 90)).toBeGreaterThan(240);
    expect(profile[4]).toBeGreaterThan(20);
    expect(profile[4]).toBeGreaterThan(profile[24]);
    expect(profile.at(-1)).toBeLessThanOrEqual(3);
    // Halo monotônico, sem anéis.
    for (let i = 1; i < profile.length; i++) expect(profile[i]).toBeLessThanOrEqual(profile[i - 1] + 3);
    expect(profileStats(profile).maxStep).toBeLessThanOrEqual(40);
  } finally {
    await context.close();
  }
});

// --- Efeitos novos do pacote modular -------------------------------------------------------------------------

type Command = Record<string, unknown>;
const run = (page: Page, commands: Command[]) => page.evaluate((list) => window.vct.batch(list as never), commands);
const rect = (id: string, x: number, y: number, width: number, height: number, fill: string): Command =>
  ({ type: 'layer.create', layerId: id, kind: 'geometry', name: id, startTime: 0, endTime: 4, props: { x, y, width, height, fill } });
const addEffect = (kind: string, ownerId: string, effectId: string, params: Record<string, number> = {}): Command[] => [
  { type: 'effect.add', kind, ownerId, effectId },
  ...Object.entries(params).map(([parameter, value]) => ({ type: 'effect.setParam', effectId, parameter, value })),
];
const setParam = (effectId: string, parameter: string, value: number): Command => ({ type: 'effect.setParam', effectId, parameter, value });
const channel = (frame: Frame, x: number, y: number, index: number) => frame.rgb[(y * frame.width + x) * 3 + index];

async function withProject(browser: import('@playwright/test').Browser, background: string, body: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openProject(page, background);
    await body(page);
  } finally {
    await context.close();
  }
}

test('cor: exposição +1 dobra o cinza, temperatura esquenta e esfria', async ({ browser }) => {
  await withProject(browser, '#000000', async (page) => {
    await run(page, [rect('cinza', 160, 90, 320, 180, '#5a5a5a'), ...addEffect('levels', 'cinza', 'cor1')]);
    expect(Math.abs(at(await capture(page), 160, 90) - 90)).toBeLessThanOrEqual(2);
    await run(page, [setParam('cor1', 'exposure', 1)]);
    expect(Math.abs(at(await capture(page), 160, 90) - 180)).toBeLessThanOrEqual(4);
    await run(page, [setParam('cor1', 'exposure', 0), setParam('cor1', 'temperature', 1)]);
    const warm = await capture(page);
    expect(channel(warm, 160, 90, 0) - channel(warm, 160, 90, 2)).toBeGreaterThan(15);
    await run(page, [setParam('cor1', 'temperature', -1)]);
    const cool = await capture(page);
    expect(channel(cool, 160, 90, 2) - channel(cool, 160, 90, 0)).toBeGreaterThan(15);
  });
});

test('vinheta: cantos escurecem, centro e DRY / WET 0 não mudam', async ({ browser }) => {
  await withProject(browser, '#ffffff', async (page) => {
    await run(page, addEffect('vignette', '__post__', 'vig1', { darkness: .8, offset: .6 }));
    const frame = await capture(page);
    expect(at(frame, 160, 90)).toBeGreaterThan(250);
    expect(at(frame, 2, 2)).toBeLessThan(120);
    expect(at(frame, 160, 90)).toBeGreaterThan(at(frame, 40, 90));
    expect(at(frame, 40, 90)).toBeGreaterThan(at(frame, 2, 2));
    await run(page, [setParam('vig1', 'mix', 0)]);
    expect(at(await capture(page), 2, 2)).toBeGreaterThan(250);
  });
});

test('aberração cromática: canais se separam na borda e não no centro', async ({ browser }) => {
  await withProject(browser, '#000000', async (page) => {
    await run(page, [
      rect('centro', 160, 90, 40, 60, '#ffffff'), rect('borda', 290, 90, 40, 60, '#ffffff'),
      ...addEffect('chromaticAberration', '__post__', 'ca1', { offset: 14 }),
    ]);
    const frame = await capture(page);
    let center = 0;
    let edge = 0;
    let edgeCount = 0;
    for (let y = 70; y < 110; y++) {
      for (let x = 135; x < 185; x++) if (Math.abs(channel(frame, x, y, 0) - channel(frame, x, y, 2)) > 40) center++;
      for (let x = 262; x < 318; x++) {
        const difference = Math.abs(channel(frame, x, y, 0) - channel(frame, x, y, 2));
        edge = Math.max(edge, difference);
        if (difference > 40) edgeCount++;
      }
    }
    // No centro o deslocamento é de ~1 px (só a franja da borda); na borda chega a ~11 px.
    expect(edge).toBeGreaterThan(200);
    expect(edgeCount).toBeGreaterThan(center * 3);
  });
});

test('nitidez: o lado claro de uma borda fica mais claro e as áreas planas não mudam', async ({ browser }) => {
  await withProject(browser, '#505050', async (page) => {
    await run(page, [rect('claro', 240, 90, 160, 180, '#b0b0b0'), ...addEffect('sharpen', 'claro', 'sh1', { amount: 2, radius: 2 })]);
    const frame = await capture(page);
    expect(at(frame, 162, 90)).toBeGreaterThan(0xb0 + 12);
    expect(Math.abs(at(frame, 240, 90) - 0xb0)).toBeLessThanOrEqual(2);
    expect(Math.abs(at(frame, 40, 90) - 0x50)).toBeLessThanOrEqual(2);
  });
});

test('grão de filme: varia por pixel e por instante, e amount 0 não muda nada', async ({ browser }) => {
  await withProject(browser, '#808080', async (page) => {
    await run(page, addEffect('noise', '__post__', 'gr1', { amount: .3, scale: 1 }));
    const a = await capture(page, 1);
    const b = await capture(page, 1.5);
    const mean = a.luma.reduce((sum, value) => sum + value, 0) / a.luma.length;
    const deviation = Math.sqrt(a.luma.reduce((sum, value) => sum + (value - mean) ** 2, 0) / a.luma.length);
    expect(Math.abs(mean - 128)).toBeLessThan(6);
    expect(deviation).toBeGreaterThan(8);
    expect(deviation).toBeLessThan(60);
    expect(a.luma.filter((value, index) => Math.abs(value - b.luma[index]) > 6).length).toBeGreaterThan(a.luma.length * .3);
    await run(page, [setParam('gr1', 'amount', 0)]);
    expect((await capture(page)).luma.every((value) => Math.abs(value - 128) <= 1)).toBe(true);
  });
});

test('zoom blur: o quadrado branco longe do centro deixa rastro na direção do centro', async ({ browser }) => {
  await withProject(browser, '#000000', async (page) => {
    await run(page, [rect('luz', 270, 90, 24, 24, '#ffffff')]);
    expect(at(await capture(page), 235, 90)).toBeLessThan(5);
    await run(page, addEffect('zoomBlur', 'luz', 'zb1', { strength: .6 }));
    const frame = await capture(page);
    // O rastro vai do quadrado para fora (cada pixel amostra na direção do centro); o lado de dentro e o centro ficam escuros.
    expect(at(frame, 296, 90)).toBeGreaterThan(25);
    expect(at(frame, 316, 90)).toBeGreaterThan(25);
    expect(at(frame, 235, 90)).toBeLessThan(5);
    expect(at(frame, 160, 90)).toBeLessThan(5);
  });
});

test('tilt-shift: faixa em foco fica nítida e as bordas, borradas', async ({ browser }) => {
  await withProject(browser, '#000000', async (page) => {
    await run(page, [
      rect('foco', 160, 90, 200, 4, '#ffffff'), rect('topo', 160, 12, 200, 4, '#ffffff'),
      ...addEffect('tiltShift', 'foco', 'ts1', { blur: 14, gradient: 60, focus: .5 }),
      ...addEffect('tiltShift', 'topo', 'ts2', { blur: 14, gradient: 60, focus: .5 }),
    ]);
    const frame = await capture(page);
    const peak = (y: number) => Math.max(...column(frame, 160).slice(y - 8, y + 9));
    expect(peak(90)).toBeGreaterThan(240);
    expect(peak(12)).toBeLessThan(150);
    expect(peak(12)).toBeGreaterThan(10);
  });
});

test('meio-tom: um cinza uniforme vira retícula de pontos', async ({ browser }) => {
  await withProject(browser, '#000000', async (page) => {
    await run(page, [rect('cinza', 160, 90, 320, 180, '#808080')]);
    expect(new Set((await capture(page)).luma).size).toBe(1);
    await run(page, addEffect('halftone', 'cinza', 'ht1', { size: 16, angle: 0 }));
    const frame = await capture(page);
    expect(Math.min(...frame.luma)).toBeLessThan(60);
    expect(Math.max(...frame.luma)).toBeGreaterThan(190);
    // Pontos suaves (não é ruído) e cobertura média de um cinza médio.
    const line = row(frame, 90);
    let changes = 0;
    for (let x = 1; x < W; x++) changes += Math.abs(line[x] - line[x - 1]);
    expect(changes / (W - 1)).toBeLessThan(40);
    const mean = frame.luma.reduce((sum, value) => sum + value, 0) / frame.luma.length;
    expect(mean).toBeGreaterThan(70);
    expect(mean).toBeLessThan(190);
  });
});

test('glitch: blocos mudam de tamanho entre instantes, o mesmo instante repete e amount 0 não muda', async ({ browser }) => {
  await withProject(browser, '#000000', async (page) => {
    // 32 faixas de 10 px com cinzas distintos: qualquer deslocamento horizontal maior que ~10 px altera o pixel.
    await run(page, Array.from({ length: 32 }, (_, index) => rect(`faixa${index}`, 5 + index * 10, 90, 10, 180, `#${(index * 8).toString(16).padStart(2, '0').repeat(3)}`)));
    const plain = await capture(page, 1);
    await run(page, addEffect('glitch', '__post__', 'gl1', { amount: .8, frequency: 6, blockSize: 120, shift: .2, rgbSplit: 0, scanlines: 0 }));
    // Largura (percentil 75) dos trechos alterados por linha, em vários instantes.
    const widths: number[] = [];
    for (const time of [.2, .5, .8, 1.1, 1.4, 1.7, 2, 2.3]) {
      const frame = await capture(page, time);
      const lengths: number[] = [];
      for (let y = 0; y < H; y++) {
        let length = 0;
        for (let x = 0; x <= W; x++) {
          const changed = x < W && Math.abs(frame.luma[y * W + x] - plain.luma[y * W + x]) > 12;
          if (changed) length++;
          else if (length) { lengths.push(length); length = 0; }
        }
      }
      // Nem todo instante tem rajada: só os ativos entram na comparação.
      if (lengths.length < 5) continue;
      lengths.sort((a, b) => a - b);
      widths.push(Math.round(lengths[Math.floor(lengths.length * .75)] / 16));
    }
    expect(widths.length, `instantes ativos ${widths}`).toBeGreaterThanOrEqual(4);
    expect(new Set(widths).size, `larguras ${widths}`).toBeGreaterThanOrEqual(3);
    expect((await capture(page, 1.1)).luma).toEqual((await capture(page, 1.1)).luma);
    await run(page, [setParam('gl1', 'amount', 0)]);
    expect((await capture(page, 1.1)).luma).toEqual(plain.luma);
  });
});

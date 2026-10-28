import { expect, test, type Page } from '@playwright/test';

// Legenda automática com um motor falso: a suíte nunca baixa um modelo. O app usa
// globalThis.__VCT_TRANSCRIBE_ENGINE__ quando existe (src/transcribe/protocol.ts); o
// motor real, com Whisper de verdade, é conferido à parte (scripts de verificação manual).
function speechWav(seconds = 6) {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * index / rate) * 6000), 44 + index * 2);
  return buffer;
}

interface Tuning { blockSeconds: number; overlapSeconds: number; minTailSeconds: number; stallMs: number }

async function openProject(page: Page, options: { tuning?: Partial<Tuning>; duration?: string; media?: Buffer; place?: boolean; width?: string; height?: string } = {}) {
  await page.addInitScript((tuning) => {
    const win = window as unknown as { __release?: () => void };
    const abortable = (signal?: AbortSignal) => new Promise<never>((_, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Cancelada', 'AbortError')), { once: true });
    });
    // Falas em tempos absolutos do áudio; cada bloco devolve as que começam dentro dele (as da sobreposição saem nos dois).
    const script = [.5, 1.5, 2.5, 3.5, 4.5, 5.2, 5.7].map((start, index) => ({ start, end: start + .9, text: `Fala ${index + 1}` }));
    const engine = {
      cached: false,
      /** Bloco em que o motor para de responder (o watchdog da página precisa agir). */
      hangAt: -1,
      /** Manda sinal de vida (onAlive) enquanto espera, como o worker real faz a cada 3 s. */
      beat: false,
      /** Trava montando o modelo (vivo, sem progresso), como a WebGPU que não termina de compilar. */
      hangLoading: false,
      requests: [] as Array<{ model: string; language: string; source: string; profile: string; samples: number; blocks: number; startBlock: number; words: boolean }>,
      imported: [] as string[],
      async availability() { return this.cached ? 'cache' : 'download'; },
      async importFiles(_model: string, files: File[]) {
        this.imported = files.map((file) => file.name);
        this.cached = true;
        return { stored: this.imported, missing: [], rejected: [] };
      },
      async transcribe(request: {
        model: string; language: string; source: string; profile: string; audio: Float32Array; blocks: Array<{ index: number; start: number; end: number }>;
        startBlock?: number; wordTimestamps: boolean; onProgress(progress: object): void;
        onBlock(result: { index: number; segments: object[]; wordLevel: boolean }): void; signal?: AbortSignal;
      }) {
        this.requests.push({
          model: request.model, language: request.language, source: request.source, profile: request.profile, samples: request.audio.length,
          blocks: request.blocks.length, startBlock: request.startBlock ?? 0, words: request.wordTimestamps,
        });
        const beat = this.beat;
        const wait = () => new Promise<void>((resolve, reject) => {
          const timer = beat ? setInterval(() => (request as { onAlive?: () => void }).onAlive?.(), 100) : 0;
          win.__release = () => { clearInterval(timer); win.__release = undefined; resolve(); };
          request.signal?.addEventListener('abort', () => { clearInterval(timer); reject(new DOMException('Cancelada', 'AbortError')); }, { once: true });
        });
        if (request.source === 'download') {
          request.onProgress({ phase: 'download', loaded: 40e6, total: 80e6 });
          await wait();
          request.onProgress({ phase: 'download', loaded: 80e6, total: 80e6 });
          this.cached = true;
        } else {
          request.onProgress({ phase: 'loading', loaded: 80e6, total: 80e6 });
          if (this.hangLoading) {
            const timer = setInterval(() => (request as { onAlive?: () => void }).onAlive?.(), 100);
            try { await abortable(request.signal); } finally { clearInterval(timer); }
          }
        }
        const total = request.blocks.length;
        const word = (text: string, start: number) => ({ text, start, end: start + .35 });
        for (let position = request.startBlock ?? 0; position < total; position++) {
          const block = request.blocks[position];
          request.onProgress({ phase: 'transcribing', chunksDone: position, chunksTotal: total, blockFraction: 0, device: 'wasm' });
          // Baixando: o portão do download já valeu. Senão, cada bloco espera a liberação do teste.
          if (this.hangAt === position) {
            const timer = beat ? setInterval(() => (request as { onAlive?: () => void }).onAlive?.(), 100) : 0;
            try { await abortable(request.signal); } finally { clearInterval(timer); }
          }
          if (request.source !== 'download') await wait();
          const from = block.start / 16000;
          const to = block.end / 16000;
          const segments = total === 1
            ? [
              { start: .5, end: 2.6, text: 'Olá, esta é a primeira legenda.', words: ['Olá,', 'esta', 'é', 'a', 'primeira', 'legenda.'].map((text, index) => word(text, .5 + index * .35)) },
              { start: 3, end: 5, text: 'Aqui vem a segunda.', words: ['Aqui', 'vem', 'a', 'segunda.'].map((text, index) => word(text, 3 + index * .4)) },
            ].map((segment) => ({ ...segment, start: segment.start + from, end: segment.end + from, words: segment.words.map((item) => ({ ...item, start: item.start + from, end: item.end + from })) }))
            : script.filter((item) => item.start >= from && item.start < to);
          request.onBlock({ index: block.index, segments, wordLevel: true });
        }
        return { device: 'wasm' as const };
      },
    };
    Object.defineProperty(globalThis, '__VCT_TRANSCRIBE_ENGINE__', { value: engine, configurable: true });
    if (tuning) Object.defineProperty(globalThis, '__VCT_TRANSCRIBE_TUNING__', { value: tuning, configurable: true });
  }, options.tuning ?? null);
  await page.goto('http://127.0.0.1:4174/current/');
  await page.locator('[data-language="pt-BR"]').click();
  await page.locator('#new-project').click();
  for (const [name, value] of Object.entries({ name: 'Legendas', width: options.width ?? '320', height: options.height ?? '180', fps: '10', duration: options.duration ?? '8' })) {
    await page.locator(`#setup-form [name="${name}"]`).fill(value);
  }
  await page.locator('#setup-form button[type="submit"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-bin-import]').first().click();
  await (await chooser).setFiles([{ name: 'fala.wav', mimeType: 'audio/wav', buffer: options.media ?? speechWav() }]);
  await expect(page.locator('[data-bin-asset]')).toHaveCount(1);
  await page.locator('[data-bin-asset]').filter({ hasText: 'fala.wav' }).click();
  if (options.place !== false) await page.locator('[data-bin-place="new-track"]').click();
}

// Libera o próximo ponto de espera do motor falso (download ou bloco), assim que ele chegar lá.
async function release(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __release?: () => void }).__release));
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
}

/** Três blocos de 3 s (sobreposição de 0,5 s) nos 6 s de fala do áudio de teste. */
const THREE_BLOCKS = { blockSeconds: 3, overlapSeconds: .5, minTailSeconds: 0 };

const requests = (page: Page) => page.evaluate(() => (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { requests: Array<Record<string, unknown>> } }).__VCT_TRANSCRIBE_ENGINE__.requests);

test('legenda automática: aviso de download, progresso, revisão e inserção', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page);
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');

    // Primeira vez: aviso com nome, tamanho e fonte; três saídas.
    const note = modal.locator('.transcribe-note.is-warning');
    await expect(note).toContainText('Whisper base');
    await expect(note).toContainText('80 MB');
    await expect(note).toContainText('Hugging Face');
    await expect(note).toContainText('não baixa de novo');
    await expect(modal.locator('[data-transcribe-go]')).toHaveText(/Baixar e legendar/);
    await expect(modal.locator('[data-transcribe-manual]')).toHaveText(/Usar arquivos do modelo \(sem internet\)/);
    await expect(modal.locator('[data-transcribe-close]').last()).toHaveText(/Cancelar/);
    await expect(modal.locator('[data-transcribe-source] option')).toContainText(['Mixagem da timeline', 'Mídia: fala.wav']);
    await page.screenshot({ path: info.outputPath('aviso.png') });

    // Teclado: o foco fica dentro do diálogo, e Esc cancela.
    expect(await page.evaluate(() => document.activeElement?.closest('.transcribe-modal') !== null)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await page.locator('[data-auto-subtitles]').click();

    await modal.locator('[data-transcribe-language]').selectOption('pt');
    await modal.locator('[data-transcribe-source]').selectOption('mix');
    await modal.locator('[data-transcribe-go]').click();
    // Download: bytes e porcentagem vêm do motor.
    await expect(modal.locator('[data-transcribe-phase]')).toHaveText(/Baixando o modelo/);
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('40,0 de 80,0 MB · 50%');
    await release(page);
    // Transcrição: pedaços feitos e total.
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    const srt = modal.locator('.transcribe-srt');
    await expect(srt).toHaveValue(/Olá, esta é a primeira legenda\./);
    await expect(srt).toHaveValue(/00:00:0\d,\d{3} --> /);
    await expect(modal.locator('[data-transcribe-count]')).toContainText('2 legendas');
    await page.screenshot({ path: info.outputPath('revisao.png') });

    // O texto é editável e a inserção usa o texto editado.
    await srt.fill((await srt.inputValue()).replace('segunda', 'terceira'));
    // Aparência: a sombra vem ligada e o tamanho padrão é M; aqui vai G, em cima.
    await expect(modal.locator('[data-subtitle-shadow]')).toBeChecked();
    await expect(modal.locator('[data-subtitle-size][value="medium"]')).toBeChecked();
    await modal.locator('[data-subtitle-size][value="large"]').check();
    await modal.locator('[data-subtitle-position]').selectOption('top');
    await modal.locator('[data-transcribe-insert]').click();
    await expect(modal).toHaveCount(0);
    const styled = await page.evaluate(() => {
      const project = window.vct.getProject() as unknown as { settings: { height: number }; layers: Array<{ name: string; fontSize: number; y: number; shadowOpacity?: number }> };
      return { height: project.settings.height, layers: project.layers.filter((layer) => layer.name.startsWith('Legenda')) };
    });
    expect(styled.layers).toHaveLength(2);
    for (const layer of styled.layers) {
      expect(layer.fontSize).toBe(Math.round(styled.height * .07));
      expect(layer.y).toBeLessThan(styled.height / 2);
      expect(layer.shadowOpacity).toBeGreaterThan(0);
    }
    const inserted = await page.evaluate(() => ({
      tracks: window.vct.getTimeline().tracks.map((track) => ({ name: track.name, clips: track.clips.map((clip) => clip.text) })),
      status: window.vct.status(),
    }));
    const subtitles = inserted.tracks.find((track) => track.name === 'Legendas');
    expect(subtitles?.clips).toHaveLength(2);
    expect(subtitles?.clips.join(' ')).toContain('terceira');
    expect(inserted.status).toContain('Desfazer: Legenda automática');
    expect(await page.evaluate(() => (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { requests: unknown[] } }).__VCT_TRANSCRIBE_ENGINE__.requests)).toMatchObject([{ model: 'base', language: 'pt', source: 'download', blocks: 1, startBlock: 0, words: true }]);
    // Um áudio de verdade foi preparado em 16 kHz mono: 8 s de mixagem.
    expect(await page.evaluate(() => (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { requests: Array<{ samples: number }> } }).__VCT_TRANSCRIBE_ENGINE__.requests[0].samples)).toBe(8 * 16000);

    // Uma passo de desfazer remove todas as legendas.
    await page.evaluate(() => window.vct.undo());
    expect(await page.evaluate(() => window.vct.getTimeline().tracks.some((track) => track.name === 'Legendas'))).toBe(false);

    // Já baixado: nada de aviso na vez seguinte, o botão já diz Legendar.
    await page.locator('[data-auto-subtitles]').click();
    await expect(modal.locator('[data-transcribe-go]')).toHaveText(/^Legendar/);
    await expect(modal.locator('.transcribe-note.is-warning')).toHaveCount(0);
    await expect(modal.locator('[data-transcribe-note]')).toContainText('já está guardado neste navegador');
    await expect(modal.locator('[data-transcribe-manual]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('legenda automática: arquivos do modelo escolhidos à mão e cancelamento', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page, { tuning: THREE_BLOCKS });
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    await modal.locator('[data-transcribe-model]').selectOption('small');
    await expect(modal.locator('.transcribe-note.is-warning')).toContainText('252 MB');
    await modal.locator('[data-transcribe-manual]').click();
    const panel = modal.locator('[data-transcribe-manual-panel]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('onnx/encoder_model_quantized.onnx');
    await expect(panel.locator('[data-transcribe-pick="folder"]')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await panel.locator('[data-transcribe-pick="files"]').click();
    await (await chooser).setFiles([{ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from('{}') }]);
    // Sem rede: depois de guardar, o modelo conta como disponível e o aviso some.
    await expect(modal.locator('[data-transcribe-go]')).toHaveText(/^Legendar/);
    await expect(modal.locator('[data-transcribe-note]')).toContainText('já está guardado');
    expect(await page.evaluate(() => (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { imported: string[] } }).__VCT_TRANSCRIBE_ENGINE__.imported)).toEqual(['config.json']);

    // Sem aviso, começa direto; Cancelar interrompe e fecha.
    await modal.locator('[data-transcribe-go]').click();
    await expect(modal.locator('[data-transcribe-phase]')).toHaveText(/Transcrevendo/);
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('bloco 1 de 3');
    expect(await page.evaluate(() => window.vct.status())).toContain('Legenda automática: transcrevendo');
    await modal.locator('[data-transcribe-close]').last().click();
    await expect(modal).toHaveCount(0);
    expect(await page.evaluate(() => window.vct.status())).toContain('cancelada');
  } finally {
    await context.close();
  }
});

test('vct.transcribe devolve na hora, mostra o aviso à pessoa e entrega o SRT', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page);
    const asset = await page.evaluate(() => window.vct.assets().split(' | ')[0]);
    const started = await page.evaluate(async (source) => {
      const t0 = performance.now();
      const text = await window.vct.transcribe({ source, language: 'pt', model: 'base' });
      return { text, ms: performance.now() - t0, status: window.vct.status() };
    }, asset);
    expect(started.ms).toBeLessThan(5000);
    expect(started.text).toContain('não está neste navegador');
    expect(started.text).toContain('Baixar e legendar');
    expect(started.status).toContain('aguardando a pessoa confirmar o download');
    expect(`${started.text}${started.status}`).not.toMatch(/[?&=]/);
    // Enquanto a pessoa não responde, outro pedido é recusado.
    expect(await page.evaluate(async () => { try { await window.vct.transcribe(); return 'passou'; } catch (error) { return (error as Error).message; } })).toContain('andamento');

    const modal = page.locator('.transcribe-modal');
    await expect(modal.locator('.transcribe-note.is-warning')).toBeVisible();
    await modal.locator('[data-transcribe-go]').click();
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('50%');
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    const done = await page.evaluate(() => ({ status: window.vct.status(), srt: window.vct.transcript() }));
    expect(done.status).toContain('pronta, 2 legendas');
    expect(done.srt).toContain('-->');
    expect(done.srt).toContain('Olá');
    expect(done.srt).not.toMatch(/[?&=]/);
    // A pessoa fecha sem inserir: nada mudou na timeline.
    await modal.locator('[data-transcribe-close]').first().click();
    expect(await page.evaluate(() => window.vct.getTimeline().tracks.some((track) => track.name === 'Legendas'))).toBe(false);

    // Modelo já disponível: começa na hora, sem aviso.
    const direct = await page.evaluate(async () => {
      const text = await window.vct.transcribe();
      return { text, status: window.vct.status() };
    });
    expect(direct.text).toContain('Transcrição iniciada');
    expect(direct.text).toContain('já neste navegador');
    await expect(modal.locator('[data-transcribe-phase]')).toHaveText(/Transcrevendo/);
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    await modal.locator('[data-transcribe-insert]').click();
    expect(await page.evaluate(() => window.vct.status())).toContain('legendas inseridas');
  } finally {
    await context.close();
  }
});

test('mídia em blocos: progresso, estimativa, transcrição parcial e junção sem repetir', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page, { tuning: THREE_BLOCKS });
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean } }).__VCT_TRANSCRIBE_ENGINE__.cached = true; });
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    await modal.locator('[data-transcribe-go]').click();
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('bloco 1 de 3');
    expect(await page.evaluate(() => window.vct.status())).toContain('bloco 1 de 3');
    expect(await page.evaluate(() => window.vct.transcript())).toContain('Nenhuma legenda automática pronta');
    // A estimativa precisa de um pouco de velocidade medida.
    await page.waitForTimeout(1300);
    await release(page);

    // Primeiro bloco pronto: o que existe já aparece no diálogo e em vct.transcript().
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('bloco 2 de 3');
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('min restantes');
    await expect(modal.locator('[data-transcribe-partial]')).toContainText('legendas até agora');
    await expect(modal.locator('[data-transcribe-stop]')).toBeVisible();
    const partial = await page.evaluate(() => ({ status: window.vct.status(), srt: window.vct.transcript() }));
    expect(partial.status).toContain('bloco 2 de 3');
    expect(partial.status).toContain('min restantes');
    expect(partial.status).toContain('legendas até agora');
    expect(partial.srt).toContain('Fala 1');
    expect(partial.srt).toContain('Fala 3');
    expect(partial.srt).not.toContain('Fala 7');
    expect(`${partial.status}${partial.srt}`).not.toMatch(/[?&=]/);

    await release(page);
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('bloco 3 de 3');
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    // Sete falas, cada uma uma vez só: a sobreposição de 0,5 s não repete Fala 3 nem Fala 6.
    await expect(modal.locator('[data-transcribe-count]')).toContainText('7 legendas');
    const srt = await modal.locator('.transcribe-srt').inputValue();
    for (let number = 1; number <= 7; number++) expect(srt.match(new RegExp(`Fala ${number}\\b`, 'g'))).toHaveLength(1);
    expect(await requests(page)).toMatchObject([{ blocks: 3, startBlock: 0 }]);
    expect(await page.evaluate(() => window.vct.status())).toContain('pronta, 7 legendas');
  } finally {
    await context.close();
  }
});

test('vct.cancelTranscribe interrompe e mantém as legendas dos blocos prontos', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page, { tuning: THREE_BLOCKS });
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean } }).__VCT_TRANSCRIBE_ENGINE__.cached = true; });
    expect(await page.evaluate(() => window.vct.cancelTranscribe())).toContain('Nenhuma legenda automática em andamento');
    const started = await page.evaluate(() => window.vct.transcribe({ language: 'pt', model: 'base' }));
    expect(started).toContain('Transcrição iniciada');
    expect(started).toContain('vct.cancelTranscribe()');
    const modal = page.locator('.transcribe-modal');
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('bloco 1 de 3');
    await release(page);
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('bloco 2 de 3');
    const text = await page.evaluate(() => window.vct.cancelTranscribe());
    expect(text).toContain('cancelada');
    expect(text).toContain('legendas');
    expect(text).not.toMatch(/[?&=]/);
    await expect(modal).toHaveCount(0);
    const after = await page.evaluate(() => ({ status: window.vct.status(), srt: window.vct.transcript() }));
    expect(after.status).toContain('cancelada');
    expect(after.srt).toContain('Fala 1');
    expect(after.srt).not.toContain('Fala 7');
    // Livre de novo: dá para pedir outra.
    expect(await page.evaluate(() => window.vct.transcribe())).toContain('Transcrição iniciada');
  } finally {
    await context.close();
  }
});

test('watchdog: sem progresso o motor é encerrado e a pessoa retoma do bloco guardado', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page, { tuning: { ...THREE_BLOCKS, stallMs: 800 } });
    await page.evaluate(() => {
      const engine = (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean; hangAt: number } }).__VCT_TRANSCRIBE_ENGINE__;
      engine.cached = true;
      engine.hangAt = 1;
    });
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    await modal.locator('[data-transcribe-go]').click();
    await release(page);
    // O bloco 2 nunca responde: depois de 800 ms parados, o motor é encerrado.
    const resume = modal.locator('[data-transcribe-resume]');
    await expect(resume).toHaveText(/Retomar do bloco 2/);
    await expect(modal.locator('[role="alert"]')).toContainText('sem progresso no bloco 2 de 3');
    await expect(modal).toContainText('legendas dos blocos anteriores foram mantidas');
    const stalled = await page.evaluate(() => ({ status: window.vct.status(), srt: window.vct.transcript() }));
    expect(stalled.status).toContain('parou de responder no bloco 2 de 3');
    expect(stalled.status).toContain('Retomar do bloco 2');
    expect(stalled.srt).toContain('Fala 1');
    expect(`${stalled.status}${stalled.srt}`).not.toMatch(/[?&=]/);
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { hangAt: number } }).__VCT_TRANSCRIBE_ENGINE__.hangAt = -1; });

    await resume.click();
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('bloco 2 de 3');
    await release(page);
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    await expect(modal.locator('[data-transcribe-count]')).toContainText('7 legendas');
    expect(await requests(page)).toMatchObject([{ blocks: 3, startBlock: 0 }, { blocks: 3, startBlock: 1 }]);
    const srt = await modal.locator('.transcribe-srt').inputValue();
    for (let number = 1; number <= 7; number++) expect(srt.match(new RegExp(`Fala ${number}\\b`, 'g'))).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test('mídia longa: aviso de demora, trecho escolhido e vct.transcribe com start e end', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    // 700 s de composição: acima de 10 min.
    await openProject(page, { duration: '700' });
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean } }).__VCT_TRANSCRIBE_ENGINE__.cached = true; });
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    const warning = modal.locator('[data-transcribe-long]');
    // Com um clipe selecionado a fonte é ele (6 s): sem aviso. A mixagem tem 700 s.
    await expect(warning).toBeHidden();
    await expect(modal.locator('[data-transcribe-range-box]')).toBeHidden();
    await modal.locator('[data-transcribe-source]').selectOption('mix');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/Vai demorar ~\d+ min nesta máquina/);
    await expect(warning).toContainText('Mídia longa: 11:40');
    await expect(modal.locator('[data-transcribe-range] option')).toContainText(['Tudo (11:40)', 'Intervalo (início e fim)']);
    // Mais de 5 min: tempos por frase por padrão; a pessoa pode ligar os de palavra.
    await expect(modal.locator('[data-transcribe-words]')).not.toBeChecked();
    await expect(warning.locator('[data-transcribe-use-clip]')).toHaveText('Só o clipe selecionado');
    await page.screenshot({ path: info.outputPath('longa.png') });

    await modal.locator('[data-transcribe-range]').selectOption('range');
    await modal.locator('[data-transcribe-start]').fill('0:01');
    await modal.locator('[data-transcribe-end]').fill('abc');
    await expect(modal.locator('[data-transcribe-range-error]')).toContainText('Use tempos como');
    await modal.locator('[data-transcribe-end]').fill('0:05');
    await expect(modal.locator('[data-transcribe-range-error]')).toBeHidden();
    // O trecho cabe em 10 min: o aviso some e os tempos por palavra voltam.
    await expect(warning).toBeHidden();
    await expect(modal.locator('[data-transcribe-words]')).toBeChecked();
    await modal.locator('[data-transcribe-go]').click();
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    // 4 s de áudio, e as legendas voltam ao tempo da timeline (começam 1 s depois).
    expect(await requests(page)).toMatchObject([{ samples: 4 * 16000, blocks: 1, words: true }]);
    await expect(modal.locator('.transcribe-srt')).toHaveValue(/00:00:01,500 --> /);
    await modal.locator('[data-transcribe-close]').first().click();

    // Pela API: start e end em segundos da mixagem.
    expect(await page.evaluate(() => window.vct.transcribe({ start: 2, end: 8 }))).toContain('trecho 0:02 a 0:08');
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    expect(await requests(page)).toMatchObject([{}, { samples: 6 * 16000 }]);
    await expect(modal.locator('.transcribe-srt')).toHaveValue(/00:00:02,500 --> /);
    await modal.locator('[data-transcribe-close]').first().click();
    // Valores inválidos são recusados na hora.
    expect(await page.evaluate(async () => { try { await window.vct.transcribe({ start: 9, end: 3 }); return 'passou'; } catch (error) { return (error as Error).message; } })).toContain('end');
    // A composição inteira (700 s) cabe em um bloco só: os silêncios saem do plano.
    expect(await page.evaluate(() => window.vct.transcribe({ words: false }))).toContain('Transcrição iniciada');
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    const all = await requests(page);
    expect(all[2]).toMatchObject({ blocks: 1, words: false, samples: 700 * 16000 });
  } finally {
    await context.close();
  }
});

test('arquivo longo é decodificado em janelas de 30 s e vira 16 kHz mono sem o áudio inteiro em float', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    // 130 s de WAV (8 kHz): quatro janelas de 30 s e uma de 10 s.
    // Fora da timeline: o motor de reprodução decodificaria o arquivo inteiro ao colocá-lo.
    await openProject(page, { duration: '200', media: speechWav(130), place: false });
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean } }).__VCT_TRANSCRIBE_ENGINE__.cached = true; });
    const prep = () => page.evaluate(() => (window as unknown as { __VCT_AUDIO_PREP__?: Record<string, unknown> }).__VCT_AUDIO_PREP__);
    const modal = page.locator('.transcribe-modal');
    const asset = await page.evaluate(() => window.vct.assets().split(' | ')[0]);

    await page.evaluate((source) => window.vct.transcribe({ source }), asset);
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    expect(await requests(page)).toMatchObject([{ samples: 130 * 16000 }]);
    expect(await prep()).toMatchObject({ path: 'stream', windows: 5, outputSamples: 130 * 16000, windowFrames: 30 * 8000 });
    await modal.locator('[data-transcribe-close]').first().click();

    // Só o trecho pedido é decodificado: 30 s do meio, uma janela.
    await page.evaluate((source) => window.vct.transcribe({ source, start: 40, end: 70 }), asset);
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    expect(await requests(page)).toMatchObject([{}, { samples: 30 * 16000 }]);
    expect(await prep()).toMatchObject({ path: 'stream', windows: 1, inputFrames: 30 * 8000, outputSamples: 30 * 16000 });
  } finally {
    await context.close();
  }
});

test('heartbeat: motor vivo e lento não é encerrado; vivo e preso é, só bem depois', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page, { tuning: { ...THREE_BLOCKS, stallMs: 800 } });
    await page.evaluate(() => {
      const engine = (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean; beat: boolean } }).__VCT_TRANSCRIBE_ENGINE__;
      engine.cached = true;
      engine.beat = true;
    });
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    await modal.locator('[data-transcribe-go]').click();
    await expect(modal.locator('[data-transcribe-phase]')).toHaveText(/Transcrevendo/);
    // Mais do triplo do limite sem progresso nem blocos, mas com sinal de vida a cada 100 ms: continua.
    await page.waitForTimeout(2000);
    await expect(modal.locator('[data-transcribe-phase]')).toHaveText(/Transcrevendo/);
    await expect(modal.locator('[data-transcribe-resume]')).toHaveCount(0);
    for (let block = 0; block < 3; block++) await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    await expect(modal.locator('[data-transcribe-count]')).toContainText('7 legendas');
    await modal.locator('[data-transcribe-close]').first().click();

    // Vivo mas sem avançar (bloco 2 preso): encerrado depois de 4x o limite, com mensagem própria.
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { hangAt: number } }).__VCT_TRANSCRIBE_ENGINE__.hangAt = 1; });
    await page.locator('[data-auto-subtitles]').click();
    await modal.locator('[data-transcribe-go]').click();
    await release(page);
    await expect(modal.locator('[role="alert"]')).toContainText('sem avançar no bloco 2 de 3', { timeout: 15_000 });
    await expect(modal.locator('[data-transcribe-resume]')).toHaveText(/Retomar do bloco 2/);
  } finally {
    await context.close();
  }
});

test('modelo que não termina de carregar na placa de vídeo: encerrado em 2x o limite e retomado no processador', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    // Placa de vídeo com shader-f16, como a RTX do caso real.
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => ({ features: { has: () => true } }) }, configurable: true }));
    await openProject(page, { tuning: { ...THREE_BLOCKS, stallMs: 800 } });
    await page.evaluate(() => {
      const engine = (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean; hangLoading: boolean } }).__VCT_TRANSCRIBE_ENGINE__;
      engine.cached = true;
      engine.hangLoading = true;
    });
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    await modal.locator('[data-transcribe-go]').click();
    await expect(modal.locator('[data-transcribe-phase]')).toHaveText(/Carregando o modelo/);
    const started = Date.now();
    await expect(modal.locator('[role="alert"]')).toContainText('não terminou de carregar', { timeout: 10_000 });
    // 2x o limite (1,6 s), não os 4x da transcrição.
    expect(Date.now() - started).toBeLessThan(3000);
    await expect(modal.locator('[role="alert"]')).toContainText('Retomar usa o processador');
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { hangLoading: boolean } }).__VCT_TRANSCRIBE_ENGINE__.hangLoading = false; });
    await modal.locator('[data-transcribe-resume]').click();
    for (let block = 0; block < 3; block++) await release(page);
    await expect(modal.locator('[data-transcribe-count]')).toContainText('7 legendas');
    expect((await requests(page)).map((item) => [item.profile, item.startBlock])).toEqual([['webgpu-f16', 0], ['wasm', 0]]);
  } finally {
    await context.close();
  }
});

test('página isolada de origem: o app inteiro funciona sob COOP e COEP', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page);
    const isolation = await page.evaluate(async () => {
      const response = await fetch(location.href, { cache: 'no-store' });
      const worker = new Worker(URL.createObjectURL(new Blob(['postMessage([self.crossOriginIsolated, typeof SharedArrayBuffer])'], { type: 'text/javascript' })));
      const inWorker = await new Promise<unknown>((resolve) => { worker.onmessage = (event) => resolve(event.data); });
      worker.terminate();
      return {
        isolated: self.crossOriginIsolated, shared: typeof SharedArrayBuffer,
        opener: response.headers.get('cross-origin-opener-policy'), embedder: response.headers.get('cross-origin-embedder-policy'), inWorker,
      };
    });
    expect(isolation).toMatchObject({ isolated: true, shared: 'function', opener: 'same-origin', embedder: 'credentialless', inWorker: [true, 'function'] });
  } finally {
    await context.close();
  }
});

test('Inserir na timeline coloca também a mídia transcrita que não estava na timeline, em um só passo de desfazer', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page, { place: false });
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean } }).__VCT_TRANSCRIBE_ENGINE__.cached = true; });
    expect(await page.evaluate(() => window.vct.getProject().audioTracks.length)).toBe(0);
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    await modal.locator('[data-transcribe-source]').selectOption({ label: 'Mídia: fala.wav' });
    await modal.locator('[data-transcribe-go]').click();
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    await modal.locator('[data-transcribe-insert]').click();
    await expect(modal).toHaveCount(0);
    const after = await page.evaluate(() => {
      const project = window.vct.getProject() as unknown as { audioTracks: Array<{ asset: string; startTime: number; endTime: number }>; layers: Array<{ kind: string }> };
      return { audio: project.audioTracks, texts: project.layers.filter((layer) => layer.kind === 'text').length, status: window.vct.status() };
    });
    expect(after.texts).toBe(2);
    expect(after.audio).toHaveLength(1);
    expect(after.audio[0]).toMatchObject({ startTime: 0, endTime: 6 });
    expect(after.status).toContain('Desfazer: Legenda automática');
    // Um passo: some tudo, o áudio inclusive.
    await page.evaluate(() => window.vct.undo());
    const undone = await page.evaluate(() => {
      const project = window.vct.getProject() as unknown as { audioTracks: unknown[]; layers: unknown[] };
      return { audio: project.audioTracks.length, layers: project.layers.length };
    });
    expect(undone).toEqual({ audio: 0, layers: 0 });

    // Com o áudio já na timeline, a segunda inserção não o repete.
    await page.locator('[data-bin-asset]').filter({ hasText: 'fala.wav' }).click();
    await page.locator('[data-bin-place="new-track"]').click();
    const placed = await page.evaluate(() => window.vct.getProject().audioTracks.length);
    await page.locator('[data-auto-subtitles]').click();
    await modal.locator('[data-transcribe-source]').selectOption({ label: 'Mídia: fala.wav' });
    await modal.locator('[data-transcribe-go]').click();
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    await modal.locator('[data-transcribe-insert]').click();
    await expect(modal).toHaveCount(0);
    expect(await page.evaluate(() => window.vct.getProject().audioTracks.length)).toBe(placed);
  } finally {
    await context.close();
  }
});

test('legendas em composição vertical 9:16 saem pequenas, dentro da caixa e com linhas curtas', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await openProject(page, { width: '360', height: '640' });
    await page.evaluate(() => { (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { cached: boolean } }).__VCT_TRANSCRIBE_ENGINE__.cached = true; });
    await page.locator('[data-auto-subtitles]').click();
    const modal = page.locator('.transcribe-modal');
    await modal.locator('[data-transcribe-source]').selectOption('mix');
    await modal.locator('[data-transcribe-go]').click();
    await release(page);
    await expect(modal.locator('.transcribe-srt')).toBeVisible();
    await modal.locator('[data-transcribe-insert]').click();
    await expect(modal).toHaveCount(0);
    const layers = await page.evaluate(() => {
      const project = window.vct.getProject() as unknown as { layers: Array<{ kind: string; fontSize: number; width: number; height: number; y: number }> };
      return project.layers.filter((layer) => layer.kind === 'text');
    });
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      // 5,5% do lado menor (360): 20 px, e não 5,5% da altura (35 px); caixa de 86% da largura, acima da base da área segura.
      expect(layer.fontSize).toBe(20);
      expect(layer.width).toBe(Math.round(360 * .86));
      expect(layer.y + layer.height / 2).toBeLessThanOrEqual(640 - 640 * 380 / 1920);
    }
  } finally {
    await context.close();
  }
});

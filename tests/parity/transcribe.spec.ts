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

async function openProject(page: Page) {
  await page.addInitScript(() => {
    const engine = {
      cached: false,
      requests: [] as Array<{ model: string; language: string; source: string; samples: number }>,
      imported: [] as string[],
      async availability() { return this.cached ? 'cache' : 'download'; },
      async importFiles(_model: string, files: File[]) {
        this.imported = files.map((file) => file.name);
        this.cached = true;
        return { stored: this.imported, missing: [], rejected: [] };
      },
      async transcribe(request: { model: string; language: string; source: string; audio: Float32Array; onProgress(progress: object): void; signal?: AbortSignal }) {
        this.requests.push({ model: request.model, language: request.language, source: request.source, samples: request.audio.length });
        const wait = () => new Promise<void>((resolve) => { (window as unknown as { __release: () => void }).__release = resolve; });
        if (request.source === 'download') {
          request.onProgress({ phase: 'download', loaded: 40e6, total: 80e6 });
          await wait();
          request.onProgress({ phase: 'download', loaded: 80e6, total: 80e6 });
          this.cached = true;
        } else {
          request.onProgress({ phase: 'loading', loaded: 80e6, total: 80e6 });
        }
        request.onProgress({ phase: 'transcribing', chunksDone: 0, chunksTotal: 2, device: 'wasm' });
        if (request.source !== 'download') await wait();
        request.onProgress({ phase: 'transcribing', chunksDone: 2, chunksTotal: 2, device: 'wasm' });
        const word = (text: string, start: number) => ({ text, start, end: start + .35 });
        return {
          device: 'wasm' as const,
          text: 'Olá, esta é a primeira legenda. Aqui vem a segunda.',
          segments: [
            { start: .5, end: 2.6, text: 'Olá, esta é a primeira legenda.', words: ['Olá,', 'esta', 'é', 'a', 'primeira', 'legenda.'].map((text, index) => word(text, .5 + index * .35)) },
            { start: 3, end: 5, text: 'Aqui vem a segunda.', words: ['Aqui', 'vem', 'a', 'segunda.'].map((text, index) => word(text, 3 + index * .4)) },
          ],
        };
      },
    };
    Object.defineProperty(globalThis, '__VCT_TRANSCRIBE_ENGINE__', { value: engine, configurable: true });
  });
  await page.goto('http://127.0.0.1:4174/current/');
  await page.locator('[data-language="pt-BR"]').click();
  await page.locator('#new-project').click();
  for (const [name, value] of Object.entries({ name: 'Legendas', width: '320', height: '180', fps: '10', duration: '8' })) {
    await page.locator(`#setup-form [name="${name}"]`).fill(value);
  }
  await page.locator('#setup-form button[type="submit"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-bin-import]').first().click();
  await (await chooser).setFiles([{ name: 'fala.wav', mimeType: 'audio/wav', buffer: speechWav() }]);
  await expect(page.locator('[data-bin-asset]')).toHaveCount(1);
  await page.locator('[data-bin-asset]').filter({ hasText: 'fala.wav' }).click();
  await page.locator('[data-bin-place="new-track"]').click();
}

const release = (page: Page) => page.evaluate(() => (window as unknown as { __release: () => void }).__release());

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
    await modal.locator('[data-transcribe-insert]').click();
    await expect(modal).toHaveCount(0);
    const inserted = await page.evaluate(() => ({
      tracks: window.vct.getTimeline().tracks.map((track) => ({ name: track.name, clips: track.clips.map((clip) => clip.text) })),
      status: window.vct.status(),
    }));
    const subtitles = inserted.tracks.find((track) => track.name === 'Legendas');
    expect(subtitles?.clips).toHaveLength(2);
    expect(subtitles?.clips.join(' ')).toContain('terceira');
    expect(inserted.status).toContain('Desfazer: Legenda automática');
    expect(await page.evaluate(() => (window as unknown as { __VCT_TRANSCRIBE_ENGINE__: { requests: unknown[] } }).__VCT_TRANSCRIBE_ENGINE__.requests)).toMatchObject([{ model: 'base', language: 'pt', source: 'download' }]);
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
    await openProject(page);
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
    await expect(modal.locator('[data-transcribe-detail]')).toContainText('trecho 1 de 2');
    expect(await page.evaluate(() => window.vct.status())).toContain('Legenda automática: transcrevendo');
    await modal.locator('[data-transcribe-close]').last().click();
    await expect(modal).toHaveCount(0);
    expect(await page.evaluate(() => window.vct.status())).toContain('cancelada pela pessoa');
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

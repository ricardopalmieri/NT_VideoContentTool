import { expect, it } from 'vitest';
import { createEffect, createLayer, createProject, type ProjectDocument } from '../../src/model/types';
import { migrateProject } from '../../src/model/migrate-project';
import { translate } from '../../src/i18n';

const settings = { name: 'Teste', width: 320, height: 180, fps: 10, duration: 10, background: '#000000', transparent: true };
it('valores padrão v2 preservam geometria quadrada e transparência', () => {
  const project = createProject(settings);
  const geometry = createLayer('geometry', settings);
  expect(project.version).toBe(2);
  expect(geometry.width).toBeCloseTo(63, 12);
  expect(geometry.height).toBeCloseTo(63, 12);
  expect(createLayer('video', settings).loop).toBe(false);
  expect(createEffect('blur').params).toEqual({ mix: 1, radius: 8, quality: 2 });
});
it('migra v1 in-place mantendo zeros e defaults históricos', () => {
  const project = {
    format: 'noisetupi-video-content-tool', version: 1, settings,
    layers: [{ kind: 'text', startTime: 2, endTime: 8, sourceOffset: 3, opacity: 0, sizeLocked: true,
      keyframes: { x: [{ time: 0, value: 20 }] },
      effects: [{ kind: 'feedback', params: { amount: 0, offsetX: .1, discarded: 123 } }] }],
  } as unknown as ProjectDocument;
  migrateProject(project);
  expect(project.version).toBe(2);
  expect(project.audioTracks).toEqual([]);
  expect(project.layers[0]).toMatchObject({ opacity: 0, sourceIn: 3, sizeLocked: false, fadeInStart: 2, fadeInEnd: 2, fadeOutStart: 8, fadeOutEnd: 8 });
  expect(project.layers[0].keyframes.x[0].easing).toBe('easeInOut');
  expect(project.layers[0].effects[0].params).toEqual({ count: 8, spacing: .06, decay: .05, offsetX: 32, offsetY: 1.8, mix: 1 });
  const once = JSON.stringify(project);
  migrateProject(project);
  expect(JSON.stringify(project)).toBe(once);
});
it('v2 preserva falsos e zeros de áudio e efeitos', () => {
  const project = createProject(settings);
  project.audioTracks = [{ linkedLayerId: 'video', linked: false, muted: false, volume: 0, playbackRate: 0, startTime: 2, endTime: 8 }] as ProjectDocument['audioTracks'];
  project.postEffects.push({ ...createEffect('rgbDelay'), params: { amount: .008, mix: 0 } });
  migrateProject(project);
  expect(project.audioTracks[0]).toMatchObject({ linked: false, volume: 0, playbackRate: 0, fadeInStart: 2, fadeOutEnd: 8 });
  expect(project.postEffects[0].params).toMatchObject({ mix: 0, redDelay: 0, greenDelay: -3, blueDelay: -6 });
});
it('i18n preserva textos em português e inglês sem fallback novo', () => {
  expect(translate('pt-BR', 'newProject')).toBe('Novo projeto');
  expect(translate('en', 'newProject')).toBe('New project');
  expect(translate('pt-BR', 'complete')).toBe('Exportação concluída');
  expect(translate('en', 'complete')).toBe('Export complete');
});

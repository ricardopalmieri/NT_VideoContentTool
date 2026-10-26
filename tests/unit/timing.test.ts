import { describe, expect, it } from 'vitest';
import { fadeEnvelope, normalizeFades } from '../../src/timeline/timing';
import { sourceTimeFor } from '../../src/renderer/source-time';
import { snapTimelineTime, timelineSnapCandidates } from '../../src/timeline/snapping';
import { createLayer, createProject } from '../../src/model/types';

const settings = { name: 'Teste', width: 320, height: 180, fps: 10, duration: 10, background: '#000000', transparent: true };
describe('timing histórico 0.6.2', () => {
  it.each([[0, 0], [1, 0], [2, .5], [3, 1], [7, 1], [8, .5], [9, 0], [10, 0]])('fade em %s s = %s', (time, expected) => {
    expect(fadeEnvelope({ fadeInStart: 1, fadeInEnd: 3, fadeOutStart: 7, fadeOutEnd: 9 }, time)).toBe(expected);
  });
  it('fades zerados não escondem a camada nem verificam intervalo do clipe', () => {
    expect(fadeEnvelope({ fadeInStart: 3, fadeInEnd: 3, fadeOutStart: 5, fadeOutEnd: 5 }, -100)).toBe(1);
  });
  it('fades sobrepostos multiplicam os envelopes', () => {
    expect(fadeEnvelope({ fadeInStart: 0, fadeInEnd: 4, fadeOutStart: 0, fadeOutEnd: 4 }, 2)).toBe(.25);
  });
  it('normalização preserva duração zero e não corrige timing do clipe', () => {
    const layer = createLayer('text', settings, { startTime: 2, endTime: 8, fadeInStart: 10, fadeInEnd: 1, fadeOutStart: 7, fadeOutEnd: 3 });
    normalizeFades(layer);
    expect([layer.fadeInStart, layer.fadeInEnd, layer.fadeOutStart, layer.fadeOutEnd]).toEqual([8, 8, 3, 3]);
    expect([layer.startTime, layer.endTime]).toEqual([2, 8]);
  });
  it('sourceTime mantém trim, velocidade, reverse, loop e último milissegundo', () => {
    const layer = createLayer('video', settings, { startTime: 2, sourceIn: 3, sourceOut: 7 });
    expect(sourceTimeFor(layer, 3, 10, 2)).toBe(5);
    expect(sourceTimeFor(layer, 8, 10, 1)).toBe(7);
    layer.loop = true;
    expect(sourceTimeFor(layer, 7, 10, 1)).toBe(4);
    layer.reverse = true;
    expect(sourceTimeFor(layer, 7, 10, 1)).toBe(6);
    layer.sourceOut = 10;
    expect(sourceTimeFor(layer, 2, 10, 1)).toBe(9.999);
  });
  it('zero em sourceIn usa sourceOffset; speed zero usa 1', () => {
    const layer = createLayer('video', settings, { sourceIn: 0, sourceOffset: 2 });
    expect(sourceTimeFor(layer, 1, 10, 0)).toBe(3);
    expect(sourceTimeFor(layer, 1, 0, 1)).toBe(0);
  });
  it('snap desligado ainda arredonda para frame sem consultar DOM/alvos', () => {
    const project = createProject(settings);
    const unexpected = (): never => { throw new Error('Avaliação deveria ser preguiçosa'); };
    expect(snapTimelineTime(1.26, project, false, unexpected, unexpected)).toBe(1.3);
    expect(snapTimelineTime(1.26, project, true, unexpected, unexpected, true)).toBe(1.3);
    expect(snapTimelineTime(1.26, null, true, unexpected, unexpected)).toBe(1.26);
  });
  it('snap inclui próprio fade e playhead; último candidato ganha empates', () => {
    const project = createProject(settings);
    project.layers.push(createLayer('text', settings, { fadeInEnd: 2.5 }));
    expect(timelineSnapCandidates(project, 3)).toContain(2.5);
    expect(timelineSnapCandidates(project, 3, project.layers[0].id)).toEqual([0, 10, 3]);
    expect(snapTimelineTime(5, project, true, () => 90, () => [4.5, 5.5])).toBe(5.5);
  });
  it('limiar usa 9 px e no mínimo um frame', () => {
    const project = createProject(settings);
    expect(snapTimelineTime(5, project, true, () => 100, () => [5.9])).toBe(5);
    expect(snapTimelineTime(5, project, true, () => 90, () => [5.9])).toBe(5.9);
    expect(snapTimelineTime(5, project, true, () => 10000, () => [5.05])).toBe(5.05);
  });
});

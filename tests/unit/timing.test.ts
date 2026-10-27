import { describe, expect, it } from 'vitest';
import { fadeEnvelope, fadeInEnvelope, fadeOutEnvelope, normalizeFades, setFadeHandle } from '../../src/timeline/timing';
import { sourceTimeFor } from '../../src/renderer/source-time';
import { snapTimelineTime, timelineSnapCandidates } from '../../src/timeline/snapping';
import { shouldSeekVideo } from '../../src/renderer/video-seek';
import { createAudioTrack, createLayer, createProject } from '../../src/model/types';

const settings = { name: 'Teste', width: 320, height: 180, fps: 10, duration: 10, background: '#000000', transparent: true };
describe('timing histórico 0.6.2', () => {
  it.each([[0, 0], [1, 0], [2, .5], [3, 1], [7, 1], [8, .5], [9, 0], [10, 0]])('fade em %s s = %s', (time, expected) => {
    expect(fadeEnvelope({ fadeInStart: 1, fadeInEnd: 3, fadeOutStart: 7, fadeOutEnd: 9 }, time)).toBe(expected);
  });
  it('fades zerados não escondem a camada nem verificam intervalo do clipe', () => {
    expect(fadeEnvelope({ fadeInStart: 3, fadeInEnd: 3, fadeOutStart: 5, fadeOutEnd: 5 }, -100)).toBe(1);
  });
  it('fades sobrepostos multiplicam os envelopes', () => {
    const fades = { fadeInStart: 0, fadeInEnd: 4, fadeOutStart: 0, fadeOutEnd: 4 };
    expect(fadeInEnvelope(fades, 2)).toBe(.5);
    expect(fadeOutEnvelope(fades, 2)).toBe(.5);
    expect(fadeInEnvelope(fades, 2) * fadeOutEnvelope(fades, 2)).toBe(.25);
    expect(fadeEnvelope(fades, 2)).toBe(.25);
  });
  it('normalização ancora fades nas bordas, zera durações inválidas e não corrige timing do clipe', () => {
    const layer = createLayer('text', settings, { startTime: 2, endTime: 8, fadeInStart: 10, fadeInEnd: 1, fadeOutStart: 7, fadeOutEnd: 3 });
    normalizeFades(layer);
    expect([layer.fadeInStart, layer.fadeInEnd, layer.fadeOutStart, layer.fadeOutEnd]).toEqual([2, 2, 8, 8]);
    expect([layer.startTime, layer.endTime]).toEqual([2, 8]);
  });
  it('trim e movimento preservam a duração dos fades (regressão: trecho invisível)', () => {
    const layer = createLayer('text', settings, { startTime: 0, endTime: 6, fadeInStart: 0, fadeInEnd: 1, fadeOutStart: 5, fadeOutEnd: 6 });
    layer.endTime = 9;
    normalizeFades(layer);
    expect([layer.fadeOutStart, layer.fadeOutEnd]).toEqual([8, 9]);
    expect(fadeEnvelope(layer, 7)).toBe(1);
    layer.startTime = 3;
    normalizeFades(layer);
    expect([layer.fadeInStart, layer.fadeInEnd]).toEqual([3, 4]);
    layer.endTime = 3.5;
    normalizeFades(layer);
    expect([layer.fadeInEnd, layer.fadeOutStart]).toEqual([3.5, 3]);
  });
  it('arrastar a alça a partir do canto cria rampa, não fade de duração zero (regressão)', () => {
    const layer = createLayer('text', settings, { startTime: 0, endTime: 10 });
    normalizeFades(layer);
    setFadeHandle(layer, 'in', 1.37);
    expect([layer.fadeInStart, layer.fadeInEnd]).toEqual([0, 1.37]);
    expect(fadeEnvelope(layer, .685)).toBeCloseTo(.5, 5);
    setFadeHandle(layer, 'out', 8);
    expect([layer.fadeOutStart, layer.fadeOutEnd]).toEqual([8, 10]);
    setFadeHandle(layer, 'in', -5);
    expect(layer.fadeInEnd).toBe(0);
    setFadeHandle(layer, 'out', 50);
    expect(layer.fadeOutStart).toBe(10);
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
  it('zero em sourceIn é o início da mídia; sourceOffset só vale sem sourceIn; speed zero usa 1', () => {
    const layer = createLayer('video', settings, { sourceIn: 0, sourceOffset: 2 });
    expect(sourceTimeFor(layer, 1, 10, 0)).toBe(1);
    const legacy = { ...layer, sourceIn: undefined } as unknown as typeof layer;
    expect(sourceTimeFor(legacy, 1, 10, 0)).toBe(3);
    expect(sourceTimeFor(layer, 1, 0, 1)).toBe(0);
  });
  it('snap desligado ainda arredonda para frame sem consultar DOM/alvos', () => {
    const project = createProject(settings);
    const unexpected = (): never => { throw new Error('Avaliação deveria ser preguiçosa'); };
    expect(snapTimelineTime(1.26, project, false, unexpected, unexpected)).toBe(1.3);
    expect(snapTimelineTime(1.26, project, true, unexpected, unexpected, true)).toBe(1.3);
    expect(snapTimelineTime(1.26, null, true, unexpected, unexpected)).toBe(1.26);
  });
  it('snap exclui o clipe arrastado e o playhead quando o próprio playhead é arrastado', () => {
    const project = createProject(settings);
    const layer = createLayer('text', settings, { fadeInEnd: 2.5 });
    const linkedAudio = createAudioTrack('Áudio', 'media/audio.wav', 10, {
      linked: true,
      linkedLayerId: layer.id,
      fadeInEnd: 2.75,
    });
    project.layers.push(layer);
    project.audioTracks.push(linkedAudio);
    expect(timelineSnapCandidates(project, 3, { layerId: layer.id })).toEqual([0, 10, 3]);
    expect(timelineSnapCandidates(project, 3, { audioId: linkedAudio.id })).toEqual([0, 10, 3]);
    expect(timelineSnapCandidates(project, 3, { playhead: true })).not.toContain(3);
    expect(snapTimelineTime(5, project, true, () => 90, () => [4.5, 5.5])).toBe(5.5);
  });
  it('limiar usa 9 px e no mínimo um frame', () => {
    const project = createProject(settings);
    expect(snapTimelineTime(5, project, true, () => 100, () => [5.9])).toBe(5);
    expect(snapTimelineTime(5, project, true, () => 90, () => [5.9])).toBe(5.9);
    expect(snapTimelineTime(5, project, true, () => 10000, () => [5.05])).toBe(5.05);
  });
  it('não pula seek entre frames consecutivos quando a diferença é menor que um frame', () => {
    expect(shouldSeekVideo(.75, .8749)).toBe(true);
    expect(shouldSeekVideo(.8749, .875)).toBe(false);
  });
});

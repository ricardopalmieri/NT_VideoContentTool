import { describe, expect, it } from 'vitest';
import { clipNeighbors, copyClips, pasteClips, moveClipToTrack, placeTrack, shiftTrack, splitClip, trackIdOf, visualTracks } from '../../src/model/clip-tracks';
import { createAudioEffect, createAudioTrack, createLayer, createProject } from '../../src/model/types';
import { validateProjectDocument } from '../../src/model/validate-project';
import { transitionState } from '../../src/model/transitions';
import { fadeEnvelope } from '../../src/timeline/timing';

const settings = { name: 'Clipes', width: 320, height: 180, fps: 10, duration: 10, background: '#000000', transparent: true };

function project() {
  const doc = createProject(settings);
  const video = createLayer('video', settings, {
    id: 'v', startTime: 0, endTime: 10, sourceIn: 2, sourceOut: 12,
    fadeInStart: 0, fadeInEnd: 1, fadeOutStart: 9, fadeOutEnd: 10,
  });
  const text = createLayer('text', settings, { id: 't', startTime: 0, endTime: 10 });
  doc.layers.push(text, video);
  doc.audioTracks.push(createAudioTrack('Áudio', 'media/a.wav', 20, {
    id: 'a', linked: true, linkedLayerId: 'v', startTime: 0, endTime: 10, sourceIn: 2, sourceOut: 12,
    fadeInStart: 0, fadeInEnd: 1, fadeOutStart: 9, fadeOutEnd: 10,
  }));
  return doc;
}

describe('faixas com vários clipes', () => {
  it('colar áudio com efeitos mantém IDs únicos e o projeto válido', () => {
    const doc = project();
    doc.audioTracks[0].effects.push(createAudioEffect('lowpass'));
    const original = structuredClone(doc.audioTracks[0].effects[0]);
    const clipboard = copyClips(doc, ['v']);
    pasteClips(doc, clipboard, 0);
    pasteClips(doc, clipboard, 0);
    expect(validateProjectDocument(doc).issues).toEqual([]);
    expect(new Set(doc.audioTracks.map(track => track.effects[0].id)).size).toBe(3);
    expect(doc.audioTracks[0].effects[0]).toEqual(original);
    expect(clipboard.audio[0].effects[0]).toEqual(original);
  });

  it('corte seco depois da transição não repete a entrada na segunda metade', () => {
    const doc = project();
    doc.layers[1].transition = { type: 'dissolve', duration: 1 };
    const { first, second } = splitClip(doc, 'v', 4, 30)!;
    expect(first.transition).toEqual({ type: 'dissolve', duration: 1 });
    expect(transitionState(doc, second, 4).opacity).toBe(1);
    expect(second.transition).toBeUndefined();
  });

  it('corte preserva áudio cujo vínculo foi desligado', () => {
    const doc = project();
    doc.audioTracks[0].linked = false;
    const before = structuredClone(doc.audioTracks);
    splitClip(doc, 'v', 4, 30);
    expect(doc.audioTracks).toEqual(before);
  });

  it('projeto sem trackId: cada layer é a própria faixa', () => {
    const doc = project();
    expect(visualTracks(doc).map((track) => track.id)).toEqual(['t', 'v']);
    expect(trackIdOf(doc.layers[0])).toBe('t');
  });

  it('corte divide vídeo, trecho de origem, fades e áudio vinculado', () => {
    const doc = project();
    const result = splitClip(doc, 'v', 4, 30)!;
    expect(result).not.toBeNull();
    const { first, second } = result;
    expect([first.startTime, first.endTime, second.startTime, second.endTime]).toEqual([0, 4, 4, 10]);
    expect([first.sourceIn, first.sourceOut, second.sourceIn, second.sourceOut]).toEqual([2, 6, 6, 12]);
    expect([first.fadeInEnd - first.fadeInStart, first.fadeOutEnd - first.fadeOutStart]).toEqual([1, 0]);
    expect([second.fadeInEnd - second.fadeInStart, second.fadeOutEnd - second.fadeOutStart]).toEqual([0, 1]);
    expect(fadeEnvelope(first, 3.9)).toBe(1);
    expect(fadeEnvelope(second, 4.1)).toBe(1);
    expect(trackIdOf(second)).toBe('v');
    expect(visualTracks(doc).map((track) => track.clips.map((clip) => clip.id))).toEqual([['t'], ['v', second.id]]);
    const audio = doc.audioTracks.filter((track) => track.laneId === 'a' || track.id === 'a');
    expect(audio).toHaveLength(2);
    expect(audio[1].linkedLayerId).toBe(second.id);
    expect([audio[0].endTime, audio[1].startTime, audio[1].sourceIn]).toEqual([4, 4, 6]);
  });

  it('corte respeita velocidade e reverse', () => {
    const doc = project();
    doc.layers[1].playbackRate = 2;
    const fast = splitClip(doc, 'v', 2, 30)!;
    expect([fast.first.sourceOut, fast.second.sourceIn]).toEqual([6, 6]);
    const reversed = project();
    reversed.layers[1].reverse = true;
    const back = splitClip(reversed, 'v', 4, 30)!;
    expect([back.first.sourceIn, back.first.sourceOut, back.second.sourceIn, back.second.sourceOut]).toEqual([8, 12, 2, 8]);
  });

  it('corte fora do clipe ou colado na borda é recusado', () => {
    const doc = project();
    expect(splitClip(doc, 'v', 0, 30)).toBeNull();
    expect(splitClip(doc, 'v', 10, 30)).toBeNull();
    expect(splitClip(doc, 'v', 12, 30)).toBeNull();
    expect(doc.layers).toHaveLength(2);
  });

  it('texto e geometria são cortados sem mexer no trecho de origem', () => {
    const doc = project();
    const result = splitClip(doc, 't', 5)!;
    expect([result.first.endTime, result.second.startTime]).toEqual([5, 5]);
    expect([result.second.sourceIn, result.second.sourceOut]).toEqual([result.first.sourceIn, result.first.sourceOut]);
  });

  it('mover para faixa ocupada no mesmo trecho é recusado', () => {
    const doc = project();
    const { second } = splitClip(doc, 'v', 4, 30)!;
    expect(moveClipToTrack(doc, second.id, 't')).toBe(false);
    expect(trackIdOf(second)).toBe('v');
  });

  it('vizinhos limitam o espaço livre do clipe na faixa', () => {
    const doc = project();
    const { first, second } = splitClip(doc, 'v', 4, 30)!;
    expect(clipNeighbors(doc, first.id)).toEqual({ previousEnd: 0, nextStart: 4 });
    expect(clipNeighbors(doc, second.id)).toEqual({ previousEnd: 4, nextStart: Number.POSITIVE_INFINITY });
  });

  it('mover clipe para outra faixa e reordenar faixas mantém as faixas contíguas', () => {
    const doc = project();
    const { second } = splitClip(doc, 'v', 4, 30)!;
    doc.layers.find((layer) => layer.id === 't')!.endTime = 3;
    expect(moveClipToTrack(doc, second.id, 't')).toBe(true);
    expect(visualTracks(doc).map((track) => track.clips.map((clip) => clip.id))).toEqual([['t', second.id], ['v']]);
    expect(shiftTrack(doc, 't', 1)).toBe(true);
    expect(visualTracks(doc).map((track) => track.id)).toEqual(['v', 't']);
    expect(placeTrack(doc, 'v', 't', true)).toBe(true);
    expect(visualTracks(doc).map((track) => track.id)).toEqual(['t', 'v']);
    expect(moveClipToTrack(doc, 'v', 'inexistente')).toBe(false);
  });
});

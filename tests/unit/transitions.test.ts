import { describe, expect, it } from 'vitest';
import { copyClips, pasteClips, rippleDelete, splitClip, trackIdOf, visualTracks } from '../../src/model/clip-tracks';
import { autoTransitionsForOverlap, syncTransitionAudioFades, transitionState, transitionWindow } from '../../src/model/transitions';
import { createAudioTrack, createLayer, createProject } from '../../src/model/types';

const settings = { name: 'Transições', width: 100, height: 50, fps: 10, duration: 20, background: '#000000', transparent: false };

// Dois clipes na mesma faixa: A 0–6 e B 4–10 (sobreposição de 2 s).
function overlapping() {
  const doc = createProject(settings);
  const a = createLayer('video', settings, { id: 'a', startTime: 0, endTime: 6 });
  const b = createLayer('video', settings, { id: 'b', trackId: 'a', startTime: 4, endTime: 10 });
  doc.layers.push(a, b);
  doc.audioTracks.push(
    createAudioTrack('A', 'media/a.wav', 6, { id: 'aa', linked: true, linkedLayerId: 'a', startTime: 0, endTime: 6, fadeInStart: 0, fadeInEnd: 0, fadeOutStart: 6, fadeOutEnd: 6 }),
    createAudioTrack('B', 'media/b.wav', 6, { id: 'ab', linked: true, linkedLayerId: 'b', startTime: 4, endTime: 10, fadeInStart: 4, fadeInEnd: 4, fadeOutStart: 10, fadeOutEnd: 10 }),
  );
  return doc;
}

describe('transições', () => {
  it('modo Sobrepor cria Dissolver na sobreposição, com janela = trecho sobreposto', () => {
    const doc = overlapping();
    expect(autoTransitionsForOverlap(doc)).toEqual(['b']);
    const b = doc.layers[1];
    expect(transitionWindow(doc, b)).toMatchObject({ start: 4, end: 6 });
    expect(transitionState(doc, b, 5).opacity).toBeCloseTo(.5, 6);
    expect(transitionState(doc, doc.layers[0], 5).opacity).toBe(1);
    expect(transitionState(doc, b, 7).opacity).toBe(1);
  });

  it('fade pelo fundo: sai o anterior na primeira metade, entra o novo na segunda', () => {
    const doc = overlapping();
    doc.layers[1].transition = { type: 'dip', duration: .5 };
    expect(transitionState(doc, doc.layers[0], 4.5).opacity).toBeCloseTo(.5, 6);
    expect(transitionState(doc, doc.layers[1], 4.5).opacity).toBe(0);
    expect(transitionState(doc, doc.layers[0], 5.5).opacity).toBe(0);
    expect(transitionState(doc, doc.layers[1], 5.5).opacity).toBeCloseTo(.5, 6);
  });

  it('cortina revela o clipe e empurrar desloca os dois', () => {
    const doc = overlapping();
    doc.layers[1].transition = { type: 'wipe-right', duration: .5 };
    expect(transitionState(doc, doc.layers[1], 5).reveal).toEqual({ from: 'left', amount: .5 });
    doc.layers[1].transition = { type: 'push-left', duration: .5 };
    expect(transitionState(doc, doc.layers[1], 5).offsetX).toBe(50);
    expect(transitionState(doc, doc.layers[0], 5).offsetX).toBe(-50);
  });

  it('sem sobreposição, a transição usa a própria duração para entrar', () => {
    const doc = createProject(settings);
    doc.layers.push(createLayer('text', settings, { id: 't', startTime: 2, endTime: 8, transition: { type: 'dissolve', duration: 1 } }));
    expect(transitionWindow(doc, doc.layers[0])).toEqual({ start: 2, end: 3, partner: undefined });
    expect(transitionState(doc, doc.layers[0], 2.25).opacity).toBeCloseTo(.25, 6);
  });

  it('áudio vinculado faz crossfade na mesma janela', () => {
    const doc = overlapping();
    autoTransitionsForOverlap(doc);
    syncTransitionAudioFades(doc);
    expect([doc.audioTracks[1].fadeInStart, doc.audioTracks[1].fadeInEnd]).toEqual([4, 6]);
    expect([doc.audioTracks[0].fadeOutStart, doc.audioTracks[0].fadeOutEnd]).toEqual([4, 6]);
  });
});

describe('ripple delete e copiar/colar', () => {
  it('ripple delete fecha o espaço na faixa e leva keyframes e áudio junto', () => {
    const doc = createProject(settings);
    doc.layers.push(createLayer('text', settings, { id: 't', startTime: 0, endTime: 10 }));
    splitClip(doc, 't', 3);
    const [, second] = doc.layers;
    splitClip(doc, second.id, 6);
    const third = doc.layers[2];
    third.keyframes.x = [{ time: 7, value: 1, easing: 'linear' }];
    expect(rippleDelete(doc, [second.id])).toBe(1);
    expect(doc.layers.map((layer) => [layer.startTime, layer.endTime])).toEqual([[0, 3], [3, 7]]);
    expect(third.keyframes.x[0].time).toBe(4);
  });

  it('ripple delete fecha também o espaço quando o próximo clipe está sobreposto', () => {
    const doc = overlapping();
    const next = doc.layers[1];
    next.keyframes.x = [{ time: 5, value: 1, easing: 'linear' }];

    expect(rippleDelete(doc, ['a'])).toBe(1);
    expect(doc.layers.map((layer) => [layer.startTime, layer.endTime])).toEqual([[0, 6]]);
    expect(next.keyframes.x[0].time).toBe(1);
    expect(doc.audioTracks.map((track) => [track.startTime, track.endTime])).toEqual([[0, 6]]);
  });

  it('colar no playhead volta para a faixa original quando livre, senão cria faixa nova', () => {
    const doc = createProject(settings);
    doc.layers.push(createLayer('text', settings, { id: 't', startTime: 0, endTime: 4 }));
    const clipboard = copyClips(doc, ['t']);
    const [onTrack] = pasteClips(doc, clipboard, 6);
    expect([onTrack.startTime, onTrack.endTime, trackIdOf(onTrack)]).toEqual([6, 10, 't']);
    const [newTrack] = pasteClips(doc, clipboard, 7);
    expect(trackIdOf(newTrack)).toBe(newTrack.id);
    expect(visualTracks(doc)).toHaveLength(2);
  });
});

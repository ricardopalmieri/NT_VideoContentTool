import { describe, expect, it, vi } from 'vitest';
import { createVctApi } from '../../src/automation/window-vct';
import { runProjectCommands, type VctCommand } from '../../src/model/commands';
import { createAudioEffect, createAudioTrack, createLayer, createProject } from '../../src/model/types';

const settings = { name: 'AI editing', width: 320, height: 180, fps: 30, duration: 20, background: '#000000', transparent: false };
function source() {
  const doc = createProject(settings);
  doc.layers.push(createLayer('video', settings, { id: 'v', endTime: 10, sourceOut: 10, fadeOutStart: 10, fadeOutEnd: 10 }));
  doc.audioTracks.push(createAudioTrack('linked', 'test.webm', 10, { id: 'a', linked: true, linkedLayerId: 'v', effects: [createAudioEffect('lowpass')] }));
  return doc;
}
const run = (commands: readonly unknown[], doc = source()) => runProjectCommands(doc, commands, 1 / 60);

describe('AI editing commands', () => {
  it('plans and executes a deterministic A/V split, move and duplicate without changing source', () => {
    const doc = source();
    doc.layers[0].keyframes.x = [{ time: 5, value: 10, easing: 'linear' }];
    const before = structuredClone(doc);
    const commands: VctCommand[] = [
      { type: 'clip.split', layerId: 'v', time: 4, newLayerId: 'part-b' },
      { type: 'clip.move', layerId: 'part-b', startTime: 5 },
      { type: 'clip.duplicate', layerId: 'part-b', startTime: 12, newLayerId: 'copy-b' },
    ];
    const result = run(commands, doc);
    expect(run(commands, doc)).toEqual(result);
    expect(doc).toEqual(before);
    expect(result.project.layers.find(l => l.id === 'part-b')).toMatchObject({ startTime: 5, endTime: 11, sourceIn: 4, keyframes: { x: [{ time: 6, value: 10, easing: 'linear' }] } });
    expect(result.project.audioTracks.find(t => t.linkedLayerId === 'copy-b')).toMatchObject({ startTime: 12, endTime: 18, sourceIn: 4 });
    expect(new Set(result.project.audioTracks.map(t => t.effects[0].id)).size).toBe(3);
  });

  it('creates titles and sets content in the same transaction', () => {
    const result = run([
      { type: 'layer.create', layerId: 'title', kind: 'text', name: 'Opening', startTime: 1, endTime: 3 },
      { type: 'layer.setText', layerId: 'title', text: 'Opening title' },
    ]);
    expect(result.project.layers[0]).toMatchObject({ id: 'title', text: 'Opening title', fadeInStart: 1, fadeOutEnd: 3 });
  });

  it('rejects collision and unknown fields instead of silently making a different edit', () => {
    expect(() => run([{ type: 'clip.split', layerId: 'v', time: 4, newLayerId: 'a' }])).toThrow('já está em uso');
    expect(() => run([{ type: 'clip.move', layerId: 'v', startTime: 2, typo: true }])).toThrow('desconhecido');
    expect(() => run([{ type: 'clip.move', layerId: 'v', startTime: .01 }])).toThrow('frame');
    expect(() => run([{ type: 'clip.move', layerId: 'v', startTime: 15 }])).toThrow('duração');
    expect(() => run([{ type: 'clip.remove', layerId: 'v', ripple: 'false' }])).toThrow('booleano');
  });

  it('rejects ambiguous video splits and preserves input when a later command fails', () => {
    const doc = source();
    doc.layers[0].sourceOut = 0;
    expect(() => run([{ type: 'clip.split', layerId: 'v', time: 4, newLayerId: 'b' }], doc)).toThrow('sourceOut');
    const before = structuredClone(doc);
    expect(() => run([
      { type: 'layer.setName', layerId: 'v', name: 'Changed' },
      { type: 'clip.move', layerId: 'missing', startTime: 0 },
    ], doc)).toThrow('não encontrada');
    expect(doc).toEqual(before);
  });

  it('protects locked ripple neighbours and refuses occupied destinations', () => {
    const doc = run([{ type: 'clip.split', layerId: 'v', time: 4, newLayerId: 'b' }]).project;
    expect(() => run([{ type: 'clip.move', layerId: 'b', startTime: 2 }], doc)).toThrow('ocupada');
    doc.layers[1].locked = true;
    expect(() => run([{ type: 'clip.remove', layerId: 'v', ripple: true }], doc)).toThrow('bloqueada');
    expect(doc.layers).toHaveLength(2);
  });

  it('moves to an existing track and applies an explicit overlap transition with audio', () => {
    const doc = run([{ type: 'clip.split', layerId: 'v', time: 4, newLayerId: 'b' }]).project;
    const result = run([
      { type: 'clip.move', layerId: 'b', startTime: 2, allowOverlap: true },
      { type: 'clip.setTransition', layerId: 'b', transition: { type: 'dissolve', duration: .5 } },
    ], doc);
    expect(result.project.layers[1].transition?.type).toBe('dissolve');
    expect(result.project.audioTracks[1]).toMatchObject({ fadeInStart: 2, fadeInEnd: 4 });
    expect(result.project.audioTracks[0]).toMatchObject({ fadeOutStart: 2, fadeOutEnd: 4 });
  });
});

describe('agent API', () => {
  it('dryRun is side-effect-free, compact and identical to commit; queries are detached', () => {
    let doc = source();
    const commit = vi.fn(next => { doc = next; });
    const confirm = vi.fn(() => true);
    const api = createVctApi({ getProject: () => doc, keyframeTolerance: () => 1 / 60, commitProject: commit, confirmConsequential: confirm });
    const commands: VctCommand[] = [{ type: 'clip.split', layerId: 'v', time: 4, newLayerId: 'b' }];
    const plan = api.dryRun(commands, { format: 'json' });
    expect(commit).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(plan).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(api.dryRun(commands)).toMatch(/^ok \(simulação\) · 1 comando/);
    expect(api.batch(commands, { format: 'json' }).results).toEqual(plan.results);
    expect(api.getTimeline()).toEqual(plan.timeline);
    plan.timeline!.tracks[0].clips[0].name = 'Mutated';
    expect(doc.layers[0].name).not.toBe('Mutated');
    expect((api.describe('clip.split', { format: 'json' }) as unknown as { fields: Record<string, { required?: boolean }> }).fields.newLayerId.required).toBe(true);
    expect(api.describe('clip.split')).toContain('newLayerId!:id');
  });

  it('cancelled removal leaves the project intact and dryRun only reports the confirmation', () => {
    const doc = source();
    const commit = vi.fn();
    const confirm = vi.fn(() => false);
    const api = createVctApi({ getProject: () => doc, keyframeTolerance: () => 1 / 60, commitProject: commit, confirmConsequential: confirm });
    expect(api.dryRun([{ type: 'clip.remove', layerId: 'v' }], { format: 'json' }).requiresConfirmation).toBe(true);
    expect(api.dryRun([{ type: 'clip.remove', layerId: 'v' }])).toContain('pede confirmação');
    expect(confirm).not.toHaveBeenCalled();
    expect(api.dispatch({ type: 'clip.remove', layerId: 'v' })).toBe('erro: Lote cancelado pelo usuário.');
    expect(api.dispatch({ type: 'clip.remove', layerId: 'v' }, { format: 'json' })).toMatchObject({ ok: false, errors: ['erro: Lote cancelado pelo usuário.'] });
    expect(commit).not.toHaveBeenCalled();
    expect(doc.layers).toHaveLength(1);
  });

  it('export guard blocks mutations and history but permits planning and queries', () => {
    const doc = source();
    const commit = vi.fn();
    const undo = vi.fn(() => true);
    const api = createVctApi({ getProject: () => doc, keyframeTolerance: () => 1 / 60, commitProject: commit, confirmConsequential: () => true,
      assertCanEdit: () => { throw new Error('Exporting'); }, undo, redo: undo });
    expect(() => api.dispatch({ type: 'clip.remove', layerId: 'v' })).toThrow('Exporting');
    expect(() => api.undo()).toThrow('Exporting');
    expect(() => api.redo()).toThrow('Exporting');
    expect(api.getTimeline().tracks).toHaveLength(1);
    expect(api.dryRun([{ type: 'clip.remove', layerId: 'v' }], { format: 'json' }).timeline!.tracks).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });
});

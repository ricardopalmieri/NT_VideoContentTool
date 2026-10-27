import { copyClips, moveClipToTrack, overlapsTrack, pasteClips, rippleDelete, shiftClip, splitClip, trackIdOf } from './clip-tracks';
import { isTransitionType, syncTransitionAudioFades, type ClipTransition } from './transitions';
import { createLayer, type ProjectDocument } from './types';

export type EditingCommand =
  | { type: 'layer.create'; layerId: string; kind: 'text' | 'geometry'; name: string; startTime: number; endTime: number }
  | { type: 'layer.setText'; layerId: string; text: string }
  | { type: 'clip.split'; layerId: string; time: number; newLayerId: string }
  | { type: 'clip.move'; layerId: string; startTime: number; trackId?: string; allowOverlap?: boolean }
  | { type: 'clip.duplicate'; layerId: string; startTime: number; newLayerId: string }
  | { type: 'clip.remove'; layerId: string; ripple?: boolean }
  | { type: 'clip.setTransition'; layerId: string; transition: ClipTransition | null };

// Machine-readable descriptions also drive strict field parsing for these commands.
export const EDITING_COMMANDS = {
  'layer.create': { required: ['layerId', 'kind', 'name', 'startTime', 'endTime'], optional: [], description: 'Create text or geometry on a new top track. kind: text|geometry; times in seconds.' },
  'layer.setText': { required: ['layerId', 'text'], optional: [], description: 'Set text content (0–10000 characters) on an unlocked text layer.' },
  'clip.split': { required: ['layerId', 'time', 'newLayerId'], optional: [], description: 'Split at a frame boundary; preserve linked audio. Explicit sourceOut required for video; looping video is rejected.' },
  'clip.move': { required: ['layerId', 'startTime'], optional: ['trackId', 'allowOverlap'], description: 'Move with duration, keyframes, fades and linked audio. Existing destination track; overlap defaults to false.' },
  'clip.duplicate': { required: ['layerId', 'startTime', 'newLayerId'], optional: [], description: 'Copy one clip and linked audio; use original track if free, otherwise create a top track.' },
  'clip.remove': { required: ['layerId'], optional: ['ripple'], description: 'Remove clip and linked audio; ripple defaults to false. Requires page confirmation at commit.' },
  'clip.setTransition': { required: ['layerId', 'transition'], optional: [], description: 'Set {type: dissolve|dip|wipe-right|wipe-left|push-left, duration: seconds}, or null. Overlap determines duration when present.' },
} as const;

export function parseEditingCommand(value: Record<string, unknown>): EditingCommand | null {
  if (typeof value.type !== 'string' || !Object.hasOwn(EDITING_COMMANDS, value.type)) return null;
  const definition = EDITING_COMMANDS[value.type as keyof typeof EDITING_COMMANDS];
  const allowed: readonly string[] = ['type', ...definition.required, ...definition.optional];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Campo de comando desconhecido.');
  for (const key of definition.required) if (!(key in value)) throw new Error(`Campo obrigatório: ${key}.`);
  for (const key of ['layerId', 'newLayerId', 'trackId', 'name']) {
    if (key in value && (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 200)) {
      throw new Error(`${key} deve conter 1–200 caracteres.`);
    }
  }
  for (const key of ['startTime', 'endTime', 'time']) {
    if (key in value && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 7200)) {
      throw new Error(`${key} deve estar entre 0 e 7200 segundos.`);
    }
  }
  for (const key of ['ripple', 'allowOverlap']) if (key in value && typeof value[key] !== 'boolean') throw new Error(`${key} deve ser booleano.`);
  if (value.type === 'layer.create' && value.kind !== 'text' && value.kind !== 'geometry') throw new Error('kind deve ser text ou geometry.');
  if (value.type === 'layer.setText' && (typeof value.text !== 'string' || value.text.length > 10000)) throw new Error('text deve ser texto com até 10000 caracteres.');
  if (value.type === 'clip.setTransition' && value.transition !== null) {
    const t = value.transition;
    if (!t || typeof t !== 'object' || Array.isArray(t) || !('type' in t) || !isTransitionType(t.type)
      || !('duration' in t) || typeof t.duration !== 'number' || !Number.isFinite(t.duration) || t.duration <= 0 || t.duration > 7200
      || Object.keys(t).some(key => key !== 'type' && key !== 'duration')) throw new Error('Transição inválida.');
  }
  return structuredClone(value) as EditingCommand;
}

function idFactory(project: ProjectDocument, root: string) {
  const used = new Set<string>();
  for (const layer of project.layers) {
    used.add(layer.id); used.add(trackIdOf(layer));
    layer.effects.forEach(effect => used.add(effect.id));
  }
  for (const track of project.audioTracks) {
    used.add(track.id); if (track.laneId) used.add(track.laneId);
    track.effects.forEach(effect => used.add(effect.id));
  }
  project.postEffects.forEach(effect => used.add(effect.id));
  let sequence = 0;
  return (kind: string) => {
    const id = kind === 'layer' ? root : `${root}:${kind}:${++sequence}`;
    if (used.has(id)) throw new Error(`O identificador já está em uso: ${id}.`);
    used.add(id);
    return id;
  };
}

function frameTime(project: ProjectDocument, time: number) {
  if (Math.abs(time * project.settings.fps - Math.round(time * project.settings.fps)) > 1e-6) {
    throw new Error('O tempo deve coincidir com um frame da composição.');
  }
}

function inComposition(project: ProjectDocument, start: number, end: number) {
  frameTime(project, start); frameTime(project, end);
  if (start < 0 || end <= start || end > project.settings.duration + 1e-6) throw new Error('O clipe deve caber na duração da composição.');
}

export function executeEditingCommand(project: ProjectDocument, command: EditingCommand) {
  if (command.type === 'layer.create') {
    inComposition(project, command.startTime, command.endTime);
    const id = idFactory(project, command.layerId)('layer');
    project.layers.unshift(createLayer(command.kind, project.settings, {
      id, name: command.name, startTime: command.startTime, endTime: command.endTime,
      fadeInStart: command.startTime, fadeInEnd: command.startTime,
      fadeOutStart: command.endTime, fadeOutEnd: command.endTime,
    }));
    return { layerId: id };
  }
  const layer = project.layers.find(item => item.id === command.layerId);
  if (!layer) throw new Error(`Camada não encontrada: ${command.layerId}.`);
  if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
  switch (command.type) {
    case 'layer.setText':
      if (layer.kind !== 'text') throw new Error('A camada não é texto.');
      layer.text = command.text;
      return { layerId: layer.id, text: layer.text };
    case 'clip.split': {
      frameTime(project, command.time);
      // Do not guess decoded duration or restart a loop in an automated edit.
      if (layer.kind === 'video' && (layer.loop || layer.sourceOut <= layer.sourceIn)) throw new Error('Corte de vídeo exige sourceOut explícito e loop desligado.');
      const result = splitClip(project, layer.id, command.time, layer.sourceOut, .5 / project.settings.fps, idFactory(project, command.newLayerId));
      if (!result) throw new Error('O corte deve estar dentro do clipe, distante das bordas.');
      return { layerId: layer.id, newLayerId: result.second.id, audioIds: project.audioTracks.filter(t => t.linked && t.linkedLayerId === result.second.id).map(t => t.id) };
    }
    case 'clip.move': {
      const end = command.startTime + layer.endTime - layer.startTime;
      inComposition(project, command.startTime, end);
      const target = command.trackId ?? trackIdOf(layer);
      if (!project.layers.some(item => trackIdOf(item) === target)) throw new Error('Faixa de destino não encontrada.');
      if (!command.allowOverlap && overlapsTrack(project, target, command.startTime, end, layer.id)) throw new Error('Faixa de destino ocupada.');
      shiftClip(project, layer, command.startTime - layer.startTime);
      if (target !== trackIdOf(layer) && !moveClipToTrack(project, layer.id, target, command.allowOverlap)) throw new Error('Não foi possível mover entre faixas.');
      syncTransitionAudioFades(project);
      return { layerId: layer.id, trackId: trackIdOf(layer), startTime: layer.startTime, endTime: layer.endTime };
    }
    case 'clip.duplicate': {
      inComposition(project, command.startTime, command.startTime + layer.endTime - layer.startTime);
      const [copy] = pasteClips(project, copyClips(project, [layer.id]), command.startTime, idFactory(project, command.newLayerId));
      return { layerId: copy.id, trackId: trackIdOf(copy), audioIds: project.audioTracks.filter(t => t.linked && t.linkedLayerId === copy.id).map(t => t.id) };
    }
    case 'clip.remove':
      if (command.ripple) rippleDelete(project, [layer.id]);
      else {
        project.layers = project.layers.filter(item => item.id !== layer.id);
        project.audioTracks = project.audioTracks.filter(t => !t.linked || t.linkedLayerId !== layer.id);
      }
      syncTransitionAudioFades(project);
      return { layerId: layer.id, removed: true };
    case 'clip.setTransition':
      if (command.transition) layer.transition = structuredClone(command.transition);
      else delete layer.transition;
      syncTransitionAudioFades(project);
      return { layerId: layer.id, transition: layer.transition ?? null };
  }
}

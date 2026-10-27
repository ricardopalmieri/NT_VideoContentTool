import { copyClips, insertIntoTrack, moveClipToTrack, overlapsTrack, pasteClips, rippleDelete, shiftClip, splitClip, trackIdOf, visualTracks } from './clip-tracks';
import { syncTransitionAudioFades, type ClipTransition } from './transitions';
import { setLayerProps } from './project-commands';
import { createLayer, type InputKind, type ProjectDocument } from './types';

export type EditingCommand =
  | { type: 'layer.create'; layerId: string; kind: InputKind; name: string; startTime: number; endTime: number; asset?: string; trackId?: string; props?: Record<string, unknown> }
  | { type: 'layer.setText'; layerId: string; text: string }
  | { type: 'clip.split'; layerId: string; time: number; newLayerId: string; sourceDuration?: number }
  | { type: 'clip.move'; layerId: string; startTime: number; trackId?: string; allowOverlap?: boolean }
  | { type: 'clip.duplicate'; layerId: string; startTime: number; newLayerId: string }
  | { type: 'clip.remove'; layerId: string; ripple?: boolean }
  | { type: 'clip.setTransition'; layerId: string; transition: ClipTransition | null };

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
    const layer = createLayer(command.kind, project.settings, {
      id, name: command.name, startTime: command.startTime, endTime: command.endTime,
      fadeInStart: command.startTime, fadeInEnd: command.startTime,
      fadeOutStart: command.endTime, fadeOutEnd: command.endTime,
      ...(command.asset ? { asset: command.asset } : {}),
    });
    if (command.trackId) {
      if (overlapsTrack(project, command.trackId, command.startTime, command.endTime)) throw new Error('Faixa de destino ocupada.');
      if (!insertIntoTrack(project, layer, command.trackId)) throw new Error('Faixa de destino não encontrada.');
    } else {
      project.layers.unshift(layer);
    }
    if (command.props) setLayerProps(project, id, command.props);
    return { layerId: id, trackId: trackIdOf(layer) };
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
      // Without the decoded file duration, never guess it or restart a loop.
      if (layer.kind === 'video' && !command.sourceDuration && (layer.loop || layer.sourceOut <= layer.sourceIn)) {
        throw new Error('Corte de vídeo exige sourceOut explícito e loop desligado (ou sourceDuration).');
      }
      const mediaDuration = command.sourceDuration || layer.sourceOut;
      const result = splitClip(project, layer.id, command.time, mediaDuration, .5 / project.settings.fps, idFactory(project, command.newLayerId));
      if (!result) throw new Error('O corte deve estar dentro do clipe, distante das bordas.');
      return { layerId: layer.id, newLayerId: result.second.id, audioIds: project.audioTracks.filter(t => t.linked && t.linkedLayerId === result.second.id).map(t => t.id) };
    }
    case 'clip.move': {
      const end = command.startTime + layer.endTime - layer.startTime;
      // Só o início precisa cair num frame: o comprimento é o do próprio clipe (aparar deixa bordas fora da grade).
      frameTime(project, command.startTime);
      if (command.startTime < 0 || end > project.settings.duration + 1e-6) throw new Error('O clipe deve caber na duração da composição.');
      const target = command.trackId ?? trackIdOf(layer);
      if (!visualTracks(project).some(track => track.id === target)) throw new Error('Faixa de destino não encontrada.');
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

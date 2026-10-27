// Media bin, clip placement and named tracks (Batch 2).
import { ensureTrackMeta, insertIntoTrack, laneIdOf, overlapsTrack, visualTracks } from "./clip-tracks";
import { applyFit, assetKindOf, type Fit } from "./media-assets";
import { setLayerProps } from "./project-commands";
import { createAudioTrack, createLayer, type AssetSourceMetadata, type ProjectDocument } from "./types";

const EPSILON = 1e-6;

function idInUse(project: ProjectDocument, id: string) {
  return project.layers.some((layer) => layer.id === id || layer.trackId === id || layer.effects.some((effect) => effect.id === id))
    || project.audioTracks.some((track) => track.id === id || track.laneId === id || track.effects.some((effect) => effect.id === id))
    || project.postEffects.some((effect) => effect.id === id)
    || Boolean(project.tracks?.some((track) => track.id === id));
}

function onFrame(project: ProjectDocument, time: number, name: string) {
  const fps = project.settings.fps;
  if (Math.abs(time * fps - Math.round(time * fps)) > 1e-6) throw new Error(`${name} deve coincidir com um frame (múltiplo de 1/${fps} s).`);
}

export function addAsset(project: ProjectDocument, asset: string, metadata: Record<string, unknown>) {
  if (!asset.startsWith("media/")) throw new Error("asset deve ser uma referência media/….");
  const entry = metadata as unknown as AssetSourceMetadata;
  if (typeof entry.originalName !== "string" || typeof entry.size !== "number" || typeof entry.mimeType !== "string") {
    throw new Error("metadata precisa de originalName, size e mimeType.");
  }
  project.assetMetadata ||= {};
  project.assetMetadata[asset] = { ...entry, lastModified: entry.lastModified ?? 0, kind: entry.kind ?? assetKindOf(asset, entry) ?? undefined };
  return { asset };
}

export function removeAsset(project: ProjectDocument, asset: string) {
  const used = project.layers.some((layer) => layer.asset === asset) || project.audioTracks.some((track) => track.asset === asset);
  if (used) throw new Error(`A mídia ${asset} está em uso na timeline. Remova os clipes antes.`);
  if (!project.assetMetadata?.[asset]) throw new Error(`Mídia não encontrada no bin: ${asset}.`);
  delete project.assetMetadata[asset];
  return { asset, removed: true };
}

export interface PlaceCommand {
  layerId: string; asset: string; startTime: number; endTime?: number; duration?: number; trackId?: string;
  sourceIn?: number; playbackRate?: number; fit?: Fit; audio?: "linked" | "none"; name?: string; props?: Record<string, unknown>;
}

/** Puts a bin asset on the timeline in one step: timing, source range, framing and linked audio. */
export function placeClip(project: ProjectDocument, command: PlaceCommand) {
  const metadata = project.assetMetadata?.[command.asset];
  const kind = assetKindOf(command.asset, metadata);
  if (!metadata && !project.layers.some((layer) => layer.asset === command.asset)) {
    throw new Error(`Mídia não encontrada no bin: ${command.asset}. Veja vct.assets().`);
  }
  if (kind === "audio") throw new Error("Para áudio use audio.create.");
  if (!kind) throw new Error(`Tipo de mídia desconhecido: ${command.asset}.`);
  if (idInUse(project, command.layerId)) throw new Error(`O identificador já está em uso: ${command.layerId}.`);
  if (command.endTime !== undefined && command.duration !== undefined) throw new Error("Use endTime ou duration, não os dois.");
  const rate = command.playbackRate ?? 1;
  const sourceIn = command.sourceIn ?? 0;
  const sourceLength = kind === "video" && metadata?.duration ? metadata.duration - sourceIn : undefined;
  if (sourceLength !== undefined && sourceLength <= EPSILON) throw new Error(`sourceIn passa do fim do arquivo (${metadata!.duration} s).`);
  const fps = project.settings.fps;
  const end = command.endTime ?? (command.duration !== undefined
    ? command.startTime + command.duration
    : command.startTime + (sourceLength !== undefined ? Math.floor(sourceLength / rate * fps + EPSILON) / fps : 3));
  onFrame(project, command.startTime, "startTime");
  onFrame(project, end, "endTime");
  if (end <= command.startTime + EPSILON) throw new Error("O clipe precisa ter duração maior que zero.");
  if (end > project.settings.duration + EPSILON) {
    throw new Error(`O clipe termina em ${+end.toFixed(3)} s, depois da composição (${project.settings.duration} s). Use composition.set ou endTime menor.`);
  }
  const used = (end - command.startTime) * rate;
  if (sourceLength !== undefined && used > sourceLength + 1 / fps) {
    throw new Error(`O trecho pedido (${+used.toFixed(2)} s do arquivo) passa do fim da mídia; o máximo a partir de ${sourceIn} s é ${+sourceLength.toFixed(2)} s.`);
  }
  const layer = createLayer(kind, project.settings, {
    id: command.layerId, name: command.name || metadata?.originalName || command.asset.replace(/^media\//, ""),
    asset: command.asset, startTime: command.startTime, endTime: end,
    fadeInStart: command.startTime, fadeInEnd: command.startTime, fadeOutStart: end, fadeOutEnd: end,
    ...(kind === "video" ? { loop: false, sourceIn, sourceOut: sourceIn + used, playbackRate: rate } : {}),
  });
  const fit = command.fit ?? (metadata?.width ? "contain" : "none");
  if (fit !== "none") applyFit(layer, metadata, project.settings, fit);
  else if (metadata?.width && metadata.height) Object.assign(layer, { width: metadata.width, height: metadata.height });
  if (command.trackId) {
    if (overlapsTrack(project, command.trackId, command.startTime, end)) throw new Error(`Faixa ${command.trackId} ocupada entre ${command.startTime} e ${+end.toFixed(3)} s.`);
    if (!insertIntoTrack(project, layer, command.trackId)) throw new Error(`Faixa não encontrada: ${command.trackId}. Crie com track.create.`);
  } else {
    project.layers.unshift(layer);
  }
  const audioIds: string[] = [];
  if (kind === "video" && command.audio !== "none" && metadata?.hasAudio !== false) {
    const track = createAudioTrack(layer.name, command.asset, end - command.startTime, {
      id: `${command.layerId}:audio`, linked: true, linkedLayerId: layer.id, startTime: command.startTime, endTime: end,
      sourceIn, sourceOut: sourceIn + used, playbackRate: rate,
      fadeInStart: command.startTime, fadeInEnd: command.startTime, fadeOutStart: end, fadeOutEnd: end,
    });
    if (idInUse(project, track.id)) throw new Error(`O identificador já está em uso: ${track.id}.`);
    project.audioTracks.push(track);
    audioIds.push(track.id);
  }
  if (command.props) setLayerProps(project, layer.id, command.props);
  return { layerId: layer.id, trackId: layer.trackId || layer.id, startTime: layer.startTime, endTime: layer.endTime, audioIds };
}

export function fitLayer(project: ProjectDocument, layerId: string, fit: Fit) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`Camada não encontrada: ${layerId}.`);
  if (layer.locked) throw new Error(`A camada está bloqueada: ${layer.id}.`);
  if (!layer.asset) throw new Error("layer.fit vale só para imagem ou vídeo.");
  applyFit(layer, project.assetMetadata?.[layer.asset], project.settings, fit);
  return { layerId, width: layer.width, height: layer.height, rotation: layer.rotation };
}

export function createTrack(project: ProjectDocument, trackId: string, kind: "video" | "audio", name?: string, index?: number) {
  if (idInUse(project, trackId)) throw new Error(`O identificador já está em uso: ${trackId}.`);
  const tracks = ensureTrackMeta(project);
  const sameKind = tracks.filter((track) => track.kind === kind);
  const prefix = kind === "video" ? "V" : "A";
  let number = sameKind.length + 1;
  while (tracks.some((track) => track.name === `${prefix}${number}`)) number++;
  const entry = { id: trackId, kind, name: name || `${prefix}${number}` };
  const at = Math.max(0, Math.min(sameKind.length, index ?? 0));
  const video = tracks.filter((track) => track.kind === "video");
  const audio = tracks.filter((track) => track.kind === "audio");
  (kind === "video" ? video : audio).splice(kind === "video" ? at : index ?? audio.length, 0, entry);
  project.tracks = [...video, ...audio];
  return { trackId, kind, name: entry.name };
}

export function renameTrack(project: ProjectDocument, trackId: string, name: string) {
  const tracks = ensureTrackMeta(project);
  const track = tracks.find((item) => item.id === trackId);
  if (!track) throw new Error(`Faixa não encontrada: ${trackId}.`);
  track.name = name;
  return { trackId, name };
}

export function removeTrack(project: ProjectDocument, trackId: string) {
  const busy = visualTracks(project).find((track) => track.id === trackId)?.clips.length
    || project.audioTracks.some((track) => laneIdOf(track) === trackId);
  if (busy) throw new Error(`A faixa ${trackId} tem clipes. Remova ou mova os clipes antes.`);
  if (!project.tracks?.some((track) => track.id === trackId)) throw new Error(`Faixa não encontrada: ${trackId}.`);
  project.tracks = project.tracks.filter((track) => track.id !== trackId);
  return { trackId, removed: true };
}

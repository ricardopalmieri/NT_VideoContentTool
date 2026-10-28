// "Inserir na timeline": se a mídia transcrita é um arquivo do bin que ainda não está na timeline, ela
// entra junto com as legendas, no mesmo lote de comandos (um só passo de desfazer). Puro: sem DOM.
import type { VctCommand } from "../model/commands";
import { listAssets } from "../model/media-assets";
import type { ProjectDocument } from "../model/types";

/** A fonte da transcrição: arquivo do bin, a partir de `from` (s no arquivo), `length` segundos (undefined = até o fim). */
export interface TranscribedMedia {
  asset: string;
  from: number;
  length?: number;
}

const EPSILON = 1e-6;

function freeId(project: ProjectDocument, base: string) {
  const used = (id: string) => project.layers.some((layer) => layer.id === id || layer.trackId === id)
    || project.audioTracks.some((track) => track.id === id || track.laneId === id)
    || Boolean(project.tracks?.some((track) => track.id === id));
  let id = base;
  for (let n = 2; used(id); n++) id = `${base}${n}`;
  return id;
}

/** O arquivo já tem clipe (de vídeo ou de áudio) na timeline? */
export function isOnTimeline(project: ProjectDocument, asset: string) {
  return project.layers.some((layer) => layer.asset === asset) || project.audioTracks.some((track) => track.asset === asset);
}

/**
 * Comandos que colocam a mídia transcrita na timeline, começando no início do trecho (o tempo da timeline
 * é o tempo do arquivo, então as legendas caem no lugar certo): vídeo no tamanho original com o áudio
 * vinculado (clip.place), ou o clipe de áudio (audio.create). Vazio se não há o que colocar.
 */
export function mediaPlacementCommands(project: ProjectDocument, media: TranscribedMedia | null): VctCommand[] {
  if (!media || isOnTimeline(project, media.asset)) return [];
  const entry = listAssets(project).find((item) => item.id === media.asset);
  if (!entry || (entry.kind !== "video" && entry.kind !== "audio")) return [];
  const fps = project.settings.fps;
  const onFrame = (time: number) => Math.round(time * fps) / fps;
  const start = onFrame(Math.max(0, media.from));
  const available = entry.duration !== undefined ? entry.duration - start : Infinity;
  const wanted = media.length !== undefined && Number.isFinite(media.length) ? media.length : available;
  // Termina no fim do trecho, do arquivo ou da composição, o que vier primeiro, em quadros inteiros.
  const span = Math.min(wanted, available, project.settings.duration - start);
  if (!Number.isFinite(span)) return [];
  const end = Math.floor((start + span) * fps + EPSILON) / fps;
  if (end - start < 1 / fps - EPSILON) return [];
  if (entry.kind === "video") {
    return [{ type: "clip.place", layerId: freeId(project, "transcrito"), asset: media.asset, startTime: start, endTime: end, sourceIn: start, audio: "linked" }];
  }
  return [{
    type: "audio.create", trackId: freeId(project, "transcrito_audio"), asset: media.asset, name: entry.name, startTime: start, endTime: end,
    props: { sourceIn: start, sourceOut: end },
  }];
}

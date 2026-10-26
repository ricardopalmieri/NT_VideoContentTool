import type { AudioTrack, Layer } from "./types";

export function syncLinkedAudioTracks(layer: Layer, tracks: AudioTrack[]) {
  if (layer.kind !== "video") return;
  for (const track of tracks) {
    if (!track.linked || track.linkedLayerId !== layer.id) continue;
    track.startTime = layer.startTime;
    track.endTime = layer.endTime;
    track.sourceIn = layer.sourceIn;
    track.sourceOut = layer.sourceOut;
    track.playbackRate = layer.playbackRate;
    track.reverse = layer.reverse;
    track.loop = layer.loop;
    track.fadeInStart = layer.fadeInStart;
    track.fadeInEnd = layer.fadeInEnd;
    track.fadeOutStart = layer.fadeOutStart;
    track.fadeOutEnd = layer.fadeOutEnd;
  }
}

export function syncLinkedVideoLayer(track: AudioTrack, layers: Layer[], tracks: AudioTrack[]) {
  if (!track.linked || !track.linkedLayerId) return undefined;
  const layer = layers.find((item) => item.id === track.linkedLayerId && item.kind === "video");
  if (!layer) return undefined;
  layer.startTime = track.startTime;
  layer.endTime = track.endTime;
  layer.sourceIn = track.sourceIn;
  layer.sourceOut = track.sourceOut;
  layer.playbackRate = track.playbackRate;
  layer.reverse = track.reverse;
  layer.loop = track.loop;
  layer.fadeInStart = track.fadeInStart;
  layer.fadeInEnd = track.fadeInEnd;
  layer.fadeOutStart = track.fadeOutStart;
  layer.fadeOutEnd = track.fadeOutEnd;
  syncLinkedAudioTracks(layer, tracks);
  return layer;
}

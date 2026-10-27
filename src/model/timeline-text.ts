// The timeline as short text for agents: one line per track, without ? & or =.
import { audioLanes, trackName, visualTracks } from "./clip-tracks";
import type { ProjectDocument } from "./types";

const seconds = (value: number) => `${+value.toFixed(3)}`;

export function timelineText(project: ProjectDocument) {
  const { settings } = project;
  const lines = [`${settings.name} · ${settings.width}x${settings.height} · ${settings.fps} fps · ${seconds(settings.duration)} s`];
  for (const track of visualTracks(project)) {
    const clips = [...track.clips].sort((a, b) => a.startTime - b.startTime).map((clip) => {
      const extras = [
        clip.kind !== "video" && clip.kind !== "image" ? clip.kind : "",
        clip.kind === "text" && clip.text ? `"${clip.text.slice(0, 24)}"` : "",
        clip.transition ? `${clip.transition.type} ${seconds(clip.transition.duration)}` : "",
        clip.blendMode !== "normal" ? clip.blendMode : "",
        clip.opacity < 1 ? `op ${+clip.opacity.toFixed(2)}` : "",
        clip.effects.length ? `fx ${clip.effects.map((effect) => effect.kind).join("+")}` : "",
        Object.keys(clip.keyframes).length ? `kf ${Object.keys(clip.keyframes).join("+")}` : "",
        clip.visible ? "" : "oculto",
        clip.locked ? "travado" : "",
      ].filter(Boolean).join(" ");
      return `${seconds(clip.startTime)}-${seconds(clip.endTime)} ${clip.id}${extras ? ` (${extras})` : ""}`;
    });
    lines.push(`${trackName(project, track.id)} [${track.id}]: ${clips.join(" | ") || "vazia"}`);
  }
  for (const lane of audioLanes(project)) {
    const clips = lane.clips.map((clip) => {
      const extras = [
        clip.linked && clip.linkedLayerId ? `vinc ${clip.linkedLayerId}` : "",
        clip.muted ? "mudo" : "",
        clip.volume !== 1 ? `vol ${+clip.volume.toFixed(2)}` : "",
      ].filter(Boolean).join(" ");
      return `${seconds(clip.startTime)}-${seconds(clip.endTime)} ${clip.id}${extras ? ` (${extras})` : ""}`;
    });
    lines.push(`${trackName(project, lane.id)} [${lane.id}]: ${clips.join(" | ") || "vazia"}`);
  }
  if (project.postEffects.length) lines.push(`pós: ${project.postEffects.map((effect) => `${effect.id} ${effect.kind}${effect.enabled ? "" : " desligado"}`).join(" | ")}`);
  return lines.join("\n");
}

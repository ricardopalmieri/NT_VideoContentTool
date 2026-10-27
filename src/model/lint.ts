// Quality checks shared by the warnings panel and window.vct.lint().
import { audioLanes } from "./clip-tracks";
import type { Layer, ProjectDocument } from "./types";

export interface LintIssue {
  level: "erro" | "aviso";
  code: "fora-da-composicao" | "flash" | "area-segura" | "buraco" | "audio-sobreposto" | "texto-rapido" | "midia-sem-dados";
  message: string;
  start?: number;
  end?: number;
  ids: string[];
}

const EPSILON = 1e-6;
const s = (value: number) => `${+value.toFixed(2)} s`;

/** Margins kept free of text: social UI on vertical video, title-safe 5% otherwise. */
export function safeArea(settings: Pick<ProjectDocument["settings"], "width" | "height">) {
  const vertical = settings.height > settings.width * 1.3;
  return vertical
    ? { top: settings.height * 220 / 1920, bottom: settings.height * 380 / 1920, left: settings.width * .05, right: settings.width * .05 }
    : { top: settings.height * .05, bottom: settings.height * .05, left: settings.width * .05, right: settings.width * .05 };
}

function bounds(layer: Layer) {
  const width = Math.abs(layer.width * layer.scaleX);
  const height = Math.abs(layer.height * layer.scaleY);
  const angle = layer.rotation * Math.PI / 180;
  const w = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
  const h = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
  return { left: layer.x - w / 2, right: layer.x + w / 2, top: layer.y - h / 2, bottom: layer.y + h / 2 };
}

function visualSpan(project: ProjectDocument) {
  const area = project.settings.workArea;
  return area ? [area.in, area.out] : [0, project.settings.duration];
}

export function lintProject(project: ProjectDocument): LintIssue[] {
  const issues: LintIssue[] = [];
  const { settings } = project;
  const frame = 1 / settings.fps;

  for (const item of [...project.layers, ...project.audioTracks]) {
    if (item.endTime > settings.duration + EPSILON) {
      issues.push({ level: "erro", code: "fora-da-composicao", message: `${item.id} termina em ${s(item.endTime)}, depois da composição (${s(settings.duration)}).`, ids: [item.id], start: settings.duration, end: item.endTime });
    }
  }

  // Photosensitivity (WCAG 2.3.1): no more than 3 flashes in any second.
  const shortClips = project.layers
    .filter((layer) => layer.visible && layer.kind !== "guide" && layer.endTime - layer.startTime <= 3 * frame + EPSILON)
    .sort((a, b) => a.startTime - b.startTime);
  for (const clip of shortClips) {
    const burst = shortClips.filter((other) => other.startTime >= clip.startTime - EPSILON && other.startTime < clip.startTime + 1 - EPSILON);
    if (burst.length > 3) {
      issues.push({ level: "erro", code: "flash", message: `${burst.length} flashes em 1 s a partir de ${s(clip.startTime)}. Acima de 3 por segundo há risco de fotossensibilidade (WCAG 2.3.1).`, start: clip.startTime, end: clip.startTime + 1, ids: burst.map((item) => item.id) });
      break;
    }
  }
  if (shortClips.length && !issues.some((issue) => issue.code === "flash")) {
    issues.push({ level: "aviso", code: "flash", message: `${shortClips.length} clipe(s) de até 3 frames (flash). Confira o brilho; evite mais de 3 por segundo.`, ids: shortClips.map((item) => item.id) });
  }

  const margin = safeArea(settings);
  for (const layer of project.layers.filter((item) => item.kind === "text" && item.visible)) {
    const box = bounds(layer);
    if (box.top < margin.top - EPSILON || box.bottom > settings.height - margin.bottom + EPSILON || box.left < margin.left - EPSILON || box.right > settings.width - margin.right + EPSILON) {
      issues.push({ level: "aviso", code: "area-segura", message: `Texto ${layer.id} sai da área segura (margens ${Math.round(margin.top)} px no topo e ${Math.round(margin.bottom)} px na base).`, ids: [layer.id], start: layer.startTime, end: layer.endTime });
    }
    const words = (layer.text || "").trim().split(/\s+/).filter(Boolean).length;
    const minimum = 1 + .3 * words;
    if (words && layer.endTime - layer.startTime < minimum - EPSILON) {
      issues.push({ level: "aviso", code: "texto-rapido", message: `Texto ${layer.id} fica ${s(layer.endTime - layer.startTime)} na tela; para ${words} palavra(s) o mínimo sugerido é ${s(minimum)}.`, ids: [layer.id], start: layer.startTime, end: layer.endTime });
    }
  }

  // Gaps where nothing visual covers the frame (only when the project has visual clips).
  const visual = project.layers.filter((layer) => layer.visible && layer.kind !== "guide");
  if (visual.length && !settings.transparent) {
    const [from, to] = visualSpan(project);
    const spans = visual.map((layer) => [Math.max(from, layer.startTime), Math.min(to, layer.endTime)] as const).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    let cursor = from;
    for (const [start, end] of spans) {
      if (start - cursor > frame + EPSILON) issues.push({ level: "aviso", code: "buraco", message: `Nada visível de ${s(cursor)} a ${s(start)} (só o fundo).`, start: cursor, end: start, ids: [] });
      cursor = Math.max(cursor, end);
    }
    if (to - cursor > frame + EPSILON) issues.push({ level: "aviso", code: "buraco", message: `Nada visível de ${s(cursor)} a ${s(to)} (só o fundo).`, start: cursor, end: to, ids: [] });
  }

  // Audible clips from different files playing at the same time.
  const audible = project.audioTracks.filter((track) => !track.muted && track.volume > .001);
  const lanes = audioLanes(project);
  for (let a = 0; a < audible.length; a++) {
    for (let b = a + 1; b < audible.length; b++) {
      const first = audible[a];
      const second = audible[b];
      if (first.asset === second.asset) continue;
      const start = Math.max(first.startTime, second.startTime);
      const end = Math.min(first.endTime, second.endTime);
      if (end - start <= frame) continue;
      const sameLane = lanes.some((lane) => lane.clips.includes(first) && lane.clips.includes(second));
      issues.push({ level: "aviso", code: "audio-sobreposto", message: `${first.id} e ${second.id} soam juntos de ${s(start)} a ${s(end)}${sameLane ? "" : " (faixas diferentes)"}. Ajuste volume ou mute com audio.set.`, start, end, ids: [first.id, second.id] });
    }
  }

  for (const layer of project.layers.filter((item) => item.asset && (item.kind === "video" || item.kind === "image"))) {
    if (!project.assetMetadata?.[layer.asset!]?.width) {
      issues.push({ level: "aviso", code: "midia-sem-dados", message: `${layer.id} usa ${layer.asset}, sem resolução conhecida no bin (enquadramento automático indisponível).`, ids: [layer.id] });
      break;
    }
  }
  return issues;
}

/** Lint as short text, one issue per line (no ? & or =). */
export function lintText(project: ProjectDocument) {
  const issues = lintProject(project);
  if (!issues.length) return "Nenhum problema encontrado.";
  return issues.map((issue) => `${issue.level} ${issue.code}: ${issue.message}`).join("\n");
}

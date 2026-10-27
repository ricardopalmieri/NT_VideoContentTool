// Frames to export: the work area when it is set, else the whole composition.
import type { ProjectSettings } from "../model/types";

export function exportRange(settings: Pick<ProjectSettings, "fps" | "duration" | "workArea">) {
  const start = settings.workArea ? Math.max(0, settings.workArea.in) : 0;
  const end = settings.workArea ? Math.min(settings.duration, settings.workArea.out) : settings.duration;
  const firstFrame = Math.round(start * settings.fps);
  const frameCount = Math.max(1, Math.ceil(end * settings.fps - 1e-6) - firstFrame);
  return { start: firstFrame / settings.fps, end, firstFrame, frameCount, duration: frameCount / settings.fps };
}

// Musical times for agents and the beat grid: "bar:3.2" (bar 3, beat 2,
// counted from 1), "beat:14.5" (beats after the grid offset), and lengths
// "bars:2" / "beats:4". Results are snapped to the composition frame.
import type { ProjectSettings } from "./types";

const POSITION = /^(bar|beat):(\d+(?:\.\d+)?)$/;
const LENGTH = /^(bars|beats):(\d+(?:\.\d+)?)$/;
export const TIME_FIELDS = ["startTime", "endTime", "time", "duration", "at"] as const;

export function resolveMusicalTime(value: string, settings: Pick<ProjectSettings, "fps" | "grid">, field: string) {
  const grid = settings.grid;
  if (!grid) throw new Error(`${field}: "${value}" exige grade musical. Use composition.set com grid {bpm, offset}.`);
  const beat = 60 / grid.bpm;
  let seconds: number;
  const position = POSITION.exec(value);
  const length = LENGTH.exec(value);
  if (position && field !== "duration") {
    if (position[1] === "beat") seconds = grid.offset + Number(position[2]) * beat;
    else {
      const [bar, beatInBar = "1"] = position[2].split(".");
      if (Number(bar) < 1 || Number(beatInBar) < 1) throw new Error(`${field}: compassos e tempos contam a partir de 1 ("bar:1.1").`);
      if (!Number.isInteger(Number(beatInBar)) || Number(beatInBar) > grid.beatsPerBar) {
        throw new Error(`${field}: "${value}" — o tempo dentro do compasso vai de 1 a ${grid.beatsPerBar}. Para frações use beat:14.5.`);
      }
      seconds = grid.offset + ((Number(bar) - 1) * grid.beatsPerBar + Number(beatInBar) - 1) * beat;
    }
  } else if (length) {
    seconds = Number(length[2]) * beat * (length[1] === "bars" ? grid.beatsPerBar : 1);
  } else {
    throw new Error(`${field}: tempo musical inválido "${value}". Use bar:3.2, beat:14, bars:2 ou beats:4.`);
  }
  return Math.round(seconds * settings.fps) / settings.fps;
}

/** Converts musical strings in time fields (and layer.set props) to seconds. */
export function resolveCommandTimes(command: unknown, settings: Pick<ProjectSettings, "fps" | "grid">) {
  if (!command || typeof command !== "object" || Array.isArray(command)) return command;
  const copy = { ...(command as Record<string, unknown>) };
  for (const field of TIME_FIELDS) {
    if (typeof copy[field] === "string") copy[field] = resolveMusicalTime(copy[field] as string, settings, field);
  }
  // Listas de tempos das macros (fx.strobe times) também aceitam "beat:3".
  if (Array.isArray(copy.times)) {
    copy.times = copy.times.map((value, index) => typeof value === "string" ? resolveMusicalTime(value, settings, `times[${index}]`) : value);
  }
  if (copy.props && typeof copy.props === "object" && !Array.isArray(copy.props)) {
    const props = { ...(copy.props as Record<string, unknown>) };
    for (const field of ["startTime", "endTime"]) if (typeof props[field] === "string") props[field] = resolveMusicalTime(props[field] as string, settings, field);
    copy.props = props;
  }
  return copy;
}

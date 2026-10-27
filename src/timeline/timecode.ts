// Timecode HH:MM:SS:FF e contagem de frames para campos de duração.
export type DurationUnit = "tc" | "frames";

const pad = (value: number) => String(value).padStart(2, "0");

export function formatTimecode(seconds: number, fps: number) {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const frameRate = Math.max(1, Math.round(fps));
  const frames = totalFrames % frameRate;
  const totalSeconds = Math.floor(totalFrames / frameRate);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(totalSeconds % 60)}:${pad(frames)}`;
}

// Aceita "HH:MM:SS:FF", "MM:SS:FF", "MM:SS" (sem frames) e "SS". Separador ":" ou ";".
export function parseTimecode(text: string, fps: number): number | null {
  const parts = text.trim().split(/[:;]/);
  if (!parts.length || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  const frameRate = Math.max(1, Math.round(fps));
  let hours = 0, minutes = 0, seconds = 0, frames = 0;
  if (numbers.length === 4) [hours, minutes, seconds, frames] = numbers;
  else if (numbers.length === 3) [minutes, seconds, frames] = numbers;
  else if (numbers.length === 2) [minutes, seconds] = numbers;
  else [seconds] = numbers;
  if (frames >= frameRate) return null;
  return ((hours * 3600 + minutes * 60 + seconds) * frameRate + frames) / frameRate;
}

export function formatDurationValue(seconds: number, fps: number, unit: DurationUnit) {
  return unit === "frames" ? String(Math.round(seconds * fps)) : formatTimecode(seconds, fps);
}

export function parseDurationValue(text: string, fps: number, unit: DurationUnit): number | null {
  if (unit === "frames") {
    if (!/^\d+$/.test(text.trim())) return null;
    return Number(text.trim()) / Math.max(1, fps);
  }
  return parseTimecode(text, fps);
}

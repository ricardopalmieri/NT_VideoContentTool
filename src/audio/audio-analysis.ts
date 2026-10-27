// Audio analysis for agents that cannot listen: level profile, onsets and
// tempo from decoded samples. Pure functions over Float32Array channels.

export interface LevelPoint {
  time: number;
  rms: number;
  peak: number;
}

function mono(channels: readonly Float32Array[], start: number, end: number) {
  const length = Math.max(0, end - start);
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index++) out[index] += (channel[start + index] || 0) / channels.length;
  }
  return out;
}

/** RMS and peak (0..1, linear) per step seconds between start and end. */
export function levelProfile(channels: readonly Float32Array[], sampleRate: number, start: number, end: number, step = .5): LevelPoint[] {
  const points: LevelPoint[] = [];
  for (let time = start; time < end - 1e-9; time += step) {
    const from = Math.floor(time * sampleRate);
    const to = Math.min(Math.floor(Math.min(end, time + step) * sampleRate), channels[0]?.length ?? 0);
    let sum = 0;
    let peak = 0;
    let count = 0;
    for (const channel of channels) {
      for (let index = from; index < to; index++) {
        const value = channel[index];
        sum += value * value;
        peak = Math.max(peak, Math.abs(value));
        count++;
      }
    }
    points.push({ time: +time.toFixed(3), rms: count ? Math.sqrt(sum / count) : 0, peak });
  }
  return points;
}

export const toDb = (value: number) => value <= 1e-5 ? -100 : 20 * Math.log10(value);

/** Energy envelope at hop seconds (default ~11.6 ms at 44.1 kHz). */
function envelope(signal: Float32Array, sampleRate: number, hop: number) {
  const size = Math.max(1, Math.round(hop * sampleRate));
  const frames = Math.floor(signal.length / size);
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let index = frame * size; index < (frame + 1) * size; index++) sum += signal[index] * signal[index];
    out[frame] = Math.sqrt(sum / size);
  }
  return out;
}

/** Times (s) where energy rises sharply: hits, cuts in the music, attacks. */
export function detectOnsets(channels: readonly Float32Array[], sampleRate: number, hop = .01) {
  const signal = mono(channels, 0, channels[0]?.length ?? 0);
  const env = envelope(signal, sampleRate, hop);
  const flux = new Float32Array(env.length);
  // Silêncio antes do primeiro quadro: um golpe em 0 s também conta.
  for (let index = 0; index < env.length; index++) flux[index] = Math.max(0, env[index] - (env[index - 1] ?? 0));
  // Piso absoluto: ondulação de graves e ruído em trechos calmos não viram ataques.
  let peak = 0;
  for (const value of flux) peak = Math.max(peak, value);
  const floor = peak * .15;
  const onsets: number[] = [];
  const window = Math.max(1, Math.round(.1 / hop));
  let last = -Infinity;
  for (let index = 0; index < flux.length - 1; index++) {
    let mean = 0;
    let count = 0;
    for (let offset = -window; offset <= window; offset++) {
      const value = flux[index + offset];
      if (value !== undefined) { mean += value; count++; }
    }
    mean /= Math.max(1, count);
    const time = index * hop;
    if (flux[index] > Math.max(mean * 1.6 + 1e-4, floor) && flux[index] >= (flux[index - 1] ?? 0) && flux[index] >= flux[index + 1] && time - last > .07) {
      onsets.push(+time.toFixed(3));
      last = time;
    }
  }
  return { onsets, envelope: env, flux, hop };
}

/** Tempo by autocorrelation of the onset strength, folded into 70..180 BPM. */
export function estimateTempo(flux: Float32Array, hop: number, onsets: readonly number[]) {
  const minLag = Math.round(60 / 180 / hop);
  const maxLag = Math.round(60 / 70 / hop);
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let index = lag; index < flux.length; index++) sum += flux[index] * flux[index - lag];
    if (sum > best) { best = sum; bestLag = lag; }
  }
  if (!bestLag || best <= 0) return null;
  const bpm = 60 / (bestLag * hop);
  const beat = 60 / bpm;
  // Grid offset: phase that puts the most onsets on beats.
  let offset = 0;
  let bestScore = -1;
  for (let phase = 0; phase < beat; phase += hop) {
    const score = onsets.reduce((total, time) => {
      const distance = Math.abs(((time - phase) % beat + beat) % beat);
      return total + (Math.min(distance, beat - distance) < .03 ? 1 : 0);
    }, 0);
    if (score > bestScore) { bestScore = score; offset = phase; }
  }
  return { bpm: +bpm.toFixed(1), offset: +offset.toFixed(3), confidence: onsets.length ? +(bestScore / onsets.length).toFixed(2) : 0 };
}

export interface SectionSummary {
  start: number;
  end: number;
  level: "silêncio" | "baixo" | "médio" | "alto";
}

/** Groups the level profile into sections of similar loudness. */
export function sections(points: readonly LevelPoint[], step: number): SectionSummary[] {
  const levelOf = (rms: number): SectionSummary["level"] => {
    const db = toDb(rms);
    return db < -50 ? "silêncio" : db < -28 ? "baixo" : db < -16 ? "médio" : "alto";
  };
  const out: SectionSummary[] = [];
  for (const point of points) {
    const level = levelOf(point.rms);
    const last = out.at(-1);
    if (last && last.level === level) last.end = +(point.time + step).toFixed(3);
    else out.push({ start: point.time, end: +(point.time + step).toFixed(3), level });
  }
  return out;
}

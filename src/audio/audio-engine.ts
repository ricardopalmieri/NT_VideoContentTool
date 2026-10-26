import { fadeInEnvelope, fadeOutEnvelope } from "../timeline/timing";
import type { AudioTrack, ProjectDocument } from "../model/types";
import { resolveAssetUrl } from "../io/web-platform";

const decoded = new Map<string, AudioBuffer>();
const reversed = new Map<string, AudioBuffer>();

async function fetchAudioBuffer(asset: string, context: BaseAudioContext) {
  const url = resolveAssetUrl(asset);
  const cached = decoded.get(url);
  if (cached) return cached;
  if (!url) throw new Error(`Asset de áudio ausente: ${asset}`);
  const bytes = await (await fetch(url)).arrayBuffer();
  const buffer = await context.decodeAudioData(bytes.slice(0));
  decoded.set(url, buffer);
  return buffer;
}

function reverseBuffer(context: BaseAudioContext, asset: string, source: AudioBuffer) {
  const key = resolveAssetUrl(asset);
  const cached = reversed.get(key);
  if (cached) return cached;
  const result = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel);
    const output = result.getChannelData(channel);
    for (let index = 0; index < input.length; index++) output[index] = input[input.length - 1 - index];
  }
  reversed.set(key, result);
  return result;
}

export async function probeAudio(asset: string) {
  const context = new AudioContext();
  try {
    return await fetchAudioBuffer(asset, context);
  } finally {
    await context.close();
  }
}

function configureSource(context: BaseAudioContext, track: AudioTrack, original: AudioBuffer) {
  const source = context.createBufferSource();
  const buffer = track.reverse ? reverseBuffer(context, track.asset, original) : original;
  source.buffer = buffer;
  source.playbackRate.value = Math.max(.05, Math.abs(track.playbackRate || 1));
  const sourceIn = Math.max(0, Math.min(original.duration, track.sourceIn || 0));
  const sourceOut = Math.max(sourceIn, Math.min(original.duration, track.sourceOut || original.duration));
  source.loop = track.loop;
  source.loopStart = track.reverse ? original.duration - sourceOut : sourceIn;
  source.loopEnd = track.reverse ? original.duration - sourceIn : sourceOut;
  return { source, offset: track.reverse ? original.duration - sourceOut : sourceIn };
}



function convolverImpulse(context: BaseAudioContext, duration: number, decay: number) {
  const length = Math.max(1, Math.round(context.sampleRate * Math.min(6, duration)));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      const noise = Math.sin(index * (channel ? 91.173 : 73.761)) * 43758.5453;
      data[index] = ((noise - Math.floor(noise)) * 2 - 1) * Math.pow(1 - index / length, Math.max(.1, decay));
    }
  }
  return impulse;
}

function applyAudioEffects(context: BaseAudioContext, input: AudioNode, track: AudioTrack) {
  let current = input;
  for (const effect of track.effects || []) {
    if (!effect.enabled) continue;
    const p = effect.params;
    if (effect.kind === "lowpass" || effect.kind === "highpass") {
      const filter = context.createBiquadFilter();
      filter.type = effect.kind;
      filter.frequency.value = Math.max(20, Math.min(22000, p.frequency));
      filter.Q.value = Math.max(.01, Math.min(30, p.resonance));
      current.connect(filter);
      current = filter;
    } else if (effect.kind === "eq3") {
      const low = context.createBiquadFilter();
      low.type = "lowshelf"; low.frequency.value = 250; low.gain.value = p.low;
      const mid = context.createBiquadFilter();
      mid.type = "peaking"; mid.frequency.value = 1200; mid.Q.value = .8; mid.gain.value = p.mid;
      const high = context.createBiquadFilter();
      high.type = "highshelf"; high.frequency.value = 5000; high.gain.value = p.high;
      current.connect(low).connect(mid).connect(high);
      current = high;
    } else if (effect.kind === "compressor") {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = p.threshold;
      compressor.ratio.value = p.ratio;
      compressor.attack.value = p.attack;
      compressor.release.value = p.release;
      current.connect(compressor);
      current = compressor;
    } else if (effect.kind === "delay") {
      const output = context.createGain();
      const dry = context.createGain(); dry.gain.value = 1 - p.mix;
      const wet = context.createGain(); wet.gain.value = p.mix;
      const delay = context.createDelay(4); delay.delayTime.value = Math.min(4, p.time);
      const feedback = context.createGain(); feedback.gain.value = Math.min(.92, p.feedback);
      current.connect(dry).connect(output);
      current.connect(delay).connect(wet).connect(output);
      delay.connect(feedback).connect(delay);
      current = output;
    } else if (effect.kind === "reverb") {
      const output = context.createGain();
      const dry = context.createGain(); dry.gain.value = 1 - p.mix;
      const wet = context.createGain(); wet.gain.value = p.mix;
      const convolver = context.createConvolver();
      convolver.buffer = convolverImpulse(context, p.duration, p.decay);
      current.connect(dry).connect(output);
      current.connect(convolver).connect(wet).connect(output);
      current = output;
    }
  }
  return current;
}

function connectTrack(context: BaseAudioContext, source: AudioBufferSourceNode, track: AudioTrack, destination: AudioNode, contextStart: number, timelineStart: number) {
  const volume = Math.max(0, Math.min(2, track.volume));
  const volumeGain = context.createGain();
  volumeGain.gain.setValueAtTime(volume, contextStart);
  const fadeInGain = context.createGain();
  const fadeOutGain = context.createGain();
  const schedule = (gain: GainNode, envelope: typeof fadeInEnvelope, start: number, end: number) => {
    gain.gain.setValueAtTime(envelope(track, timelineStart), contextStart);
    for (const point of [start, end]) {
      if (point > timelineStart) gain.gain.linearRampToValueAtTime(envelope(track, point), contextStart + point - timelineStart);
    }
  };
  schedule(fadeInGain, fadeInEnvelope, track.fadeInStart, track.fadeInEnd);
  schedule(fadeOutGain, fadeOutEnvelope, track.fadeOutStart, track.fadeOutEnd);
  applyAudioEffects(context, source, track)
    .connect(volumeGain)
    .connect(fadeInGain)
    .connect(fadeOutGain)
    .connect(destination);
}

export class AudioTimelineEngine {
  private context: AudioContext | null = null;
  private active: AudioBufferSourceNode[] = [];
  private generation = 0;

  stop() {
    this.generation++;
    for (const source of this.active) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.active = [];
  }

  async play(project: ProjectDocument, timelineTime: number) {
    this.stop();
    this.context ||= new AudioContext();
    await this.context.resume();
    const generation = this.generation;
    for (const track of project.audioTracks || []) {
      if (track.muted || timelineTime >= track.endTime) continue;
      try {
        const original = await fetchAudioBuffer(track.asset, this.context);
        if (generation !== this.generation) return;
        const { source, offset: baseOffset } = configureSource(this.context, track, original);
        const rate = Math.max(.05, Math.abs(track.playbackRate || 1));
        const local = Math.max(0, timelineTime - track.startTime);
        const span = Math.max(.001, (track.sourceOut || original.duration) - track.sourceIn);
        let consumed = local * rate;
        if (track.loop) consumed %= span;
        const offset = baseOffset + consumed;
        const delay = Math.max(0, track.startTime - timelineTime);
        const remaining = Math.max(0, track.endTime - Math.max(timelineTime, track.startTime));
        if (!remaining) continue;
        const timelineStart = Math.max(timelineTime, track.startTime);
        connectTrack(this.context, source, track, this.context.destination, this.context.currentTime + delay, timelineStart);
        source.start(this.context.currentTime + delay, Math.min(original.duration - .001, offset));
        source.stop(this.context.currentTime + delay + remaining);
        this.active.push(source);
      } catch {
        // The visual part of a video may be supported even when its audio codec is not.
      }
    }
  }
}

export async function mixProjectAudio(project: ProjectDocument, sampleRate = 48_000) {
  const tracks = (project.audioTracks || []).filter((track) => !track.muted && track.endTime > track.startTime);
  if (!tracks.length) return null;
  const context = new OfflineAudioContext(2, Math.ceil(project.settings.duration * sampleRate), sampleRate);
  let scheduled = 0;
  for (const track of tracks) {
    try {
      const original = await fetchAudioBuffer(track.asset, context);
      const { source, offset } = configureSource(context, track, original);
      const duration = Math.min(project.settings.duration, track.endTime) - Math.max(0, track.startTime);
      if (duration <= 0) continue;
      connectTrack(context, source, track, context.destination, Math.max(0, track.startTime), Math.max(0, track.startTime));
      source.start(Math.max(0, track.startTime), Math.min(original.duration - .001, offset));
      source.stop(Math.max(0, track.startTime) + duration);
      scheduled++;
    } catch {
      // Ignore unsupported audio codecs and keep the visual export available.
    }
  }
  return scheduled ? context.startRendering() : null;
}

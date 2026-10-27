// Do texto do Whisper às legendas: quebra em linhas e em cues, tempos em frames e SRT.
// Funções puras (sem DOM), testadas em tests/unit/transcribe-cues.test.ts.
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface TimedSegment {
  start: number;
  /** O Whisper às vezes devolve o fim do último trecho vazio; tratamos como desconhecido. */
  end: number | null;
  text: string;
  words?: TimedWord[];
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface CueOptions {
  fps: number;
  maxChars?: number;
  maxLines?: number;
  /** Duração máxima de uma legenda, em segundos. */
  maxDuration?: number;
  /** Duração mínima, desde que não invada a legenda seguinte. */
  minDuration?: number;
  /** Legendas depois deste tempo são cortadas (fim do áudio ou da composição). */
  duration?: number;
}

export const DEFAULT_MAX_CHARS = 42;
export const DEFAULT_MAX_LINES = 2;
export const DEFAULT_MAX_DURATION = 6;
const DEFAULT_MIN_DURATION = .8;
/** Pausa entre palavras que sempre separa duas legendas (s). */
const PAUSE_BREAK = 1;
/** Uma frase só encerra a legenda se ela já tem este tamanho (evita legendas de uma palavra). */
const SENTENCE_BREAK_CHARS = 20;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/** Tempo alinhado ao quadro mais próximo. */
export function snapToFrame(seconds: number, fps: number) {
  return Math.round(seconds * fps + 1e-9) / fps;
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Divide as palavras em no máximo maxLines linhas de até maxChars; null se não couber.
 * Com duas linhas escolhe o corte que deixa as linhas mais parecidas.
 */
export function wrapLines(words: readonly string[], maxChars = DEFAULT_MAX_CHARS, maxLines = DEFAULT_MAX_LINES): string[] | null {
  if (!words.length) return [];
  const whole = words.join(" ");
  if (whole.length <= maxChars) return [whole];
  if (maxLines < 2) return null;
  if (maxLines === 2) {
    let best: string[] | null = null;
    let bestWidth = Infinity;
    for (let cut = 1; cut < words.length; cut++) {
      const first = words.slice(0, cut).join(" ");
      const second = words.slice(cut).join(" ");
      const width = Math.max(first.length, second.length);
      if (width <= maxChars && width < bestWidth) {
        best = [first, second];
        bestWidth = width;
      }
    }
    return best;
  }
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) line = next;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  return lines.length <= maxLines && lines.every((item) => item.length <= maxChars) ? lines : null;
}

/** Palavras por frase: quebra em pontuação final, em pausas longas ou quando o trecho passa de maxDuration. */
export function groupWords(words: readonly TimedWord[], maxDuration = 10): TimedSegment[] {
  const segments: TimedSegment[] = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (!current.length) return;
    segments.push({ start: current[0].start, end: current[current.length - 1].end, text: clean(current.map((word) => word.text).join(" ")), words: current });
    current = [];
  };
  for (const word of words) {
    if (!clean(word.text)) continue;
    const last = current[current.length - 1];
    if (last && (word.start - last.end > PAUSE_BREAK || word.end - current[0].start > maxDuration)) flush();
    current.push(word);
    if (SENTENCE_END.test(clean(word.text))) flush();
  }
  flush();
  return segments;
}

/** Palavras com tempo: as do modelo, ou o texto repartido pelo tamanho de cada palavra. */
function segmentWords(segment: TimedSegment): TimedWord[] {
  if (segment.words?.length) {
    return segment.words.map((word) => ({ text: clean(word.text), start: word.start, end: word.end })).filter((word) => word.text);
  }
  const texts = clean(segment.text).split(" ").filter(Boolean);
  if (!texts.length) return [];
  const end = segment.end !== null && segment.end > segment.start ? segment.end : segment.start + Math.max(1, texts.length * .4);
  const total = texts.reduce((sum, text) => sum + text.length + 1, 0);
  let used = 0;
  return texts.map((text) => {
    const start = segment.start + (end - segment.start) * used / total;
    used += text.length + 1;
    return { text, start, end: segment.start + (end - segment.start) * used / total };
  });
}

/** Legendas de 1 a 2 linhas, até maxChars por linha e maxDuration por legenda, com tempos em quadros. */
export function buildCues(segments: readonly TimedSegment[], options: CueOptions): Cue[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxDuration = options.maxDuration ?? DEFAULT_MAX_DURATION;
  const minDuration = options.minDuration ?? DEFAULT_MIN_DURATION;
  const fps = options.fps > 0 ? options.fps : 30;
  const raw: Cue[] = [];
  let group: TimedWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const lines = wrapLines(group.map((word) => word.text), maxChars, maxLines) ?? [group.map((word) => word.text).join(" ")];
    raw.push({ start: group[0].start, end: group[group.length - 1].end, text: lines.join("\n") });
    group = [];
  };
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    // Cada trecho do modelo começa uma legenda nova: o Whisper já separou ali.
    flush();
    for (const word of segmentWords(segment)) {
      const last = group[group.length - 1];
      const pause = last && word.start - last.end > PAUSE_BREAK;
      if (last && (pause || word.end - group[0].start > maxDuration
        || !wrapLines([...group.map((item) => item.text), word.text], maxChars, maxLines))) {
        // Cue cheia no meio da frase: se há vírgula na segunda metade, a legenda termina ali e o resto abre a próxima.
        const comma = pause ? -1 : group.map((item) => /[,;:]$/.test(item.text)).lastIndexOf(true);
        const carry = comma >= 0 && comma + 1 < group.length && comma + 1 >= group.length * .4 ? group.splice(comma + 1) : [];
        flush();
        group = carry;
      }
      group.push(word);
      const chars = group.map((item) => item.text).join(" ").length;
      if (SENTENCE_END.test(word.text) && (chars >= SENTENCE_BREAK_CHARS || word.end - group[0].start >= 2)) flush();
    }
  }
  flush();

  const cues = raw.filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end)).sort((a, b) => a.start - b.start);
  cues.forEach((cue, index) => {
    const next = cues[index + 1];
    const limit = next ? next.start : Infinity;
    cue.end = Math.max(cue.end, Math.min(cue.start + minDuration, limit));
    cue.start = snapToFrame(Math.max(0, cue.start), fps);
    cue.end = Math.max(snapToFrame(cue.end, fps), cue.start + 1 / fps);
  });
  for (let index = 0; index < cues.length - 1; index++) {
    if (cues[index].end > cues[index + 1].start) cues[index].end = cues[index + 1].start;
  }
  const last = options.duration;
  return cues
    .filter((cue) => cue.end > cue.start + 1e-9 && (last === undefined || cue.start < last - 1e-9))
    .map((cue) => ({ ...cue, end: last === undefined ? cue.end : Math.min(cue.end, snapToFrame(last, fps)) }))
    .filter((cue) => cue.end > cue.start + 1e-9);
}

/** 00:00:01,500 */
export function formatSrtTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)},${pad(total % 1000, 3)}`;
}

export function cuesToSrt(cues: readonly Cue[]) {
  return cues.map((cue, index) => `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`).join("\n\n") + (cues.length ? "\n" : "");
}

/** Desloca os trechos (por exemplo, para o início do clipe na timeline) e muda a escala de tempo (velocidade do clipe). */
export function offsetSegments(segments: readonly TimedSegment[], offset: number, scale = 1): TimedSegment[] {
  const move = (time: number) => offset + time * scale;
  return segments.map((segment) => ({
    ...segment,
    start: move(segment.start),
    end: segment.end === null ? null : move(segment.end),
    words: segment.words?.map((word) => ({ ...word, start: move(word.start), end: move(word.end) })),
  }));
}

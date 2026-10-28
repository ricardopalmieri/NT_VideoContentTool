import { describe, expect, it } from "vitest";
import {
  BLOCK_OVERLAP_SECONDS, BLOCK_SECONDS, STALL_MS, blockOverlap, defaultWordTimestamps, doneAudioSeconds, estimateRemainingSeconds, estimateTranscribeSeconds,
  etaMinutes, findSpeechRanges, formatClock, mergeBlockSegments, parseClock, planBlocks, planSeconds, silenceThresholdDb, speechRanges,
} from "../../src/transcribe/blocks";
import { offsetSegments, type TimedSegment } from "../../src/transcribe/cues";
import { TranscribeError, classifyError, isMemoryError, isWordTimestampError } from "../../src/transcribe/errors";
import { createTranscribeStore, transcribeStatusText } from "../../src/transcribe/transcribe-state";

const RATE = 16_000;
const seconds = (value: number) => Math.round(value * RATE);

describe("plano de blocos", () => {
  it("fatia 30 min em blocos de 5 min com 5 s de sobreposição", () => {
    const blocks = planBlocks(seconds(1800));
    expect(blocks[0]).toEqual({ index: 0, start: 0, end: seconds(BLOCK_SECONDS) });
    // Cada bloco recomeça 5 s antes do fim do anterior.
    for (let index = 1; index < blocks.length; index++) {
      expect(blocks[index].start).toBe(blocks[index - 1].end - seconds(BLOCK_OVERLAP_SECONDS));
      expect(blocks[index].index).toBe(index);
    }
    expect(blocks.at(-1)!.end).toBe(seconds(1800));
    expect(blocks.length).toBe(6);
    // Nenhum bloco passa de 5 min + o resto absorvido (< 30 s).
    for (const block of blocks) expect(block.end - block.start).toBeLessThanOrEqual(seconds(BLOCK_SECONDS + 30));
  });

  it("um áudio curto é um bloco só; o resto curto não vira bloco", () => {
    expect(planBlocks(seconds(90))).toEqual([{ index: 0, start: 0, end: seconds(90) }]);
    // 310 s: o resto de 10 s é absorvido pelo primeiro bloco.
    expect(planBlocks(seconds(310))).toEqual([{ index: 0, start: 0, end: seconds(310) }]);
    expect(planBlocks(seconds(340)).length).toBe(2);
    expect(planBlocks(0)).toEqual([]);
  });

  it("a memória do bloco não cresce com a duração", () => {
    for (const hours of [1, 3, 10]) {
      const blocks = planBlocks(seconds(hours * 3600));
      const largest = Math.max(...blocks.map((block) => block.end - block.start));
      expect(largest).toBeLessThanOrEqual(seconds(BLOCK_SECONDS + 30));
    }
  });

  it("só planeja os trechos com fala, sem juntar o que o silêncio separa", () => {
    const blocks = planBlocks(seconds(1000), { ranges: [{ start: 10, end: 40 }, { start: 600, end: 650 }] });
    expect(blocks).toEqual([
      { index: 0, start: seconds(10), end: seconds(40) },
      { index: 1, start: seconds(600), end: seconds(650) },
    ]);
    expect(planSeconds(blocks)).toBe(80);
    expect(planBlocks(seconds(100), { ranges: [] })).toEqual([]);
    // Trecho maior que um bloco é fatiado com sobreposição.
    const long = planBlocks(seconds(2000), { ranges: [{ start: 100, end: 1000 }], blockSeconds: 300, overlapSeconds: 5 });
    expect(long[0].start).toBe(seconds(100));
    expect(long.at(-1)!.end).toBe(seconds(1000));
    expect(long.length).toBe(3);
  });

  it("aceita blocos e sobreposição de teste", () => {
    const blocks = planBlocks(seconds(7), { blockSeconds: 3, overlapSeconds: .5, minTailSeconds: 0 });
    expect(blocks.map((block) => [block.start / RATE, block.end / RATE])).toEqual([[0, 3], [2.5, 5.5], [5, 7]]);
    expect(blockOverlap(blocks[0], blocks[1])).toEqual({ start: 2.5, end: 3 });
    expect(blockOverlap(undefined, blocks[0])).toBeNull();
    expect(blockOverlap({ index: 0, start: 0, end: 100 }, { index: 1, start: 200, end: 300 })).toBeNull();
  });
});

const phrase = (start: number, end: number, text: string): TimedSegment => ({ start, end, text });
const withWords = (start: number, texts: string[]): TimedSegment => {
  const words = texts.map((text, index) => ({ text, start: start + index * .5, end: start + index * .5 + .4 }));
  return { start: words[0].start, end: words.at(-1)!.end, text: texts.join(" "), words };
};

describe("tempos e junção dos blocos", () => {
  it("desloca os tempos do bloco para o tempo do áudio inteiro", () => {
    const [segment] = offsetSegments([withWords(1, ["olá", "mundo"])], 300);
    expect(segment.start).toBe(301);
    expect(segment.words![1].start).toBe(301.5);
  });

  it("na sobreposição vale o meio dela, sem repetir", () => {
    // Bloco 1 vai até 305 s; o bloco 2 começa em 300 s. O corte fica em 302,5 s.
    const first = [phrase(10, 12, "primeira"), phrase(299, 301, "quase no fim"), phrase(303, 304.5, "borda do bloco um")];
    const second = [phrase(300.2, 301.5, "quase no fim"), phrase(303, 305, "borda do bloco um"), phrase(306, 308, "depois")];
    const merged = mergeBlockSegments(first, second, { start: 300, end: 305 });
    expect(merged.map((segment) => segment.text)).toEqual(["primeira", "quase no fim", "borda do bloco um", "depois"]);
  });

  it("sem sobreposição só acrescenta; bloco vazio não apaga o anterior", () => {
    const first = [phrase(0, 2, "a")];
    expect(mergeBlockSegments(first, [phrase(500, 502, "b")], null).map((segment) => segment.text)).toEqual(["a", "b"]);
    const tail = [phrase(0, 2, "a"), phrase(303, 304, "no fim")];
    expect(mergeBlockSegments(tail, [], { start: 300, end: 305 })).toEqual(tail);
  });

  it("corta palavra por palavra quando há tempos por palavra", () => {
    const first = [withWords(298, ["um", "dois", "três", "quatro", "cinco", "seis"])];
    // palavras começam em 298, 298.5, 299, 299.5, 300, 300.5
    const second = [withWords(299.5, ["quatro", "cinco", "seis", "sete", "oito"])];
    const merged = mergeBlockSegments(first, second, { start: 299.5, end: 301 });
    // Corte em 300,25: o primeiro fica com o que começa antes (até "cinco"), o segundo com o que começa depois.
    const text = merged.map((segment) => segment.text).join(" | ");
    expect(text).toBe("um dois três quatro cinco | seis sete oito");
    expect(merged[0].words!.length).toBe(5);
    expect(merged[1].start).toBeGreaterThanOrEqual(300.25);
  });

  it("repetição exata na emenda conta uma vez", () => {
    const merged = mergeBlockSegments([phrase(10, 12, "Olá, tudo bem?")], [phrase(10.4, 12.2, "olá tudo bem")], null);
    expect(merged).toHaveLength(1);
  });
});

describe("estimativa de tempo", () => {
  it("usa a velocidade medida", () => {
    // 60 s de áudio em 30 s de relógio: sobram 240 s de áudio, 120 s de relógio.
    expect(estimateRemainingSeconds({ doneSeconds: 60, totalSeconds: 300, elapsedSeconds: 30 })).toBeCloseTo(120);
    expect(estimateRemainingSeconds({ doneSeconds: 300, totalSeconds: 300, elapsedSeconds: 30 })).toBe(0);
  });

  it("não chuta sem base", () => {
    expect(estimateRemainingSeconds({ doneSeconds: 0, totalSeconds: 300, elapsedSeconds: 30 })).toBeNull();
    expect(estimateRemainingSeconds({ doneSeconds: 60, totalSeconds: 300, elapsedSeconds: 0 })).toBeNull();
  });

  it("conta o áudio feito: blocos prontos mais a fração do atual", () => {
    const blocks = planBlocks(seconds(7), { blockSeconds: 3, overlapSeconds: .5, minTailSeconds: 0 });
    expect(doneAudioSeconds(blocks, 0)).toBe(0);
    expect(doneAudioSeconds(blocks, 1)).toBe(3);
    expect(doneAudioSeconds(blocks, 1, .5)).toBe(4.5);
    expect(doneAudioSeconds(blocks, 3)).toBe(planSeconds(blocks));
    expect(doneAudioSeconds(blocks, 9, 1)).toBe(planSeconds(blocks));
  });

  it("minutos para mostrar e estimativa prévia por máquina", () => {
    expect(etaMinutes(1)).toBe(1);
    expect(etaMinutes(61)).toBe(2);
    expect(estimateTranscribeSeconds(1800, "base", false)).toBeGreaterThan(estimateTranscribeSeconds(1800, "base", true));
    expect(estimateTranscribeSeconds(1800, "small", false)).toBeGreaterThan(estimateTranscribeSeconds(1800, "base", false));
    // Com threads (página isolada) o WASM é mais rápido que com uma só, mas a WebGPU continua à frente.
    for (const model of ["base", "small"] as const) {
      expect(estimateTranscribeSeconds(1800, model, false, true)).toBeLessThan(estimateTranscribeSeconds(1800, model, false, false));
      expect(estimateTranscribeSeconds(1800, model, true, true)).toBeLessThan(estimateTranscribeSeconds(1800, model, false, true));
    }
    // 30 min de áudio com o modelo Preciso na WebGPU: bem menos que a duração, na ordem de alguns minutos.
    expect(estimateTranscribeSeconds(1800, "small", true) / 60).toBeGreaterThan(2);
    expect(estimateTranscribeSeconds(1800, "small", true) / 60).toBeLessThan(10);
  });

  it("o watchdog espera 60 s de silêncio do motor (heartbeat), não os 90 s sem progresso de antes", () => {
    expect(STALL_MS).toBe(60_000);
  });

  it("tempo por palavra só até 5 min por padrão", () => {
    expect(defaultWordTimestamps(120)).toBe(true);
    expect(defaultWordTimestamps(300)).toBe(true);
    expect(defaultWordTimestamps(301)).toBe(false);
  });

  it("lê e escreve relógios", () => {
    expect(parseClock("90")).toBe(90);
    expect(parseClock("1:30")).toBe(90);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("1,5")).toBe(1.5);
    expect(parseClock("")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("1:2:3:4")).toBeNull();
    expect(formatClock(90)).toBe("1:30");
    expect(formatClock(3723)).toBe("1:02:03");
  });
});

/** Tom de fala (falso) e silêncio, em 16 kHz mono. */
function signal(parts: Array<[number, number]>) {
  const total = parts.reduce((sum, [length]) => sum + length, 0);
  const audio = new Float32Array(seconds(total));
  let cursor = 0;
  for (const [length, amplitude] of parts) {
    for (let index = 0; index < seconds(length); index++) audio[cursor + index] = Math.sin(2 * Math.PI * 220 * index / RATE) * amplitude;
    cursor += seconds(length);
  }
  return audio;
}

describe("silêncio", () => {
  it("pula o silêncio longo e as pontas, mantendo uma margem", () => {
    // 20 s de silêncio, 10 s de fala, 40 s de silêncio, 10 s de fala, 20 s de silêncio.
    const audio = signal([[20, 0], [10, .3], [40, 0], [10, .3], [20, 0]]);
    const ranges = findSpeechRanges(audio);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toBeCloseTo(19, 0);
    expect(ranges[0].end).toBeCloseTo(31, 0);
    expect(ranges[1].start).toBeCloseTo(69, 0);
    expect(ranges[1].end).toBeCloseTo(81, 0);
    const blocks = planBlocks(audio.length, { ranges });
    expect(blocks).toHaveLength(2);
    expect(planSeconds(blocks)).toBeLessThan(30);
  });

  it("mantém pausas curtas dentro da fala", () => {
    const audio = signal([[5, .3], [4, 0], [5, .3]]);
    const ranges = findSpeechRanges(audio);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(0);
    expect(ranges[0].end).toBeCloseTo(14, 0);
  });

  it("áudio mudo não tem trechos", () => {
    expect(findSpeechRanges(signal([[60, 0]]))).toEqual([]);
  });

  it("o limiar acompanha a gravação", () => {
    const quiet = Array.from({ length: 20 }, (_, index) => ({ time: index * .5, rms: .003, peak: .01 }));
    const loud = Array.from({ length: 20 }, (_, index) => ({ time: index * .5, rms: .2, peak: .6 }));
    expect(silenceThresholdDb(quiet)).toBe(-60);
    expect(silenceThresholdDb(loud)).toBeCloseTo(-49, 0);
    expect(silenceThresholdDb(loud.map((point) => ({ ...point, rms: .8 })))).toBe(-45);
    expect(speechRanges([], .5, 10)).toEqual([]);
  });
});

describe("erros do motor", () => {
  it("só o erro de tempos por palavra autoriza tempos por frase", () => {
    expect(isWordTimestampError(new Error("Model outputs must contain cross attentions to extract timestamps."))).toBe(true);
    expect(isWordTimestampError(new Error("Aborted(). Build with -sASSERTIONS for more info."))).toBe(false);
    expect(isWordTimestampError(new Error("out of memory"))).toBe(false);
  });

  it("reconhece falta de memória, inclusive o número cru do runtime", () => {
    expect(isMemoryError(new Error("Failed to allocate a buffer of size 1073741824"))).toBe(true);
    expect(isMemoryError(new Error("RuntimeError: memory access out of bounds"))).toBe(true);
    expect(isMemoryError(1234567)).toBe(true);
    expect(isMemoryError(new Error("não achei o modelo"))).toBe(false);
    expect(classifyError(98765).kind).toBe("memory");
    expect(classifyError(new Error("falhou")).kind).toBe("other");
    const known = new TranscribeError("worker", "x");
    expect(classifyError(known)).toBe(known);
  });
});

describe("status dos blocos", () => {
  it("mostra bloco N de M, tempo restante e legendas parciais; nunca passa do total", () => {
    const store = createTranscribeStore();
    store.reset({ phase: "transcribing", startedAt: 1_000, chunksTotal: 7 });
    store.set({ chunksDone: 2, etaSeconds: 600, cues: 14 });
    const text = transcribeStatusText(store.get(), 41_000);
    expect(text).toContain("bloco 3 de 7");
    expect(text).toContain("~10 min restantes");
    expect(text).toContain("14 legendas até agora");
    expect(text).not.toMatch(/[?&=]/);
    store.set({ chunksDone: 12 });
    expect(store.get().chunksDone).toBe(7);
    expect(transcribeStatusText(store.get(), 41_000)).toContain("bloco 7 de 7");
  });

  it("travado diz de onde retomar", () => {
    const store = createTranscribeStore();
    store.reset({ phase: "stalled", chunksTotal: 7, resumeBlock: 4, cues: 9 });
    const text = transcribeStatusText(store.get());
    expect(text).toContain("bloco 4 de 7");
    expect(text).toContain("Retomar do bloco 4");
    expect(text).not.toMatch(/[?&=]/);
  });
});

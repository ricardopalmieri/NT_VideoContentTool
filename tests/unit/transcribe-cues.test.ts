import { describe, expect, it } from "vitest";
import { buildCues, cuesToSrt, formatSrtTime, groupWords, offsetSegments, snapToFrame, wrapLines, type TimedWord } from "../../src/transcribe/cues";
import { expandSrt } from "../../src/model/macros";
import { createProject } from "../../src/model/types";

const words = (text: string, start: number, step = .3): TimedWord[] =>
  text.split(" ").map((word, index) => ({ text: ` ${word}`, start: start + index * step, end: start + (index + 1) * step }));

describe("quebra em linhas", () => {
  it("cabe numa linha até 42 caracteres", () => {
    expect(wrapLines(["Olá", "tudo", "bem", "com", "você"])).toEqual(["Olá tudo bem com você"]);
  });

  it("divide em duas linhas equilibradas", () => {
    const text = "Esta é uma frase um pouco mais longa que não cabe numa linha só".split(" ");
    const lines = wrapLines(text)!;
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 42)).toBe(true);
    expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThan(14);
    expect(lines.join(" ")).toBe(text.join(" "));
  });

  it("devolve null quando passa de duas linhas", () => {
    expect(wrapLines(Array(30).fill("palavra"))).toBeNull();
    expect(wrapLines(["a".repeat(50)])).toBeNull();
  });
});

describe("legendas a partir de palavras", () => {
  it("respeita 42 caracteres por linha, 2 linhas e 6 s por legenda", () => {
    const long = "um dois tres quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis dezessete dezoito dezenove vinte vinte-e-um vinte-e-dois vinte-e-tres";
    const cues = buildCues([{ start: 0, end: 20, text: long, words: words(long, 0, .6) }], { fps: 30 });
    expect(cues.length).toBeGreaterThan(2);
    for (const cue of cues) {
      const lines = cue.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(lines.every((line) => line.length <= 42)).toBe(true);
      expect(cue.end - cue.start).toBeLessThanOrEqual(6 + 1e-6);
    }
    expect(cues.map((cue) => cue.text.replace(/\n/g, " ")).join(" ")).toBe(long);
  });

  it("encaixa os tempos em quadros e não deixa legendas se sobreporem", () => {
    const cues = buildCues([
      { start: .013, end: 1.52, text: "Primeira frase longa o bastante." },
      { start: 1.5, end: 3.11, text: "Segunda frase também longa." },
    ], { fps: 24 });
    expect(cues).toHaveLength(2);
    for (const cue of cues) {
      expect(snapToFrame(cue.start, 24)).toBeCloseTo(cue.start, 9);
      expect(snapToFrame(cue.end, 24)).toBeCloseTo(cue.end, 9);
    }
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start + 1e-9);
    expect(cues[1].end).toBeGreaterThan(cues[1].start);
  });

  it("quebra em ponto final quando a legenda já tem tamanho e em pausas longas", () => {
    const first = words("Hoje o dia começou muito bem.", 0);
    const second = words("Amanhã vai ser ainda melhor", 2);
    const cues = buildCues([{ start: 0, end: 4, text: "", words: [...first, ...second] }], { fps: 30 });
    expect(cues.map((cue) => cue.text)).toEqual(["Hoje o dia começou muito bem.", "Amanhã vai ser ainda melhor"]);
    const paused = buildCues([{ start: 0, end: 5, text: "", words: [...words("Olá você", 0), ...words("de novo", 3.5)] }], { fps: 30 });
    expect(paused).toHaveLength(2);
  });

  it("divide o texto de um trecho sem tempos por palavra proporcionalmente", () => {
    const cues = buildCues([{ start: 10, end: 20, text: "uma frase curta. outra frase um pouco maior que a primeira, para dividir" }], { fps: 30 });
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0].start).toBeCloseTo(10, 1);
    expect(cues[cues.length - 1].end).toBeLessThanOrEqual(20 + 1 / 30);
  });

  it("aceita fim desconhecido, ignora trechos vazios e corta no fim da composição", () => {
    const cues = buildCues([
      { start: 0, end: null, text: "sem fim definido" },
      { start: 2, end: 3, text: "   " },
      { start: 9.5, end: 14, text: "passa do fim da composição" },
      { start: 12, end: 13, text: "fora" },
    ], { fps: 10, duration: 10 });
    expect(cues.map((cue) => cue.text)).toEqual(["sem fim definido", "passa do fim da composição"]);
    expect(Math.max(...cues.map((cue) => cue.end))).toBeLessThanOrEqual(10);
  });

  it("dá duração mínima sem invadir a legenda seguinte", () => {
    const cues = buildCues([
      { start: 0, end: 0.1, text: "oi" },
      { start: 0.3, end: 1.5, text: "tudo bem" },
    ], { fps: 30 });
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start + 1e-9);
    expect(cues[1].end - cues[1].start).toBeGreaterThanOrEqual(.8 - 1e-6);
  });
});

describe("agrupar palavras em frases", () => {
  it("quebra em pontuação final e em pausa", () => {
    const grouped = groupWords([...words("Olá mundo.", 0), ...words("Outra frase", 1), ...words("depois da pausa", 5)]);
    expect(grouped.map((segment) => segment.text)).toEqual(["Olá mundo.", "Outra frase", "depois da pausa"]);
    expect(grouped[0].words).toHaveLength(2);
  });
});

describe("SRT", () => {
  it("formata tempos e blocos", () => {
    expect(formatSrtTime(3723.456)).toBe("01:02:03,456");
    expect(formatSrtTime(-1)).toBe("00:00:00,000");
    expect(cuesToSrt([{ start: 1, end: 2.5, text: "Olá\nmundo" }, { start: 3, end: 4, text: "Fim" }]))
      .toBe("1\n00:00:01,000 --> 00:00:02,500\nOlá\nmundo\n\n2\n00:00:03,000 --> 00:00:04,000\nFim\n");
    expect(cuesToSrt([])).toBe("");
  });

  it("o SRT gerado entra pela macro text.fromSrt sem perder nenhuma legenda", () => {
    const project = createProject({ name: "T", width: 1080, height: 1920, fps: 30, duration: 20, background: "#000", transparent: false });
    const cues = buildCues([{ start: 0.5, end: 8, text: "Esta é a primeira frase da legenda automática. E esta é a segunda frase, um pouco mais comprida que a outra." }], { fps: 30, duration: 20 });
    const commands = expandSrt(project, { srt: cuesToSrt(cues) });
    expect(commands.filter((command) => command.type === "layer.create")).toHaveLength(cues.length);
  });
});

describe("deslocar para a timeline", () => {
  it("soma o início do clipe e aplica a velocidade", () => {
    const [segment] = offsetSegments([{ start: 1, end: 3, text: "a b", words: words("a b", 1, 1) }], 10, .5);
    expect(segment.start).toBe(10.5);
    expect(segment.end).toBe(11.5);
    expect(segment.words![1].end).toBe(11.5);
    expect(offsetSegments([{ start: 0, end: null, text: "x" }], 5)[0].end).toBeNull();
  });
});

describe("legendas cheias no meio da frase", () => {
  it("terminam na vírgula quando ela está na segunda metade", () => {
    const text = "A legenda automática transcreve a fala diretamente no navegador, sem enviar o áudio para a internet.";
    const cues = buildCues([{ start: 0, end: 11, text: "", words: words(text, 0, .35) }], { fps: 30 });
    expect(cues.map((cue) => cue.text.replace("\n", " "))).toEqual([
      "A legenda automática transcreve a fala diretamente no navegador,",
      "sem enviar o áudio para a internet.",
    ]);
  });
});

// window.vct.describe(): a one-page index first, detail on demand. Every text here
// avoids ? & and = (Claude in Chrome blocks them); window.vct filters the rest.
import { COMMANDS, describeCommand, describeCommandsText, isCommandType, type CommandSpec } from "../model/command-registry";
import { describeField, type FieldSpec } from "../model/command-schema";
import { MAX_COMMANDS_PER_BATCH } from "../model/commands";
import {
  AUDIO_PROPERTIES, COMPOSITION_PROPERTIES, LAYER_KIND_PROPERTIES, LAYER_PROPERTIES, propertyKindOf, type LayerProperty,
} from "../model/property-tables";

export type DescribeFormat = "text" | "json";
export type DescribeJson = Record<string, unknown>;

// Rules that are not obvious from field names.
const SEMANTICS = [
  "Tempos em segundos da composição, alinhados a frames (frame dividido por fps).",
  "Fluxo curto: assets() e summary() para ler; clip.place para montar; dryRun ou plan com dryRun; batch ou plan; lint(); captureFrame para conferir.",
  "Keyframe: time em s da composição; com timeBase clip conta do início do clipe. O easing de um keyframe vale do key até o próximo; hold segura o valor e salta no próximo key.",
  "Tempos musicais: com grid definido (composition.set grid bpm), startTime endTime time duration e at aceitam bar:3.2, beat:14, bars:2 e beats:4.",
  "Efeitos de pós (rgbDelay noise glitch vhs cameraShake glow) usam ownerId __post__; os demais vão numa camada.",
  "Faixa visual: id da faixa é trackId do clipe ou o id do primeiro clipe. Índice 0 é o topo (desenhado por cima).",
  "Remoções pedem confirmação ao usuário no commit. dryRun não pede.",
  "Ids novos: curtos e legíveis. Ids derivados de corte e duplicação: novoId:audio:N e novoId:fx:N.",
  "Retorno de batch, plan, dryRun e dispatch: texto curto, ok seguido de contagem, desfazer e avisos, ou erro no comando N com a causa. Com { format: 'json' }: { ok, errors, warnings, results }.",
  "Mídia entra no tamanho original em pixels, centralizada (clip.place sem fit). layer.fit com contain ou cover enquadra; layer.set muda width e height.",
];

const LIMITS = [
  "Legenda automática: vct.transcribe começa na hora (Whisper local; o áudio não sai da máquina). Sem o modelo no navegador a pessoa vê o aviso de download. Mídia longa vai em blocos de ~5 min (start e end limitam o trecho; vct.cancelTranscribe cancela). Confira status (bloco N de M, tempo restante), leia o SRT com vct.transcript (já parcial) e aplique com text.fromSrt.",
  "Limites: projeto aberto pela pessoa. Salvar, exportar, importar e abrir só com vct.request (a pessoa confirma na tela); depois confira vct.status().",
  "Se a pessoa pausar o agente, batch plan dispatch undo redo e request falham até ela clicar em Retomar; leituras seguem.",
];

const FILTER_NOTE = "Texto devolvido pela API troca os caracteres de pergunta, e comercial e igual pelas versões largas.";

/** Ids that every entity command needs; the index leaves them out to stay short. */
const ENTITY_IDS = new Set(["layerId", "trackId", "effectId", "laneId"]);

const required = (spec: CommandSpec) => Object.entries(spec.fields).filter(([, field]) => (field as FieldSpec).required).map(([name]) => name);

function groups() {
  const result = new Map<string, Array<[string, CommandSpec]>>();
  for (const [type, spec] of Object.entries(COMMANDS) as Array<[string, CommandSpec]>) {
    result.set(spec.group, [...(result.get(spec.group) ?? []), [type, spec]]);
  }
  return result;
}

/** Page one: command names by group with the required fields (type!a,b), and where to ask for more. */
export function indexText() {
  const lines = [
    `VCT API 1 · lote 1 a ${MAX_COMMANDS_PER_BATCH}, tudo ou nada, 1 desfazer. nome!campo: obrigatórios (ids layerId trackId effectId laneId omitidos).`,
    "Mais: describe('tipo') · describe('props texto|forma|imagem|video|guia|audio|composicao') · describe('regras') · describe('tudo')",
  ];
  for (const [group, entries] of groups()) {
    let previous = "";
    const names = entries.map(([type, spec]) => {
      const cut = type.lastIndexOf(".");
      const prefix = type.slice(0, cut);
      const name = prefix === previous ? type.slice(cut) : type;
      previous = prefix;
      const fields = required(spec).filter((field) => !ENTITY_IDS.has(field));
      return `${name}${fields.length ? `!${fields.join(",")}` : ""}`;
    });
    lines.push(`${group}: ${names.join(" ")}`);
  }
  return lines.join("\n");
}

export function indexJson(): DescribeJson {
  return {
    version: "1", maxCommandsPerBatch: MAX_COMMANDS_PER_BATCH,
    groups: Object.fromEntries([...groups()].map(([group, entries]) => [group, entries.map(([type, spec]) => ({ type, required: required(spec), summary: spec.summary }))])),
    topics: ["tipo", "props texto|forma|imagem|video|guia|audio|composicao", "regras", "tudo"],
  };
}

/** A field as one line: name, type, range and its note. */
function fieldLine(name: string, spec: FieldSpec) {
  return `${describeField(name, spec)}${spec.description ? ` (${spec.description})` : ""}`;
}

const LAYER_HINT = "props por tipo de camada: describe('props texto'), forma, imagem, video ou guia";
const PROPS_HINT: Record<string, string> = {
  "layer.set": LAYER_HINT, "layer.setMany": LAYER_HINT, "layer.create": LAYER_HINT,
  "clip.place": "props por tipo de camada: describe('props imagem') ou video",
  "audio.set": "props: describe('props audio')", "audio.create": "props: describe('props audio')",
  "composition.set": "props: describe('props composicao')",
};

export function commandText(type: string) {
  const info = describeCommand(type);
  const spec = COMMANDS[type as keyof typeof COMMANDS] as CommandSpec;
  const lines = [`${type} · ${info.summary}${info.consequential ? " Pede confirmação à pessoa ao aplicar." : ""}`, "campos:"];
  for (const [name, field] of Object.entries(spec.fields)) lines.push(`  ${fieldLine(name, field as FieldSpec)}`);
  if (PROPS_HINT[type]) lines.push(PROPS_HINT[type]);
  lines.push(`exemplo: ${JSON.stringify(info.example)}`);
  return lines.join("\n");
}

const LAYER_GROUPS: Array<[string, readonly LayerProperty[]]> = [
  ["texto", ["text", "fontFamily", "fontSize", "fontWeight", "align"]],
  ["forma", ["geometry"]],
  ["mídia", ["asset", "sourceIn", "sourceOut", "playbackRate", "reverse", "loop"]],
  ["preenchimento e contorno", ["fill", "fillOpacity", "fillEnabled", "stroke", "strokeOpacity", "strokeWidth", "strokeEnabled"]],
  ["sombra", ["shadowColor", "shadowOpacity", "shadowBlur", "shadowX", "shadowY"]],
  ["posição e tamanho (x e y: centro, em px)", ["x", "y", "width", "height", "scaleX", "scaleY", "rotation", "scaleLocked", "sizeLocked"]],
  ["aparência", ["opacity", "blendMode", "visible"]],
  ["tempo", ["startTime", "endTime", "fadeInStart", "fadeInEnd", "fadeOutStart", "fadeOutEnd"]],
  ["outros", ["name", "locked", "exportable"]],
];

const KIND_TITLE: Record<string, string> = { text: "texto", geometry: "forma", image: "imagem", video: "vídeo", guide: "guia", layer: "camada (todas)" };
const KIND_NAMES = "texto forma imagem video guia audio composicao";

function propsKind(topic: string) {
  const name = topic.replace(/^props\s*/i, "");
  if (!name) return undefined;
  const kind = propertyKindOf(name);
  if (!kind) throw new Error(`Tipo de props desconhecido: ${name}. Use ${KIND_NAMES}.`);
  return kind;
}

function layerProps(kind: string) {
  const allowed = kind === "layer" ? undefined : new Set<string>(LAYER_KIND_PROPERTIES[kind as keyof typeof LAYER_KIND_PROPERTIES]);
  return LAYER_GROUPS.map(([title, names]) => [title, names.filter((name) => !allowed || allowed.has(name))] as const).filter(([, names]) => names.length);
}

export function propsText(topic: string) {
  const kind = propsKind(topic);
  if (!kind) return `props: describe('props <tipo>') com tipo em ${KIND_NAMES}.`;
  if (kind === "audio" || kind === "composition") {
    const table = (kind === "audio" ? AUDIO_PROPERTIES : COMPOSITION_PROPERTIES) as Record<string, FieldSpec>;
    return [`props ${kind === "audio" ? "audio (audio.set, audio.create)" : "composição (composition.set)"}:`, ...Object.entries(table).map(([name, spec]) => `  ${fieldLine(name, spec)}`)].join("\n");
  }
  const lines = [`props ${KIND_TITLE[kind]} (layer.set, layer.setMany, layer.create, clip.place props):`];
  for (const [title, names] of layerProps(kind)) {
    lines.push(`${title}: ${names.map((name) => (title.startsWith("posição") ? describeField(name, LAYER_PROPERTIES[name] as FieldSpec) : fieldLine(name, LAYER_PROPERTIES[name] as FieldSpec))).join(" ")}`);
  }
  if (kind === "text" || kind === "layer") lines.push("Várias camadas de uma vez: layer.setMany com layerIds, trackId ou kind; multiply escala valores, como { fontSize: 1.4 }.");
  return lines.join("\n");
}

export function propsJson(topic: string): DescribeJson {
  const kind = propsKind(topic);
  if (!kind) return { kinds: KIND_NAMES.split(" ") };
  if (kind === "audio") return { kind, properties: structuredClone(AUDIO_PROPERTIES) };
  if (kind === "composition") return { kind, properties: structuredClone(COMPOSITION_PROPERTIES) };
  return { kind, properties: Object.fromEntries(layerProps(kind).flatMap(([, names]) => names).map((name) => [name, { ...LAYER_PROPERTIES[name] }])) };
}

export function rulesText() {
  return [...SEMANTICS, ...LIMITS, FILTER_NOTE].map((line) => `- ${line}`).join("\n");
}

/** The whole contract in one text (paged by the caller); also what docs/API-AGENTE.md prints. */
export function fullText(methods: readonly string[]) {
  return [
    `VCT API 1 · lote 1 a ${MAX_COMMANDS_PER_BATCH} comandos, tudo ou nada, um passo de desfazer`,
    `Métodos: ${methods.join(" ")}`,
    "Campos com ! são obrigatórios. Detalhe e exemplo: describe(tipo).",
    ...SEMANTICS.map((line) => `- ${line}`),
    describeCommandsText(),
    ...LIMITS,
  ].join("\n");
}

/** Everything describe() can answer, in the shape the agent asked for. */
export function describeTopic(topic: string | undefined, format: DescribeFormat, methods: readonly string[]): string | DescribeJson {
  const word = (topic ?? "").trim();
  const key = word.toLowerCase();
  if (!word) return format === "json" ? indexJson() : indexText();
  if (key === "tudo" || key === "all") {
    return format === "json"
      ? { ...indexJson(), methods: [...methods], commands: Object.fromEntries(Object.keys(COMMANDS).map((type) => [type, describeCommand(type)])), rules: [...SEMANTICS, ...LIMITS] }
      : fullText(methods);
  }
  if (key === "regras" || key === "rules") return format === "json" ? { rules: [...SEMANTICS, ...LIMITS] } : rulesText();
  if (key === "props" || key.startsWith("props ")) return format === "json" ? propsJson(word) : propsText(word);
  if (!isCommandType(word)) throw new Error(`Comando VCT não suportado: ${word}. Veja describe().`);
  return format === "json" ? describeCommand(word) : commandText(word);
}

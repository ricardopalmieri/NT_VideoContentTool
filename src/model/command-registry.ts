// The single list of VCT commands. Parsing, describe(), the agent guide and the
// docs all read this registry; execution lives in commands.ts.
import { describeField, parseFields, type FieldMap } from "./command-schema";
import { AUDIO_EFFECT_CATALOG, EFFECT_CATALOG } from "./effect-catalog";
import { AUDIO_PROPERTIES, COMPOSITION_PROPERTIES, LAYER_PROPERTIES } from "./property-tables";
import { TRANSITION_TYPES } from "./transitions";
import { FITS } from "./media-assets";

export interface CommandSpec {
  summary: string;
  fields: FieldMap;
  example: Record<string, unknown>;
  /** Commits ask the user to confirm (removals). */
  consequential?: boolean;
  group: "macro" | "mídia" | "camada" | "clipe" | "keyframe" | "efeito" | "áudio" | "composição" | "faixa";
}

const time = { type: "number", required: true, min: 0, max: 7200 } as const;
const id = { type: "id", required: true } as const;
const easing = { type: "enum", values: ["linear", "bezier", "easeIn", "easeOut", "easeInOut", "hold"] } as const;
const keyValue = { type: "number", required: true } as const;
const curve = { type: "number", min: 0, max: 1, description: "força do bezier (padrão .75)" } as const;
const timeBase = { type: "enum", values: ["composition", "clip"], description: "clip: tempos contados do início do clipe" } as const;
const layerKinds = ["text", "geometry", "image", "video", "guide"] as const;

export const COMMANDS = {
  // Mídia
  "clip.place": {
    group: "mídia",
    summary: "Põe uma mídia do bin na timeline num passo: tempo, trecho do arquivo, enquadramento e áudio vinculado. Sem fit entra no tamanho original do arquivo, centralizada. Sem endTime nem duration usa o resto do arquivo. Sem trackId cria faixa nova no topo.",
    fields: { layerId: id, asset: { type: "string", required: true, maxLength: 500 }, startTime: time, endTime: { type: "number", min: 0, max: 7200 },
      duration: { type: "number", min: .001, max: 7200 }, trackId: { type: "id" }, sourceIn: { type: "number", min: 0, max: 7200 },
      playbackRate: { type: "number", min: .05, max: 8 }, fit: { type: "enum", values: FITS }, audio: { type: "enum", values: ["linked", "none"] },
      name: { type: "string" }, props: { type: "object" } },
    example: { type: "clip.place", layerId: "torre1", asset: "media/torre.mp4", startTime: 0, duration: 2.5, sourceIn: 4, trackId: "base", fit: "cover", audio: "none" },
  },
  "layer.fit": {
    group: "mídia", summary: "Reenquadra imagem ou vídeo: contain (inteiro), cover (preenche), rotate-cover (gira 90 e preenche), none (tamanho real).",
    fields: { layerId: id, fit: { type: "enum", required: true, values: FITS } },
    example: { type: "layer.fit", layerId: "torre1", fit: "cover" },
  },
  "asset.add": {
    group: "mídia", summary: "Registra uma mídia no bin (uso interno da importação; a IA não importa arquivos).",
    fields: { asset: { type: "string", required: true, maxLength: 500 }, metadata: { type: "object", required: true } },
    example: { type: "asset.add", asset: "media/a.png", metadata: { originalName: "a.png", size: 1, mimeType: "image/png" } },
  },
  "asset.remove": {
    group: "mídia", consequential: true, summary: "Tira do bin uma mídia que não está em uso.",
    fields: { asset: { type: "string", required: true, maxLength: 500 } },
    example: { type: "asset.remove", asset: "media/a.png" },
  },
  // Camadas
  "layer.create": {
    group: "camada",
    summary: "Cria camada na faixa nova do topo (ou em trackId livre). image/video/guide exigem asset.",
    fields: { layerId: id, kind: { type: "enum", required: true, values: layerKinds }, name: { type: "string", required: true },
      startTime: time, endTime: time, asset: { type: "string", maxLength: 500 }, trackId: { type: "id" },
      props: { type: "object", description: "propriedades iniciais, como em layer.set" } },
    example: { type: "layer.create", layerId: "titulo", kind: "text", name: "Título", startTime: 0, endTime: 3 },
  },
  "layer.set": {
    group: "camada",
    summary: "Muda várias propriedades de uma camada de uma vez. Tempos checam ordem e duração da composição.",
    fields: { layerId: id, props: { type: "object", required: true }, allowOverlap: { type: "boolean" } },
    example: { type: "layer.set", layerId: "titulo", props: { opacity: .8, blendMode: "screen", fill: "#ffcc00" } },
  },
  "layer.setNumeric": {
    group: "camada",
    summary: "Atalho de layer.set para uma propriedade numérica.",
    fields: { layerId: id, property: { type: "string", required: true }, value: keyValue },
    example: { type: "layer.setNumeric", layerId: "titulo", property: "opacity", value: .5 },
  },
  "layer.setName": {
    group: "camada", summary: "Renomeia a camada (1–200 caracteres).",
    fields: { layerId: id, name: { type: "string", required: true } },
    example: { type: "layer.setName", layerId: "titulo", name: "Título principal" },
  },
  "layer.setText": {
    group: "camada", summary: "Troca o texto de uma camada de texto (até 10000 caracteres).",
    fields: { layerId: id, text: { type: "string", required: true, maxLength: 10000, allowEmpty: true } },
    example: { type: "layer.setText", layerId: "titulo", text: "Olá" },
  },
  "layer.setMany": {
    group: "camada",
    summary: "Aplica as mesmas props a várias camadas num passo: layerIds, trackId e kind escolhem (os filtros se somam). multiply multiplica props numéricas pelo valor atual de cada camada (fontSize 1.4 deixa 40% maior). Valida como layer.set.",
    fields: { layerIds: { type: "array", maxItems: 500, description: "lista de ids de camada" }, trackId: { type: "id" }, kind: { type: "enum", values: layerKinds },
      props: { type: "object", description: "valores iguais para todas" }, multiply: { type: "object", description: "prop numérica: fator, como fontSize 1.4" } },
    example: { type: "layer.setMany", trackId: "legenda_track", props: { fill: "#ffffff", shadowOpacity: .8 }, multiply: { fontSize: 1.4 } },
  },
  // Clipes
  "clip.move": {
    group: "clipe", summary: "Move no tempo (e para trackId existente), com keyframes, fades e áudio vinculado.",
    fields: { layerId: id, startTime: time, trackId: { type: "id" }, allowOverlap: { type: "boolean" } },
    example: { type: "clip.move", layerId: "b1", startTime: 2, trackId: "base" },
  },
  "clip.split": {
    group: "clipe", summary: "Corta num frame. Vídeo exige sourceOut definido e loop desligado, ou sourceDuration (duração do arquivo).",
    fields: { layerId: id, time, newLayerId: id, sourceDuration: { type: "number", min: .001, max: 7200 } },
    example: { type: "clip.split", layerId: "b1", time: 1.5, newLayerId: "b1b" },
  },
  "clip.duplicate": {
    group: "clipe", summary: "Copia o clipe (com áudio vinculado) para startTime, na mesma faixa se livre.",
    fields: { layerId: id, startTime: time, newLayerId: id },
    example: { type: "clip.duplicate", layerId: "b1", startTime: 4, newLayerId: "b1c" },
  },
  "clip.paste": {
    group: "clipe", summary: "Cola clipes copiados (formato de copyClips) a partir de startTime.",
    fields: { clipboard: { type: "object", required: true }, startTime: time },
    example: { type: "clip.paste", clipboard: { layers: [], audio: [] }, startTime: 4 },
  },
  "clip.remove": {
    group: "clipe", consequential: true, summary: "Remove o clipe e o áudio vinculado; ripple fecha o espaço.",
    fields: { layerId: id, ripple: { type: "boolean" } },
    example: { type: "clip.remove", layerId: "b1", ripple: true },
  },
  "clip.setTransition": {
    group: "clipe", summary: `Transição de entrada {type:${TRANSITION_TYPES.join("|")}, duration} ou null.`,
    fields: { layerId: id, transition: { type: "object", required: true, nullable: true } },
    example: { type: "clip.setTransition", layerId: "b2", transition: { type: "dissolve", duration: .5 } },
  },
  "clip.fade": {
    group: "clipe",
    summary: "Fade de entrada (in) e/ou saída (out), em s, no clipe e no áudio vinculado juntos. 0 tira o fade. Com transição, a sobreposição manda no áudio.",
    fields: { layerId: id, in: { type: "number", min: 0, max: 7200 }, out: { type: "number", min: 0, max: 7200 } },
    example: { type: "clip.fade", layerId: "torre1", in: .5, out: 1 },
  },
  // Faixas
  "track.create": {
    group: "faixa", summary: "Cria faixa com nome (vazia até receber clipes). index 0 é o topo (vídeo) ou a primeira (áudio).",
    fields: { trackId: id, kind: { type: "enum", required: true, values: ["video", "audio"] }, name: { type: "string" },
      index: { type: "number", min: 0, max: 10000, integer: true } },
    example: { type: "track.create", trackId: "base", kind: "video", name: "Base", index: 0 },
  },
  "track.rename": {
    group: "faixa", summary: "Renomeia uma faixa.",
    fields: { trackId: id, name: { type: "string", required: true } },
    example: { type: "track.rename", trackId: "base", name: "Cidades" },
  },
  "track.remove": {
    group: "faixa", summary: "Remove uma faixa vazia.",
    fields: { trackId: id }, example: { type: "track.remove", trackId: "base" },
  },
  "track.reorder": {
    group: "faixa", summary: "Move a faixa visual para index (0 é o topo, desenhada por cima).",
    fields: { trackId: id, index: { type: "number", required: true, min: 0, max: 10000, integer: true } },
    example: { type: "track.reorder", trackId: "overlay", index: 0 },
  },
  // Keyframes
  "keyframe.upsert": {
    group: "keyframe", summary: "Cria ou atualiza keyframe. time em s da composição (ou do clipe com timeBase clip). easing vale do key até o próximo.",
    fields: { layerId: id, property: { type: "string", required: true }, time, value: keyValue, easing, curve, timeBase },
    example: { type: "keyframe.upsert", layerId: "titulo", property: "opacity", time: 0, value: 0, easing: "easeOut" },
  },
  "keyframe.toggle": {
    group: "keyframe", summary: "Liga/desliga o keyframe no tempo (remove se existir).",
    fields: { layerId: id, property: { type: "string", required: true }, time, value: keyValue, easing, curve, timeBase },
    example: { type: "keyframe.toggle", layerId: "titulo", property: "x", time: 1, value: 540 },
  },
  "keyframe.set": {
    group: "keyframe", summary: "Substitui a trilha inteira de keyframes; lista vazia remove a animação.",
    fields: { layerId: id, property: { type: "string", required: true }, keys: { type: "array", required: true, maxItems: 2000 }, timeBase },
    example: { type: "keyframe.set", layerId: "titulo", property: "scaleX", keys: [{ time: 0, value: 1 }, { time: 1, value: 1.2, easing: "hold" }] },
  },
  "effect.keyframe.upsert": {
    group: "keyframe", summary: "Keyframe de parâmetro de efeito (mesmas regras).",
    fields: { effectId: id, property: { type: "string", required: true }, time, value: keyValue, easing, curve, timeBase },
    example: { type: "effect.keyframe.upsert", effectId: "blur1", property: "radius", time: 2, value: 12 },
  },
  "effect.keyframe.toggle": {
    group: "keyframe", summary: "Liga/desliga keyframe de parâmetro de efeito.",
    fields: { effectId: id, property: { type: "string", required: true }, time, value: keyValue, easing, curve, timeBase },
    example: { type: "effect.keyframe.toggle", effectId: "blur1", property: "radius", time: 2, value: 12 },
  },
  "effect.keyframe.set": {
    group: "keyframe", summary: "Substitui a trilha de keyframes de um parâmetro de efeito.",
    fields: { effectId: id, property: { type: "string", required: true }, keys: { type: "array", required: true, maxItems: 2000 }, timeBase },
    example: { type: "effect.keyframe.set", effectId: "blur1", property: "radius", keys: [] },
  },
  // Efeitos
  "effect.add": {
    group: "efeito", summary: "Adiciona efeito. Efeitos de pós usam ownerId \"__post__\".",
    fields: { kind: { type: "enum", required: true, values: Object.keys(EFFECT_CATALOG) }, ownerId: id, effectId: id },
    example: { type: "effect.add", kind: "glow", ownerId: "__post__", effectId: "post_glow" },
  },
  "effect.setParam": {
    group: "efeito", summary: "Muda um parâmetro (veja listCatalog para nomes e limites; mix 0..1).",
    fields: { effectId: id, parameter: { type: "string", required: true }, value: keyValue },
    example: { type: "effect.setParam", effectId: "post_glow", parameter: "mix", value: .4 },
  },
  "effect.set": {
    group: "efeito", summary: "Liga/desliga ou renomeia um efeito.",
    fields: { effectId: id, enabled: { type: "boolean" }, name: { type: "string" } },
    example: { type: "effect.set", effectId: "post_glow", enabled: false },
  },
  "effect.reorder": {
    group: "efeito", summary: "Muda a posição do efeito na cadeia (0 é o primeiro).",
    fields: { effectId: id, index: { type: "number", required: true, min: 0, max: 1000, integer: true } },
    example: { type: "effect.reorder", effectId: "blur1", index: 0 },
  },
  "effect.remove": {
    group: "efeito", consequential: true, summary: "Remove um efeito de camada ou de pós.",
    fields: { effectId: id }, example: { type: "effect.remove", effectId: "blur1" },
  },
  // Áudio
  "audio.create": {
    group: "áudio", summary: "Cria clipe de áudio a partir de uma mídia já importada (asset).",
    fields: { trackId: id, asset: { type: "string", required: true, maxLength: 500 }, name: { type: "string", required: true },
      startTime: time, endTime: time, laneId: { type: "id" }, props: { type: "object" } },
    example: { type: "audio.create", trackId: "trilha", asset: "media/trilha.wav", name: "Trilha", startTime: 0, endTime: 30 },
  },
  "audio.set": {
    group: "áudio", summary: "Muda propriedades do clipe de áudio (volume 0..2, muted, tempos, fades).",
    fields: { trackId: id, props: { type: "object", required: true } },
    example: { type: "audio.set", trackId: "b1:audio:1", props: { volume: .4 } },
  },
  "audio.move": {
    group: "áudio", summary: "Move o clipe de áudio no tempo e, com laneId, para outra faixa de áudio.",
    fields: { trackId: id, startTime: time, laneId: { type: "id" } },
    example: { type: "audio.move", trackId: "trilha", startTime: 1 },
  },
  "audio.link": {
    group: "áudio", summary: "Vincula o áudio a um vídeo (segue tempos e cortes).",
    fields: { trackId: id, layerId: { type: "id" } }, example: { type: "audio.link", trackId: "b1:audio:1", layerId: "b1" },
  },
  "audio.unlink": {
    group: "áudio", summary: "Desvincula o áudio do vídeo para editar separado.",
    fields: { trackId: id }, example: { type: "audio.unlink", trackId: "b1:audio:1" },
  },
  "audio.remove": {
    group: "áudio", consequential: true, summary: "Remove um clipe de áudio.",
    fields: { trackId: id }, example: { type: "audio.remove", trackId: "trilha" },
  },
  "audio.reorderLane": {
    group: "áudio", summary: "Move a faixa de áudio para index (0 é a primeira).",
    fields: { laneId: id, index: { type: "number", required: true, min: 0, max: 10000, integer: true } },
    example: { type: "audio.reorderLane", laneId: "trilha", index: 0 },
  },
  "audioEffect.add": {
    group: "áudio", summary: "Adiciona efeito de áudio ao clipe (trackId é o id do clipe de áudio).",
    fields: { trackId: id, kind: { type: "enum", required: true, values: Object.keys(AUDIO_EFFECT_CATALOG) }, effectId: id },
    example: { type: "audioEffect.add", trackId: "trilha", kind: "lowpass", effectId: "lp1" },
  },
  "audioEffect.setParam": {
    group: "áudio", summary: "Muda parâmetro de efeito de áudio.",
    fields: { effectId: id, parameter: { type: "string", required: true }, value: keyValue },
    example: { type: "audioEffect.setParam", effectId: "lp1", parameter: "frequency", value: 800 },
  },
  "audioEffect.set": {
    group: "áudio", summary: "Liga/desliga efeito de áudio.",
    fields: { effectId: id, enabled: { type: "boolean", required: true } },
    example: { type: "audioEffect.set", effectId: "lp1", enabled: false },
  },
  "audioEffect.reorder": {
    group: "áudio", summary: "Muda a posição do efeito de áudio na cadeia.",
    fields: { effectId: id, index: { type: "number", required: true, min: 0, max: 1000, integer: true } },
    example: { type: "audioEffect.reorder", effectId: "lp1", index: 0 },
  },
  "audioEffect.remove": {
    group: "áudio", consequential: true, summary: "Remove efeito de áudio.",
    fields: { effectId: id }, example: { type: "audioEffect.remove", effectId: "lp1" },
  },
  // Macros (expandem em comandos base; dryRun mostra a expansão)
  "loop.seam": {
    group: "macro", summary: "Costura de loop: cópia do plano de abertura entra em fade nos últimos fade s e termina no quadro em que o loop começa.",
    fields: { fade: { type: "number", min: .04, max: 10 }, trackId: { type: "id" }, newLayerId: { type: "id" } },
    example: { type: "loop.seam", fade: .5 },
  },
  "fx.stutter": {
    group: "macro", summary: "Repete o trecho do vídeo que começa em at; pattern em tempos (1/2 1/4 …), flip espelha os próximos. Precisa de grid ou beat.",
    fields: { layerId: id, at: time, pattern: { type: "string", required: true }, beat: { type: "number", min: .05, max: 10 }, newLayerId: { type: "id" } },
    example: { type: "fx.stutter", layerId: "torre1", at: 2, pattern: "1/2 1/2 1/4 1/4 flip 1/4 1/4" },
  },
  "fx.strobe": {
    group: "macro", summary: "Flashes de tela cheia de frames frames em cada tempo de times. Mais de 3 por segundo é risco de fotossensibilidade.",
    fields: { times: { type: "array", required: true, maxItems: 200 }, frames: { type: "number", min: 1, max: 30, integer: true }, color: { type: "color" },
      opacity: { type: "number", min: 0, max: 1 }, id: { type: "id" } },
    example: { type: "fx.strobe", times: [4, 8], frames: 2, color: "#ffffff", opacity: .7 },
  },
  "fx.spike": {
    group: "macro", summary: "Efeito sobe a intensity em at e volta a 0 em dur s (glitch, rgbDelay, cameraShake…). Efeito de camada exige ownerId.",
    fields: { effect: { type: "enum", required: true, values: Object.keys(EFFECT_CATALOG) }, at: time, dur: { type: "number", min: .02, max: 10 },
      intensity: { type: "number", min: 0, max: 1 }, ownerId: { type: "id" }, effectId: { type: "id" }, parameter: { type: "string" } },
    example: { type: "fx.spike", effect: "glitch", at: 6, dur: .25, intensity: .8 },
  },
  "text.animate": {
    group: "macro", summary: "Entrada e saída prontas (fade, slide-up, pop, none) como keyframes, com duration s cada.",
    fields: { layerId: id, in: { type: "enum", values: ["fade", "slide-up", "pop", "none"] }, out: { type: "enum", values: ["fade", "slide-up", "pop", "none"] },
      duration: { type: "number", min: .04, max: 10 } },
    example: { type: "text.animate", layerId: "titulo", in: "slide-up", out: "fade", duration: .4 },
  },
  "text.fromSrt": {
    group: "macro", summary: "Cria uma legenda de texto por bloco SRT numa faixa nova (legenda_track), dentro da área segura. Tamanho padrão 5,5% do lado menor da composição (vale em 16:9 e em 9:16); props muda tudo e layer.setMany ajusta depois.",
    fields: { srt: { type: "string", required: true, maxLength: 200000 }, trackId: { type: "id" }, idPrefix: { type: "id" }, props: { type: "object" } },
    example: { type: "text.fromSrt", srt: "1\n00:00:01,000 --> 00:00:03,000\nOlá" },
  },
  // Composição
  "composition.set": {
    group: "composição", summary: "Muda nome, tamanho, fps, duração, fundo ou transparência. resize: adapt|keep ao mudar tamanho.",
    fields: { props: { type: "object", required: true }, resize: { type: "enum", values: ["adapt", "keep"] } },
    example: { type: "composition.set", props: { duration: 30 } },
  },
} as const satisfies Record<string, CommandSpec>;

export type CommandType = keyof typeof COMMANDS;

export function isCommandType(value: unknown): value is CommandType {
  return typeof value === "string" && Object.hasOwn(COMMANDS, value);
}

export function parseCommandFields(value: Record<string, unknown>): CommandType {
  if (!isCommandType(value.type)) throw new Error(`Comando VCT não suportado: ${String(value.type)}. Veja describe().`);
  parseFields(value, COMMANDS[value.type].fields, value.type);
  return value.type;
}

export function isConsequential(type: string) {
  return isCommandType(type) && (COMMANDS[type] as CommandSpec).consequential === true;
}

const PROPERTY_TABLES = { layer: LAYER_PROPERTIES, audio: AUDIO_PROPERTIES, composition: COMPOSITION_PROPERTIES };

/** Compact text: one line per command, then property tables. No ?, & or =. */
export function describeCommandsText() {
  const lines: string[] = [];
  let group = "";
  for (const [type, spec] of Object.entries(COMMANDS) as Array<[string, CommandSpec]>) {
    if (spec.group !== group) lines.push(`## ${group = spec.group}`);
    const fields = Object.entries(spec.fields).map(([name, field]) => describeField(name, field)).join(" ");
    lines.push(`${type} ${fields} | ${spec.summary}`);
  }
  for (const [name, table] of Object.entries(PROPERTY_TABLES)) {
    lines.push(`## props ${name}`);
    lines.push(Object.entries(table).map(([key, field]) => describeField(key, { ...field, required: false })).join(" "));
  }
  return lines.join("\n");
}

export function describeCommand(type: string) {
  if (!isCommandType(type)) throw new Error(`Comando VCT não suportado: ${type}.`);
  const spec = COMMANDS[type] as CommandSpec;
  return {
    type, summary: spec.summary, consequential: spec.consequential === true,
    fields: Object.fromEntries(Object.entries(spec.fields).map(([name, field]) => [name, { ...field }])),
    example: structuredClone(spec.example),
  };
}

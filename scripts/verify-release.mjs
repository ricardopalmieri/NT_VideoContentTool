import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

const archivePath = new URL("../release/NoisetupiVideoContentToolWeb-Hostinger-0.7.0.zip", import.meta.url);
const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
const index = strFromU8(archive["index.html"] || new Uint8Array());
const version = JSON.parse(strFromU8(archive["version.json"] || new Uint8Array()));
const scriptPath = Object.keys(archive).find((path) => /^assets\/index-.*\.js$/.test(path));
if (!scriptPath) throw new Error("Bundle JavaScript não encontrado.");
const script = strFromU8(archive[scriptPath]);
const fontPaths = Object.keys(archive).filter((path) => /\.(woff2?|ttf|otf)$/.test(path));
const checks = [
  [Boolean(archive["LICENSE"] && archive["NOTICE"] && archive["THIRD_PARTY_LICENSES.md"] && archive["TRADEMARKS.md"]), "avisos legais no pacote"],
  [Boolean(archive["LICENSES/MPL-2.0.txt"] && archive["LICENSES/fflate-MIT.txt"]), "textos completos MPL e MIT"],
  [["ibm-plex-mono", "ibm-plex-sans", "inter", "space-grotesk", "syne"].every((font) => Boolean(archive[`LICENSES/${font}-OFL-1.1.txt`])), "cinco avisos OFL"],
  [script.includes("Copyright Ricardo Palmieri / Noisetupi") && script.includes("Mozilla Public"), "comentários legais preservados no JavaScript"],
  [version.version === "0.7.0", "version.json 0.7.0"],
  [index.includes('application-version" content="0.7.0'), "index identificado como 0.7.0"],
  [index.includes(scriptPath), "index aponta para o bundle atual"],
  [script.includes("data-add-audio"), "botão de inserir áudio"],
  [script.includes("data-move-video-clip"), "arraste de clipe de vídeo"],
  [script.includes("audio-group-label"), "seção AUDIO na timeline"],
  [script.includes("data-timeline-order-layer"), "reordenação das camadas na timeline"],
  [script.includes("data-copy-section"), "cópia de seções de parâmetros"],
  [script.includes("data-axis-lock"), "cadeado de eixos"],
  [script.includes("data-add-audio-effect"), "efeitos de áudio"],
  [script.includes("clip-media-strip"), "thumbnails e waveform"],
  [script.includes("fadeInStart"), "envelopes de fade"],
  [script.includes("GAUSSIAN RADIUS"), "blur gaussiano"],
  [script.includes("setup-social-preset"), "presets sociais ao criar projeto"],
  [script.includes("composition-settings"), "alteração da composição no editor"],
  [script.includes("resize-mode"), "adaptação proporcional das camadas"],
  [script.includes("data-move-layer-clip"), "clipes móveis para todas as layers"],
  [script.includes("data-fade-handle"), "fades ajustáveis na timeline"],
  [script.includes("timeline-snap") && script.includes("canvas-snap"), "snap na timeline e canvas"],
  [script.includes("data-group-height"), "altura independente de vídeo e áudio"],
  [script.includes("composition-background"), "fundo no menu de composição"],
  [script.includes("CENTER WITHOUT SCALING"), "redimensionamento centralizado"],
  [script.includes("MEDIA RELINK"), "relink de mídias ausentes"],
  [script.includes("data-replace-layer-media") && script.includes("data-replace-audio-media"), "substituição de mídia"],
  [script.includes("data-transform-handle") && script.includes("transform-box"), "caixa de transformação no canvas"],
  [script.includes("audio-waveform-svg") && script.includes('x1="0"'), "waveform centralizada na track"],
  [script.includes("0.7.0") && script.includes("BUILD"), "identificação visível do build"],
  [version.rendererFix === "nonblocking-missing-video", "renderer não bloqueia em vídeo sem mídia"],
  [version.playbackFix === "stable-video-frame-cache", "preview de vídeo sem intermitência"],
  [version.selectionModel === "unified-sticky-layer-selection", "seleção unificada de layers"],
  [version.fontBundle === "local-latin-woff2", "fontes locais otimizadas"],
  [script.includes("data-select-layer-row") && script.includes("data-select-audio-row"), "seleção explícita em todas as linhas da timeline"],
  [fontPaths.length === 10 && fontPaths.every((path) => path.endsWith(".woff2")), "somente dez fontes WOFF2 no pacote"],
];
for (const [passed, label] of checks) {
  if (!passed) throw new Error(`Falha: ${label}`);
  console.log(`OK: ${label}`);
}

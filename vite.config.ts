import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";

// package.json is the only place the version is written.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

function appVersion(): Plugin {
  return {
    name: "vct-app-version",
    transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", version),
    generateBundle() {
      const manifest = JSON.parse(readFileSync(new URL("./scripts/version-manifest.json", import.meta.url), "utf8"));
      this.emitFile({ type: "asset", fileName: "version.json", source: `${JSON.stringify({ name: manifest.name, version, ...manifest, }, null, 2)}\n` });
    },
  };
}

/**
 * Runtime files of onnxruntime-web, served from the app itself (dist/ort/) so the
 * automatic subtitles never load code from a CDN (the CSP would block it anyway).
 * Two builds: asyncify (WebGPU and the default WASM) and the plain one for Safari
 * before 26. They are only fetched when the person transcribes.
 */
const ORT_FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];
const ortDirectory = fileURLToPath(new URL("./node_modules/onnxruntime-web/dist/", import.meta.url));

function ortRuntime(): Plugin {
  return {
    name: "vct-ort-runtime",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = decodeURIComponent((request.url || "").split("?")[0]).replace(/^\/ort\//, "");
        if (!request.url?.startsWith("/ort/") || !ORT_FILES.includes(name)) { next(); return; }
        response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        response.end(readFileSync(ortDirectory + name));
      });
    },
    generateBundle() {
      for (const name of ORT_FILES) this.emitFile({ type: "asset", fileName: `ort/${name}`, source: readFileSync(ortDirectory + name) });
    },
  };
}

/** Big files only needed to transcribe: the offline worker leaves them out of the precache. */
const NOT_PRECACHED = /^(ort\/|models\/)|(^|\/)(whisper\.worker|transformers|ort[.-])[^/]*\.(js|mjs|wasm)$/;

/**
 * Service worker for offline use, generated with the list of files of this build.
 * Pages are network-first (a new deploy shows up at once); hashed assets are cache-first.
 */
function offlineWorker(): Plugin {
  return {
    name: "vct-offline-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      // public/ is copied as is and is not part of the bundle; .htaccess is server config.
      const publicFiles = readdirSync(new URL("./public/", import.meta.url)).filter((name) => !name.startsWith("."));
      const files = ["./", ...[...Object.keys(bundle), ...publicFiles].filter((name) => !name.endsWith(".map") && !NOT_PRECACHED.test(name)).map((name) => `./${name}`)];
      const source = `// Gerado no build ${version}. Não editar à mão.
const CACHE = "vct-${version}-${Date.now().toString(36)}";
const PRECACHE = ${JSON.stringify(files)};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith("vct-") && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" || /(version\.json|manifest\.webmanifest)$/.test(url.pathname)) {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match("./"))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "./",
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [appVersion(), ortRuntime(), offlineWorker()],
  // onnxruntime-web: the variant that loads its .mjs/.wasm from wasmPaths (dist/ort/) instead of embedding a copy.
  resolve: { conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions] },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  worker: { format: "es" },
  esbuild: { legalComments: "inline" },
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: { banner: "/*! Noisetupi Video Content Tool — © 2026 Noisetupi. MPL-2.0. Consulte THIRD_PARTY_LICENSES.md e LICENSES/. */" },
    },
  }
});

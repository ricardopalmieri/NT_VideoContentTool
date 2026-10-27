import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

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

export default defineConfig({
  base: "./",
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [appVersion()],
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

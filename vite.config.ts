import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  clearScreen: false,
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
      output: { banner: "/*! Noisetupi Video Content Tool — Copyright Ricardo Palmieri / Noisetupi. MPL-2.0. Consulte THIRD_PARTY_LICENSES.md e LICENSES/. */" },
    },
  }
});

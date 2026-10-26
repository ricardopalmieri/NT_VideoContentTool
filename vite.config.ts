import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  }
});

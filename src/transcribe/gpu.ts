// Qual perfil de modelo o dispositivo roda bem (ver ModelProfile em model-catalog.ts). A página e o
// worker usam a mesma conta: sem WebGPU vale o WASM; com WebGPU, o encoder em fp16 só se o
// adaptador tem a extensão shader-f16.
import type { ModelProfile } from "./model-catalog";

interface GpuAdapterLike { features?: { has(name: string): boolean } }
interface GpuLike { requestAdapter(): Promise<GpuAdapterLike | null> }

/** Perfil a partir do adaptador (null = sem WebGPU). Puro, para testar. */
export function profileForAdapter(adapter: GpuAdapterLike | null | undefined): ModelProfile {
  if (!adapter) return "wasm";
  return adapter.features?.has("shader-f16") ? "webgpu-f16" : "webgpu";
}

let probe: Promise<ModelProfile> | null = null;

export function detectProfile(): Promise<ModelProfile> {
  probe ??= (async () => {
    try {
      const gpu = (globalThis.navigator as unknown as { gpu?: GpuLike } | undefined)?.gpu;
      return gpu ? profileForAdapter(await gpu.requestAdapter()) : "wasm";
    } catch {
      return "wasm";
    }
  })();
  return probe;
}

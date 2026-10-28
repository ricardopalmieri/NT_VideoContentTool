import { vertexSource } from "../shaders";
import { GLSL_COMMON, MIX_FRAGMENT } from "./common";
import type { EffectFrame, EffectModule, PassSpec, UniformValue } from "./types";

export interface FxTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface FxProgram {
  program: WebGLProgram;
  locations: Map<string, WebGLUniformLocation | null>;
}

const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_size;
uniform vec2 u_frame;
uniform float u_scale;
uniform float u_time;
`;
const POSITION_LOCATION = 0;

/**
 * Executa módulos de efeito: compila cada passe sob demanda, aloca os buffers intermediários
 * num pool (RGBA16F quando a GPU deixa, senão RGBA8) e escreve o último passe no alvo recebido.
 * O estado do renderer (blend, atributo de posição, buffer de vértices) é o mesmo do resto do quadro.
 */
export class EffectRuntime {
  readonly floatTargets: boolean;
  private programs = new Map<string, FxProgram>();
  private pool = new Map<string, FxTarget[]>();
  private vertexShader: WebGLShader | null = null;
  private broken = new Set<string>();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.floatTargets = this.detectFloat();
  }

  private detectFloat() {
    const gl = this.gl;
    if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) return false;
    try {
      const probe = this.makeTarget(4, 4, true);
      this.deleteTarget(probe);
      return true;
    } catch {
      return false;
    }
  }

  private makeTarget(width: number, height: number, float: boolean): FxTarget {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`WebGL framebuffer is incomplete (${status}).`);
    }
    return { framebuffer, texture, width, height };
  }

  /** Alvo de render do pipeline de efeitos (RGBA16F se possível). */
  createTarget(width: number, height: number): FxTarget {
    return this.makeTarget(width, height, this.floatTargets);
  }

  deleteTarget(target: FxTarget) {
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  private acquire(width: number, height: number) {
    const key = `${width}x${height}`;
    return this.pool.get(key)?.pop() ?? this.createTarget(width, height);
  }

  private release(target: FxTarget) {
    const key = `${target.width}x${target.height}`;
    const list = this.pool.get(key);
    if (list) list.push(target);
    else this.pool.set(key, [target]);
  }

  /** Descarta os buffers intermediários (o tamanho do quadro mudou). */
  reset() {
    for (const list of this.pool.values()) for (const target of list) this.deleteTarget(target);
    this.pool.clear();
  }

  dispose() {
    this.reset();
    for (const entry of this.programs.values()) this.gl.deleteProgram(entry.program);
    this.programs.clear();
  }

  private compile(type: number, source: string) {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "Shader error";
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  private programFor(key: string, pass: PassSpec, samplers: string[]) {
    let entry = this.programs.get(key);
    if (entry) return entry;
    const gl = this.gl;
    const declarations = samplers.map((name) => `uniform sampler2D ${name};\n`).join("");
    const fragment = this.compile(gl.FRAGMENT_SHADER, `${HEADER}${declarations}${GLSL_COMMON}${pass.fragment}`);
    this.vertexShader ||= this.compile(gl.VERTEX_SHADER, vertexSource);
    const program = gl.createProgram()!;
    gl.attachShader(program, this.vertexShader);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, POSITION_LOCATION, "a_position");
    gl.linkProgram(program);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "Shader link error";
      gl.deleteProgram(program);
      throw new Error(log);
    }
    entry = { program, locations: new Map() };
    this.programs.set(key, entry);
    return entry;
  }

  private setUniform(entry: FxProgram, name: string, value: UniformValue) {
    const gl = this.gl;
    let location = entry.locations.get(name);
    if (location === undefined) {
      location = gl.getUniformLocation(entry.program, name);
      entry.locations.set(name, location);
    }
    if (!location) return;
    if (typeof value === "number") gl.uniform1f(location, value);
    else if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
    else if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2]);
    else if (value.length === 4) gl.uniform4f(location, value[0], value[1], value[2], value[3]);
    else gl.uniform1f(location, value[0] ?? 0);
  }

  /**
   * Roda o módulo sobre `input` e devolve a textura do resultado: `output.texture`, ou o próprio
   * `input` quando o efeito não faz nada (DRY / WET 0, raio 0, módulo sem passes ou shader quebrado).
   */
  run(module: EffectModule, params: Readonly<Record<string, number>>, frame: EffectFrame, input: WebGLTexture, output: FxTarget): WebGLTexture {
    const mix = Math.max(0, Math.min(1, params.mix ?? 1));
    if (mix <= .001 || this.broken.has(module.kind)) return input;
    const passes = module.passes(params, frame);
    if (!passes.length) return input;
    if (mix < .999) {
      const wet = passes.at(-1)!.output ?? passes.at(-1)!.id;
      passes.push({ id: "mix", fragment: MIX_FRAGMENT, inputs: { u_dry: "src", u_wet: wet }, uniforms: { u_mix: mix } });
    }
    try {
      this.execute(module.kind, passes, frame, input, output);
    } catch (error) {
      // Um shader que não compila não pode derrubar o quadro: o efeito vira passagem direta.
      this.broken.add(module.kind);
      console.error(`Efeito ${module.kind} desativado: ${error instanceof Error ? error.message : error}`);
      this.gl.activeTexture(this.gl.TEXTURE0);
      return input;
    }
    this.gl.activeTexture(this.gl.TEXTURE0);
    return output.texture;
  }

  private execute(kind: string, passes: PassSpec[], frame: EffectFrame, input: WebGLTexture, output: FxTarget) {
    const gl = this.gl;
    const names = passes.map((pass) => pass.output ?? pass.id);
    const resolved = passes.map((pass, index) => ({
      pass,
      inputs: Object.entries(pass.inputs ?? { u_input: index === 0 ? "src" : names[index - 1] }),
    }));
    const lastUse = new Map<string, number>();
    resolved.forEach(({ inputs }, index) => { for (const [, buffer] of inputs) lastUse.set(buffer, index); });
    const live = new Map<string, FxTarget>();
    try {
      resolved.forEach(({ pass, inputs }, index) => {
        const last = index === resolved.length - 1;
        const size = pass.size ?? 1;
        const width = last ? output.width : Math.max(1, Math.round(frame.width * size));
        const height = last ? output.height : Math.max(1, Math.round(frame.height * size));
        const target = last ? output : this.acquire(width, height);
        if (!last) live.set(names[index], target);
        const samplers = inputs.map(([sampler]) => sampler);
        const entry = this.programFor(`${kind}:${pass.id}:${samplers.join(",")}`, pass, samplers);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, width, height);
        gl.useProgram(entry.program);
        inputs.forEach(([sampler, buffer], unit) => {
          const texture = buffer === "src" ? input : live.get(buffer)?.texture;
          if (!texture) throw new Error(`Passe ${pass.id}: o buffer ${buffer} não existe.`);
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          const samplerLocation = gl.getUniformLocation(entry.program, sampler);
          if (samplerLocation) gl.uniform1i(samplerLocation, unit);
        });
        this.setUniform(entry, "u_size", [width, height]);
        this.setUniform(entry, "u_frame", [frame.width, frame.height]);
        this.setUniform(entry, "u_scale", frame.scale);
        this.setUniform(entry, "u_time", frame.time);
        for (const [name, value] of Object.entries(pass.uniforms ?? {})) this.setUniform(entry, name, value);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        // Buffers cujo último leitor foi este passe voltam ao pool.
        for (const [buffer, texture] of [...live]) {
          if ((lastUse.get(buffer) ?? -1) <= index && texture !== target) {
            live.delete(buffer);
            this.release(texture);
          }
        }
      });
    } finally {
      for (const target of live.values()) this.release(target);
    }
  }
}

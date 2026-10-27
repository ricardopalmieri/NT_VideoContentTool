import { vertexSource, fragmentSource } from "./shaders";
import { sourceTimeFor } from "./source-time";
import { shouldSeekVideo } from "./video-seek";
import { fadeEnvelope } from "../timeline/timing";
import type { EffectNode, Layer, ProjectDocument } from "../model/types";
import { resolveAssetUrl } from "../io/web-platform";

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

interface EffectHistory {
  targets: Target[];
  writeIndex: number;
  count: number;
  lastTime: number;
}

export class ComposerRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private sourceTexture: WebGLTexture;
  private targets: Target[] = [];
  private compTarget!: Target;
  private raster = document.createElement("canvas");
  private ctx = this.raster.getContext("2d", { willReadFrequently: false })!;
  private media = new Map<string, HTMLImageElement | HTMLVideoElement>();
  private videoFrameCache = new Map<string, HTMLCanvasElement>();
  private videoFrameCacheTime = new Map<string, number>();
  private project!: ProjectDocument;
  private uniforms = new Map<string, WebGLUniformLocation>();
  private effectHistories = new Map<string, EffectHistory>();
  private previewScale = 1;
  private activeScale = 1;
  private previewPlaying = false;
  private contextLost = false;
  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.invalidate();
  };
  private readonly handleContextRestored: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly invalidate: () => void = () => undefined,
    onContextRestored: () => void = () => undefined,
  ) {
    this.canvas = canvas;
    this.handleContextRestored = onContextRestored;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is required.");
    this.gl = gl;
    this.program = this.createProgram(vertexSource, fragmentSource);
    this.sourceTexture = this.createTexture();
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    for (const name of ["u_texture", "u_texture_r", "u_texture_g", "u_texture_b", "u_resolution", "u_time", "u_effect", "u_mix", "u_opacity", "u_darken", ...Array.from({ length: 8 }, (_, i) => `u_p${i}`)]) {
      this.uniforms.set(name, gl.getUniformLocation(this.program, name)!);
    }
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
  }

  setProject(project: ProjectDocument, _root: string) {
    this.project = project;
    const { width, height } = project.settings;
    const max = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    if (width > max || height > max) throw new Error(`Canvas exceeds GPU limit (${max}px).`);
    if (width * height > 33_554_432) throw new Error("Canvas exceeds the safe GPU pixel limit.");
    this.resizeRenderSurface(this.activeScale);
    for (const layer of project.layers) this.preload(layer, false);
  }

  setPreviewScale(scale: number) {
    this.previewScale = Math.max(.25, Math.min(1, scale));
  }

  private resizeRenderSurface(scale: number) {
    if (!this.project) return;
    const width = Math.max(16, Math.round(this.project.settings.width * scale));
    const height = Math.max(16, Math.round(this.project.settings.height * scale));
    const canvasResized = this.canvas.width !== width || this.canvas.height !== height;
    if (canvasResized) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const rasterResized = this.raster.width !== width || this.raster.height !== height;
    if (rasterResized) {
      this.raster.width = width;
      this.raster.height = height;
    }
    if (canvasResized || rasterResized || this.targets.length !== 2 || !this.compTarget) {
      this.resetTargets();
    }
    this.activeScale = scale;
  }

  private ensureRenderScale(scale: number) {
    if (Math.abs(this.activeScale - scale) > .001) this.resizeRenderSurface(scale);
  }

  private assetUrl(relative: string) {
    return resolveAssetUrl(relative);
  }

  preload(layer: Layer, fitToCanvas = false, onFitted?: () => void) {
    if (!layer.asset || this.media.has(layer.id)) return;
    const source = this.assetUrl(layer.asset);
    // A lightweight project may be opened before its external media is relinked.
    // Do not register an empty media element: a video without a source never
    // fires loadedmetadata and used to stall the whole render queue.
    if (!source) return;
    const fitMedia = (sourceWidth: number, sourceHeight: number) => {
      if (!sourceWidth || !sourceHeight || !this.project) return;
      // Mídia entra no tamanho real em pixels (1:1 com a composição). Só reduz se
      // for maior que a composição; a imagem guia sempre ocupa a composição.
      const fit = Math.min(this.project.settings.width / sourceWidth, this.project.settings.height / sourceHeight);
      const scale = layer.kind === "guide" ? fit : Math.min(1, fit);
      layer.width = sourceWidth * scale;
      layer.height = sourceHeight * scale;
      onFitted?.();
    };
    if (layer.kind === "video") {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.preload = "auto";
      video.playsInline = true;
      video.addEventListener("loadedmetadata", () => {
        if (fitToCanvas) fitMedia(video.videoWidth, video.videoHeight);
        if (!layer.sourceOut || layer.sourceOut <= layer.sourceIn) layer.sourceOut = video.duration || 0;
        this.invalidate();
      }, { once: true });
      video.addEventListener("loadeddata", () => this.invalidate(), { once: true });
      this.media.set(layer.id, video);
      video.src = source;
      video.load();
    } else {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.addEventListener("load", () => {
        if (fitToCanvas) fitMedia(image.naturalWidth, image.naturalHeight);
        this.invalidate();
      }, { once: true });
      this.media.set(layer.id, image);
      image.src = source;
    }
  }

  hitTestAll(x: number, y: number, time: number): Layer[] {
    const hits: Layer[] = [];
    for (const layer of this.project.layers) {
      if (!layer.visible || time < layer.startTime || time > layer.endTime) continue;
      if (this.evaluated(layer, "opacity", time) * this.fadeEnvelope(layer, time) <= .001) continue;
      const centerX = this.evaluated(layer, "x", time);
      const centerY = this.evaluated(layer, "y", time);
      const scaleX = Math.abs(this.evaluated(layer, "scaleX", time));
      const scaleY = Math.abs(this.evaluated(layer, "scaleY", time));
      if (scaleX < .0001 || scaleY < .0001) continue;
      const rotation = -this.evaluated(layer, "rotation", time) * Math.PI / 180;
      const dx = x - centerX;
      const dy = y - centerY;
      const localX = (dx * Math.cos(rotation) - dy * Math.sin(rotation)) / scaleX;
      const localY = (dx * Math.sin(rotation) + dy * Math.cos(rotation)) / scaleY;
      const width = Math.abs(this.evaluated(layer, "width", time));
      const height = layer.geometry === "line"
        ? Math.max(12, this.evaluated(layer, "strokeWidth", time) * 2)
        : Math.abs(this.evaluated(layer, "height", time));
      if (Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2) hits.push(layer);
    }
    return hits;
  }

  hitTest(x: number, y: number, time: number): Layer | undefined {
    return this.hitTestAll(x, y, time)[0];
  }

  removeMedia(id: string) {
    const item = this.media.get(id);
    if (item instanceof HTMLVideoElement) {
      item.pause();
      item.removeAttribute("src");
      item.load();
    }
    this.media.delete(id);
    this.videoFrameCache.delete(id);
    this.videoFrameCacheTime.delete(id);
  }

  dispose() {
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    for (const id of [...this.media.keys()]) this.removeMedia(id);
    if (this.contextLost) return;
    this.clearEffectHistories();
    const gl = this.gl;
    const renderTargets = this.compTarget ? [...this.targets, this.compTarget] : this.targets;
    for (const target of renderTargets) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.targets = [];
    gl.deleteTexture(this.sourceTexture);
    gl.deleteProgram(this.program);
  }

  mediaDuration(id: string) {
    const media = this.media.get(id);
    return media instanceof HTMLVideoElement && Number.isFinite(media.duration) ? media.duration : 0;
  }

  private sourceTimeFor(layer: Layer, timelineTime: number, mediaDuration: number) {
    return sourceTimeFor(layer, timelineTime, mediaDuration, this.evaluated(layer, "playbackRate", timelineTime));
  }

  // Mede o texto como no render: linhas quebradas, quantas cabem e a altura necessária.
  measureText(layer: Layer, time: number) {
    const ctx = measureContext();
    const fontSize = this.evaluated(layer, "fontSize", time);
    ctx.font = `${this.evaluated(layer, "fontWeight", time) || 500} ${fontSize || 80}px ${layer.fontFamily || "IBM Plex Sans"}`;
    return layoutTextLines(ctx, layer.text || "", fontSize, this.evaluated(layer, "width", time), this.evaluated(layer, "height", time));
  }

  private fadeEnvelope(layer: Layer, time: number) {
    return fadeEnvelope(layer, time);
  }

  setPlaybackState(playing: boolean, timelineTime: number) {
    this.previewPlaying = playing;
    for (const layer of this.project?.layers || []) {
      if (layer.kind !== "video") continue;
      const video = this.media.get(layer.id);
      if (!(video instanceof HTMLVideoElement)) continue;
      if (!playing || layer.reverse || timelineTime < layer.startTime || timelineTime > layer.endTime) {
        video.pause();
        continue;
      }
      const target = this.sourceTimeFor(layer, timelineTime, video.duration || 0);
      const speed = Math.max(.05, Math.min(8, Math.abs(this.evaluated(layer, "playbackRate", timelineTime) || 1)));
      video.playbackRate = speed;
      if (video.readyState >= 1 && Math.abs(video.currentTime - target) > .18) video.currentTime = target;
      void video.play().catch(() => undefined);
    }
  }

  private createProgram(vertex: string, fragment: string) {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader error");
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Shader link error");
    gl.useProgram(program);
    return program;
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private createTarget(): Target {
    const gl = this.gl;
    const texture = this.createTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`WebGL framebuffer is incomplete (${status}).`);
    }
    return { framebuffer, texture };
  }

  private resetTargets() {
    const gl = this.gl;
    const existing = this.compTarget ? [...this.targets, this.compTarget] : this.targets;
    for (const target of existing) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.targets = [this.createTarget(), this.createTarget()];
    this.compTarget = this.createTarget();
    this.clearEffectHistories();
  }

  private clearEffectHistories() {
    const gl = this.gl;
    for (const history of this.effectHistories.values()) {
      for (const target of history.targets) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
    }
    this.effectHistories.clear();
  }

  private easedAmount(keyframe: { easing: string; curve?: number }, amount: number) {
    const t = Math.max(0, Math.min(1, amount));
    if (keyframe.easing === "hold") return 0;
    if (keyframe.easing === "easeIn") return t * t;
    if (keyframe.easing === "easeOut") return 1 - (1 - t) * (1 - t);
    if (keyframe.easing === "easeInOut") return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    if (keyframe.easing === "bezier") {
      const smooth = t * t * (3 - 2 * t);
      const tension = Math.max(0, Math.min(1, keyframe.curve ?? .75));
      return t + (smooth - t) * tension;
    }
    return t;
  }

  private evaluated(layer: Layer, property: keyof Layer, time: number): number {
    const fallback = Number(layer[property]);
    const keys = layer.keyframes[String(property)];
    if (!keys?.length) return fallback;
    const ordered = [...keys].sort((a, b) => a.time - b.time);
    if (time <= ordered[0].time) return ordered[0].value;
    if (time >= ordered.at(-1)!.time) return ordered.at(-1)!.value;
    const rightIndex = ordered.findIndex((key) => key.time >= time);
    const a = ordered[rightIndex - 1];
    const b = ordered[rightIndex];
    const t = this.easedAmount(a, (time - a.time) / (b.time - a.time));
    return a.value + (b.value - a.value) * t;
  }

  layerValue(layer: Layer, property: keyof Layer, time: number) {
    return this.evaluated(layer, property, time);
  }

  private async seekVideo(video: HTMLVideoElement, time: number) {
    if (video.readyState < 1) {
      if (!video.currentSrc && !video.src) return false;
      const metadataReady = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ready: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          video.removeEventListener("loadedmetadata", onReady);
          video.removeEventListener("error", onError);
          video.removeEventListener("abort", onError);
          resolve(ready);
        };
        const onReady = () => finish(true);
        const onError = () => finish(false);
        const timeout = window.setTimeout(() => finish(video.readyState >= 1), 1000);
        video.addEventListener("loadedmetadata", onReady);
        video.addEventListener("error", onError);
        video.addEventListener("abort", onError);
      });
      if (!metadataReady) return false;
    }
    const target = Math.max(0, Math.min(video.duration || time, time));
    if (!shouldSeekVideo(video.currentTime, target) && video.readyState >= 2) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        video.removeEventListener("seeked", checkReady);
        video.removeEventListener("loadeddata", checkReady);
        video.removeEventListener("error", fail);
        video.removeEventListener("abort", fail);
        resolve(ready);
      };
      const checkReady = () => {
        if (video.readyState >= 2 && !video.seeking && !shouldSeekVideo(video.currentTime, target)) finish(true);
      };
      const fail = () => finish(false);
      const timeout = window.setTimeout(fail, 1500);
      video.addEventListener("seeked", checkReady);
      video.addEventListener("loadeddata", checkReady);
      video.addEventListener("error", fail);
      video.addEventListener("abort", fail);
      if (shouldSeekVideo(video.currentTime, target)) {
        video.currentTime = target;
      } else if (video.readyState >= 2) {
        checkReady();
      }
    });
  }

  private waitForImage(image: HTMLImageElement) {
    if (image.complete) return Promise.resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (loaded: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
        resolve(loaded && image.naturalWidth > 0 && image.naturalHeight > 0);
      };
      const onLoad = () => finish(true);
      const onError = () => finish(false);
      const timeout = window.setTimeout(() => finish(false), 10_000);
      image.addEventListener("load", onLoad);
      image.addEventListener("error", onError);
    });
  }

  private syncVideoPlayback(layerId: string, video: HTMLVideoElement, sourceTime: number, speed: number) {
    video.playbackRate = speed;
    if (Math.abs(video.currentTime - sourceTime) > .32 && !video.seeking) {
      this.captureVideoFrame(layerId, video, true);
      video.currentTime = sourceTime;
    }
    if (video.paused && !video.seeking) void video.play().catch(() => undefined);
  }

  private captureVideoFrame(layerId: string, video: HTMLVideoElement, force = false) {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const now = performance.now();
    if (!force && now - (this.videoFrameCacheTime.get(layerId) || 0) < 180) return;
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    let frame = this.videoFrameCache.get(layerId);
    if (!frame) {
      frame = document.createElement("canvas");
      this.videoFrameCache.set(layerId, frame);
    }
    if (frame.width !== width || frame.height !== height) {
      frame.width = width;
      frame.height = height;
    }
    frame.getContext("2d")?.drawImage(video, 0, 0, width, height);
    this.videoFrameCacheTime.set(layerId, now);
  }

  private evaluatedColor(layer: Layer, property: "fill" | "stroke", time: number) {
    const fallback = layer[property];
    const keys = layer.keyframes[`${property}Color`];
    if (!keys?.length) return fallback;
    const ordered = [...keys].sort((a, b) => a.time - b.time);
    const decode = (value: number) => [
      (Math.round(value) >> 16) & 255,
      (Math.round(value) >> 8) & 255,
      Math.round(value) & 255,
    ];
    if (time <= ordered[0].time) return `#${Math.round(ordered[0].value).toString(16).padStart(6, "0")}`;
    if (time >= ordered.at(-1)!.time) return `#${Math.round(ordered.at(-1)!.value).toString(16).padStart(6, "0")}`;
    const rightIndex = ordered.findIndex((key) => key.time >= time);
    const a = ordered[rightIndex - 1];
    const b = ordered[rightIndex];
    const amount = this.easedAmount(a, (time - a.time) / (b.time - a.time));
    const from = decode(a.value);
    const to = decode(b.value);
    const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
    return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  layerColor(layer: Layer, property: "fill" | "stroke", time: number) {
    return this.evaluatedColor(layer, property, time);
  }

  private drawGeometry(layer: Layer, time: number, layerOpacity: number) {
    const ctx = this.ctx;
    const w = this.evaluated(layer, "width", time);
    const h = this.evaluated(layer, "height", time);
    ctx.beginPath();
    if (layer.geometry === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (layer.geometry === "triangle") {
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
    } else if (layer.geometry === "polygon") {
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 3;
        const point = [Math.cos(a) * w / 2, Math.sin(a) * h / 2];
        i ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]);
      }
      ctx.closePath();
    } else if (layer.geometry === "line") {
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
    } else ctx.rect(-w / 2, -h / 2, w, h);
    if (layer.fillEnabled && layer.geometry !== "line") {
      ctx.globalAlpha = layerOpacity * this.evaluated(layer, "fillOpacity", time);
      ctx.fillStyle = this.evaluatedColor(layer, "fill", time);
      ctx.fill();
    }
    if (layer.strokeEnabled || layer.geometry === "line") {
      ctx.globalAlpha = layerOpacity * this.evaluated(layer, "strokeOpacity", time);
      ctx.strokeStyle = this.evaluatedColor(layer, "stroke", time);
      ctx.lineWidth = this.evaluated(layer, "strokeWidth", time);
      ctx.stroke();
    }
  }

  private async rasterize(
    layer: Layer,
    time: number,
    exporting: boolean,
    opacityMultiplier = 1,
    offsetX = 0,
    offsetY = 0,
  ) {
    const ctx = this.ctx;
    const width = this.raster.width;
    const height = this.raster.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(this.activeScale, 0, 0, this.activeScale, 0, 0);
    const x = this.evaluated(layer, "x", time) + offsetX;
    const y = this.evaluated(layer, "y", time) + offsetY;
    const scaleX = this.evaluated(layer, "scaleX", time);
    const scaleY = this.evaluated(layer, "scaleY", time);
    const rotation = this.evaluated(layer, "rotation", time) * Math.PI / 180;
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);
    // Opacidade e fade entram no composite, depois dos efeitos (chroma key, levels etc.).
    const layerOpacity = opacityMultiplier;
    ctx.globalAlpha = layerOpacity;

    if (layer.kind === "geometry") this.drawGeometry(layer, time, layerOpacity);
    else if (layer.kind === "text") {
      const fontWeight = this.evaluated(layer, "fontWeight", time);
      const fontSize = this.evaluated(layer, "fontSize", time);
      const layerWidth = this.evaluated(layer, "width", time);
      const layerHeight = this.evaluated(layer, "height", time);
      ctx.font = `${fontWeight || 500} ${fontSize || 80}px ${layer.fontFamily || "IBM Plex Sans"}`;
      ctx.textAlign = layer.align || "center";
      ctx.textBaseline = "middle";
      const { padding, lineHeight, lines, maxLines } = layoutTextLines(ctx, layer.text || "", fontSize, layerWidth, layerHeight);
      const visibleLines = lines.slice(0, maxLines);
      const startY = -(visibleLines.length - 1) * lineHeight / 2;
      const drawX = layer.align === "left" ? -layerWidth / 2 + padding : layer.align === "right" ? layerWidth / 2 - padding : 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(-layerWidth / 2, -layerHeight / 2, layerWidth, layerHeight);
      ctx.clip();
      visibleLines.forEach((line, index) => {
        const drawY = startY + index * lineHeight;
        if (layer.fillEnabled) {
          ctx.globalAlpha = layerOpacity * this.evaluated(layer, "fillOpacity", time);
          ctx.fillStyle = this.evaluatedColor(layer, "fill", time);
          ctx.fillText(line, drawX, drawY);
        }
        if (layer.strokeEnabled) {
          ctx.globalAlpha = layerOpacity * this.evaluated(layer, "strokeOpacity", time);
          ctx.strokeStyle = this.evaluatedColor(layer, "stroke", time);
          ctx.lineWidth = this.evaluated(layer, "strokeWidth", time);
          ctx.strokeText(line, drawX, drawY);
        }
      });
      ctx.restore();
    } else {
      const media = this.media.get(layer.id);
      if (!media) return false;
      let drawable: CanvasImageSource = media;
      if (media instanceof HTMLVideoElement) {
        // Preview should never wait for media I/O. loadedmetadata/loadeddata
        // invalidate the renderer as soon as the frame can actually be drawn.
        if (media.readyState < 1 && !exporting) return false;
        const sourceTime = this.sourceTimeFor(layer, time, media.duration || 0);
        const speed = Math.max(.05, Math.min(8, Math.abs(this.evaluated(layer, "playbackRate", time) || 1)));
        if (exporting || !this.previewPlaying || layer.reverse) {
          if (!await this.seekVideo(media, sourceTime)) return false;
        } else {
          this.syncVideoPlayback(layer.id, media, sourceTime, speed);
        }
        if (media.readyState < 2) {
          const cachedFrame = this.videoFrameCache.get(layer.id);
          if (exporting || !cachedFrame?.width || !cachedFrame.height) return false;
          drawable = cachedFrame;
        } else {
          this.captureVideoFrame(layer.id, media);
        }
      } else if (!await this.waitForImage(media)) {
        return false;
      }
      const sourceW = drawable instanceof HTMLVideoElement
        ? drawable.videoWidth
        : drawable instanceof HTMLImageElement
          ? drawable.naturalWidth
          : drawable.width;
      const sourceH = drawable instanceof HTMLVideoElement
        ? drawable.videoHeight
        : drawable instanceof HTMLImageElement
          ? drawable.naturalHeight
          : drawable.height;
      if (!sourceW || !sourceH) return false;
      const layerWidth = this.evaluated(layer, "width", time);
      const layerHeight = this.evaluated(layer, "height", time);
      ctx.drawImage(drawable, -layerWidth / 2, -layerHeight / 2, layerWidth, layerHeight);
    }
    ctx.globalAlpha = 1;
    return true;
  }

  private effectCode(kind: EffectNode["kind"]) {
    return ({ mirror: 1, feedback: 2, levels: 3, kaleidoscope: 4, blur: 5, crop: 6, edge: 7, colorKey: 8, animaTracer: 9, rgbDelay: 20, noise: 21, glitch: 22, vhs: 23, cameraShake: 24, glow: 25 } as const)[kind];
  }

  private effectParam(effect: EffectNode, key: string, time: number) {
    const fallback = effect.params[key] ?? 0;
    const keys = effect.keyframes?.[key];
    if (!keys?.length) return fallback;
    const ordered = [...keys].sort((a, b) => a.time - b.time);
    if (time <= ordered[0].time) return ordered[0].value;
    if (time >= ordered.at(-1)!.time) return ordered.at(-1)!.value;
    const rightIndex = ordered.findIndex((item) => item.time >= time);
    const a = ordered[rightIndex - 1];
    const b = ordered[rightIndex];
    const amount = this.easedAmount(a, (time - a.time) / (b.time - a.time));
    return a.value + (b.value - a.value) * amount;
  }

  effectValue(effect: EffectNode, key: string, time: number) {
    return this.effectParam(effect, key, time);
  }

  private effectValues(effect: EffectNode, time: number) {
    const p = new Proxy(effect.params, { get: (_, key: string) => this.effectParam(effect, key, time) });
    switch (effect.kind) {
      case "mirror": return [p.mode, p.center];
      case "feedback": return [];
      case "levels": return [p.brightness, p.contrast, p.saturation, p.gamma];
      case "kaleidoscope": return [p.segments, p.rotation, p.zoom];
      case "blur": return [p.radius];
      case "crop": return [p.left, p.right, p.top, p.bottom];
      case "edge": return [p.amount, p.threshold, p.colorize];
      case "colorKey": return [p.hue, p.tolerance, p.softness];
      case "animaTracer": return [p.progress, p.sensitivity, p.thickness, p.softness, p.direction, p.irregularity, 0, p.invert];
      case "rgbDelay": return [p.redDelay, p.greenDelay, p.blueDelay];
      case "noise": return [p.amount, p.scale];
      case "glitch": return [p.amount, p.frequency, p.blockSize, p.shift, p.rgbSplit, p.scanlines];
      case "vhs": return [p.amount, p.scanlines, p.tracking];
      case "cameraShake": return [p.amount, p.speed];
      case "glow": return [p.threshold, p.radius, p.intensity, p.knee, p.saturation];
    }
  }

  private drawPass(
    texture: WebGLTexture,
    target: Target | null,
    effect: EffectNode | null,
    time: number,
    channels?: [WebGLTexture, WebGLTexture, WebGLTexture],
    parameterOverrides?: number[],
    opacity = 1,
    darken = false,
  ) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer || null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniforms.get("u_texture")!, 0);
    const channelTextures = channels || [texture, texture, texture];
    channelTextures.forEach((channelTexture, index) => {
      gl.activeTexture(gl.TEXTURE1 + index);
      gl.bindTexture(gl.TEXTURE_2D, channelTexture);
      gl.uniform1i(this.uniforms.get(["u_texture_r", "u_texture_g", "u_texture_b"][index])!, index + 1);
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(this.uniforms.get("u_resolution")!, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.get("u_time")!, time);
    gl.uniform1i(this.uniforms.get("u_effect")!, effect ? this.effectCode(effect.kind) : 0);
    gl.uniform1f(this.uniforms.get("u_mix")!, effect ? this.effectParam(effect, "mix", time) : 1);
    gl.uniform1f(this.uniforms.get("u_opacity")!, opacity);
    gl.uniform1f(this.uniforms.get("u_darken")!, darken ? 1 : 0);
    const values = parameterOverrides || (effect ? this.effectValues(effect, time) : []);
    for (let i = 0; i < 8; i++) gl.uniform1f(this.uniforms.get(`u_p${i}`)!, values[i] || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private rgbDelayChannels(effect: EffectNode, texture: WebGLTexture, time: number): [WebGLTexture, WebGLTexture, WebGLTexture] {
    const delays = ["redDelay", "greenDelay", "blueDelay"].map((key) =>
      Math.min(24, Math.abs(Math.round(this.effectParam(effect, key, time)))));
    const capacity = Math.max(...delays) + 1;
    let history = this.effectHistories.get(effect.id);
    if (!history || history.targets.length !== capacity) {
      if (history) {
        for (const target of history.targets) {
          this.gl.deleteFramebuffer(target.framebuffer);
          this.gl.deleteTexture(target.texture);
        }
      }
      history = {
        targets: Array.from({ length: capacity }, () => this.createTarget()),
        writeIndex: 0,
        count: 0,
        lastTime: -1,
      };
      this.effectHistories.set(effect.id, history);
    }
    const frameDuration = 1 / Math.max(1, this.project.settings.fps);
    if (history.lastTime >= 0 && (time <= history.lastTime || time - history.lastTime > frameDuration * 2.5)) {
      history.writeIndex = 0;
      history.count = 0;
    }
    this.drawPass(texture, history.targets[history.writeIndex], null, time);
    history.writeIndex = (history.writeIndex + 1) % history.targets.length;
    history.count = Math.min(history.targets.length, history.count + 1);
    history.lastTime = time;
    return delays.map((delay) => {
      if (delay >= history!.count) return texture;
      const index = (history!.writeIndex - 1 - delay + history!.targets.length) % history!.targets.length;
      return history!.targets[index].texture;
    }) as [WebGLTexture, WebGLTexture, WebGLTexture];
  }

  private blendFor(mode: string) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    // A cor já chega pré-multiplicada: SRC_ALPHA aplicaria o alpha duas vezes.
    if (mode === "add") gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === "multiply") gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    else if (mode === "screen") gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else if (mode === "lighten") {
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else if (mode === "darken") {
      gl.blendEquation(gl.MIN);
      gl.blendFunc(gl.ONE, gl.ONE);
    }
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private compositeRaster(layer: Layer, effects: EffectNode[], time: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.raster);
    let current = this.sourceTexture;
    let index = 0;
    gl.disable(gl.BLEND);
    for (const effect of effects) {
      if (effect.kind === "blur") {
        const radius = Math.max(0, this.effectParam(effect, "radius", time));
        const quality = Math.max(1, Math.min(3, Math.round(this.effectParam(effect, "quality", time) || 1)));
        for (let pass = 0; pass < quality; pass++) {
          let target = this.targets[index % 2];
          this.drawPass(current, target, effect, time, undefined, [radius / Math.sqrt(quality), 0]);
          current = target.texture;
          index++;
          target = this.targets[index % 2];
          this.drawPass(current, target, effect, time, undefined, [radius / Math.sqrt(quality), 1]);
          current = target.texture;
          index++;
        }
      } else {
        const target = this.targets[index % 2];
        this.drawPass(current, target, effect, time);
        current = target.texture;
        index++;
      }
    }
    this.blendFor(layer.blendMode);
    const opacity = this.evaluated(layer, "opacity", time) * this.fadeEnvelope(layer, time);
    this.drawPass(current, this.compTarget, null, time, undefined, undefined, opacity, layer.blendMode === "darken");
  }

  async render(time: number, exporting = false) {
    if (this.contextLost || this.gl.isContextLost()) {
      throw new Error("WebGL context was lost. Restore the browser tab before rendering.");
    }
    this.ensureRenderScale(exporting ? 1 : this.previewScale);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.compTarget.framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const bg = this.project.settings.transparent ? [0, 0, 0, 0] : this.hex(this.project.settings.background);
    gl.disable(gl.BLEND);
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const layer of [...this.project.layers].reverse()) {
      if (!layer.visible || (exporting && !layer.exportable) || time < layer.startTime || time > layer.endTime) continue;
      const enabledEffects = layer.effects.filter((item) => item.enabled);
      const trail = enabledEffects.find((effect) => effect.kind === "feedback");
      const visualEffects = enabledEffects.filter((effect) => effect !== trail);
      if (!trail) {
        const ready = await this.rasterize(layer, time, exporting);
        if (ready) this.compositeRaster(layer, visualEffects, time);
        else if (exporting) throw new Error(`Não foi possível renderizar a mídia da layer "${layer.name}".`);
        continue;
      }
      const requestedCount = Math.round(this.effectParam(trail, "count", time));
      const previewLimit = layer.kind === "video" && !exporting ? 10 : 32;
      const count = Math.max(1, Math.min(previewLimit, requestedCount));
      const spacing = Math.max(0, this.effectParam(trail, "spacing", time));
      const decay = Math.max(0.05, Math.min(1, this.effectParam(trail, "decay", time)));
      const offsetX = this.effectParam(trail, "offsetX", time);
      const offsetY = this.effectParam(trail, "offsetY", time);
      for (let index = count - 1; index >= 0; index--) {
        const sampleTime = time - index * spacing;
        if (sampleTime < layer.startTime || sampleTime > layer.endTime) continue;
        const ready = await this.rasterize(
          layer,
          sampleTime,
          exporting,
          Math.pow(decay, index),
          offsetX * index,
          offsetY * index,
        );
        if (ready) this.compositeRaster(layer, visualEffects, time);
        else if (exporting) throw new Error(`Não foi possível renderizar a mídia da layer "${layer.name}" no frame ${Math.round(sampleTime * this.project.settings.fps)}.`);
      }
    }

    gl.disable(gl.BLEND);
    let current = this.compTarget.texture;
    let index = 0;
    for (const effect of this.project.postEffects.filter((item) => item.enabled)) {
      const target = this.targets[index % 2];
      const channels = effect.kind === "rgbDelay" ? this.rgbDelayChannels(effect, current, time) : undefined;
      this.drawPass(current, target, effect, time, channels);
      current = target.texture;
      index++;
    }
    this.drawPass(current, null, null, time);
  }

  framePngBase64() {
    return this.canvas.toDataURL("image/png").split(",")[1];
  }

  private hex(value: string): [number, number, number, number] {
    const match = value.replace("#", "");
    const full = match.length === 3 ? match.split("").map((v) => v + v).join("") : match.padEnd(6, "0");
    return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255, 1];
  }
}

let measureCanvas: CanvasRenderingContext2D | null = null;
function measureContext() {
  measureCanvas ||= document.createElement("canvas").getContext("2d")!;
  return measureCanvas;
}

export function layoutTextLines(ctx: Pick<CanvasRenderingContext2D, "measureText">, text: string, fontSize: number, layerWidth: number, layerHeight: number) {
  const padding = Math.max(2, fontSize * .04);
  const availableWidth = Math.max(1, layerWidth - padding * 2);
  const lineHeight = fontSize * 1.18;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${line} ${word}`;
      if (ctx.measureText(candidate).width <= availableWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  const maxLines = Math.max(1, Math.floor(Math.max(lineHeight, layerHeight - padding * 2) / lineHeight));
  const requiredHeight = lines.length * lineHeight + padding * 2;
  return { padding, lineHeight, lines, maxLines, requiredHeight };
}

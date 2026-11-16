// The frame on screen, for the judge and the Explanation. Only the video, never the camera.
import type { Box } from "../core/types.ts";

export type Frame = { b64: string; t: number; width: number; height: number };

export function captureFrame(video: HTMLVideoElement, maxWidth = 768): Frame | undefined {
  if (!video.videoWidth) return undefined;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  return frameOf(video, Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale), video.currentTime);
}

/** A picture (the live video, or one kept from a few seconds ago) as the Frame the models get. */
export function frameOf(source: CanvasImageSource, width: number, height: number, t: number): Frame | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
    const b64 = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
    return { b64, t, width, height };
  } catch {
    return undefined; // DRM video: no frame, the text still works
  }
}

/** A small picture of a frame, for the Offer: so it's clear which moment it is about. */
export function thumbOf(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const w = 112;
  c.width = w * 2;
  c.height = Math.round((w * 2 * height) / width);
  try {
    c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  } catch {}
  c.className = "thumb";
  return c;
}

/**
 * The last few seconds of video, a frame every half second. A Stuck moment is noticed a few
 * seconds after it happens (a look is held 1.5 s, the judge thinks, the Offer waits for the
 * sentence to end), and by then the picture that caused it may be gone. Kept as bitmaps; only the
 * one an Offer is about becomes a JPEG.
 */
export class FrameMemory {
  private kept: { t: number; bmp: ImageBitmap }[] = [];
  private busy = false;
  private video: HTMLVideoElement;
  private seconds: number;
  constructor(video: HTMLVideoElement, seconds = 10) {
    this.video = video;
    this.seconds = seconds;
  }

  async keep() {
    const v = this.video;
    if (this.busy || v.paused || !v.videoWidth) return;
    this.busy = true;
    const t = v.currentTime;
    const scale = Math.min(1, 768 / v.videoWidth);
    try {
      const bmp = await createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * scale), resizeHeight: Math.round(v.videoHeight * scale), resizeQuality: "medium" });
      this.kept.push({ t, bmp });
      while (this.kept.length > this.seconds * 2) this.kept.shift()!.bmp.close();
    } catch {
      // DRM video, or the video changed under us
    } finally {
      this.busy = false;
    }
  }

  /** The frame nearest to video time `t` (within a second), or the one on screen now. */
  at(t: number): { frame: Frame | undefined; thumb: HTMLCanvasElement | null } {
    let best: { t: number; bmp: ImageBitmap } | null = null;
    for (const k of this.kept) if (Math.abs(k.t - t) <= 1 && (!best || Math.abs(k.t - t) < Math.abs(best.t - t))) best = k;
    if (best) return { frame: frameOf(best.bmp, best.bmp.width, best.bmp.height, best.t), thumb: thumbOf(best.bmp, best.bmp.width, best.bmp.height) };
    const v = this.video;
    return { frame: captureFrame(v), thumb: v.videoWidth ? thumbOf(v, v.videoWidth, v.videoHeight) : null };
  }

  clear() {
    for (const k of this.kept) k.bmp.close();
    this.kept = [];
  }
}

/**
 * Where the picture actually sits inside the <video> box (letterboxing), relative to `container`,
 * in the container's own pixels: also right while the Room glides the player (a CSS transform).
 */
export function videoContentRect(video: HTMLVideoElement, container: HTMLElement) {
  const v = video.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  const z = container.offsetWidth ? c.width / container.offsetWidth : 1;
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const s = Math.min(v.width / vw, v.height / vh);
  const w = vw * s;
  const h = vh * s;
  return { left: (v.left - c.left + (v.width - w) / 2) / z, top: (v.top - c.top + (v.height - h) / 2) / z, width: w / z, height: h / z };
}

/** Part of the paused frame at full resolution, enlarged, for a closer look at a small thing. */
export function cropFrame(video: HTMLVideoElement, b: Box, side = 768): string | undefined {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw) return undefined;
  const [y0, x0, y1, x1] = b;
  const sx = (x0 / 1000) * vw;
  const sy = (y0 / 1000) * vh;
  const sw = ((x1 - x0) / 1000) * vw;
  const sh = ((y1 - y0) / 1000) * vh;
  if (sw < 4 || sh < 4) return undefined;
  const scale = Math.min(4, side / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  try {
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  } catch {
    return undefined;
  }
}

/** How busy a part of the picture is, 0 (flat) to 1 (lots of edges, like text or lines). Fractions of the picture. */
export type Busy = (x0: number, y0: number, x1: number, y1: number) => number;

/**
 * A coarse map of the paused frame's edges, so arrows and labels can go where the picture is
 * calm instead of over text and lines. Read once per answer; a summed table keeps each look cheap.
 */
export function busyMap(video: HTMLVideoElement, cols = 64, rows = 36): Busy | null {
  if (!video.videoWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  let px: Uint8ClampedArray;
  try {
    g.drawImage(video, 0, 0, cols, rows);
    px = g.getImageData(0, 0, cols, rows).data;
  } catch {
    return null; // DRM video
  }
  const lum = (i: number) => (0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2]) / 255;
  // Summed-area table of edge strength: the brightest step to a neighbour.
  const sum = new Float64Array((cols + 1) * (rows + 1));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const l = lum(i);
      const e = Math.max(x + 1 < cols ? Math.abs(l - lum(i + 1)) : 0, y + 1 < rows ? Math.abs(l - lum(i + cols)) : 0);
      sum[(y + 1) * (cols + 1) + x + 1] = e + sum[y * (cols + 1) + x + 1] + sum[(y + 1) * (cols + 1) + x] - sum[y * (cols + 1) + x];
    }
  }
  return (fx0, fy0, fx1, fy1) => {
    const c = (v: number, n: number) => Math.max(0, Math.min(n, Math.round(v * n)));
    const [x0, x1, y0, y1] = [c(fx0, cols), c(fx1, cols), c(fy0, rows), c(fy1, rows)];
    const n = (x1 - x0) * (y1 - y0);
    if (n <= 0) return 0;
    const s = sum[y1 * (cols + 1) + x1] - sum[y0 * (cols + 1) + x1] - sum[y1 * (cols + 1) + x0] + sum[y0 * (cols + 1) + x0];
    return Math.min(1, (s / n) * 4);
  };
}

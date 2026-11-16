// The Room (GLOSSARY.md): while the chat is open, the video moves into the space Unstuck's own
// windows leave free, so nothing of Unstuck covers it. Only the geometry lives here, so it can be tested.

export type Rect = { left: number; top: number; width: number; height: number };
/** A window's place as fractions of the screen, so it survives window resizes and fullscreen. */
export type FracRect = { x: number; y: number; w: number; h: number };

export const ROOM = {
  /** Space between the windows and around the edge of the screen, px. */
  gap: 12,
  /** The chat's share of the screen width, within these bounds (px). */
  panelShare: 0.3,
  panelMin: 340,
  panelMax: 480,
  /** The simulation's share of the height beside the chat; the video gets the rest, above it. */
  simShare: 0.58,
  /** The video never gets narrower than this, even when the windows leave no room (px). */
  minVideo: 240,
};

/** The chat: a full-height column on the right. */
export function defaultPanel(W: number, H: number): Rect {
  const g = ROOM.gap;
  const width = Math.round(Math.min(ROOM.panelMax, Math.max(ROOM.panelMin, W * ROOM.panelShare)));
  return { left: W - width - g, top: g, width, height: H - 2 * g };
}

/** A simulation: underneath the video, on the wider side of the chat. */
export function defaultSim(W: number, H: number, panel: Rect): Rect {
  const g = ROOM.gap;
  const leftSpace = panel.left - 2 * g;
  const rightSpace = W - (panel.left + panel.width) - 2 * g;
  const [x0, x1] = leftSpace >= rightSpace ? [g, panel.left - g] : [panel.left + panel.width + g, W - g];
  const height = Math.round((H - 2 * g) * ROOM.simShare);
  return { left: x0, top: H - g - height, width: Math.max(ROOM.minVideo, x1 - x0), height };
}

const overlaps = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * The biggest place for a video of this aspect (width / height) that none of `blocks` covers,
 * a gap away from them and from the screen's edge, centred in the free space it found.
 */
export function videoSpot(W: number, H: number, blocks: Rect[], aspect: number): Rect {
  const g = ROOM.gap;
  const xs = new Set([g, W - g]);
  const ys = new Set([g, H - g]);
  for (const b of blocks) {
    for (const x of [b.left - g, b.left + b.width + g]) if (x > g && x < W - g) xs.add(x);
    for (const y of [b.top - g, b.top + b.height + g]) if (y > g && y < H - g) ys.add(y);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  let best: { w: number; r: Rect } | null = null;
  // Every rectangle between two of the edges is a candidate; few windows, so this stays tiny.
  for (let i = 0; i < X.length; i++)
    for (let j = i + 1; j < X.length; j++)
      for (let k = 0; k < Y.length; k++)
        for (let l = k + 1; l < Y.length; l++) {
          const r = { left: X[i], top: Y[k], width: X[j] - X[i], height: Y[l] - Y[k] };
          if (blocks.some((b) => overlaps(r, b))) continue;
          const w = Math.min(r.width, r.height * aspect);
          if (!best || w > best.w + 0.5) best = { w, r };
        }
  if (!best || best.w < ROOM.minVideo) {
    const width = ROOM.minVideo;
    return { left: best?.r.left ?? g, top: best?.r.top ?? g, width, height: Math.round(width / aspect) };
  }
  const width = Math.round(best.w);
  const height = Math.round(best.w / aspect);
  return { left: Math.round(best.r.left + (best.r.width - width) / 2), top: Math.round(best.r.top + (best.r.height - height) / 2), width, height };
}

export function toFrac(r: Rect, W: number, H: number): FracRect {
  return { x: r.left / W, y: r.top / H, w: r.width / W, h: r.height / H };
}

export function fromFrac(f: FracRect, W: number, H: number): Rect {
  return { left: Math.round(f.x * W), top: Math.round(f.y * H), width: Math.round(f.w * W), height: Math.round(f.h * H) };
}

/** Keeps a window on screen and at least `min` big. */
export function keepOnScreen(r: Rect, W: number, H: number, min: { width: number; height: number }): Rect {
  const width = Math.min(Math.max(min.width, r.width), W - 16);
  const height = Math.min(Math.max(min.height, r.height), H - 16);
  return { width, height, left: Math.min(Math.max(8, r.left), W - width - 8), top: Math.min(Math.max(8, r.top), H - height - 8) };
}

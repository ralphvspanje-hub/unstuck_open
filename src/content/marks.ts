// Marks v3: drawn over the paused frame, each tied to a [[phrase]] in the Explanation.
// - arrow:     a pen-drawn arrow from a calm bit of the picture to the thing (the usual one)
// - outline:   a tight hand-drawn circle around one small thing, its label right beside it
// - spotlight: everything else dims ("look here")
// - flow:      dots streaming from one thing to another (current, data, a force)
// The layer sits exactly on the video picture, so nothing spills onto the letterbox. Arrows and
// labels go where the frame is calm (busyMap), away from text and lines and from each other.
import { animate } from "motion";
import { normPhrase } from "../core/answer.ts";
import type { Box, Mark } from "../core/types.ts";
import type { Busy } from "./frame.ts";

type Rect = { left: number; top: number; width: number; height: number };
type Px = { x0: number; x1: number; y0: number; y1: number; cx: number; cy: number };
const NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export class MarkLayer {
  private root: ShadowRoot;
  private layer: HTMLDivElement | null = null;
  private svg: SVGSVGElement | null = null;
  private rect: Rect = { left: 0, top: 0, width: 0, height: 0 };
  private byPhrase = new Map<string, Element[]>();
  /** Where labels already sit, so a second one picks another side. */
  private labels: Area[] = [];
  /** What the Marks point at, so a second Mark's arrow and label stay off the first one's thing. */
  private areas: Area[] = [];
  /** How busy the paused frame is where (null: unknown, e.g. a DRM video). */
  busy: Busy | null = null;
  /** Called with the first Mark's spot, so the knot can fly there. */
  onFirst: (x: number, y: number) => void = () => {};

  constructor(root: ShadowRoot) {
    this.root = root;
  }

  get count() {
    return this.byPhrase.size;
  }

  private ensure(rect: Rect) {
    if (this.layer) return;
    this.rect = rect;
    const layer = document.createElement("div");
    layer.className = "marks-layer";
    place(layer, rect);
    // Drawn in the picture's size at the time; the viewBox scales it if the player resizes.
    const svg = svgEl("svg", { class: "marks", viewBox: `0 0 ${rect.width} ${rect.height}` });
    layer.append(svg);
    this.root.append(layer);
    this.layer = layer;
    this.svg = svg;
  }

  private px(b: Box): Px {
    const { width: W, height: H } = this.rect;
    const [y0, x0, y1, x1] = b;
    const p = { x0: (x0 / 1000) * W, x1: (x1 / 1000) * W, y0: (y0 / 1000) * H, y1: (y1 / 1000) * H };
    return { ...p, cx: (p.x0 + p.x1) / 2, cy: (p.y0 + p.y1) / 2 };
  }

  draw(m: Mark, rect: Rect, first: boolean) {
    if (!m.box) return;
    this.ensure(rect);
    const a = this.px(m.box);
    const els: Element[] = [];
    let at = { x: a.cx, y: a.cy };
    if (m.kind === "spotlight") els.push(...this.spotlight(a, m.label));
    else if (m.kind === "flow" && m.toBox) els.push(...this.flow(a, this.px(m.toBox), m.label));
    else if (m.kind === "outline") els.push(...this.outline(a, m.label));
    else {
      const drawn = this.arrow(a, m.label);
      els.push(...drawn.els);
      at = drawn.tip;
    }
    this.areas.push(a);
    if (m.kind === "flow" && m.toBox) this.areas.push(this.px(m.toBox));
    this.byPhrase.set(normPhrase(m.phrase || m.label || String(this.byPhrase.size)), els);
    if (first) this.onFirst(rect.left + at.x, rect.top + at.y);
  }

  /** The player changed size (theatre mode, fullscreen): keep the Marks on the picture. */
  relayout(rect: Rect) {
    if (this.layer) place(this.layer, rect);
  }

  /** The Viewer points at a phrase in the text: its circle is drawn again, the rest gives a small bump. */
  pulse(phrase: string) {
    for (const el of this.byPhrase.get(normPhrase(phrase)) ?? []) {
      if (el.classList.contains("pen")) draw(el as SVGPathElement, 480, 0);
      else if (el.classList.contains("spot")) el.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-in-out" });
      else if (el.classList.contains("flow-group")) el.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 520, easing: "ease-in-out" });
    }
  }

  clear() {
    const layer = this.layer;
    this.layer = null;
    this.svg = null;
    this.byPhrase.clear();
    this.labels = [];
    this.areas = [];
    if (layer) animate(layer, { opacity: 0 }, { duration: 0.2 }).finished.then(() => layer.remove());
  }

  // ── the four kinds ───────────────────────────────────────────────────────

  private spotlight(a: Px, label: string): Element[] {
    const pad = 12;
    const { width: W, height: H } = this.rect;
    const pct = (v: number, of: number) => `${(v / of) * 100}%`;
    const spot = document.createElement("div");
    spot.className = "spot";
    Object.assign(spot.style, { left: pct(a.x0 - pad, W), top: pct(a.y0 - pad, H), width: pct(a.x1 - a.x0 + 2 * pad, W), height: pct(a.y1 - a.y0 + 2 * pad, H) });
    this.layer!.prepend(spot); // under the svg, so labels stay bright
    spot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "ease-out", fill: "backwards" });
    const out: Element[] = [spot];
    if (label) out.push(...this.label(label, { x0: a.x0 - pad, x1: a.x1 + pad, y0: a.y0 - pad, y1: a.y1 + pad, cx: a.cx, cy: a.cy }, 450));
    return out;
  }

  /** A loop around one small, compact thing (big or long ones get an arrow: fitMark in answer.ts). */
  private outline(a: Px, label: string): Element[] {
    const { d, ext } = wobblyEllipse(a, this.byPhrase.size);
    const path = svgEl("path", { d, class: "pen" });
    this.svg!.append(path);
    draw(path, 620, 120);
    return [path, ...(label ? this.label(label, ext, 600) : [])];
  }

  /**
   * An arrow pointing at the thing. Of eight directions it takes the one whose tail and label
   * land on calm picture, inside the frame and clear of the other Marks. The tip stops just short
   * of a small thing, or a little inside a big one.
   */
  private arrow(a: Px, label: string): { els: Element[]; tip: { x: number; y: number } } {
    const { width: W, height: H } = this.rect;
    const w = a.x1 - a.x0;
    const h = a.y1 - a.y0;
    const d = w > W * 0.3 || h > H * 0.3 ? -Math.min(w, h) * 0.1 : 8;
    const R = { x0: a.x0 - d, x1: a.x1 + d, y0: a.y0 - d, y1: a.y1 + d };
    const len = Math.max(60, Math.min(120, Math.min(W, H) * 0.16));
    const text = label ? svgEl("text", { class: "label" }) : null;
    if (text) {
      text.textContent = label;
      this.svg!.append(text);
    }
    const tw = text?.getComputedTextLength() ?? 0;
    const th = 16;
    const busy = (b: Area) => (this.busy ? this.busy(b.x0 / W, b.y0 / H, b.x1 / W, b.y1 / H) : 0);
    let best: { score: number; tip: { x: number; y: number }; tail: { x: number; y: number }; lab: Area; u: { x: number; y: number } } | null = null;
    for (const [i, deg] of [-135, -45, 135, 45, 180, 0, -90, 90].entries()) {
      const u = { x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) };
      const kx = u.x > 1e-6 ? (R.x1 - a.cx) / u.x : u.x < -1e-6 ? (R.x0 - a.cx) / u.x : Infinity;
      const ky = u.y > 1e-6 ? (R.y1 - a.cy) / u.y : u.y < -1e-6 ? (R.y0 - a.cy) / u.y : Infinity;
      const k = Math.min(kx, ky);
      const tip = { x: a.cx + u.x * k, y: a.cy + u.y * k };
      const tail = { x: tip.x + u.x * len, y: tip.y + u.y * len };
      const lab = labelBox(tail, u, tw, text ? th : 0);
      const all = { x0: Math.min(lab.x0, tail.x), x1: Math.max(lab.x1, tail.x), y0: Math.min(lab.y0, tail.y), y1: Math.max(lab.y1, tail.y) };
      const inside = all.x0 > 6 && all.y0 > 6 && all.x1 < W - 6 && all.y1 < H - 6;
      const others = [...this.areas, ...this.labels];
      const hits = others.some((o) => overlaps(o, lab)) || this.areas.some((o) => [0.25, 0.5, 0.75, 1].some((f) => inArea(o, tail.x + (tip.x - tail.x) * (1 - f), tail.y + (tip.y - tail.y) * (1 - f))));
      // How busy the picture is under the shaft: small squares along the line, not its bounding box
      // (a flat arrow's box has no height, and would always look calm).
      const along = [0.2, 0.4, 0.6, 0.8].map((f) => {
        const x = tail.x + (tip.x - tail.x) * f;
        const y = tail.y + (tip.y - tail.y) * f;
        return busy({ x0: x - 9, x1: x + 9, y0: y - 9, y1: y + 9 });
      });
      const score = (inside ? 0 : 10) + (hits ? 3 : 0) + busy(lab) * 2 + (along.reduce((p, q) => p + q, 0) / along.length) * 1.5 + i * 0.03;
      if (!best || score < best.score) best = { score, tip, tail, lab, u };
    }
    const { tip, tail, lab, u } = best!;
    // A gentle bow, like a quick pen stroke; the head follows the curve's direction at the tip.
    const bow = len * 0.14;
    const c = { x: (tip.x + tail.x) / 2 - u.y * bow, y: (tip.y + tail.y) / 2 + u.x * bow };
    const shaft = svgEl("path", { d: `M${tail.x.toFixed(1)} ${tail.y.toFixed(1)} Q ${c.x.toFixed(1)} ${c.y.toFixed(1)}, ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`, class: "pen arrow" });
    const ang = Math.atan2(tip.y - c.y, tip.x - c.x);
    const wing = (s: number) => `${(tip.x - Math.cos(ang + s) * 14).toFixed(1)} ${(tip.y - Math.sin(ang + s) * 14).toFixed(1)}`;
    const head = svgEl("path", { d: `M${wing(-0.5)} L${tip.x.toFixed(1)} ${tip.y.toFixed(1)} L${wing(0.5)}`, class: "pen arrow" });
    this.svg!.append(shaft, head);
    draw(shaft, 420, 80);
    draw(head, 180, 480);
    const els: Element[] = [shaft, head];
    if (text) {
      text.setAttribute("x", String(lab.x0));
      text.setAttribute("y", String(lab.y1 - 3));
      text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 520, fill: "backwards" });
      this.labels.push(lab);
      els.push(text);
    }
    return { els, tip };
  }

  private flow(a: Px, b: Px, label: string): Element[] {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    // A gentle arc, bowing upward so it doesn't hide what it connects.
    const bow = Math.min(60, len * 0.18);
    const c = { x: (a.cx + b.cx) / 2 + (dy / len) * bow, y: (a.cy + b.cy) / 2 - Math.abs(dx / len) * bow };
    const g = svgEl("g", { class: "flow-group" });
    const trail = svgEl("path", { d: `M${a.cx} ${a.cy} Q ${c.x} ${c.y}, ${b.cx} ${b.cy}`, class: "flow-trail" });
    const dots = svgEl("path", { d: `M${a.cx} ${a.cy} Q ${c.x} ${c.y}, ${b.cx} ${b.cy}`, class: "flow" });
    // Arrowhead along the curve's direction at the end.
    const ang = Math.atan2(b.cy - c.y, b.cx - c.x);
    const tip = { x: b.cx - Math.cos(ang) * 10, y: b.cy - Math.sin(ang) * 10 };
    const head = svgEl("path", {
      d: `M${tip.x} ${tip.y} L${tip.x - Math.cos(ang - 0.5) * 14} ${tip.y - Math.sin(ang - 0.5) * 14} L${tip.x - Math.cos(ang + 0.5) * 14} ${tip.y - Math.sin(ang + 0.5) * 14} Z`,
      class: "flow-head",
    });
    const ringA = svgEl("circle", { cx: a.cx, cy: a.cy, r: 8, class: "flow-end" });
    const ringB = svgEl("circle", { cx: b.cx, cy: b.cy, r: 8, class: "flow-end" });
    g.append(trail, dots, head, ringA, ringB);
    this.svg!.append(g);
    draw(trail, 700, 150);
    for (const [el, delay] of [[ringA, 100], [dots, 600], [head, 800], [ringB, 800]] as const) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay, fill: "backwards" });
    }
    const mid = { x: (a.cx + 2 * c.x + b.cx) / 4, y: (a.cy + 2 * c.y + b.cy) / 4 };
    return [g, ...(label ? this.label(label, { x0: mid.x - 4, x1: mid.x + 4, y0: mid.y - 6, y1: mid.y + 6, cx: mid.x, cy: mid.y }, 900, ["above", "below"]) : [])];
  }

  /** A label right next to its shape, with a short leader line; never off the picture. */
  private label(text: string, s: Px, delay: number, sides: ("right" | "left" | "above" | "below")[] = ["right", "left", "above", "below"]): Element[] {
    const t = svgEl("text", { class: "label" });
    t.textContent = text;
    this.svg!.append(t);
    const w = t.getComputedTextLength();
    const h = 16;
    const { width: W, height: H } = this.rect;
    const gap = 14;
    const spots = {
      right: { x: s.x1 + gap, y: s.cy + 5, lx: s.x1 + 2, ly: s.cy, ok: s.x1 + gap + w < W - 6 },
      left: { x: s.x0 - gap - w, y: s.cy + 5, lx: s.x0 - 2, ly: s.cy, ok: s.x0 - gap - w > 6 },
      above: { x: Math.min(Math.max(6, s.cx - w / 2), W - w - 6), y: s.y0 - gap, lx: s.cx, ly: s.y0 - 2, ok: s.y0 - gap - h > 6 },
      below: { x: Math.min(Math.max(6, s.cx - w / 2), W - w - 6), y: s.y1 + gap + h - 4, lx: s.cx, ly: s.y1 + 2, ok: s.y1 + gap + h < H - 6 },
    };
    const box = (k: keyof typeof spots) => ({ x0: spots[k].x - 3, x1: spots[k].x + w + 3, y0: spots[k].y - h, y1: spots[k].y + 5 });
    const free = (k: keyof typeof spots) => ![...this.labels, ...this.areas].some((o) => overlaps(o, box(k)));
    const calm = (k: keyof typeof spots) => {
      const b = box(k);
      return (this.busy ? this.busy(b.x0 / W, b.y0 / H, b.x1 / W, b.y1 / H) : 0) + sides.indexOf(k) * 0.03;
    };
    const side = sides.filter((k) => spots[k].ok && free(k)).sort((p, q) => calm(p) - calm(q))[0] ?? sides.find((k) => spots[k].ok) ?? sides[0];
    this.labels.push(box(side));
    const p = spots[side];
    t.setAttribute("x", String(p.x));
    t.setAttribute("y", String(p.y));
    const lx2 = side === "right" ? p.x - 4 : side === "left" ? p.x + w + 4 : p.lx;
    const ly2 = side === "above" ? p.y + 4 : side === "below" ? p.y - h + 2 : p.ly;
    const leader = svgEl("line", { x1: p.lx, y1: p.ly, x2: lx2, y2: ly2, class: "leader" });
    this.svg!.insertBefore(leader, t);
    for (const el of [leader, t]) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay, fill: "backwards" });
    return [t, leader];
  }
}

type Area = { x0: number; x1: number; y0: number; y1: number };
const overlaps = (a: Area, b: Area) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inArea = (a: Area, x: number, y: number) => x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1;

/** Where an arrow's label goes: beyond its tail, on the side the arrow comes from. */
function labelBox(tail: { x: number; y: number }, u: { x: number; y: number }, w: number, h: number): Area {
  if (!w) return { x0: tail.x - 4, x1: tail.x + 4, y0: tail.y - 4, y1: tail.y + 4 };
  if (Math.abs(u.x) >= 0.35) {
    const x0 = u.x > 0 ? tail.x + 6 : tail.x - 6 - w;
    const y0 = tail.y - h / 2 + u.y * 6;
    return { x0, x1: x0 + w, y0, y1: y0 + h };
  }
  const y0 = u.y > 0 ? tail.y + 6 : tail.y - 6 - h;
  return { x0: tail.x - w / 2, x1: tail.x + w / 2, y0, y1: y0 + h };
}

function place(el: HTMLElement, r: Rect) {
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}

function draw(path: SVGGeometryElement, ms: number, delay: number) {
  const len = path.getTotalLength();
  path.style.strokeDasharray = `${len}`;
  path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms, delay, easing: "cubic-bezier(.5,0,.25,1)", fill: "backwards" })
    .finished.then(() => (path.style.strokeDasharray = ""), () => {});
}

const wobble = (i: number, seed: number) => Math.sin(i * 12.9898 + seed * 78.233) * 0.5 + Math.sin(i * 3.1 + seed) * 0.5;

/** A pen-drawn loop around the box: starts top-left and closes with a short overlap. */
function wobblyEllipse(a: Px, seed: number): { d: string; ext: Px } {
  // An ellipse through the box's corners would be √2 too wide; things in boxes are rarely square.
  const rx = (a.x1 - a.x0) / 2 * 1.12 + 6;
  const ry = (a.y1 - a.y0) / 2 * 1.12 + 6;
  const a0 = -2.3;
  const steps = 48;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (i / steps) * Math.PI * 2 * 1.05;
    const r = 1 + wobble(i, seed) * 0.012 + (i / steps) * 0.025;
    pts.push(`${i ? "L" : "M"}${(a.cx + Math.cos(t) * rx * r).toFixed(1)} ${(a.cy + Math.sin(t) * ry * r).toFixed(1)}`);
  }
  return { d: pts.join(" "), ext: { ...a, x0: a.cx - rx, x1: a.cx + rx, y0: a.cy - ry, y1: a.cy + ry } };
}

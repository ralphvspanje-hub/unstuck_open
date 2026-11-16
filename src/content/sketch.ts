// Sketches: clean the model's SVG, then let it draw itself stroke by stroke.
import DOMPurify from "dompurify";
import { namespaceSvgIds } from "../core/answer.ts";
import { setHTML } from "./html.ts";

const ALLOWED = ["svg", "g", "path", "line", "polyline", "polygon", "circle", "ellipse", "rect", "text", "tspan", "defs", "marker"];
let counter = 0;

export function cleanSvg(svg: string): string | null {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true },
    ALLOWED_TAGS: ALLOWED,
    FORBID_ATTR: ["style", "href", "xlink:href", "class"],
  }) as unknown as string;
  if (!clean.includes("<svg")) return null;
  return namespaceSvgIds(clean, `sk${++counter}`);
}

const GEOMETRY = "path, line, polyline, polygon, circle, ellipse, rect";

/** Inserts the Sketch into `host` and animates it. Resolves when the drawing is complete. */
export function drawSketch(host: HTMLElement, svg: string, opts: { fast?: boolean } = {}): Promise<void> {
  const clean = cleanSvg(svg);
  if (!clean) return Promise.resolve();
  setHTML(host, clean);
  const root = host.querySelector("svg");
  if (!root) return Promise.resolve();
  root.removeAttribute("width");
  root.removeAttribute("height");
  if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", "0 0 400 240");
  root.classList.add("sketch-svg");
  declutter(root);
  fitViewBox(root);

  const items = [...root.querySelectorAll<SVGElement>(`${GEOMETRY}, text`)].filter((el) => !el.closest("defs, marker"));
  const speed = opts.fast ? 0.35 : 1;
  let at = 0;
  const done: Promise<unknown>[] = [];
  for (const el of items) {
    if (el instanceof SVGGeometryElement && el.tagName !== "text") {
      let len = 0;
      try {
        len = el.getTotalLength();
      } catch {}
      const filled = (el.getAttribute("fill") ?? "none") !== "none";
      if (len > 0) {
        const dur = Math.min(650, Math.max(160, len * 1.6)) * speed;
        el.style.strokeDasharray = `${len}`;
        el.style.strokeDashoffset = `${len}`;
        const frames: Keyframe[] = filled
          ? [{ strokeDashoffset: len, fillOpacity: 0 }, { strokeDashoffset: 0, fillOpacity: 1 }]
          : [{ strokeDashoffset: len }, { strokeDashoffset: 0 }];
        done.push(el.animate(frames, { duration: dur, delay: at, easing: "cubic-bezier(.45,.05,.3,1)", fill: "forwards" }).finished);
        at += dur * 0.75;
        continue;
      }
    }
    done.push(
      el.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], {
        duration: 260 * speed,
        delay: at,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "backwards",
      }).finished,
    );
    at += 140 * speed;
  }
  return Promise.all(done).then(() => {}, () => {});
}

/** A label that runs past the drawing's edge would be cut off by the panel: widen the view to hold it. */
function fitViewBox(root: SVGSVGElement) {
  const vb = root.viewBox.baseVal;
  let b: DOMRect;
  try {
    b = root.getBBox();
  } catch {
    return;
  }
  if (!vb || !b.width || !b.height) return;
  const out = b.x < vb.x || b.y < vb.y || b.x + b.width > vb.x + vb.width || b.y + b.height > vb.y + vb.height;
  if (!out) return;
  const pad = 6;
  const x0 = Math.min(vb.x, b.x - pad);
  const y0 = Math.min(vb.y, b.y - pad);
  const x1 = Math.max(vb.x + vb.width, b.x + b.width + pad);
  const y1 = Math.max(vb.y + vb.height, b.y + b.height + pad);
  root.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
}

type Area = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Area, b: Area) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** An element's box in screen pixels, grown by `grow`. */
function screenArea(el: SVGGraphicsElement, m: DOMMatrix, grow = 0, dx = 0, dy = 0): Area {
  const b = el.getBBox();
  const a = new DOMPoint(b.x + dx, b.y + dy).matrixTransform(m);
  const c = new DOMPoint(b.x + b.width + dx, b.y + b.height + dy).matrixTransform(m);
  return { x0: Math.min(a.x, c.x) - grow, y0: Math.min(a.y, c.y) - grow, x1: Math.max(a.x, c.x) + grow, y1: Math.max(a.y, c.y) + grow };
}

/**
 * Labels the model put on top of a line, across a box's edge or over another label move to
 * the nearest clear spot. Run before the drawing animates (dashes would fool the hit test).
 */
function declutter(root: SVGSVGElement) {
  const rootM = root.getScreenCTM();
  const vb = root.viewBox.baseVal;
  if (!rootM || !vb?.width) return;
  const free = (el: Element) => !el.closest("defs, marker");
  const texts = [...root.querySelectorAll<SVGTextElement>("text")].filter(free);
  if (!texts.length) return;
  const view = (() => {
    const a = new DOMPoint(vb.x, vb.y).matrixTransform(rootM);
    const c = new DOMPoint(vb.x + vb.width, vb.y + vb.height).matrixTransform(rootM);
    return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
  })();

  // Strokes are hit-tested a few units thicker, so labels also keep a little distance.
  const restore: (() => void)[] = [];
  const shapes = [...root.querySelectorAll<SVGGeometryElement>(GEOMETRY)].filter(free).flatMap((el) => {
    const m = el.getScreenCTM();
    if (!m) return [];
    const cs = getComputedStyle(el);
    const sw = parseFloat(cs.strokeWidth) || 0;
    const stroked = cs.stroke !== "none" && sw > 0;
    const b = el.getBBox();
    // Only small filled shapes (dots, arrowheads) count as solid; a big filled box may hold its label.
    const solid = cs.fill !== "none" && b.width < 40 && b.height < 40;
    if (!stroked && !solid) return [];
    if (stroked) {
      el.style.strokeWidth = `${sw + 5}`;
      restore.push(() => (el.style.strokeWidth = ""));
    }
    return [{ el, inv: m.inverse(), stroked, solid, area: screenArea(el, m, sw / 2 + 6) }];
  });

  const areas = new Map<SVGTextElement, Area>();
  try {
    for (const t of texts) {
      const m = t.getScreenCTM();
      if (m) areas.set(t, screenArea(t, m));
    }
    for (const t of texts) {
      const m = t.getScreenCTM();
      const b = t.getBBox();
      if (!m || !b.width) continue;
      const score = (dx: number, dy: number) => {
        let n = 0;
        const mine = screenArea(t, m, 1, dx, dy);
        if (mine.x0 < view.x0 || mine.y0 < view.y0 || mine.x1 > view.x1 || mine.y1 > view.y1) n += 30;
        for (const [o, a] of areas) if (o !== t && overlaps(mine, a)) n += 60;
        for (let x = b.x + 1; x <= b.x + b.width - 1; x += 4) {
          for (const fy of [0.3, 0.55, 0.8]) {
            const p = new DOMPoint(x + dx, b.y + b.height * fy + dy).matrixTransform(m);
            for (const s of shapes) {
              if (p.x < s.area.x0 || p.x > s.area.x1 || p.y < s.area.y0 || p.y > s.area.y1) continue;
              const q = p.matrixTransform(s.inv);
              if ((s.stroked && s.el.isPointInStroke(q)) || (s.solid && s.el.isPointInFill(q))) {
                n++;
                break;
              }
            }
          }
        }
        return n;
      };
      let best = { dx: 0, dy: 0, n: score(0, 0) };
      if (best.n === 0) continue;
      search: for (const r of [5, 10, 16, 24, 34, 46, 60, 78]) {
        for (const [ux, uy] of [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
          const dx = ux * r * 1.5;
          const dy = uy * r;
          const n = score(dx, dy);
          if (n < best.n) best = { dx, dy, n };
          if (n === 0) break search;
        }
      }
      if (best.dx || best.dy) {
        shift(t, best.dx, best.dy);
        areas.set(t, screenArea(t, m));
      }
    }
  } finally {
    for (const f of restore) f();
  }
}

function shift(t: SVGTextElement, dx: number, dy: number) {
  for (const el of [t, ...t.querySelectorAll("tspan")]) {
    for (const [attr, d] of [["x", dx], ["y", dy]] as const) {
      const v = el.getAttribute(attr);
      if (v === null) {
        if (el === t) el.setAttribute(attr, String(d));
        continue;
      }
      el.setAttribute(attr, v.trim().split(/[\s,]+/).map((n) => String((parseFloat(n) || 0) + d)).join(" "));
    }
  }
}

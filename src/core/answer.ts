// Parses the model's streamed answer: <marks>[…]</marks> <text>…</text> <figure>…</figure> <play>…</play>.
// Works on partial input, so the panel can show the text while it is still being written.
import { cleanPlotSpec, type PlotSpec } from "./plot.ts";
import type { Box, Mark } from "./types.ts";

/**
 * An Explanation's picture: an exact plot (Unstuck draws it from the formulas), an HTML figure
 * (checked on a render by the server), or an SVG from older answers.
 */
export type Figure = { kind: "plot"; spec: PlotSpec } | { kind: "html"; html: string } | { kind: "svg"; svg: string };

export type ParsedAnswer = {
  text: string;
  textDone: boolean;
  marks: Mark[] | null;
  /** null until the section is complete; then the Figure, or "none". */
  figure: Figure | "none" | null;
  /** What a "▶ Play with it" simulation would let the Viewer move: "" when there's nothing, null until known. */
  play: string | null;
  done: boolean;
};

function section(src: string, tag: string): { body: string; closed: boolean } | null {
  const open = src.indexOf(`<${tag}>`);
  if (open < 0) return null;
  const start = open + tag.length + 2;
  const close = src.indexOf(`</${tag}>`, start);
  return close < 0 ? { body: src.slice(start), closed: false } : { body: src.slice(start, close), closed: true };
}

// A partial closing tag at the very end ("</te") must not flash on screen.
const stripPartialTag = (s: string) => s.replace(/<\/?[a-z]*$/i, "");

export function parseAnswer(src: string, finished = false): ParsedAnswer {
  const text = section(src, "text");
  const marks = section(src, "marks");
  const figure = section(src, "figure") ?? section(src, "sketch");
  const play = section(src, "play");

  let body = text ? text.body : src.includes("<") ? "" : src; // no tags at all: treat everything as text
  if (text && !text.closed) body = stripPartialTag(body);

  return {
    text: body.trim(),
    textDone: Boolean(text?.closed) || finished,
    marks: marks?.closed ? parseMarks(marks.body) : null,
    figure: figure?.closed ? (parseFigure(figure.body) ?? "none") : finished ? "none" : null,
    play: play?.closed ? play.body.replace(/\s+/g, " ").trim().slice(0, 160) : finished ? "" : null,
    done: finished,
  };
}

export function cleanBox(b: unknown): Box | undefined {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const [y0, x0, y1, x1] = b.map((n: number) => Math.min(1000, Math.max(0, n)));
  return y1 > y0 && x1 > x0 ? [y0, x0, y1, x1] : undefined;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** At most two Marks, at most one spotlight; a flow needs somewhere to flow to. */
export function parseMarks(json: string): Mark[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json.replace(/```(json)?/g, "").trim() || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Mark[] = [];
  for (const m of raw) {
    const phrase = str(m?.phrase, 80).replace(/\[\[|\]\]/g, "").trim(); // the brackets belong in the text, not here
    const find = str(m?.find, 120) || phrase;
    const box = cleanBox(m?.box_2d ?? m?.box);
    if (!phrase && !box) continue;
    let kind: Mark["kind"] = ["outline", "spotlight", "flow"].includes(m?.kind) ? m.kind : "arrow";
    const to = str(m?.to, 120);
    const toBox = cleanBox(m?.to_box_2d);
    if (kind === "flow" && !to && !toBox) kind = "arrow";
    if (kind === "spotlight" && out.some((o) => o.kind === "spotlight")) kind = "arrow";
    out.push({ phrase, kind, find, ...(kind === "flow" ? { to } : {}), label: str(m?.label, 40), box, ...(kind === "flow" && toBox ? { toBox } : {}) });
    if (out.length === 2) break;
  }
  return out;
}

/** What still needs finding on the frame. */
export function thingsToLocate(marks: Mark[]): string[] {
  const out = new Set<string>();
  for (const m of marks) {
    if (!m.box && m.find) out.add(m.find);
    if (m.kind === "flow" && !m.toBox && m.to) out.add(m.to);
  }
  return [...out];
}

/** Gives Marks their boxes from a locate answer; drops the ones that weren't found. */
export function placeMarks(marks: Mark[], boxes: Record<string, Box | null>): Mark[] {
  const kept: Mark[] = [];
  for (const m0 of marks) {
    const m = { ...m0, box: m0.box ?? boxes[m0.find] ?? undefined, ...(m0.kind === "flow" ? { toBox: m0.toBox ?? (m0.to ? boxes[m0.to] : undefined) ?? undefined } : {}) };
    if (!m.box || (m.kind === "flow" && !m.toBox)) continue;
    const fitted = fitMark(m);
    // One clear Mark beats two that sit on top of each other.
    if (fitted && !kept.some((k) => k.box && covered(fitted.box!, k.box) > 0.5)) kept.push(fitted);
  }
  return kept;
}

/** Share of a frame (0-1) a box covers. */
const areaOf = ([y0, x0, y1, x1]: Box) => ((y1 - y0) * (x1 - x0)) / 1e6;

/** How much of the smaller box lies inside the other (0-1). */
function covered(a: Box, b: Box) {
  const w = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const h = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  return w > 0 && h > 0 ? (w * h) / 1e6 / Math.max(1e-6, Math.min(areaOf(a), areaOf(b))) : 0;
}

/**
 * The kind that suits the found box. A circle only fits a small, compact thing; around anything
 * big or long it turns into a clumsy box, so that gets an arrow. A spotlight on half the picture
 * shows nothing, and an arrow at the whole picture points at nothing.
 */
export function fitMark(m: Mark): Mark | null {
  if (!m.box || m.kind === "flow") return m;
  const [y0, x0, y1, x1] = m.box;
  const area = areaOf(m.box);
  const long = Math.max(x1 - x0, y1 - y0) / Math.max(1, Math.min(x1 - x0, y1 - y0)) > 2.5;
  if (m.kind === "spotlight") return area > 0.4 ? null : m;
  if (area > 0.6) return null;
  if (m.kind === "outline" && (area > 0.06 || long)) return { ...m, kind: "arrow" };
  return m;
}

// ── the zoomed second look ─────────────────────────────────────────────────
// Boxes from a whole frame are rough; asked again on a crop around the first guess, the
// model boxes much more tightly. These map between the frame and the crop.

/** Small things are worth a second look; big ones are already close enough. */
export const worthRefining = (b: Box) => b[2] - b[0] < 400 && b[3] - b[1] < 400;

/** The crop around a first guess: the box plus enough surroundings to recognise it. */
export function cropAround(b: Box, grow = 0.75, min = 80): Box {
  const [y0, x0, y1, x1] = b;
  const m = Math.max(min, grow * Math.max(y1 - y0, x1 - x0));
  return [Math.max(0, y0 - m), Math.max(0, x0 - m), Math.min(1000, y1 + m), Math.min(1000, x1 + m)];
}

/** A box found on the crop, back in frame coordinates. */
export function fromCrop(crop: Box, r: Box): Box {
  const [cy0, cx0, cy1, cx1] = crop;
  const h = cy1 - cy0;
  const w = cx1 - cx0;
  return [cy0 + (r[0] / 1000) * h, cx0 + (r[1] / 1000) * w, cy0 + (r[2] / 1000) * h, cx0 + (r[3] / 1000) * w];
}

/** Trust the second look only if it found the same thing: centred near the first box, similar size. */
export function sameThing(first: Box, second: Box): boolean {
  const [y0, x0, y1, x1] = first;
  const h = y1 - y0;
  const w = x1 - x0;
  const cy = (second[0] + second[2]) / 2;
  const cx = (second[1] + second[3]) / 2;
  const near = cy > y0 - h * 0.3 && cy < y1 + h * 0.3 && cx > x0 - w * 0.3 && cx < x1 + w * 0.3;
  const ratio = ((second[2] - second[0]) * (second[3] - second[1])) / (h * w);
  return near && ratio > 0.2 && ratio < 2.5;
}

export const normPhrase = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Has the typed-out text reached the end of this [[phrase]]? */
export function phraseShown(shown: string, phrase: string): boolean {
  const want = normPhrase(phrase);
  for (const m of shown.matchAll(/\[\[([^\]]+?)\]\]/g)) if (normPhrase(m[1]) === want) return true;
  return false;
}

/** The <figure> section's body: a plot spec (JSON), an HTML figure, or an SVG. */
export function parseFigure(body: string): Figure | null {
  const b = body.replace(/^\s*```(?:json|html|svg|xml)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!b) return null;
  if (b.startsWith("{")) {
    try {
      const spec = cleanPlotSpec(JSON.parse(b));
      return spec ? { kind: "plot", spec } : null;
    } catch {
      return null;
    }
  }
  const svgFirst = b.indexOf("<svg");
  const html = b.search(/<div|<style/i);
  if (html >= 0 && (svgFirst < 0 || html < svgFirst)) return { kind: "html", html: b.slice(html) };
  const svg = extractSvg(b);
  return svg ? { kind: "svg", svg } : null;
}

export function extractSvg(body: string): string | null {
  const start = body.indexOf("<svg");
  const end = body.lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  return body.slice(start, end + 6);
}

/**
 * Prefix every id in a Sketch so two Sketches on screen can't clash (both might
 * define id="arrow"). Run after sanitising.
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  const ids = new Set<string>();
  for (const m of svg.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  let out = svg;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`\\bid="${esc}"`, "g"), `id="${prefix}-${id}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, "g"), `url(#${prefix}-${id})`)
      .replace(new RegExp(`href="#${esc}"`, "g"), `href="#${prefix}-${id}"`);
  }
  return out;
}

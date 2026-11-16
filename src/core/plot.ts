// Exact plots: the model says what to plot (formulas, values, a threshold), Unstuck draws it,
// so a curve always has its true shape. Pure: produces SVG markup for the Figure renderer.

export type PlotSpec = {
  x: [number, number];
  y?: [number, number];
  xLabel?: string;
  yLabel?: string;
  curves?: { f: string; label?: string; key?: boolean; dashed?: boolean }[];
  points?: { x: number; y: number; label?: string; key?: boolean }[];
  vlines?: { x: number; label?: string }[];
  hlines?: { y: number; label?: string }[];
  arrow?: { from: [number, number]; to: [number, number]; label?: string };
  bars?: { label: string; value: number; key?: boolean }[];
};

// ── a tiny formula language, parsed to closures: no eval, nothing but arithmetic ──────

type Fx = (x: number) => number;
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const FNS: Record<string, (...a: number[]) => number> = {
  exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, tanh: Math.tanh, atan: Math.atan, abs: Math.abs,
  floor: Math.floor, round: Math.round, sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow,
  sigmoid, relu: (z) => Math.max(0, z),
};

/** "1/(1+exp(-(x-10)))" → a function of x, or null if it isn't a formula we understand. */
export function compile(src: string): Fx | null {
  const s = src.replace(/\s+/g, "").replace(/[·×]/g, "*").replace(/−/g, "-").replace(/\*\*/g, "^");
  let i = 0;
  const peek = () => s[i];
  const fail = (): never => {
    throw new Error("bad formula");
  };
  const expr = (): Fx => {
    let a = term();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const l = a;
      const r = term();
      a = op === "+" ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return a;
  };
  const term = (): Fx => {
    let a = unary();
    while (peek() === "*" || peek() === "/") {
      const op = s[i++];
      const l = a;
      const r = unary();
      a = op === "*" ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
    }
    return a;
  };
  const unary = (): Fx => {
    if (peek() === "-") {
      i++;
      const a = unary();
      return (x) => -a(x);
    }
    if (peek() === "+") {
      i++;
      return unary();
    }
    return power();
  };
  const power = (): Fx => {
    const base = atom();
    if (peek() !== "^") return base;
    i++;
    const e = unary(); // right-associative, and -x^2 means -(x^2)
    return (x) => Math.pow(base(x), e(x));
  };
  const atom = (): Fx => {
    if (peek() === "(") {
      i++;
      const a = expr();
      if (s[i++] !== ")") fail();
      return a;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      const v = parseFloat(num[0]);
      return () => v;
    }
    const id = /^[a-z][a-z0-9]*/i.exec(s.slice(i));
    if (!id) return fail();
    const name = id[0].toLowerCase();
    i += id[0].length;
    if (name === "x") return (x) => x;
    if (name === "pi") return () => Math.PI;
    if (name === "e") return () => Math.E;
    const fn = FNS[name];
    if (!fn || s[i++] !== "(") return fail();
    const args = [expr()];
    while (peek() === ",") {
      i++;
      args.push(expr());
    }
    if (s[i++] !== ")") fail();
    return (x) => fn(...args.map((a) => a(x)));
  };
  try {
    const f = expr();
    return i === s.length ? f : null;
  } catch {
    return null;
  }
}

// ── the spec, cleaned ─────────────────────────────────────────────────────────────────

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const txt = (v: unknown, max = 40) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && num(v[0]) !== null && num(v[1]) !== null ? [v[0], v[1]] : null;

/** Whatever the model wrote, made safe to draw; null if nothing drawable is left. */
export function cleanPlotSpec(raw: any): PlotSpec | null {
  const r = raw?.plot ?? raw;
  if (!r || typeof r !== "object") return null;
  const bars = (Array.isArray(r.bars) ? r.bars : [])
    .map((b: any) => ({ label: txt(b?.label, 24) ?? "", value: num(b?.value), key: Boolean(b?.key) }))
    .filter((b: any) => b.value !== null)
    .slice(0, 8);
  const x = pair(r.x);
  const curves = (Array.isArray(r.curves) ? r.curves : [])
    .map((c: any) => ({ f: typeof c?.f === "string" ? c.f.slice(0, 200) : "", label: txt(c?.label), key: Boolean(c?.key), dashed: Boolean(c?.dashed) }))
    .filter((c: any) => compile(c.f))
    .slice(0, 3);
  if (!bars.length && !(x && x[1] > x[0] && curves.length)) return null;
  const y = pair(r.y);
  const spec: PlotSpec = {
    x: x && x[1] > x[0] ? x : [0, 1],
    ...(y && y[1] > y[0] ? { y } : {}),
    xLabel: txt(r.xLabel),
    yLabel: txt(r.yLabel),
  };
  if (bars.length) spec.bars = bars;
  else {
    spec.curves = curves;
    spec.points = (Array.isArray(r.points) ? r.points : []).filter((p: any) => num(p?.x) !== null && num(p?.y) !== null).slice(0, 4).map((p: any) => ({ x: p.x, y: p.y, label: txt(p.label), key: Boolean(p.key) }));
    spec.vlines = (Array.isArray(r.vlines) ? r.vlines : []).filter((v: any) => num(v?.x) !== null).slice(0, 2).map((v: any) => ({ x: v.x, label: txt(v.label) }));
    spec.hlines = (Array.isArray(r.hlines) ? r.hlines : []).filter((v: any) => num(v?.y) !== null).slice(0, 2).map((v: any) => ({ y: v.y, label: txt(v.label) }));
    const from = pair(r.arrow?.from);
    const to = pair(r.arrow?.to);
    if (from && to) spec.arrow = { from, to, label: txt(r.arrow?.label) };
  }
  return spec;
}

// ── drawing ───────────────────────────────────────────────────────────────────────────

/** About 5 round tick values (1, 2 or 5 × 10^k apart) covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, n = 5): number[] {
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const W = 400;
const H = 240;
const box = { l: 44, r: W - 14, t: 26, b: H - 34 };
const KEY = "#ff7a59";
const SECOND = "#4f8cff";
const MUTED = "#9aa0aa";
const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (v: number) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(0) : String(Number(v.toFixed(2))));
const textEl = (x: number, y: number, s: string, attrs = "") =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="13" fill="currentColor" ${attrs}>${escXml(s)}</text>`;
/** Keeps a label of about this many characters inside the picture. */
const fitX = (x: number, label: string, size = 13) => Math.min(Math.max(4, x), W - 4 - label.length * size * 0.55);

export function plotSvg(spec: PlotSpec): string {
  return spec.bars?.length ? barsSvg(spec) : curvesSvg(spec);
}

function curvesSvg(spec: PlotSpec): string {
  const [x0, x1] = spec.x;
  const fns = (spec.curves ?? []).map((c) => ({ ...c, fx: compile(c.f)! }));
  const N = 240;
  const xs = Array.from({ length: N + 1 }, (_, i) => x0 + ((x1 - x0) * i) / N);
  // y range: given, or from the curves (ignoring blow-ups), padded a little.
  let [y0, y1] = spec.y ?? [Infinity, -Infinity];
  if (!spec.y) {
    const ys = fns.flatMap((c) => xs.map(c.fx)).concat((spec.points ?? []).map((p) => p.y)).filter(Number.isFinite).sort((a, b) => a - b);
    const lo = ys[Math.floor(ys.length * 0.02)] ?? 0;
    const hi = ys[Math.ceil(ys.length * 0.98) - 1] ?? 1;
    const pad = (hi - lo || 1) * 0.08;
    [y0, y1] = [lo - pad, hi + pad];
    if (y0 > 0 && y0 < (y1 - y0) * 0.3) y0 = 0; // start at 0 when that's close anyway
  }
  const X = (v: number) => box.l + ((v - x0) / (x1 - x0)) * (box.r - box.l);
  const Y = (v: number) => box.b - ((v - y0) / (y1 - y0)) * (box.b - box.t);
  const out: string[] = [];

  // Axes at zero when zero is in view, ticks and labels.
  const ax = x0 <= 0 && x1 >= 0 ? X(0) : box.l;
  const ay = y0 <= 0 && y1 >= 0 ? Y(0) : box.b;
  out.push(`<line x1="${box.l}" y1="${ay}" x2="${box.r}" y2="${ay}" stroke="currentColor" stroke-width="2"/>`);
  out.push(`<line x1="${ax}" y1="${box.b}" x2="${ax}" y2="${box.t - 6}" stroke="currentColor" stroke-width="2"/>`);
  for (const t of niceTicks(x0, x1)) out.push(textEl(X(t), Math.min(H - 20, ay + 15), fmt(t), `font-size="11" fill="${MUTED}" text-anchor="middle"`));
  for (const t of niceTicks(y0, y1, 4)) if (Math.abs(Y(t) - ay) > 8) out.push(textEl(ax - 6, Y(t) + 4, fmt(t), `font-size="11" fill="${MUTED}" text-anchor="end"`));
  if (spec.xLabel) out.push(textEl(box.r, H - 6, spec.xLabel, `text-anchor="end" fill="${MUTED}"`));
  if (spec.yLabel) out.push(textEl(fitX(ax + 6, spec.yLabel), box.t - 10, spec.yLabel, `fill="${MUTED}"`));

  for (const v of spec.vlines ?? []) {
    if (v.x < x0 || v.x > x1) continue;
    out.push(`<line x1="${X(v.x)}" y1="${box.b}" x2="${X(v.x)}" y2="${box.t}" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="5 5"/>`);
    if (v.label) out.push(textEl(fitX(X(v.x) + 5, v.label, 12), box.t + 12, v.label, `font-size="12" fill="${MUTED}"`));
  }
  for (const h of spec.hlines ?? []) {
    if (h.y < y0 || h.y > y1) continue;
    out.push(`<line x1="${box.l}" y1="${Y(h.y)}" x2="${box.r}" y2="${Y(h.y)}" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="5 5"/>`);
    if (h.label) out.push(textEl(box.r - h.label.length * 6.6, Y(h.y) - 6, h.label, `font-size="12" fill="${MUTED}"`));
  }

  // Curves: the key one coral, the next blue, any other grey. Breaks where they leave the view.
  let other = 0;
  const colours = fns.map((c) => (c.key ? KEY : other++ === 0 ? SECOND : MUTED));
  const samples = fns.map((c) => xs.map((x) => c.fx(x)));
  fns.forEach((c, k) => {
    let d = "";
    let pen = false;
    xs.forEach((x, i) => {
      const y = samples[k][i];
      const inside = Number.isFinite(y) && y >= y0 - (y1 - y0) * 0.02 && y <= y1 + (y1 - y0) * 0.02;
      if (!inside) return void (pen = false);
      d += `${pen ? "L" : "M"}${X(x).toFixed(1)} ${Y(y).toFixed(1)} `;
      pen = true;
    });
    if (d) out.push(`<path d="${d.trim()}" fill="none" stroke="${colours[k]}" stroke-width="${c.key ? 3.2 : 2.4}"${c.dashed ? ` stroke-dasharray="7 6"` : ""} stroke-linecap="round" stroke-linejoin="round"/>`);
  });
  // Each curve's label where it is farthest from the other curves, just above it.
  fns.forEach((c, k) => {
    if (!c.label) return;
    let best = { i: Math.round(N * 0.7), gap: -1 };
    for (let i = Math.round(N * 0.12); i <= N * 0.88; i += 6) {
      const y = samples[k][i];
      if (!Number.isFinite(y) || y < y0 || y > y1) continue;
      const gap = Math.min(Infinity, ...samples.filter((_, j) => j !== k).map((s) => (Number.isFinite(s[i]) ? Math.abs(Y(s[i]) - Y(y)) : Infinity)));
      if (gap > best.gap) best = { i, gap };
    }
    const y = samples[k][best.i];
    if (!Number.isFinite(y)) return;
    out.push(textEl(fitX(X(xs[best.i]) + 6, c.label), Math.max(14, Y(y) - 9), c.label, `fill="${colours[k]}"`));
  });

  for (const p of spec.points ?? []) {
    const colour = p.key ? KEY : SECOND;
    out.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="5" fill="${colour}"/>`);
    if (p.label) out.push(textEl(fitX(X(p.x) + 9, p.label), Y(p.y) + 4, p.label, `fill="${colour}"`));
  }
  if (spec.arrow) {
    const [ax0, ay0] = spec.arrow.from;
    const [ax1, ay1] = spec.arrow.to;
    out.unshift(`<defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${KEY}"/></marker></defs>`);
    out.push(`<line x1="${X(ax0)}" y1="${Y(ay0)}" x2="${X(ax1)}" y2="${Y(ay1)}" stroke="${KEY}" stroke-width="2.5" marker-end="url(#head)"/>`);
    if (spec.arrow.label) {
      const mx = (X(ax0) + X(ax1)) / 2;
      out.push(textEl(fitX(mx - spec.arrow.label.length * 3.4, spec.arrow.label), Math.min(Y(ay0), Y(ay1)) - 10, spec.arrow.label, `fill="${KEY}"`));
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
}

function barsSvg(spec: PlotSpec): string {
  const bars = spec.bars!;
  const lo = Math.min(0, ...bars.map((b) => b.value));
  const hi = Math.max(0, ...bars.map((b) => b.value));
  const [y0, y1] = spec.y ?? [lo, hi + (hi - lo || 1) * 0.15];
  const Y = (v: number) => box.b - ((v - y0) / (y1 - y0)) * (box.b - box.t);
  const slot = (box.r - box.l) / bars.length;
  const out: string[] = [`<line x1="${box.l}" y1="${Y(0)}" x2="${box.r}" y2="${Y(0)}" stroke="currentColor" stroke-width="2"/>`];
  if (spec.yLabel) out.push(textEl(box.l, box.t - 10, spec.yLabel, `fill="${MUTED}"`));
  bars.forEach((b, i) => {
    const cx = box.l + slot * (i + 0.5);
    const w = Math.min(56, slot * 0.6);
    const top = Math.min(Y(b.value), Y(0));
    const h = Math.abs(Y(b.value) - Y(0));
    out.push(`<rect x="${cx - w / 2}" y="${top}" width="${w}" height="${Math.max(1, h)}" rx="4" fill="${b.key ? KEY : SECOND}" fill-opacity="${b.key ? 1 : 0.75}" stroke="none"/>`);
    out.push(textEl(cx, top - 6, fmt(b.value), `font-size="12" text-anchor="middle" fill="${b.key ? KEY : "currentColor"}"`));
    out.push(textEl(cx, box.b + 18, b.label, `font-size="12" text-anchor="middle"`));
  });
  if (spec.xLabel) out.push(textEl(box.r, H - 2, spec.xLabel, `text-anchor="end" fill="${MUTED}"`));
  return `<svg viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
}

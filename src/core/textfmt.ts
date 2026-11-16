// Turns an Explanation's text into safe HTML: escapes everything, then allows **bold**,
// `code`, (mm:ss) time links, "- " bullet lines, small | tables | and $math$ / $$math$$ through a renderer.
// Unclosed markup (mid-stream) stays plain text.

export type MathRenderer = (tex: string, display: boolean) => string;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

/** How a [[phrase]] looks: "ref" (coral: its Mark is on the frame) or "ref off" (plain: no Mark, or not yet). */
export type RefClass = (phrase: string) => string;
let refClass: RefClass = () => "ref";

function inline(s: string): string {
  return esc(s)
    .replace(/\[\[([^[\]]+?)\]\]/g, (_, p) => `<span class="${refClass(unesc(p))}" data-ref="${p}">${p}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\((\d{1,2}:\d{2}(?::\d{2})?)\)/g, (_, ts) => `(<a class="ts" data-t="${toSeconds(ts)}">${ts}</a>)`);
}

/**
 * Each Mark's phrase becomes a [[ref]], even if the model forgot the brackets: its first
 * whole-word appearance outside math and outside other refs gets them.
 */
export function wrapPhrases(text: string, phrases: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  let out = text;
  for (const raw of phrases) {
    const want = norm(raw.replace(/\[\[|\]\]/g, ""));
    if (!want || [...out.matchAll(/\[\[([^\]]+?)\]\]/g)].some((m) => norm(m[1]) === want)) continue;
    const pattern = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    for (const m of out.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"))) {
      const before = out.slice(0, m.index);
      const inMath = (before.match(/\$/g) || []).length % 2 === 1;
      const inRef = before.lastIndexOf("[[") > before.lastIndexOf("]]");
      if (inMath || inRef) continue;
      out = `${before}[[${m[0]}]]${out.slice(m.index! + m[0].length)}`;
      break;
    }
  }
  return out;
}

/** "[[the gate]]" → "the gate", for places that show plain text (Session card, notes). */
export const stripRefs = (s: string) => s.replace(/\[\[([^\]]+?)\]\]/g, "$1");

export function toSeconds(ts: string): number {
  return ts.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);
}

function line(src: string, math: MathRenderer): string {
  // Split out math first so its contents are never touched by the inline rules.
  const re = /\$\$(.+?)\$\$|\$([^$]+?)\$/g;
  let out = "";
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += inline(src.slice(last, m.index));
    out += m[1] !== undefined ? math(m[1].trim(), true) : math(m[2].trim(), false);
    last = m.index! + m[0].length;
  }
  return out + inline(src.slice(last));
}

/** Markdown table rows → <table>. The first row is the header; the |---| row is skipped. */
function table(rows: string[], math: MathRenderer): string {
  const cells = (r: string) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => line(c.trim(), math));
  const body = rows.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r) || !r.includes("-"));
  if (!body.length) return "";
  const [head, ...rest] = body;
  const tr = (r: string, tag: "th" | "td") => `<tr>${cells(r).map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  return `<table><thead>${tr(head, "th")}</thead><tbody>${rest.map((r) => tr(r, "td")).join("")}</tbody></table>`;
}

export function formatText(src: string, math: MathRenderer, refs: RefClass = () => "ref"): string {
  refClass = refs;
  let html = "";
  let inList = false;
  let rows: string[] = [];
  const flush = () => {
    if (rows.length) html += table(rows, math);
    rows = [];
  };
  for (const raw of src.split(/\n+/)) {
    if (/^\s*\|/.test(raw)) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      rows.push(raw);
      continue;
    }
    flush();
    const isItem = /^\s*[-•*]\s+/.test(raw);
    const body = line(raw.replace(/^\s*[-•*]\s+/, "").trim(), math);
    if (!body) continue;
    if (isItem !== inList) {
      html += isItem ? "<ul>" : "</ul>";
      inList = isItem;
    }
    html += isItem ? `<li>${body}</li>` : `<p>${body}</p>`;
  }
  flush();
  return inList ? html + "</ul>" : html;
}

/** First sentence, for the Session card. */
export function firstSentence(text: string, max = 140): string {
  const plain = stripRefs(text).replace(/\$\$?([^$]+)\$\$?/g, "$1").replace(/[*`]/g, "").trim();
  const m = plain.match(/^[\s\S]*?[.?!](\s|$)/);
  const s = (m ? m[0] : plain).trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * While text types out, never cut inside $math$ or a [[phrase]]: stretch the cut to the
 * closing mark if it has arrived, otherwise stop before the opening one.
 */
export function safeCut(text: string, n: number, done = false): string {
  // The whole answer has arrived and is typed out: show all of it. A lone $ is a dollar sign
  // (a formula would have closed by now), and a [[ that never closed is dropped.
  if (done && n >= text.length) {
    const open = text.lastIndexOf("[[");
    return open > text.lastIndexOf("]]") ? text.slice(0, open) + text.slice(open + 2) : text;
  }
  let cut = text.slice(0, n);
  // Formulas and phrases are short: one still open after this many characters isn't one.
  const LONG = 60;
  const dollars = (cut.match(/\$/g) || []).length;
  if (dollars % 2 === 1 && n - cut.lastIndexOf("$") < LONG) {
    const close = text.indexOf("$", n);
    cut = close >= 0 && close - cut.lastIndexOf("$") < LONG ? text.slice(0, close + 1) : cut.slice(0, cut.lastIndexOf("$"));
  }
  const open = cut.lastIndexOf("[[");
  if (open > cut.lastIndexOf("]]") && n - open < LONG) {
    const close = text.indexOf("]]", open);
    cut = close >= 0 ? text.slice(0, Math.max(cut.length, close + 2)) : cut.slice(0, open);
  }
  return cut;
}

// Safe HTML helpers. YouTube enforces Trusted Types, so plain innerHTML can throw;
// every string we insert has already been escaped (textfmt.ts) or sanitised (sketch.ts).
import katex from "katex";
import { formatText, safeCut, type RefClass } from "../core/textfmt.ts";

let policy: { createHTML: (s: string) => any } | null | undefined;

export function setHTML(el: Element | ShadowRoot, html: string) {
  try {
    el.innerHTML = html;
  } catch {
    if (policy === undefined) {
      try {
        policy = (window as any).trustedTypes?.createPolicy("unstuck", { createHTML: (s: string) => s }) ?? null;
      } catch {
        policy = null;
      }
    }
    if (policy) el.innerHTML = policy.createHTML(html);
  }
}

/** Math as MathML, which Chrome renders natively: no fonts to ship into YouTube's page. */
export const renderMath = (tex: string, display: boolean) =>
  katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: false, strict: "ignore" });

export const explanationHTML = (text: string, refs?: RefClass) => formatText(text, renderMath, refs);

export { safeCut };

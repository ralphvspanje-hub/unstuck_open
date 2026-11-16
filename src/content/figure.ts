// An Explanation's Figure in the chat: an exact plot, an HTML figure, or an older SVG Sketch.
import DOMPurify from "dompurify";
import type { Figure } from "../core/answer.ts";
import { plotSvg } from "../core/plot.ts";
import { setHTML } from "./html.ts";
import { drawSketch } from "./sketch.ts";

export function drawFigure(host: HTMLElement, fig: Figure): Promise<void> {
  if (fig.kind === "plot") return drawSketch(host, plotSvg(fig.spec));
  if (fig.kind === "svg") return drawSketch(host, fig.svg);
  return drawHtmlFigure(host, fig.html);
}

/**
 * The model's HTML, made safe: no scripts, handlers, links, frames, forms or media, and no
 * url() or @import in its CSS, so nothing loads from the internet.
 */
export function cleanFigureHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    FORCE_BODY: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "frame", "object", "embed", "img", "image", "picture", "video", "audio", "source", "a", "form", "input", "button", "select", "textarea", "link", "meta", "base", "foreignObject", "use"],
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset", "action", "formaction", "background", "poster"],
  }) as unknown as string;
  return clean.replace(/@import[^;]*;?/gi, "").replace(/url\s*\([^)]*\)/gi, "none");
}

/** In its own shadow root, so its <style> can't touch the panel. Scaled down if it's too wide. */
function drawHtmlFigure(host: HTMLElement, html: string): Promise<void> {
  const holder = document.createElement("div");
  holder.className = "figure-html";
  host.replaceChildren(holder);
  const root = holder.attachShadow({ mode: "open" });
  setHTML(root, `<style>:host{display:block;color:#f4f4f5;font:13px/1.4 system-ui,sans-serif}*{box-sizing:border-box}svg{overflow:visible}</style>${cleanFigureHtml(html)}`);
  const fig = [...root.children].find((c) => c.tagName !== "STYLE") as HTMLElement | undefined;
  if (!fig) return Promise.resolve();
  const wide = fig.scrollWidth;
  if (wide > holder.clientWidth + 2) (holder.style as any).zoom = String(holder.clientWidth / wide);
  return reveal(fig);
}

/** Blocks fade in one after another and lines draw themselves, like the Sketches did. */
function reveal(fig: HTMLElement): Promise<void> {
  const done: Promise<unknown>[] = [];
  let at = 0;
  const blocks = fig.children.length > 1 ? [...fig.children] : [...(fig.firstElementChild?.children ?? [fig])];
  for (const b of blocks as HTMLElement[]) {
    done.push(b.animate([{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: at, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }).finished);
    for (const g of b.querySelectorAll<SVGGeometryElement>("path, line, polyline, polygon, circle, ellipse, rect")) {
      if (g.closest("defs, marker")) continue;
      let len = 0;
      try {
        len = g.getTotalLength();
      } catch {}
      if (!len || (g.getAttribute("fill") ?? "none") !== "none") continue;
      g.style.strokeDasharray = `${len}`;
      done.push(g.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: Math.min(600, 160 + len), delay: at + 120, easing: "cubic-bezier(.45,.05,.3,1)", fill: "backwards" }).finished.then(() => (g.style.strokeDasharray = "")));
    }
    at += 160;
  }
  return Promise.all(done).then(() => {}, () => {});
}

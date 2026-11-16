// "▶ Play with it": the model writes one self-contained HTML page; these helpers clean it up
// and add a guard that reports crashes back, so a broken simulation can be retried once.

/**
 * The HTML document out of the model's answer: without a code fence or chat around it. A page
 * missing only its closing tags is kept, since browsers finish it themselves.
 */
export function cleanSimHtml(raw: string): string | null {
  const s = raw.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```[\s\S]{0,200}$/, "");
  const start = s.search(/<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<script[\s>]|<canvas[\s>]/i);
  if (start < 0) return null;
  const end = s.toLowerCase().lastIndexOf("</html>");
  const page = end > start ? s.slice(start, end + 7) : s.slice(start).trimEnd();
  return /<script[\s>]|<canvas[\s>]|<svg[\s>]/i.test(page) ? page : null;
}

/** Runs first in the simulation: reports errors, a blank page, or that it's running. */
export const SIM_GUARD = `<script>(function(){var sent=false;function send(d){parent.postMessage(Object.assign({unstuckSim:true},d),"*")}
function fail(m){if(sent)return;sent=true;send({state:"error",message:String(m).slice(0,500)})}
addEventListener("error",function(e){fail((e.message||"error")+(e.lineno?" (line "+e.lineno+")":""))});
addEventListener("unhandledrejection",function(e){var r=e.reason;fail("unhandled promise rejection: "+(r&&r.message||r))});
addEventListener("load",function(){setTimeout(function(){if(sent)return;var b=document.body;
if(!b||(!document.querySelector("canvas,svg")&&b.innerText.trim().length<20)){fail("the page shows nothing");return}
send({state:"running"})},700)});
addEventListener("keydown",function(e){if(e.key==="Escape")send({state:"escape"})});
window.alert=window.confirm=window.prompt=function(){};})();</script>`;

/** three.js from the extension itself (dist/three.js), for pages that use THREE. */
export const THREE_TAG = `<script src="three.js"></script>`;

/**
 * The guard goes in first thing in <head>, so it sees errors in every later script; three.js
 * right after it when the page uses THREE. A page's own <script src> for three is dropped: it
 * would point at a CDN the sandbox can't reach.
 */
export function withGuard(html: string): string {
  const uses3d = /\bTHREE\./.test(html);
  const page = uses3d ? html.replace(/<script[^>]*\bsrc=["'][^"']*three[^"']*["'][^>]*>\s*<\/script>/gi, "") : html;
  const first = SIM_GUARD + (uses3d ? THREE_TAG : "");
  const head = page.match(/<head[^>]*>/i);
  if (head) return page.replace(head[0], head[0] + first);
  const doc = page.match(/<html[^>]*>/i);
  if (doc) return page.replace(doc[0], `${doc[0]}<head>${first}</head>`);
  return first + page;
}

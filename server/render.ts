// Renders an HTML figure exactly as wide as the chat panel shows it, so the model can look at
// its own figure (src/ai/figures.ts). Headless Chromium from Playwright (already here for the
// smoke test), started on first use and kept. Scripts are off and every request is blocked.
import { chromium, type Browser } from "playwright";
import { log } from "./log.ts";

let browser: Promise<Browser> | null = null;

export async function renderFigure(html: string): Promise<string | null> {
  try {
    browser ??= chromium.launch();
    const b = await browser;
    const ctx = await b.newContext({ viewport: { width: 440, height: 400 }, deviceScaleFactor: 2, javaScriptEnabled: false });
    try {
      await ctx.route("**/*", (r) => r.abort());
      const page = await ctx.newPage();
      await page.setContent(
        `<style>body{margin:0;background:#16181d;color:#f4f4f5;font:13px/1.4 system-ui,sans-serif}#box{width:404px;padding:0}*{box-sizing:border-box}svg{overflow:visible}</style><div id="box">${html}</div>`,
      );
      return (await page.locator("#box").screenshot({ timeout: 4000 })).toString("base64");
    } finally {
      await ctx.close();
    }
  } catch (e) {
    log(`render failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    browser = null;
    return null;
  }
}

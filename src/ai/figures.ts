// The check on HTML figures: an Explanation streams through untouched, except its <figure>
// section, which is held back, rendered, shown to the model, and sent on as it is ("OK") or
// as the model's fix. The text keeps streaming first, so the Viewer reads while this runs.
import { log } from "./log.ts";

export type FigureCheck = (html: string, explanation: string) => Promise<string>;

export async function* checkedFigures(gen: AsyncIterable<string>, check: FigureCheck): AsyncIterable<string> {
  let buf = "";
  let all = "";
  let holding = false;
  const fix = async (section: string) => {
    const body = section.replace(/^<figure>/, "").replace(/<\/figure>$/, "");
    if (!/<div|<style/i.test(body) || body.trim().startsWith("{")) return section; // plots and empties need no check
    const explanation = all.match(/<text>([\s\S]*?)<\/text>/)?.[1]?.trim() ?? "";
    try {
      return `<figure>${await check(body.trim(), explanation)}</figure>`;
    } catch (e) {
      log(`figure check skipped: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      return section;
    }
  };
  for await (const chunk of gen) {
    buf += chunk;
    all += chunk;
    while (true) {
      if (!holding) {
        const i = buf.indexOf("<figure>");
        if (i < 0) {
          // Keep a tail back in case "<figure>" is split across chunks.
          const safe = buf.length - 8;
          if (safe > 0) {
            yield buf.slice(0, safe);
            buf = buf.slice(safe);
          }
          break;
        }
        if (i > 0) yield buf.slice(0, i);
        buf = buf.slice(i);
        holding = true;
      }
      const j = buf.indexOf("</figure>");
      if (j < 0) break;
      yield await fix(buf.slice(0, j + 9));
      buf = buf.slice(j + 9);
      holding = false;
    }
  }
  if (buf) yield buf; // an unfinished figure goes out as it is
}

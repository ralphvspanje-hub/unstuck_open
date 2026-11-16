// Unstuck's local server. Holds the Gemini key, listens on 127.0.0.1 only, and answers
// only this extension (src/core/guard.ts). Without GEMINI_API_KEY it runs in mock mode.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { checkRequest, extensionIdFromKey } from "../src/core/guard.ts";
import * as gemini from "../src/ai/gemini.ts";
import { checkedFigures } from "../src/ai/figures.ts";
import { setLog } from "../src/ai/log.ts";
import * as mock from "./mock.ts";
import { renderFigure } from "./render.ts";
import { log } from "./log.ts";

const PORT = Number(process.env.UNSTUCK_PORT || 4717);
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const EXTENSION_ID = extensionIdFromKey(manifest.key);
setLog(log); // the model code's notes go to the terminal and .logs/server.log
const ai = process.env.UNSTUCK_MOCK === "1" ? null : gemini.createClient(process.env.GEMINI_API_KEY);
const MOCK = !ai;
const MAX_BODY = 8 * 1024 * 1024;

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function stream(res: ServerResponse, gen: AsyncIterable<string>) {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  try {
    for await (const piece of gen) res.write(piece);
  } catch (err: any) {
    if (err?.name !== "AbortError") res.write(`\n<error>${String(err?.message || err).slice(0, 300)}</error>`);
  }
  res.end();
}

const server = createServer(async (req, res) => {
  const t0 = performance.now();
  const path = (req.url || "/").split("?")[0];
  const denied = checkRequest(
    { method: req.method || "GET", host: req.headers.host, origin: req.headers.origin, marker: req.headers["x-unstuck"] as string | undefined },
    { port: PORT, extensionId: EXTENSION_ID },
  );
  if (denied) {
    console.warn(`✋ ${req.method} ${path} refused: ${denied} (origin: ${req.headers.origin ?? "none"}, host: ${req.headers.host})`);
    res.writeHead(403).end();
    return;
  }
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    if (req.method === "POST" && path === "/health") {
      sendJson(res, 200, { ok: true, mock: MOCK, flash: gemini.FLASH, decision: gemini.DECISION });
    } else if (req.method === "POST" && path === "/judge") {
      const body = await readJson(req);
      sendJson(res, 200, MOCK ? await mock.judge(body) : await gemini.judge(ai!, body));
    } else if (req.method === "POST" && path === "/map") {
      const body = await readJson(req);
      sendJson(res, 200, MOCK ? await mock.videoMap(body) : await gemini.videoMap(ai!, body));
    } else if (req.method === "POST" && path === "/locate") {
      const body = await readJson(req);
      sendJson(res, 200, MOCK ? await mock.locate(body) : await gemini.locate(ai!, body));
    } else if (req.method === "POST" && path === "/explain") {
      const body = await readJson(req);
      if (body.audio?.length) log(`/explain with lecture sound: ${body.audio.length} piece(s), ${Math.round(body.audio.reduce((n: number, a: any) => n + a.b64.length * 0.75, 0) / 1024)} KB, ${Math.round(body.audioSec ?? 0)} s`);
      if (body.outline) log(`/explain with an outline of ${String(body.outline).split("\n").length} line(s)`);
      await stream(
        res,
        MOCK
          ? mock.explain(body, abort.signal)
          : checkedFigures(gemini.explain(ai!, body, abort.signal), async (html, explanation) => {
              const shot = await renderFigure(html);
              return shot ? gemini.checkHtmlFigure(ai!, { title: body.title, explanation, html, renderB64: shot }) : html;
            }),
      );
    } else if (req.method === "POST" && path === "/sim") {
      const body = await readJson(req);
      await stream(res, MOCK ? mock.sim(body, abort.signal) : gemini.sim(ai!, body, abort.signal));
    } else if (req.method === "POST" && (path === "/figure" || path === "/figure-check")) {
      const body = await readJson(req);
      if (MOCK) sendJson(res, 501, { error: "no figures in mock mode" });
      else sendJson(res, 200, path === "/figure" ? await gemini.figure(ai!, body) : await gemini.checkFigure(ai!, body));
    } else if (req.method === "POST" && path === "/recap") {
      const body = await readJson(req);
      await stream(res, MOCK ? mock.recap(body, abort.signal) : gemini.recap(ai!, body, abort.signal));
    } else {
      sendJson(res, 404, { error: "not found" });
    }
  } catch (err: any) {
    log(`💥 ${path}: ${String(err?.message || err).slice(0, 300)}`);
    if (!res.headersSent) sendJson(res, 500, { error: String(err?.message || err).slice(0, 300) });
    else res.end();
  }
  if (path !== "/health") log(`${path} ${Math.round(performance.now() - t0)} ms`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`🪢 Unstuck server on http://127.0.0.1:${PORT} (${MOCK ? "MOCK mode, no Gemini calls" : `Gemini: ${gemini.FLASH} + ${gemini.DECISION}`})`);
  console.log(`   accepting only chrome-extension://${EXTENSION_ID}`);
});

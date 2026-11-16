// The real model calls, shared by the local server (key from its environment, GEMINI_API_KEY)
// and the extension itself (the Viewer's own key, see src/background/keystore.ts).
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { log } from "./log.ts";
import { cleanBox } from "../core/answer.ts";
import type { Box, ExplainRequest, JudgeRequest, LocateRequest, LocateResponse, MapRequest, RecapRequest, SimRequest, VideoMap } from "../core/types.ts";
import {
  EXPLAIN_SYSTEM,
  JUDGE_QUESTION,
  LOCATE_SCHEMA,
  LOCATE_SYSTEM,
  MAP_SCHEMA,
  MAP_SYSTEM,
  CHECK_SYSTEM,
  FIGURE_SYSTEM,
  RECAP_SYSTEM,
  SIM_SYSTEM,
  figurePrompt,
  explainPrompt,
  judgeContext,
  locatePrompt,
  mapPrompt,
  recapPrompt,
  simPrompt,
} from "./prompts.ts";

/** Model overrides come from the server's environment; the extension has none and uses the defaults. */
const env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {};

export const FLASH = env.UNSTUCK_FLASH_MODEL || "gemini-flash-latest";
export const DECISION = env.UNSTUCK_DECISION_MODEL || "gemini-decision-1";
/** Used when FLASH keeps answering "busy" (503/429), which happens on launch days. */
export const FLASH_FALLBACK = env.UNSTUCK_FLASH_FALLBACK || "gemini-flash-lite-latest";
/**
 * Builds the Simulations ("Play with it"): stronger than Flash-Lite, and free on a free-tier key,
 * within a daily quota. The Viewer waits for a Simulation anyway, so a slower, better model is worth it
 * there. When it fails or its quota is used up, the usual models build it. Set to "" to switch it off.
 */
export const VISUAL = env.UNSTUCK_VISUAL_MODEL ?? "gemini-4-hydrogen";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isBusy = (e: any) =>
  [429, 500, 503].includes(e?.status) || /\b(429|500|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|no answer within/i.test(String(e?.message ?? e));

/** A busy model answers 503 only after 10-40 s, so after one refusal skip it for a while. */
const SKIP_BUSY_MS = 120_000;
let flashBusyUntil = 0;
let visualOffUntil = 0;

/**
 * Main Flash model once (unless it was busy recently), then the fallback twice. Other errors fail at once.
 * `prefer`: a model to try before all of those; any failure of it (busy, quota, unknown model) moves on
 * to the usual plan, unless the Viewer cancelled.
 */
async function withRetry<T>(fn: (model: string) => Promise<T>, prefer?: { model: string; cancelled: () => boolean }): Promise<T> {
  if (prefer?.model && Date.now() >= visualOffUntil) {
    try {
      return await fn(prefer.model);
    } catch (e) {
      if (prefer.cancelled()) throw e;
      // Busy: try again soon. Quota used up, or anything else: leave it for half an hour.
      const busy = [500, 503].includes((e as any)?.status) || /\b(500|503)\b|UNAVAILABLE|high demand|overloaded|no answer within/i.test(String((e as any)?.message ?? e));
      visualOffUntil = Date.now() + (busy ? SKIP_BUSY_MS : 30 * 60_000);
      log(`⏳ ${prefer.model} didn't build it (${String((e as any)?.status ?? (e as any)?.message ?? "").slice(0, 80)}), using the usual models${busy ? "" : " for 30 min"}`);
    }
  }
  const plan: [string, number][] = [
    ...(Date.now() < flashBusyUntil ? [] : [[FLASH, 0] as [string, number]]),
    [FLASH_FALLBACK, 0],
    [FLASH_FALLBACK, 1500],
  ];
  let last: unknown;
  for (const [model, wait] of plan) {
    if (wait) await sleep(wait);
    try {
      return await fn(model);
    } catch (e) {
      last = e;
      if (!isBusy(e)) throw e;
      if (model === FLASH) flashBusyUntil = Date.now() + SKIP_BUSY_MS;
      log(`⏳ ${model} is busy (${String((e as any)?.status ?? (e as any)?.message ?? "").slice(0, 60)}), trying the next`);
    }
  }
  throw last;
}

/** How long a model may take to start writing before we move on to the next one. */
const FIRST_TEXT_MS = Number(env.UNSTUCK_FIRST_TEXT_MS || 8000);

export function createClient(apiKey: string | undefined): GoogleGenAI | null {
  return apiKey ? new GoogleGenAI({ apiKey, apiVersion: "v1beta" }) : null;
}

const frameParts = (b64?: string, mimeType = "image/jpeg") => (b64 ? [{ inlineData: { mimeType, data: b64 } }] : []);

export async function judge(ai: GoogleGenAI, r: JudgeRequest): Promise<{ score: number; latencyMs: number }> {
  const input: any[] = [{ type: "text", text: judgeContext(r) }];
  if (r.frameB64) input.push({ type: "image", data: r.frameB64, mime_type: "image/jpeg" });
  const t0 = performance.now();
  const res: any = await (ai as any).decisions.create({ model: DECISION, input, questions: { viewer_stuck: JUDGE_QUESTION } });
  const p = res?.answers?.viewer_stuck?.noul;
  const latencyMs = Math.round(performance.now() - t0);
  log(`judge ${DECISION}: ${typeof p === "number" ? p.toFixed(2) : "no answer"} in ${latencyMs} ms`);
  return { score: typeof p === "number" ? p : 0, latencyMs };
}

export async function videoMap(ai: GoogleGenAI, r: MapRequest): Promise<VideoMap> {
  const res = await withRetry((model) => ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: mapPrompt(r) }] }],
    config: { systemInstruction: MAP_SYSTEM, responseMimeType: "application/json", responseSchema: MAP_SCHEMA as any, temperature: 0.2 },
  }));
  const u: any = res.usageMetadata ?? {};
  log(`map ${res.modelVersion ?? "?"}: thinking ${u.thoughtsTokenCount ?? 0} tok, output ${u.candidatesTokenCount ?? 0} tok`);
  return cleanMap(JSON.parse(res.text ?? "{}"), r.durationSec);
}

export async function locate(ai: GoogleGenAI, r: LocateRequest): Promise<LocateResponse> {
  const things = r.things.slice(0, 4);
  const t0 = performance.now();
  const res = await withRetry((model) => ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: locatePrompt(things, r.zoomed) }, ...frameParts(r.frameB64)] }],
    config: { systemInstruction: LOCATE_SYSTEM, responseMimeType: "application/json", responseSchema: LOCATE_SCHEMA as any, temperature: 0 },
  }));
  const boxes: Record<string, Box | null> = Object.fromEntries(things.map((t) => [t, null]));
  for (const it of JSON.parse(res.text ?? "{}")?.items ?? []) {
    const thing = things[it?.i];
    if (thing && it.found) boxes[thing] = cleanBox(it.box_2d) ?? null;
  }
  const found = Object.values(boxes).filter(Boolean).length;
  log(`locate${r.zoomed ? " (zoomed)" : ""} ${res.modelVersion ?? "?"}: ${found} of ${things.length} found in ${Math.round(performance.now() - t0)} ms (${things.map((t) => `"${t.slice(0, 50)}" ${boxes[t] ? "✓" : "✗"}`).join(", ")})`);
  return { boxes };
}

export function cleanMap(raw: any, duration: number): VideoMap {
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(duration || Infinity, n)) : 0);
  return {
    topic: String(raw?.topic ?? "").slice(0, 300),
    keyTerms: (Array.isArray(raw?.keyTerms) ? raw.keyTerms : [])
      .slice(0, 15)
      .map((k: any) => ({ term: String(k.term ?? "").slice(0, 60), t: num(k.t), gist: String(k.gist ?? "").slice(0, 160) }))
      .filter((k: any) => k.term),
    denseParts: (Array.isArray(raw?.denseParts) ? raw.denseParts : [])
      .map((d: any) => ({ start: num(d.start), end: num(d.end), why: String(d.why ?? "").slice(0, 100) }))
      .filter((d: any) => d.end > d.start),
  };
}

/** `thinking`: let the model think first (slower to start, better at open questions). */
/** `parts`: more input after the text and the frame (the sound of a lecture). */
type StreamOpts = { what?: string; firstTextMs?: number; maxTokens?: number; temperature?: number; thinking?: ThinkingLevel; prefer?: string; parts?: any[] };

async function* streamText(ai: GoogleGenAI, system: string, text: string, frameB64: string | undefined, signal: AbortSignal, opts: StreamOpts = {}) {
  const { what = "explain", firstTextMs = FIRST_TEXT_MS, maxTokens = 6000, temperature = 0.6, thinking, prefer, parts = [] } = opts;
  const t0 = performance.now();
  let first = 0;
  let last: any = null;
  let used = "";
  // Each try gets its own abort: we cancel a try that hasn't started writing within FIRST_TEXT_MS.
  const start = async (model: string) => {
    const ctrl = new AbortController();
    const relay = () => ctrl.abort();
    signal.addEventListener("abort", relay, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, firstTextMs);
    try {
      const ask = (think: boolean) =>
        ai.models.generateContentStream({
          model,
          contents: [{ role: "user", parts: [{ text }, ...frameParts(frameB64), ...parts] }],
          config: { systemInstruction: system, temperature, maxOutputTokens: maxTokens, abortSignal: ctrl.signal, ...(think && thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}) },
        });
      // A model that doesn't take this thinking level answers without thinking rather than not at all.
      const stream = await ask(true).catch((e) => {
        if (!thinking || ctrl.signal.aborted || !/think/i.test(String(e?.message ?? e))) throw e;
        log(`${model} won't think at ${thinking}, answering without`);
        return ask(false);
      });
      const it = stream[Symbol.asyncIterator]();
      const head = await it.next();
      used = model;
      return { it, head };
    } catch (e) {
      if (timedOut && !signal.aborted) throw new Error(`${model} gave no answer within ${firstTextMs / 1000} s`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const { it, head } = await withRetry(start, prefer ? { model: prefer, cancelled: () => signal.aborted } : undefined);
    for (let r = head; !r.done; r = await it.next()) {
      last = r.value;
      if (r.value.text) {
        first ||= performance.now();
        yield r.value.text;
      }
    }
  } finally {
    const u: any = last?.usageMetadata ?? {};
    const s = (ms: number) => (ms / 1000).toFixed(1);
    log(`${what} ${last?.modelVersion ?? used ?? "?"}: first text ${first ? s(first - t0) : "-"} s, total ${s(performance.now() - t0)} s, thinking ${u.thoughtsTokenCount ?? 0} tok, output ${u.candidatesTokenCount ?? 0} tok${signal.aborted ? " (cancelled)" : ""}`);
  }
}

/**
 * The first answer has to be quick (no thinking, the first word in ~1-2 s). A follow-up question
 * is more open and the Viewer is waiting for it anyway, so the model thinks a little first.
 */
export const explain = (ai: GoogleGenAI, r: ExplainRequest, signal: AbortSignal) =>
  streamText(
    ai,
    EXPLAIN_SYSTEM,
    explainPrompt(r),
    r.frameB64,
    signal,
    {
      ...(r.mode === "followup" || (r.mode === "explain" && r.think)
        ? { what: r.mode === "followup" ? "follow-up" : "explain (thinking)", thinking: ThinkingLevel.LOW, firstTextMs: 20_000 }
        : {}),
      // A lecture's sound: a few minutes take a little longer to read (Flash-Lite starts in ~3 s on a minute).
      ...(r.audio?.length ? { parts: r.audio.map((a) => ({ inlineData: { mimeType: a.mime, data: a.b64 } })), firstTextMs: 10_000 } : {}),
    },
  );

export const recap = (ai: GoogleGenAI, r: RecapRequest, signal: AbortSignal) =>
  streamText(ai, RECAP_SYSTEM, recapPrompt(r), undefined, signal, {
    what: "recap",
    ...(r.audio?.length ? { parts: r.audio.map((a) => ({ inlineData: { mimeType: a.mime, data: a.b64 } })), firstTextMs: 10_000 } : {}),
  });

/**
 * Writing a whole page takes a while to start (more thinking), so it gets a longer first-text wait.
 * Built by the VISUAL model, which thinks a little first: a working page matters more than a quick one.
 */
export const sim = (ai: GoogleGenAI, r: SimRequest, signal: AbortSignal) =>
  streamText(ai, SIM_SYSTEM, simPrompt(r), r.frameB64, signal, {
    what: r.failed ? "sim (retry)" : "sim",
    firstTextMs: 25_000,
    maxTokens: 16_000,
    temperature: 0.4,
    thinking: ThinkingLevel.LOW,
    prefer: VISUAL,
  });

const pickFigure = (text: string, format: "svg" | "html") => {
  const t = text.replace(/^\s*```(?:svg|html|xml)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (format === "svg") {
    const a = t.indexOf("<svg");
    const b = t.lastIndexOf("</svg>");
    return a >= 0 && b > a ? t.slice(a, b + 6) : "";
  }
  const a = t.search(/<div|<style/i);
  return a >= 0 ? t.slice(a) : "";
};

/** A figure drawn once (no look at the result). */
export async function figure(ai: GoogleGenAI, r: { format: "svg" | "html"; title: string; explanation: string }) {
  const t0 = performance.now();
  const res = await withRetry((model) => ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: figurePrompt(r) }] }],
    config: { systemInstruction: FIGURE_SYSTEM(r.format), temperature: 0.5, maxOutputTokens: 8000 },
  }));
  const ms = Math.round(performance.now() - t0);
  log(`figure ${r.format} ${res.modelVersion ?? "?"}: ${ms} ms`);
  return { code: pickFigure(res.text ?? "", r.format), model: res.modelVersion, ms };
}

/** The check: the model sees its figure rendered, and says OK or returns a fixed one. */
export async function checkFigure(ai: GoogleGenAI, r: { format: "svg" | "html"; title: string; explanation: string; code: string; renderB64: string }, fast = false) {
  const t0 = performance.now();
  // fast: straight to the quick model (no waiting on a busy one), for checks inside an Explanation.
  const run = (fn: (model: string) => Promise<any>) => (fast ? fn(FLASH_FALLBACK) : withRetry(fn));
  const res = await run((model) => ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: `${figurePrompt(r)}\n\nYour figure's code:\n${r.code}\n\nThe attached image is that figure, rendered.` }, ...frameParts(r.renderB64, "image/png")] }],
    config: { systemInstruction: CHECK_SYSTEM(r.format), temperature: 0.3, maxOutputTokens: 8000 },
  }));
  const ms = Math.round(performance.now() - t0);
  const text = (res.text ?? "").trim();
  const ok = /^ok\.?$/i.test(text);
  log(`figure check ${r.format} ${res.modelVersion ?? "?"}: ${ok ? "OK" : "revised"} in ${ms} ms`);
  return { ok, code: ok ? r.code : pickFigure(text, r.format) || r.code, ms };
}

/** Look at a rendered HTML figure; returns it unchanged if the model says OK, otherwise its fix. */
export async function checkHtmlFigure(ai: GoogleGenAI, r: { title: string; explanation: string; html: string; renderB64: string }): Promise<string> {
  // A check that comes late is worse than none: after CHECK_MS the figure goes out as drawn.
  const late = new Promise<null>((ok) => setTimeout(() => ok(null), CHECK_MS));
  const res = await Promise.race([checkFigure(ai, { format: "html", title: r.title, explanation: r.explanation, code: r.html, renderB64: r.renderB64 }, true), late]);
  if (!res) log(`figure check took over ${CHECK_MS / 1000} s: sent unchecked`);
  return res?.code ?? r.html;
}
const CHECK_MS = 7000;

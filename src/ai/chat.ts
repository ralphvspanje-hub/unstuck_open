// Model calls for providers other than Gemini: any OpenAI-compatible chat API (OpenAI, Mistral, xAI,
// OpenRouter, Ollama, LM Studio...) and Anthropic's Messages API (ADR 0009). The same prompts as
// gemini.ts. What changes: the judge is a prompt that asks for a score (there is no Decision 1), JSON
// comes back as text and is read leniently, a lecture's sound isn't sent, and the model doesn't
// think unless it always does.
import { log } from "./log.ts";
import { cleanBox } from "../core/answer.ts";
import { cleanMap, pickFigure } from "./gemini.ts";
import type { Box, ExplainRequest, JudgeRequest, LocateRequest, LocateResponse, MapRequest, RecapRequest, SimRequest, VideoMap } from "../core/types.ts";
import {
  CHECK_SYSTEM,
  EXPLAIN_SYSTEM,
  FIGURE_SYSTEM,
  JUDGE_QUESTION,
  LOCATE_SYSTEM,
  MAP_SYSTEM,
  RECAP_SYSTEM,
  SIM_SYSTEM,
  explainPrompt,
  figurePrompt,
  judgeContext,
  locatePrompt,
  mapPrompt,
  recapPrompt,
  simPrompt,
} from "./prompts.ts";

/** Which wire format: OpenAI's chat completions (most providers) or Anthropic's messages. */
export type ChatApi = "openai" | "anthropic";
export type ChatConfig = {
  api: ChatApi;
  /** e.g. https://api.openai.com/v1, https://api.anthropic.com, http://localhost:11434/v1 */
  baseUrl: string;
  /** Left out for local models that need none. */
  key?: string;
  /** Answers, Recaps, the judge, the Video map, Marks and figures. */
  model: string;
  /** Simulations, when a different (stronger) model should build them; else `model`. */
  simModel?: string;
};

export type Part = { text: string } | { image: string; mime?: string };
type Opts = { maxTokens: number; temperature?: number; json?: boolean; stream?: boolean };
/** Parameters a model turned down once, so later calls leave them out from the start. */
type Compat = { noTemperature?: boolean; maxCompletion?: boolean; noJsonMode?: boolean };
const compatOf = new Map<string, Compat>();

const trimSlash = (u: string) => u.trim().replace(/\/+$/, "");

export function endpoint(cfg: Pick<ChatConfig, "api" | "baseUrl">, what: "chat" | "models"): string {
  const base = trimSlash(cfg.baseUrl);
  if (cfg.api === "anthropic") {
    const v1 = /\/v1$/.test(base) ? base : `${base}/v1`;
    return what === "chat" ? `${v1}/messages` : `${v1}/models`;
  }
  return what === "chat" ? `${base}/chat/completions` : `${base}/models`;
}

export function headers(cfg: Pick<ChatConfig, "api" | "key">): Record<string, string> {
  if (cfg.api === "anthropic") {
    return {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      // Anthropic only answers a browser with this header; the key is the Viewer's own.
      "anthropic-dangerous-direct-browser-access": "true",
      ...(cfg.key ? { "x-api-key": cfg.key } : {}),
    };
  }
  return { "Content-Type": "application/json", ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) };
}

/** The request body for one call. Pure, so the tests can check both formats. */
export function requestBody(api: ChatApi, model: string, system: string, parts: Part[], o: Opts, c: Compat = {}): Record<string, unknown> {
  const temperature = o.temperature !== undefined && !c.noTemperature ? { temperature: o.temperature } : {};
  if (api === "anthropic") {
    const content = parts.map((p) =>
      "text" in p ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mime ?? "image/jpeg", data: p.image } },
    );
    return { model, system, max_tokens: o.maxTokens, ...temperature, ...(o.stream ? { stream: true } : {}), messages: [{ role: "user", content }] };
  }
  // Text only goes as a plain string: some OpenAI-compatible servers take nothing else.
  const onlyText = parts.every((p) => "text" in p);
  const content = onlyText
    ? parts.map((p) => (p as { text: string }).text).join("\n\n")
    : parts.map((p) => ("text" in p ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mime ?? "image/jpeg"};base64,${p.image}` } }));
  return {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    [c.maxCompletion ? "max_completion_tokens" : "max_tokens"]: o.maxTokens,
    ...temperature,
    ...(o.json && !c.noJsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(o.stream ? { stream: true } : {}),
  };
}

/** What to leave out after a 400 that names a parameter (e.g. reasoning models take no temperature). */
export function adjustFor(message: string, c: Compat): Compat | null {
  if (!c.noTemperature && /temperature/i.test(message)) return { ...c, noTemperature: true };
  if (!c.maxCompletion && /max_tokens|max_completion_tokens/i.test(message)) return { ...c, maxCompletion: true };
  if (!c.noJsonMode && /response_format|json_object|json mode/i.test(message)) return { ...c, noJsonMode: true };
  return null;
}

class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function errorOf(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = j?.error?.message ?? j?.message ?? text;
  } catch {}
  return new ApiError(`${res.status} ${String(msg).slice(0, 300)}`, res.status);
}

/** POST one call, leaving out parameters the model turns down (at most three tries). */
async function post(cfg: ChatConfig, model: string, system: string, parts: Part[], o: Opts, signal?: AbortSignal): Promise<Response> {
  let c = compatOf.get(`${cfg.baseUrl}|${model}`) ?? {};
  for (let i = 0; ; i++) {
    const res = await fetch(endpoint(cfg, "chat"), { method: "POST", headers: headers(cfg), body: JSON.stringify(requestBody(cfg.api, model, system, parts, o, c)), signal });
    if (res.ok) return res;
    const err = await errorOf(res);
    const next = res.status === 400 && i < 3 ? adjustFor(err.message, c) : null;
    if (!next) throw err;
    c = next;
    compatOf.set(`${cfg.baseUrl}|${model}`, c);
  }
}

async function generate(cfg: ChatConfig, system: string, parts: Part[], o: Omit<Opts, "stream">, model = cfg.model): Promise<string> {
  const res = await post(cfg, model, system, parts, o);
  const j: any = await res.json();
  if (cfg.api === "anthropic") return (j?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  const m = j?.choices?.[0]?.message?.content;
  return typeof m === "string" ? m : Array.isArray(m) ? m.map((p: any) => p?.text ?? "").join("") : "";
}

/** Splits a server-sent-events buffer into its data lines and what is left for the next chunk. */
export function takeEvents(buffer: string): { data: string[]; rest: string } {
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? "";
  const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  return { data, rest };
}

/** The text in one streamed event, in either format. Throws on an error event. */
export function deltaText(api: ChatApi, ev: any): string {
  if (api === "anthropic") {
    if (ev?.type === "error") throw new Error(ev?.error?.message ?? "the model stopped with an error");
    return ev?.type === "content_block_delta" && ev?.delta?.type === "text_delta" ? String(ev.delta.text ?? "") : "";
  }
  if (ev?.error) throw new Error(ev.error.message ?? "the model stopped with an error");
  const d = ev?.choices?.[0]?.delta?.content;
  return typeof d === "string" ? d : "";
}

/** Reads JSON out of a model's text: fenced or not, with words around it or not. */
export function extractJson(text: string): any {
  const t = text.replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** The judge's score from its reply, 0-1. */
export function scoreOf(text: string): number {
  const j = extractJson(text);
  const n = typeof j?.score === "number" ? j.score : Number(text.match(/(?:^|[^\d.])(0(?:\.\d+)?|1(?:\.0+)?)(?!\d|\.\d)/)?.[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const FIRST_TEXT_MS = 20_000;

/** A streamed answer. Gives up on a model that writes nothing within `firstTextMs`; `models` are tried in turn. */
async function* streamText(cfg: ChatConfig, system: string, parts: Part[], signal: AbortSignal, o: { what: string; maxTokens?: number; temperature?: number; firstTextMs?: number; models?: string[] }) {
  const models = [...new Set(o.models ?? [cfg.model])];
  const t0 = performance.now();
  let first = 0;
  let used = "";
  let out = 0;
  try {
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let head = "";
    for (const [i, model] of models.entries()) {
      const ctrl = new AbortController();
      const relay = () => ctrl.abort();
      signal.addEventListener("abort", relay, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => ((timedOut = true), ctrl.abort()), o.firstTextMs ?? FIRST_TEXT_MS);
      try {
        const res = await post(cfg, model, system, parts, { maxTokens: o.maxTokens ?? 6000, temperature: o.temperature ?? 0.6, stream: true }, ctrl.signal);
        reader = res.body!.getReader();
        // Wait for the first words before settling on this model.
        head = await firstText(cfg.api, reader, () => timedOut);
        used = model;
        break;
      } catch (e) {
        if (signal.aborted || i === models.length - 1) throw timedOut ? new Error(`${model} gave no answer within ${(o.firstTextMs ?? FIRST_TEXT_MS) / 1000} s`) : e;
        log(`⏳ ${model} didn't answer (${String((e as any)?.message ?? e).slice(0, 80)}), trying ${models[i + 1]}`);
      } finally {
        clearTimeout(timer);
      }
    }
    first = performance.now();
    out += head.length;
    yield head;
    for await (const piece of rest(cfg.api, reader!)) {
      out += piece.length;
      yield piece;
    }
  } finally {
    const s = (ms: number) => (ms / 1000).toFixed(1);
    log(`${o.what} ${used || "?"}: first text ${first ? s(first - t0) : "-"} s, total ${s(performance.now() - t0)} s, ${out} chars${signal.aborted ? " (cancelled)" : ""}`);
  }
}

const decoders = new WeakMap<ReadableStreamDefaultReader<Uint8Array>, { dec: TextDecoder; buf: string; done: boolean; queue: string[] }>();

async function nextPieces(api: ChatApi, reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string[] | null> {
  let st = decoders.get(reader);
  if (!st) decoders.set(reader, (st = { dec: new TextDecoder(), buf: "", done: false, queue: [] }));
  if (st.done) return null;
  const { value, done } = await reader.read();
  if (done) {
    st.done = true;
    const { data } = takeEvents(st.buf + "\n");
    return pieces(api, data);
  }
  st.buf += st.dec.decode(value, { stream: true });
  const { data, rest } = takeEvents(st.buf);
  st.buf = rest;
  return pieces(api, data);
}

function pieces(api: ChatApi, data: string[]): string[] {
  const out: string[] = [];
  for (const d of data) {
    if (d === "[DONE]") continue;
    let ev: any;
    try {
      ev = JSON.parse(d);
    } catch {
      continue;
    }
    const t = deltaText(api, ev);
    if (t) out.push(t);
  }
  return out;
}

async function firstText(api: ChatApi, reader: ReadableStreamDefaultReader<Uint8Array>, timedOut: () => boolean): Promise<string> {
  for (;;) {
    const got = await nextPieces(api, reader);
    if (got === null) throw new Error(timedOut() ? "no answer in time" : "the model sent no text");
    if (got.length) return got.join("");
  }
}

async function* rest(api: ChatApi, reader: ReadableStreamDefaultReader<Uint8Array>) {
  for (;;) {
    const got = await nextPieces(api, reader);
    if (got === null) return;
    if (got.length) yield got.join("");
  }
}

const frame = (b64?: string, mime = "image/jpeg"): Part[] => (b64 ? [{ image: b64, mime }] : []);

/** The judge as a prompt: the same question and criteria Decision 1 gets, answered with a score. */
export const JUDGE_SYSTEM = `You decide whether to offer someone watching a video a short explanation, right now.
Question: ${JUDGE_QUESTION.instructions}
Yes when: ${JUDGE_QUESTION.criteria.true_description}
No when: ${JUDGE_QUESTION.criteria.false_description}
Reply with JSON only: {"score": <a number from 0 (no) to 1 (yes)>}.`;

export async function judge(cfg: ChatConfig, r: JudgeRequest): Promise<{ score: number; latencyMs: number }> {
  const t0 = performance.now();
  const text = await generate(cfg, JUDGE_SYSTEM, [{ text: judgeContext(r) }, ...frame(r.frameB64)], { maxTokens: 2000, temperature: 0, json: true });
  const score = scoreOf(text);
  const latencyMs = Math.round(performance.now() - t0);
  log(`judge ${cfg.model}: ${score.toFixed(2)} in ${latencyMs} ms`);
  return { score, latencyMs };
}

const MAP_SHAPE = `Reply with JSON only, in this shape: {"topic": "...", "keyTerms": [{"term": "...", "t": <seconds>, "gist": "..."}], "denseParts": [{"start": <seconds>, "end": <seconds>, "why": "..."}]}`;

export async function videoMap(cfg: ChatConfig, r: MapRequest): Promise<VideoMap> {
  const text = await generate(cfg, `${MAP_SYSTEM}\n\n${MAP_SHAPE}`, [{ text: mapPrompt(r) }], { maxTokens: 6000, temperature: 0.2, json: true });
  log(`map ${cfg.model}: ${text.length} chars`);
  return cleanMap(extractJson(text) ?? {}, r.durationSec);
}

const LOCATE_SHAPE = `Reply with JSON only, in this shape: {"items": [{"i": <number>, "found": true or false, "box_2d": [ymin, xmin, ymax, xmax]}]}`;

export async function locate(cfg: ChatConfig, r: LocateRequest): Promise<LocateResponse> {
  const things = r.things.slice(0, 4);
  const t0 = performance.now();
  const text = await generate(cfg, `${LOCATE_SYSTEM}\n\n${LOCATE_SHAPE}`, [{ text: locatePrompt(things, r.zoomed) }, ...frame(r.frameB64)], { maxTokens: 2000, temperature: 0, json: true });
  const boxes: Record<string, Box | null> = Object.fromEntries(things.map((t) => [t, null]));
  for (const it of extractJson(text)?.items ?? []) {
    const thing = things[it?.i];
    if (thing && it.found) boxes[thing] = cleanBox(it.box_2d) ?? null;
  }
  log(`locate ${cfg.model}: ${Object.values(boxes).filter(Boolean).length} of ${things.length} found in ${Math.round(performance.now() - t0)} ms`);
  return { boxes };
}

const noSound = (what: string, r: { audio?: unknown[] }) => r.audio?.length && log(`${what}: this provider gets the captions and Outline, not the lecture's sound`);

export function explain(cfg: ChatConfig, r: ExplainRequest, signal: AbortSignal) {
  noSound("explain", r);
  return streamText(cfg, EXPLAIN_SYSTEM, [{ text: explainPrompt(r) }, ...frame(r.frameB64)], signal, { what: r.mode === "followup" ? "follow-up" : "explain" });
}

export function recap(cfg: ChatConfig, r: RecapRequest, signal: AbortSignal) {
  noSound("recap", r);
  return streamText(cfg, RECAP_SYSTEM, [{ text: recapPrompt(r) }], signal, { what: "recap" });
}

/** The simulation model first (when set), then the usual one. A whole page takes a while to start. */
export function sim(cfg: ChatConfig, r: SimRequest, signal: AbortSignal) {
  return streamText(cfg, SIM_SYSTEM, [{ text: simPrompt(r) }, ...frame(r.frameB64)], signal, {
    what: r.failed ? "sim (retry)" : "sim",
    maxTokens: 16_000,
    temperature: 0.4,
    firstTextMs: 45_000,
    models: [cfg.simModel || cfg.model, cfg.model],
  });
}

export async function figure(cfg: ChatConfig, r: { format: "svg" | "html"; title: string; explanation: string }) {
  const t0 = performance.now();
  const text = await generate(cfg, FIGURE_SYSTEM(r.format), [{ text: figurePrompt(r) }], { maxTokens: 8000, temperature: 0.5 });
  return { code: pickFigure(text, r.format), model: cfg.model, ms: Math.round(performance.now() - t0) };
}

export async function checkFigure(cfg: ChatConfig, r: { format: "svg" | "html"; title: string; explanation: string; code: string; renderB64: string }) {
  const t0 = performance.now();
  const text = (
    await generate(
      cfg,
      CHECK_SYSTEM(r.format),
      [{ text: `${figurePrompt(r)}\n\nYour figure's code:\n${r.code}\n\nThe attached image is that figure, rendered.` }, ...frame(r.renderB64, "image/png")],
      { maxTokens: 8000, temperature: 0.3 },
    )
  ).trim();
  const ok = /^ok\.?$/i.test(text);
  return { ok, code: ok ? r.code : pickFigure(text, r.format) || r.code, ms: Math.round(performance.now() - t0) };
}

/** The provider's model list (for the setup page). Also proves the key works. */
export async function listModels(cfg: Pick<ChatConfig, "api" | "baseUrl" | "key">): Promise<string[]> {
  const res = await fetch(endpoint(cfg, "models"), { headers: headers(cfg) });
  if (!res.ok) throw await errorOf(res);
  const j: any = await res.json();
  const ids = (Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : []).map((m: any) => String(m?.id ?? m?.name ?? "")).filter(Boolean);
  return [...new Set<string>(ids)].sort();
}

/** One tiny real answer from the chosen model: the key, the address and the model name all work. */
export async function tryModel(cfg: ChatConfig): Promise<void> {
  const text = await generate(cfg, "You are a connection test.", [{ text: "Reply with the single word OK." }], { maxTokens: 400, temperature: 0 });
  if (!text.trim()) throw new Error("the model answered with nothing");
}

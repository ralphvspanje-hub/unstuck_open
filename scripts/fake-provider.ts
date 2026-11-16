// A fake model provider for testing other providers without a key (ADR 0009): one local server that
// speaks both OpenAI's chat completions and Anthropic's messages, with the mock's canned answers.
// It wants the key "test-key", and its model "fake-reasoning" turns down `temperature` and
// `max_tokens` the way reasoning models do. Used by `PROVIDER=openai|anthropic npm run smoke`.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { answer, SIM } from "../server/mock.ts";
import { EXPLAIN_SYSTEM, LOCATE_SYSTEM, MAP_SYSTEM, RECAP_SYSTEM, SIM_SYSTEM } from "../src/ai/prompts.ts";
import { JUDGE_SYSTEM } from "../src/ai/chat.ts";

export const FAKE_KEY = "test-key";
export const FAKE_MODELS = ["fake-vision-1", "fake-sim-2", "fake-reasoning"];
export type FakeCall = { api: "openai" | "anthropic"; kind: string; model: string; stream: boolean; image: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function kindOf(system: string): string {
  if (system.startsWith(JUDGE_SYSTEM.slice(0, 60))) return "judge";
  if (system.startsWith(MAP_SYSTEM.slice(0, 60))) return "map";
  if (system.startsWith(LOCATE_SYSTEM.slice(0, 60))) return "locate";
  if (system.startsWith(EXPLAIN_SYSTEM.slice(0, 60))) return "explain";
  if (system.startsWith(RECAP_SYSTEM.slice(0, 60))) return "recap";
  if (system.startsWith(SIM_SYSTEM.slice(0, 60))) return "sim";
  if (system.startsWith("You are a connection test")) return "test";
  return "other";
}

function reply(kind: string, user: string): string {
  switch (kind) {
    case "judge":
      return '{"score": 0.9}';
    case "map":
      return '```json\n{"topic": "(fake) how a network learns", "keyTerms": [], "denseParts": [{"start": 120, "end": 220, "why": "fake dense part"}]}\n```';
    case "locate": {
      const n = (user.match(/^\d+:/gm) ?? []).length || 1;
      return JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ i, found: true, box_2d: [300 + 40 * i, 300, 600 + 40 * i, 620] })) });
    }
    case "explain":
      return answer({ mode: /now asks: "/.test(user) ? "followup" : "explain", question: user.match(/now asks: "([^"]*)"/)?.[1] } as any).replace(/\(mock\)/g, "(fake provider)");
    case "recap":
      return "<text>- (fake provider) the part you missed</text><marks>[]</marks><figure></figure>";
    case "sim":
      return SIM;
    default:
      return "OK";
  }
}

const textOf = (content: any): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((p: any) => p?.text ?? "").join("\n") : "");
const hasImage = (content: any) => Array.isArray(content) && content.some((p: any) => p?.type === "image_url" || p?.type === "image");

async function body(req: IncomingMessage): Promise<any> {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

export async function startFakeProvider(port = 0) {
  const calls: FakeCall[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const json = (code: number, data: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const api = req.url?.endsWith("/messages") || req.headers["anthropic-version"] ? "anthropic" : "openai";
    const key = api === "anthropic" ? req.headers["x-api-key"] : String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (key !== FAKE_KEY) return json(401, api === "anthropic" ? { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } : { error: { message: "Incorrect API key provided" } });
    if (req.method === "GET" && req.url?.endsWith("/models")) return json(200, { data: FAKE_MODELS.map((id) => ({ id })) });
    if (req.method !== "POST") return json(404, { error: { message: "not found" } });
    const b = await body(req);
    if (b.model === "fake-reasoning" && api === "openai") {
      if ("temperature" in b) return json(400, { error: { message: "Unsupported value: 'temperature' does not support 0.6 with this model. Only the default (1) value is supported." } });
      if ("max_tokens" in b) return json(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } });
    }
    const system = api === "anthropic" ? String(b.system ?? "") : String(b.messages?.[0]?.content ?? "");
    const userContent = api === "anthropic" ? b.messages?.[0]?.content : b.messages?.[1]?.content;
    const kind = kindOf(system);
    calls.push({ api, kind, model: String(b.model), stream: Boolean(b.stream), image: hasImage(userContent) });
    const text = reply(kind, textOf(userContent));
    if (!b.stream) return json(200, api === "anthropic" ? { content: [{ type: "text", text }] } : { choices: [{ message: { role: "assistant", content: text } }] });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (api === "anthropic") res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start" })}\n\n`);
    for (let i = 0; i < text.length; i += 40) {
      const piece = text.slice(i, i + 40);
      res.write(
        api === "anthropic"
          ? `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } })}\n\n`
          : `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`,
      );
      await sleep(15);
    }
    res.end(api === "anthropic" ? `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n` : "data: [DONE]\n\n");
  });
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  const at = (server.address() as any).port as number;
  return { port: at, calls, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

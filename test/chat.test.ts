// Other providers (ADR 0009): the request formats and the reading of answers, without any network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustFor, deltaText, endpoint, extractJson, headers, requestBody, scoreOf, takeEvents } from "../src/ai/chat.ts";
import { originPattern, presetOf } from "../src/ai/presets.ts";
import { providerOf } from "../src/ai/provider.ts";

test("an OpenAI-compatible request: plain text as a string, a frame as a data URL", () => {
  const text = requestBody("openai", "m", "sys", [{ text: "hi" }], { maxTokens: 100, temperature: 0.5 }) as any;
  assert.equal(text.messages[0].content, "sys");
  assert.equal(text.messages[1].content, "hi");
  assert.equal(text.max_tokens, 100);
  assert.equal(text.temperature, 0.5);
  const img = requestBody("openai", "m", "sys", [{ text: "look" }, { image: "AAAA" }], { maxTokens: 10, json: true, stream: true }) as any;
  assert.deepEqual(img.messages[1].content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
  assert.deepEqual(img.response_format, { type: "json_object" });
  assert.equal(img.stream, true);
});

test("an Anthropic request: system on its own, the frame as a base64 image, the browser header", () => {
  const b = requestBody("anthropic", "claude", "sys", [{ text: "look" }, { image: "AAAA", mime: "image/png" }], { maxTokens: 50, temperature: 0 }) as any;
  assert.equal(b.system, "sys");
  assert.equal(b.max_tokens, 50);
  assert.equal(b.temperature, 0);
  assert.deepEqual(b.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
  const h = headers({ api: "anthropic", key: "k" });
  assert.equal(h["x-api-key"], "k");
  assert.equal(h["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(headers({ api: "openai", key: "k" }).Authorization, "Bearer k");
  assert.equal(headers({ api: "openai" }).Authorization, undefined); // a local model needs no key
});

test("addresses: OpenAI-compatible bases end in /v1, Anthropic's gets /v1 added", () => {
  assert.equal(endpoint({ api: "openai", baseUrl: "https://api.openai.com/v1/" }, "chat"), "https://api.openai.com/v1/chat/completions");
  assert.equal(endpoint({ api: "openai", baseUrl: "http://localhost:11434/v1" }, "models"), "http://localhost:11434/v1/models");
  assert.equal(endpoint({ api: "anthropic", baseUrl: "https://api.anthropic.com" }, "chat"), "https://api.anthropic.com/v1/messages");
  assert.equal(endpoint({ api: "anthropic", baseUrl: "https://proxy.example/v1" }, "models"), "https://proxy.example/v1/models");
  assert.equal(originPattern("http://localhost:11434/v1"), "http://localhost/*");
  assert.equal(originPattern("not a url"), null);
});

test("a parameter a model turns down is left out next time: temperature, then max_tokens, then JSON mode", () => {
  const a = adjustFor("Unsupported value: 'temperature' does not support 0.6", {});
  assert.deepEqual(a, { noTemperature: true });
  const b = adjustFor("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", a!);
  assert.deepEqual(b, { noTemperature: true, maxCompletion: true });
  const body = requestBody("openai", "m", "s", [{ text: "x" }], { maxTokens: 9, temperature: 1, json: true }, { ...b, noJsonMode: true }) as any;
  assert.equal(body.temperature, undefined);
  assert.equal(body.max_completion_tokens, 9);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.response_format, undefined);
  assert.equal(adjustFor("something else entirely", {}), null);
});

test("streamed answers: events split across chunks, both formats, [DONE] and errors", () => {
  const one = takeEvents('data: {"a":1}\n\ndata: {"b"');
  assert.deepEqual(one.data, ['{"a":1}']);
  assert.equal(one.rest, 'data: {"b"');
  assert.equal(deltaText("openai", { choices: [{ delta: { content: "Hel" } }] }), "Hel");
  assert.equal(deltaText("openai", { choices: [{ delta: { role: "assistant" } }] }), "");
  assert.equal(deltaText("anthropic", { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }), "lo");
  assert.equal(deltaText("anthropic", { type: "message_start" }), "");
  assert.throws(() => deltaText("anthropic", { type: "error", error: { message: "overloaded" } }), /overloaded/);
});

test("JSON from a model's text: fenced, with words around it, or broken", () => {
  assert.deepEqual(extractJson('```json\n{"score": 0.8}\n```'), { score: 0.8 });
  assert.deepEqual(extractJson('Sure! {"items": [{"i": 0}]} Hope that helps.'), { items: [{ i: 0 }] });
  assert.equal(extractJson("no json here"), null);
  assert.equal(scoreOf('{"score": 0.93}'), 0.93);
  assert.equal(scoreOf("I'd say 0.4."), 0.4);
  assert.equal(scoreOf('{"score": 7}'), 1);
  assert.equal(scoreOf("no idea"), 0);
});

test("the provider: Gemini when nothing is set, another one only with a key (or a local model)", () => {
  assert.equal(providerOf(undefined, null), null);
  assert.equal(providerOf(undefined, "k")?.kind, "gemini");
  const s = { preset: "openai", api: "openai" as const, baseUrl: "https://api.openai.com/v1", model: "m" };
  assert.equal(providerOf(s, null), null);
  assert.equal(providerOf(s, "k")?.kind, "chat");
  assert.equal(providerOf({ ...s, preset: "ollama", local: true }, null)?.kind, "chat");
  assert.equal(presetOf("nope").id, "gemini");
});

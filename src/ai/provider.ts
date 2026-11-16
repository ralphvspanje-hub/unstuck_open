// Which model provider the Viewer's own key is for (ADR 0009), and the one switch between Gemini
// (gemini.ts, the default, the only one with Decision 1, a free tier and a lecture's sound) and the
// rest (chat.ts). The key itself is kept by src/background/keystore.ts; these settings hold no secret.
import type { GoogleGenAI } from "@google/genai";
import * as gemini from "./gemini.ts";
import * as chat from "./chat.ts";
import { presetOf } from "./presets.ts";
export { PRESETS, presetOf, type Preset } from "./presets.ts";

/** Kept in chrome.storage.local as `provider`. No setting at all means Gemini. */
export type ChatSettings = { preset: string; api: chat.ChatApi; baseUrl: string; model: string; simModel?: string; local?: boolean };
export type ProviderSettings = { preset: "gemini" } | ChatSettings;

export type Provider = { kind: "gemini"; ai: GoogleGenAI } | { kind: "chat"; cfg: chat.ChatConfig; name: string };

export function providerOf(s: ProviderSettings | undefined, key: string | null): Provider | null {
  if (!s || s.preset === "gemini" || !("api" in s)) return key ? { kind: "gemini", ai: gemini.createClient(key)! } : null;
  if (!key && !s.local) return null;
  return { kind: "chat", name: presetOf(s.preset).short, cfg: { api: s.api, baseUrl: s.baseUrl, key: key ?? undefined, model: s.model, simModel: s.simModel } };
}

export const nameOf = (p: Provider) => (p.kind === "gemini" ? "Gemini" : p.name);

/** One answer (not streamed), by path, as the local server would give it. */
export function call(p: Provider, path: string, body: any): Promise<unknown> {
  if (p.kind === "gemini") {
    const ai = p.ai;
    switch (path) {
      case "/judge":
        return gemini.judge(ai, body);
      case "/map":
        return gemini.videoMap(ai, body);
      case "/locate":
        return gemini.locate(ai, body);
      case "/figure":
        return gemini.figure(ai, body);
      case "/figure-check":
        return gemini.checkFigure(ai, body);
    }
  } else {
    const c = p.cfg;
    switch (path) {
      case "/judge":
        return chat.judge(c, body);
      case "/map":
        return chat.videoMap(c, body);
      case "/locate":
        return chat.locate(c, body);
      case "/figure":
        return chat.figure(c, body);
      case "/figure-check":
        return chat.checkFigure(c, body);
    }
  }
  return Promise.reject(new Error(`unknown call ${path}`));
}

/** A streamed answer (Explanation, Recap, Simulation), by path. */
export function stream(p: Provider, path: string, body: any, signal: AbortSignal): AsyncIterable<string> {
  const m = p.kind === "gemini" ? { e: gemini.explain, r: gemini.recap, s: gemini.sim, a: p.ai } : { e: chat.explain, r: chat.recap, s: chat.sim, a: p.cfg };
  if (path === "/explain") return (m.e as any)(m.a, body, signal);
  if (path === "/recap") return (m.r as any)(m.a, body, signal);
  if (path === "/sim") return (m.s as any)(m.a, body, signal);
  throw new Error(`unknown stream ${path}`);
}

// Background worker: the only part that talks to the models, and the owner of the camera's offscreen
// page (ADR 0001). With the Viewer's own key saved (setup page), it calls their provider directly:
// Gemini by default, or another one (ADR 0009). Without one, it goes through the local server
// (the development setup, and the mock for tests).
import * as gemini from "../ai/gemini.ts";
import * as chat from "../ai/chat.ts";
import { call as providerCall, nameOf, presetOf, providerOf, stream as providerStream, type ChatSettings, type Provider, type ProviderSettings } from "../ai/provider.ts";
import { clearKey, hasKey, loadKey, saveKey } from "./keystore.ts";

declare const __UNSTUCK_PORT__: string; // set by scripts/build.ts: 4717, or another port for a test build
const SERVER = `http://127.0.0.1:${__UNSTUCK_PORT__}`;
const HEADERS = { "Content-Type": "application/json", "X-Unstuck": "1" };
const NOT_SET_UP = "Unstuck isn't set up yet: click the Unstuck icon and add your Gemini key.";

// ── direct mode: the Viewer's own key ──────────────────────────────────

let client: { stamp: string; p: Provider } | null = null;

const settingsOf = async () => ((await chrome.storage.local.get("provider")).provider as ProviderSettings | undefined) ?? { preset: "gemini" as const };

/** The Viewer's provider, with their key, or null when nothing is set up (then: the local server). */
async function directAi(): Promise<Provider | null> {
  const [s, key] = await Promise.all([settingsOf(), loadKey()]);
  const stamp = JSON.stringify(s) + (key ?? "");
  if (client?.stamp === stamp) return client.p;
  const p = providerOf(s, key);
  client = p ? { stamp, p } : null;
  return p;
}

/** What went wrong, in words a Viewer can act on. */
function friendly(e: unknown, name = "Gemini"): string {
  const m = String((e as any)?.message ?? e);
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|invalid.{0,20}key|authentication|\b40[13]\b/i.test(m)) return name === "API" ? "That API doesn't take this key. Click the Unstuck icon to check it." : `Your ${name} key doesn't work. Click the Unstuck icon to check it.`;
  if (/\b429\b|quota|RESOURCE_EXHAUSTED|rate limit/i.test(m))
    return name === "Gemini" ? "Gemini's free limit for today is used up. It resets tomorrow morning." : `${name} says the limit is used up for now (429). Try again later.`;
  if (/Failed to fetch|NetworkError|network/i.test(m)) return `No connection to ${name === "API" ? "that API" : name}. Check the address and your internet${/Ollama|LM Studio/.test(name) ? `, and that ${name} is running` : ""}.`;
  return m.slice(0, 200);
}

async function direct(p: Provider, path: string, body: any): Promise<unknown> {
  if (path === "/health") {
    const custom = p.kind === "chat" && p.name === "API";
    return { ok: true, direct: true, provider: custom ? new URL(p.cfg.baseUrl).host : nameOf(p), model: p.kind === "chat" ? p.cfg.model : undefined };
  }
  return providerCall(p, path, body);
}

/** A key is tried before it is kept: a quick look-up of a model, no answer generated. */
async function tryKey(key: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{30,}$/.test(key)) return "That doesn't look like a Gemini key. It is one long code without spaces.";
  try {
    await gemini.createClient(key)!.models.get({ model: gemini.FLASH_FALLBACK });
    return null;
  } catch (e) {
    const why = friendly(e);
    return why.startsWith("Your Gemini key") ? "Google says this key doesn't work. Copy it again from Google AI Studio." : why;
  }
}
let cameraTab: number | null = null;
/** The camera view (a demo window of Unstuck's own), if open. */
let cameraView: number | null = null;
chrome.windows.onRemoved.addListener((id) => id === cameraView && (cameraView = null));

/** Another provider: the settings from the setup page, tried with one tiny answer before they are kept. */
async function saveProvider(s: ChatSettings, key: string): Promise<string | null> {
  const name = presetOf(s.preset).short;
  if (!s.baseUrl.trim()) return "Fill in the API address.";
  if (!s.model.trim()) return "Pick a model.";
  if (!key && !s.local) return `Paste your ${name} key.`;
  try {
    await chat.tryModel({ api: s.api, baseUrl: s.baseUrl, key: key || undefined, model: s.model });
  } catch (e) {
    return friendly(e, name);
  }
  if (key) await saveKey(key);
  else await clearKey();
  await chrome.storage.local.set({ provider: s });
  client = null;
  return null;
}

async function call(path: string, body?: unknown) {
  const p = await directAi();
  if (p) {
    try {
      return { ok: true, data: await direct(p, path, body) };
    } catch (e) {
      return { ok: false, error: friendly(e, nameOf(p)) };
    }
  }
  try {
    // Always POST: Chrome leaves the Origin header off an extension's GET requests, and the
    // server only answers requests that prove they come from this extension.
    const res = await fetch(SERVER + path, { method: "POST", headers: HEADERS, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error || `server said ${res.status}` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: NOT_SET_UP };
  }
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

async function startCamera(tabId: number | undefined) {
  const model = await fetch(chrome.runtime.getURL("assets/face_landmarker.task"), { method: "HEAD" }).then((r) => r.ok, () => false);
  if (!model) return { ok: false, reason: "no-model" };
  const { cameraGranted } = await chrome.storage.local.get("cameraGranted");
  if (!cameraGranted) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("setup.html#camera") });
    return { ok: false, reason: "permission" };
  }
  cameraTab = tabId ?? null;
  if (!(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Reads the viewer's face on this laptop, as numbers only, to notice when they look away or frown.",
    });
  }
  await chrome.runtime.sendMessage({ target: "offscreen", kind: "face-start" }).catch(() => {});
  return { ok: true };
}

async function stopCamera() {
  cameraTab = null;
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.target === "offscreen") return; // meant for the camera page
  switch (msg?.kind) {
    case "api":
      call(msg.path, msg.body).then(reply);
      return true;
    case "key-save":
      void (async () => {
        const key = String(msg.key ?? "").trim();
        const problem = await tryKey(key);
        if (!problem) {
          await saveKey(key);
          await chrome.storage.local.set({ provider: { preset: "gemini" } });
          client = null;
        }
        reply(problem ? { ok: false, error: problem } : { ok: true });
      })();
      return true;
    case "key-status":
      void Promise.all([hasKey(), settingsOf()]).then(([saved, s]) => reply({ saved: saved || ("local" in s && Boolean(s.local)), settings: s }));
      return true;
    case "key-clear":
      void Promise.all([clearKey(), chrome.storage.local.remove("provider")]).then(() => ((client = null), reply({ ok: true })));
      return true;
    case "provider-models":
      chat
        .listModels({ api: msg.api, baseUrl: String(msg.baseUrl ?? ""), key: String(msg.key ?? "").trim() || undefined })
        .then((models) => reply({ ok: true, models }), (e) => reply({ ok: false, error: friendly(e, presetOf(msg.preset).short) }));
      return true;
    case "provider-save":
      saveProvider(msg.settings, String(msg.key ?? "").trim()).then((problem) => reply(problem ? { ok: false, error: problem } : { ok: true }));
      return true;
    case "camera-start":
      startCamera(sender.tab?.id).then(reply);
      return true;
    case "camera-stop":
      void stopCamera();
      return false;
    case "camera-mesh":
      void hasOffscreen().then((on) => on && chrome.runtime.sendMessage({ target: "offscreen", kind: "face-mesh", on: msg.on }).catch(() => {}));
      return false;
    case "open-camera-view":
      if (cameraView !== null) void chrome.windows.update(cameraView, { focused: true }).catch(() => (cameraView = null));
      else void openCameraView();
      return false;
    case "camera-pause":
      void hasOffscreen().then((on) => on && chrome.runtime.sendMessage({ target: "offscreen", kind: "face-pause" }).catch(() => {}));
      return false;
    case "face":
      if (cameraTab !== null) chrome.tabs.sendMessage(cameraTab, msg).catch(() => void stopCamera());
      return false;
    case "camera-denied":
      void chrome.storage.local.set({ cameraGranted: false });
      void stopCamera();
      return false;
  }
  return false;
});

/**
 * The camera view always opens as a small normal window. Opened from a full-screen YouTube on a Mac, it
 * could come up full screen too, with no close button in sight and the video playing on behind it; so
 * it is asked for as "normal", and put back to normal if it still ends up full screen or maximised
 * (checked again once the Mac's full-screen animation would be done).
 */
async function openCameraView() {
  const size = { width: 600, height: 760 };
  const w = await chrome.windows.create({ url: chrome.runtime.getURL("camera.html"), type: "popup", state: "normal", focused: true, ...size }).catch(() => null);
  cameraView = w?.id ?? null;
  const id = cameraView;
  if (id === null) return;
  const unfull = async () => {
    const v = await chrome.windows.get(id).catch(() => null);
    if (!v || v.state === "normal") return;
    await chrome.windows.update(id, { state: "normal" }).catch(() => {});
    await chrome.windows.update(id, size).catch(() => {});
  };
  await unfull();
  setTimeout(() => void unfull(), 1200);
}

// Streamed answers (Explanations, Recaps): the content script opens a port per request.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "stream") return;
  const ctrl = new AbortController();
  port.onDisconnect.addListener(() => ctrl.abort());
  port.onMessage.addListener(async (msg) => {
    if (!msg?.path) return; // a keep-alive ping from the tab while a long answer is on its way
    const { path, body } = msg;
    const p = await directAi();
    if (p) {
      try {
        for await (const piece of providerStream(p, path, body, ctrl.signal)) port.postMessage({ delta: piece });
        port.postMessage({ done: true });
      } catch (e) {
        if (!ctrl.signal.aborted) {
          try {
            port.postMessage({ error: friendly(e, nameOf(p)) });
          } catch {}
        }
      }
      return;
    }
    try {
      const res = await fetch(SERVER + path, { method: "POST", headers: HEADERS, body: JSON.stringify(body), signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`server said ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        port.postMessage({ delta: dec.decode(value, { stream: true }) });
      }
      port.postMessage({ done: true });
    } catch (e: any) {
      if (!ctrl.signal.aborted) {
        try {
          port.postMessage({ error: e?.message === "Failed to fetch" ? NOT_SET_UP : String(e?.message || e) });
        } catch {}
      }
    }
  });
});

chrome.action.onClicked.addListener(() => void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") }));
// Just installed: show the three setup steps straight away.
chrome.runtime.onInstalled.addListener((d) => d.reason === "install" && void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") }));

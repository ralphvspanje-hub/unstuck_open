// Background worker: the only part that talks to the models, and the owner of the camera's offscreen
// page (ADR 0001). With the Viewer's own Gemini key saved (setup page), it calls Gemini directly;
// without one, it goes through the local server (the development setup, and the mock for tests).
import type { GoogleGenAI } from "@google/genai";
import * as gemini from "../ai/gemini.ts";
import { clearKey, hasKey, loadKey, saveKey } from "./keystore.ts";

declare const __UNSTUCK_PORT__: string; // set by scripts/build.ts: 4717, or another port for a test build
const SERVER = `http://127.0.0.1:${__UNSTUCK_PORT__}`;
const HEADERS = { "Content-Type": "application/json", "X-Unstuck": "1" };
const NOT_SET_UP = "Unstuck isn't set up yet: click the Unstuck icon and add your Gemini key.";

// ── direct mode: the Viewer's own key ──────────────────────────────────

let client: { key: string; ai: GoogleGenAI } | null = null;

async function directAi(): Promise<GoogleGenAI | null> {
  const key = await loadKey();
  if (!key) return (client = null);
  if (client?.key !== key) client = { key, ai: gemini.createClient(key)! };
  return client.ai;
}

/** What went wrong, in words a Viewer can act on. */
function friendly(e: unknown): string {
  const m = String((e as any)?.message ?? e);
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|\b40[13]\b/i.test(m)) return "Your Gemini key doesn't work. Click the Unstuck icon to check it.";
  if (/\b429\b|quota|RESOURCE_EXHAUSTED/i.test(m)) return "Gemini's free limit for today is used up. It resets tomorrow morning.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "No connection to Gemini. Check your internet.";
  return m.slice(0, 200);
}

async function direct(ai: GoogleGenAI, path: string, body: any): Promise<unknown> {
  switch (path) {
    case "/health":
      return { ok: true, direct: true };
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
  throw new Error(`unknown call ${path}`);
}

/** Streamed answers in direct mode. (The server also checks HTML figures on a render; this doesn't.) */
function directStream(ai: GoogleGenAI, path: string, body: any, signal: AbortSignal): AsyncIterable<string> {
  if (path === "/explain") return gemini.explain(ai, body, signal);
  if (path === "/recap") return gemini.recap(ai, body, signal);
  if (path === "/sim") return gemini.sim(ai, body, signal);
  throw new Error(`unknown stream ${path}`);
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

async function call(path: string, body?: unknown) {
  const ai = await directAi();
  if (ai) {
    try {
      return { ok: true, data: await direct(ai, path, body) };
    } catch (e) {
      return { ok: false, error: friendly(e) };
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
        if (!problem) await saveKey(key);
        reply(problem ? { ok: false, error: problem } : { ok: true });
      })();
      return true;
    case "key-status":
      hasKey().then((saved) => reply({ saved }));
      return true;
    case "key-clear":
      clearKey().then(() => ((client = null), reply({ ok: true })));
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
    const ai = await directAi();
    if (ai) {
      try {
        for await (const piece of directStream(ai, path, body, ctrl.signal)) port.postMessage({ delta: piece });
        port.postMessage({ done: true });
      } catch (e) {
        if (!ctrl.signal.aborted) {
          try {
            port.postMessage({ error: friendly(e) });
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

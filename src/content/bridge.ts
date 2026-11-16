// Messaging: to the page world (player API, captions) and to the background (server calls).
import type { FaceLines } from "../core/rules.ts";
import type { FracRect } from "../core/room.ts";
import type { PanelRect } from "./ui.ts";

export type PlayerInfo = {
  videoId: string | null;
  title: string;
  channelId: string | null;
  author: string;
  isLive: boolean;
  durationSec: number;
  tracks: { lang: string; kind: string; name: string }[];
  captionsOn: boolean;
  /** The caption track belonging to the default audio, i.e. the video's own language. */
  defaultCaption: { lang: string; kind: string } | null;
};

const pending = new Map<string, (v: any) => void>();
const captionListeners = new Set<(c: { videoId: string | null; lang: string | null; tlang: string | null; body: string }) => void>();

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "unstuck-page") return;
  if (e.data.kind === "reply") {
    pending.get(e.data.id)?.(e.data.error ? null : e.data.data);
    pending.delete(e.data.id);
  } else if (e.data.kind === "captions") {
    for (const l of captionListeners) l(e.data);
  }
});

export function askPage<T>(kind: string, extra: Record<string, unknown> = {}, timeoutMs = 3000): Promise<T | null> {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    window.postMessage({ source: "unstuck-content", kind, id, ...extra }, location.origin);
    setTimeout(() => {
      if (pending.delete(id)) resolve(null);
    }, timeoutMs);
  });
}

export function onCaptions(fn: Parameters<typeof captionListeners.add>[0]) {
  captionListeners.add(fn);
  return () => captionListeners.delete(fn);
}

/** JSON call to the local server, through the background worker. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await chrome.runtime.sendMessage({ kind: "api", path, body });
  if (!res?.ok) throw new Error(res?.error || "server unreachable");
  return res.data as T;
}

/** Streamed call (Explanations, Recaps). Returns a stop function. */
export function streamApi(
  path: string,
  body: unknown,
  on: { delta: (s: string) => void; done: () => void; error: (e: string) => void },
): () => void {
  const port = chrome.runtime.connect({ name: "stream" });
  let finished = false;
  port.onMessage.addListener((m) => {
    if (m.delta) on.delta(m.delta);
    if (m.done) {
      finished = true;
      on.done();
      port.disconnect();
    }
    if (m.error) {
      finished = true;
      on.error(m.error);
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (!finished) on.error("connection to Unstuck closed");
  });
  port.postMessage({ path, body });
  // Keeps the background worker awake while a model thinks before writing (a simulation can take 25 s).
  const ping = setInterval(() => {
    if (finished) return clearInterval(ping);
    try {
      port.postMessage({ ping: true });
    } catch {
      clearInterval(ping);
    }
  }, 15_000);
  return () => {
    finished = true;
    clearInterval(ping);
    try {
      port.disconnect();
    } catch {}
  };
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  const { threshold: _old, ...rest } = (settings ?? {}) as Record<string, unknown>; // the Offer bar lives in RULES.offerAt now
  return { camera: true, alwaysOnChannels: [], sound: false, ...rest } as Settings;
}

export async function saveSettings(patch: Partial<Settings>) {
  const s = await getSettings();
  await chrome.storage.local.set({ settings: { ...s, ...patch } });
}

export type Settings = {
  camera: boolean;
  alwaysOnChannels: string[];
  sound: boolean;
  /** Where the Viewer dragged the panel to, in normal view and in fullscreen. */
  panelRect?: PanelRect | null;
  panelRectFs?: PanelRect | null;
  /** The Room: the video moves beside the chat (off: Unstuck's windows float over the video). */
  room?: boolean;
  /** Where the Viewer put the chat and a simulation in the Room, as fractions of the screen. */
  roomPanel?: FracRect | null;
  roomSim?: FracRect | null;
  /** Test: the first answer thinks too, and every answer shows how long its first word took. */
  thinkFirst?: boolean;
  /** Face lines the Viewer set by dragging them in the face meter. */
  faceLines?: Partial<FaceLines> & { v?: number };
};

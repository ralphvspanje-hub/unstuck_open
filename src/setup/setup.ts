// Setup page (click the Unstuck icon in Chrome's toolbar): three short steps for a new Viewer (their
// own Gemini key, the camera, how to use it), and a closed "For testing" part (settings, the face
// meter keys, the connection, the three v1 checks from the Offer log). The camera is granted to the
// extension itself, never to youtube.com or Panopto (ADR 0001).
import type { LogEntry } from "../core/types.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

async function settings() {
  const { settings } = await chrome.storage.local.get("settings");
  const { threshold: _old, ...rest } = (settings ?? {}) as Record<string, any>;
  return { camera: true, room: true, alwaysOnChannels: [] as string[], ...rest } as { camera: boolean; room: boolean; alwaysOnChannels: string[] } & Record<string, unknown>;
}

async function grantCamera() {
  const status = $("#cam-status");
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    await chrome.storage.local.set({ cameraGranted: true });
    status.textContent = "";
    await showCamera(true);
  } catch (e) {
    await chrome.storage.local.set({ cameraGranted: false });
    status.textContent = "The camera is blocked. Unstuck still works without it: it then goes by how you use the video (rewinding, pausing).";
    status.className = "bad";
  }
}

/** Before the camera is allowed: the button. After: a switch to use it or not. */
async function showCamera(granted: boolean) {
  $("#cam-new").classList.toggle("hidden", granted);
  $("#cam-on").classList.toggle("hidden", !granted);
  const box = $<HTMLInputElement>("#camera");
  const note = () => {
    $("#cam-off-note").classList.toggle("hidden", box.checked);
    $("#step-camera").classList.toggle("done", granted && box.checked);
  };
  box.addEventListener("change", note);
  note();
}

// ── the Viewer's own Gemini key (kept locked by the background worker, src/background/keystore.ts) ──

async function showKey() {
  const { saved } = await chrome.runtime.sendMessage({ kind: "key-status" });
  $("#key-new").classList.toggle("hidden", saved);
  $("#key-saved").classList.toggle("hidden", !saved);
  $("#step-key").classList.toggle("done", saved);
}

async function saveKey() {
  const input = $<HTMLInputElement>("#key");
  const status = $("#key-status");
  const button = $<HTMLButtonElement>("#key-save");
  if (!input.value.trim()) return;
  button.disabled = true;
  status.textContent = "Checking the key with Google…";
  status.className = "small";
  const res = await chrome.runtime.sendMessage({ kind: "key-save", key: input.value });
  button.disabled = false;
  if (res?.ok) {
    input.value = "";
    status.textContent = "It works ✓ You're ready: open a lecture or a video.";
    status.className = "small ok";
  } else {
    status.textContent = res?.error ?? "That didn't work. Try again.";
    status.className = "small bad";
  }
  await Promise.all([showKey(), checkServer()]);
}

async function checkServer() {
  const el = $("#server");
  const res = await chrome.runtime.sendMessage({ kind: "api", path: "/health" });
  if (res?.ok && res.data.direct) {
    el.textContent = "Straight to Gemini, with your key ✓";
    el.className = "ok";
  } else if (res?.ok) {
    el.textContent = res.data.mock ? "Local server in mock mode (no Gemini key): canned answers." : `Local server, with ${res.data.flash} and ${res.data.decision} ✓`;
    el.className = res.data.mock ? "warn" : "ok";
  } else {
    el.textContent = "Not connected: add a Gemini key above (or start the local server with a key: see the README).";
    el.className = "bad";
  }
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");

async function stats() {
  const { log = [] } = (await chrome.storage.local.get("log")) as { log?: LogEntry[] };
  const offers = log.filter((e) => e.offered);
  const seen = offers.filter((e) => e.offerOutcome && e.offerOutcome !== "unseen");
  const accepted = seen.filter((e) => e.offerOutcome === "accepted");
  const asks = log.filter((e) => e.source === "ask");
  const helped = log.filter((e) => e.explanationOutcome === "got_it").length;
  const judged = log.filter((e) => e.source === "offer" && e.type === "stuck").length;
  const days = new Set(log.map((e) => new Date(e.wall).toDateString())).size;
  const sessions = new Set(log.map((e) => e.videoId)).size;
  $("#stats").innerHTML = `
    <li><b>1. You keep using it</b> ${days} day(s), ${sessions} video(s) with activity</li>
    <li><b>2. Offers are worth it</b> ${pct(accepted.length, seen.length)} of ${seen.length} seen Offers accepted (goal: ≥ 50%)</li>
    <li><b>3. It stays quiet</b> ${offers.length} Offers from ${judged} Stuck candidates (goal: ≤ ~1 per 10 min when not stuck)</li>
    <li><b>Misses</b> ${asks.length} Ask(s): Stuck moments it didn't spot</li>
    <li><b>Helped</b> "Got it" on ${helped} Explanation(s)</li>`;
}

/** A checkbox bound to one setting; reads the settings fresh, so two changes don't undo each other. */
async function bind(id: string, key: "camera" | "room" | "thinkFirst", fallback = true) {
  const box = $<HTMLInputElement>(`#${id}`);
  const v = (await settings())[key];
  box.checked = typeof v === "boolean" ? v : fallback;
  box.onchange = async () => chrome.storage.local.set({ settings: { ...(await settings()), [key]: box.checked } });
}

async function init() {
  await Promise.all([bind("camera", "camera"), bind("room", "room"), bind("thinkFirst", "thinkFirst", false), showKey()]);
  $("#grant").onclick = () => void grantCamera();
  $("#key-save").onclick = () => void saveKey();
  $<HTMLInputElement>("#key").onkeydown = (e) => e.key === "Enter" && void saveKey();
  $("#key-remove").onclick = async () => {
    await chrome.runtime.sendMessage({ kind: "key-clear" });
    $("#key-status").textContent = "";
    await Promise.all([showKey(), checkServer()]);
  };
  const { cameraGranted } = await chrome.storage.local.get("cameraGranted");
  await showCamera(Boolean(cameraGranted));
  $("#export").onclick = async () => {
    const { log = [] } = await chrome.storage.local.get("log");
    const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `unstuck-log-${new Date().toISOString().slice(0, 10)}.json` }).click();
  };
  if (location.hash === "#camera") $("#grant").focus();
  await Promise.all([checkServer(), stats()]);
}
void init();

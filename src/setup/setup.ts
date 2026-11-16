// Setup page (click the Unstuck icon in Chrome's toolbar): three short steps for a new Viewer (their
// own key, Gemini or another provider; the camera; how to use it), and a closed "For testing" part (settings, the face
// meter keys, the connection, the three v1 checks from the Offer log). The camera is granted to the
// extension itself, never to youtube.com or Panopto (ADR 0001).
import type { LogEntry } from "../core/types.ts";
import { PRESETS, originPattern, presetOf } from "../ai/presets.ts";

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

// ── the Viewer's own key (kept locked by the background worker, src/background/keystore.ts) ──
// Gemini by default; another provider (ADR 0009) adds an API address and a model.

const preset = () => presetOf($<HTMLSelectElement>("#provider").value);

function showPreset() {
  const p = preset();
  const gem = p.api === "gemini";
  $("#gemini-how").classList.toggle("hidden", !gem);
  $("#other-how").classList.toggle("hidden", gem);
  $("#provider-note").textContent = p.note ?? "";
  const base = $<HTMLInputElement>("#base-url");
  base.value = p.baseUrl; // editable: a proxy or another region has its own address
  $<HTMLInputElement>("#key").placeholder = p.local ? "No key needed (paste one if your server wants it)" : `Paste your ${p.id === "custom" ? "" : `${p.short} `}key`;
  const where = $("#key-where");
  where.textContent = "";
  if (p.keyUrl) {
    where.append("Get a key at ");
    where.append(Object.assign(document.createElement("a"), { href: p.keyUrl, target: "_blank", rel: "noopener", textContent: new URL(p.keyUrl).host }));
    where.append(", then fill in the model and paste the key.");
  } else where.textContent = p.local ? "Start it, load a model, and pick that model here." : "Fill in the API address, the model and the key.";
  $("#models").textContent = "";
}

async function showKey() {
  const { saved, settings: s } = await chrome.runtime.sendMessage({ kind: "key-status" });
  $("#key-new").classList.toggle("hidden", saved);
  $("#key-saved").classList.toggle("hidden", !saved);
  $("#step-key").classList.toggle("done", saved);
  const p = presetOf(s?.preset);
  let host = "Google";
  try {
    host = p.api === "gemini" ? "Google" : new URL(s?.baseUrl || p.baseUrl).host;
  } catch {}
  $("#key-saved-what").textContent = p.api === "gemini" ? "Gemini key saved ✓" : p.id === "custom" ? `${s.model} at ${host} ✓` : `${p.short}, ${s.model} ✓`;
  $("#key-privacy").textContent =
    p.api === "gemini" && (saved || preset().api === "gemini")
      ? "The key stays in this browser, locked, and only goes to Google. On the free plan Google may use what Unstuck sends (a picture of the video and its sound, never your face) to improve its products."
      : `The key stays in this browser, locked, and only goes to ${saved ? host : "the provider"}. What Unstuck sends (a picture of the video and its transcript, never your face) falls under that provider's terms.`;
}

/** Chrome must allow the provider's address; asked for inside the click, as Chrome requires. */
function allowHost(baseUrl: string): Promise<boolean> {
  const origin = originPattern(baseUrl);
  return origin ? chrome.permissions.request({ origins: [origin] }).catch(() => false) : Promise.resolve(false);
}

function other() {
  const p = preset();
  return {
    preset: p.id,
    api: p.api as "openai" | "anthropic",
    baseUrl: $<HTMLInputElement>("#base-url").value.trim(),
    model: $<HTMLInputElement>("#model").value.trim(),
    simModel: $<HTMLInputElement>("#sim-model").value.trim() || undefined,
    local: p.local,
  };
}

function listModels() {
  const s = other();
  const status = $("#key-status");
  const allowed = allowHost(s.baseUrl);
  void (async () => {
    if (!(await allowed)) {
      status.textContent = s.baseUrl ? "Unstuck needs your permission to reach that address." : "Fill in the API address first.";
      status.className = "small bad";
      return;
    }
    status.textContent = "Asking for the models…";
    status.className = "small";
    const res = await chrome.runtime.sendMessage({ kind: "provider-models", ...s, key: $<HTMLInputElement>("#key").value });
    if (!res?.ok) {
      status.textContent = res?.error ?? "That didn't work.";
      status.className = "small bad";
      return;
    }
    const list = $("#models");
    list.textContent = "";
    for (const m of res.models) list.append(Object.assign(document.createElement("option"), { value: m }));
    status.textContent = `${res.models.length} models: click the Model field to pick one.`;
    status.className = "small ok";
  })();
}

function saveKey() {
  const input = $<HTMLInputElement>("#key");
  const status = $("#key-status");
  const button = $<HTMLButtonElement>("#key-save");
  const gem = preset().api === "gemini";
  if (gem && !input.value.trim()) return;
  const s = gem ? null : other();
  const allowed = s ? allowHost(s.baseUrl) : Promise.resolve(true);
  void (async () => {
    button.disabled = true;
    status.className = "small";
    let res: any;
    if (!s) {
      status.textContent = "Checking the key with Google…";
      res = await chrome.runtime.sendMessage({ kind: "key-save", key: input.value });
    } else if (!(await allowed)) {
      res = { ok: false, error: s.baseUrl ? "Unstuck needs your permission to reach that address." : "Fill in the API address." };
    } else {
      status.textContent = `Trying ${s.model || "the model"}…`;
      res = await chrome.runtime.sendMessage({ kind: "provider-save", settings: s, key: input.value });
    }
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
  })();
}

async function checkServer() {
  const el = $("#server");
  const res = await chrome.runtime.sendMessage({ kind: "api", path: "/health" });
  if (res?.ok && res.data.direct) {
    el.textContent = `Straight to ${res.data.provider ?? "Gemini"}${res.data.model ? ` (${res.data.model})` : ""}, with your key ✓`;
    el.className = "ok";
  } else if (res?.ok) {
    el.textContent = res.data.mock ? "Local server in mock mode (no Gemini key): canned answers." : `Local server, with ${res.data.flash} and ${res.data.decision} ✓`;
    el.className = res.data.mock ? "warn" : "ok";
  } else {
    el.textContent = "Not connected: add a key above (or start the local server with a key: see the README).";
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
  const select = $<HTMLSelectElement>("#provider");
  for (const p of PRESETS) select.append(Object.assign(document.createElement("option"), { value: p.id, textContent: p.name }));
  const { provider: saved } = (await chrome.storage.local.get("provider")) as { provider?: { preset: string; baseUrl?: string; model?: string; simModel?: string } };
  select.value = presetOf(saved?.preset).id;
  showPreset();
  if (saved && saved.preset !== "gemini") {
    $<HTMLInputElement>("#base-url").value = saved.baseUrl ?? "";
    $<HTMLInputElement>("#model").value = saved.model ?? "";
    $<HTMLInputElement>("#sim-model").value = saved.simModel ?? "";
  }
  select.onchange = () => (showPreset(), void showKey());
  $("#list-models").onclick = () => listModels();
  $("#key-save").onclick = () => saveKey();
  $<HTMLInputElement>("#key").onkeydown = (e) => e.key === "Enter" && saveKey();
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

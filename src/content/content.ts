// Entry point on youtube.com: adds the Unstuck buttons to the player and runs one Session
// per video while switched on. YouTube is a single-page app, so we follow its navigation.
import { askPage, getSettings, type PlayerInfo } from "./bridge.ts";
import { Session } from "./session.ts";
import { KNOT_TANGLED } from "./styles.ts";

let session: Session | null = null;
let videoId: string | null = null;
let starting = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watchId = () => (location.pathname === "/watch" ? new URL(location.href).searchParams.get("v") : null);

async function waitFor<T>(fn: () => T | null | undefined, ms = 8000): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
}

/** The player's details, once it has switched to this video (it lags behind navigation). */
async function playerInfo(id: string): Promise<PlayerInfo | null> {
  for (let i = 0; i < 30; i++) {
    const info = await askPage<PlayerInfo>("info");
    if (info?.videoId === id) return info;
    await sleep(200);
  }
  return null;
}

function buttons(): { toggle: HTMLButtonElement; ask: HTMLButtonElement } | null {
  const controls = document.querySelector("#movie_player .ytp-right-controls");
  if (!controls) return null;
  let toggle = controls.querySelector<HTMLButtonElement>(".unstuck-toggle");
  let ask = controls.querySelector<HTMLButtonElement>(".unstuck-ask");
  if (!toggle || !ask) {
    toggle = document.createElement("button");
    toggle.className = "ytp-button unstuck-toggle";
    toggle.innerHTML = trusted(`<svg viewBox="0 0 32 32"><path d="${KNOT_TANGLED}"/></svg>`);
    toggle.onclick = () => (session ? stop() : void start());
    ask = document.createElement("button");
    ask.className = "ytp-button unstuck-ask";
    ask.textContent = "?";
    ask.title = "Explain this (press E)";
    ask.onclick = () => session?.ask();
    controls.prepend(ask);
    controls.prepend(toggle);
  }
  return { toggle, ask };
}

function paint(state: "off" | "on" | "disabled", why = "") {
  const b = buttons();
  if (!b) return;
  b.toggle.dataset.state = state;
  b.toggle.title = state === "on" ? "Unstuck is on: click or press U to switch off" : state === "disabled" ? `Unstuck: ${why}` : "Unstuck: help when you're stuck (click or press U)";
  b.toggle.setAttribute("aria-label", b.toggle.title);
  b.ask.hidden = state !== "on";
}

async function start() {
  if (session || starting) return;
  const id = watchId();
  if (!id) return;
  starting = true;
  try {
    const [info, player, video] = await Promise.all([
      playerInfo(id),
      waitFor(() => document.querySelector<HTMLElement>("#movie_player")),
      waitFor(() => document.querySelector<HTMLVideoElement>("#movie_player video")),
    ]);
    if (!info || !player || !video || watchId() !== id) return;
    const s = new Session(player, video, info, await getSettings());
    if (await s.start()) {
      session = s;
      paint("on");
    } else setTimeout(() => s.stop(), 8500); // leave the "can't reach the server" note up
  } finally {
    starting = false;
  }
}

function stop() {
  session?.stop();
  session = null;
  paint("off");
}

async function onNavigate() {
  const id = watchId();
  if (id === videoId) return;
  stop();
  videoId = id;
  if (!id) return;
  if (!(await waitFor(buttons))) return;
  paint("off");
  const info = await playerInfo(id);
  if (!info || watchId() !== id) return;
  if (info.isLive) return paint("disabled", "live streams aren't supported");
  if (!info.tracks.length) return paint("disabled", "this video has no captions");
  const settings = await getSettings();
  if (info.channelId && settings.alwaysOnChannels.includes(info.channelId)) void start();
}

// U switches Unstuck on and off, E takes the pop-up (or asks), Q asks about right now, D shows the face meter. Typing inside our own panel must never reach YouTube's
// shortcuts (k pauses, f goes fullscreen...), so we catch those keys first.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && session?.closeSim()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (session?.ownsKeyEvent(e)) return; // handled by the input itself (session.ts shieldKeys)
    const key = e.key.toLowerCase();
    if (!["e", "q", "d", "u"].includes(key) || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.composedPath()[0] as HTMLElement;
    if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
    if (key === "u") {
      if (!watchId()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      return void (session ? stop() : start());
    }
    if (!session) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (key === "d") session.toggleMeter(); // the face meter, for tuning
    else session.ask(key === "q");
  },
  true,
);

document.addEventListener("yt-navigate-finish", () => void onNavigate());
void onNavigate();

// The control-bar icon is static markup we wrote ourselves.
let policy: any;
function trusted(html: string): any {
  try {
    policy ??= (window as any).trustedTypes?.createPolicy("unstuck-icon", { createHTML: (s: string) => s }) ?? null;
  } catch {
    policy = null;
  }
  return policy ? policy.createHTML(html) : html;
}

// Backup for the input shield: YouTube also listens to keypress/keyup on the window.
for (const type of ["keypress", "keyup"] as const) {
  window.addEventListener(type, (e) => session?.ownsKeyEvent(e) && e.stopImmediatePropagation(), true);
}

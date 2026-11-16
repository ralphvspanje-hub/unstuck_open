// Entry point on Panopto, the lecture-recording host many universities use (the viewer page, and
// the player embedded in Canvas, Brightspace or Moodle). Starts a Session by itself: someone who
// opens a recorded lecture with Unstuck installed wants it on. U or the knot button switches it off.
import { lectureFrom, outlineText, parseSrt, type Lecture } from "../core/panopto.ts";
import { getSettings, type PlayerInfo } from "./bridge.ts";
import { Session } from "./session.ts";
import type { Site } from "./sites.ts";
import { KNOT_TANGLED } from "./styles.ts";

let session: Session | null = null;
let lecture: Lecture | null = null;
let starting = false;
let button: HTMLButtonElement | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lectureId = () => new URLSearchParams(location.search).get("id");

/** The video worth watching: the biggest one on the page (the slides or screen, not the small camera view). */
function mainVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let area = 0;
  for (const v of document.querySelectorAll("video")) {
    const a = v.clientWidth * v.clientHeight;
    if (a > area && v.readyState > 0) [best, area] = [v, a];
  }
  return area > 120 * 90 ? best : null;
}

async function waitFor<T>(fn: () => T | null, ms: number): Promise<T | null> {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(300)) {
    const v = fn();
    if (v) return v;
  }
  return null;
}

async function deliveryInfo(id: string): Promise<Lecture> {
  const res = await fetch("/Panopto/Pages/Viewer/DeliveryInfo.aspx", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ deliveryId: id, isEmbed: "true", responseType: "json" }),
    credentials: "same-origin",
  });
  return lectureFrom(id, await res.json().catch(() => null));
}

function site(video: HTMLVideoElement, l: Lecture): Site {
  return {
    kind: "panopto",
    sound: true,
    captions: async () => {
      if (l.captionTrack === null) return { segs: [], lang: "" };
      const srt = await fetch(`/Panopto/Pages/Transcription/GenerateSRT.ashx?id=${encodeURIComponent(l.id)}&language=${l.captionTrack}`, { credentials: "same-origin" }).then(
        (r) => (r.ok ? r.text() : ""),
        () => "",
      );
      return { segs: parseSrt(srt), lang: "" }; // the language: whatever the lecturer speaks
    },
    outline: (t) => outlineText(l.outline, t),
    isAd: () => false,
    play: () => void video.play().catch(() => {}),
    pause: () => video.pause(),
    room: false,
    alwaysFor: "",
  };
}

/** The element the video fills: Unstuck's layers go inside it. */
function playerOf(video: HTMLVideoElement): HTMLElement {
  const box = video.parentElement ?? document.body;
  if (getComputedStyle(box).position === "static") box.style.position = "relative";
  return box;
}

/** Only the lecture viewer and the embedded player; other Panopto pages (folders, lists) are left alone. */
const onLecturePage = () => /\/Panopto\/Pages\/(Viewer|Embed)\.aspx$/i.test(location.pathname) && Boolean(lectureId());

async function start() {
  if (session || starting || !onLecturePage()) return;
  const id = lectureId();
  if (!id) return;
  starting = true;
  try {
    const video = await waitFor(mainVideo, 20_000);
    if (!video || lectureId() !== id) return;
    lecture ??= await deliveryInfo(id).catch(() => null);
    const l = lecture ?? { id, title: document.title || "Lecture", durationSec: 0, captionTrack: null, outline: [] };
    const info: PlayerInfo = {
      videoId: id,
      title: l.title,
      channelId: `panopto:${location.host}`,
      author: "",
      isLive: false,
      durationSec: l.durationSec || video.duration || 0,
      tracks: [],
      captionsOn: false,
      defaultCaption: null,
    };
    const player = playerOf(video);
    const s = new Session(player, video, info, await getSettings(), site(video, l));
    if (await s.start()) {
      session = s;
      paint();
      placeButton(player);
    } else setTimeout(() => s.stop(), 8500);
  } finally {
    starting = false;
  }
}

function stop() {
  session?.stop();
  session = null;
  paint();
}

// ── the knot button, top left of the lecture video ──────────────────────

function placeButton(player: HTMLElement) {
  if (!button) {
    const host = document.createElement("unstuck-button");
    host.style.cssText = "position:absolute;top:10px;left:10px;z-index:72;display:block;"; // left: the chat docks on the right
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      button{width:38px;height:38px;border-radius:50%;border:0;cursor:pointer;display:grid;place-items:center;
        background:rgba(18,19,24,.78);opacity:.7;transition:opacity .15s}
      button:hover,button.on{opacity:1}
      svg{width:24px;height:24px} path{fill:none;stroke:#f4f4f5;stroke-width:3;stroke-linecap:round}
      button.on path{stroke:#ff7a59}
    </style><button><svg viewBox="0 0 32 32"><path d="${KNOT_TANGLED}"/></svg></button>`;
    button = root.querySelector("button")!;
    button.onclick = (e) => {
      e.stopPropagation();
      if (session) stop();
      else void start();
    };
    (button as any).host = host;
  }
  const host = (button as any).host as HTMLElement;
  if (host.parentElement !== player) player.append(host);
  paint();
}

function paint() {
  if (!button) return;
  button.classList.toggle("on", Boolean(session));
  button.title = session ? "Unstuck is on: click or press U to switch it off" : "Unstuck is off: click or press U to switch it on";
  button.setAttribute("aria-label", button.title);
}

// ── keys: U on/off, E explain (Q right now, D the face meter, for testing) ──

window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && session?.closeSim()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (session?.ownsKeyEvent(e)) return;
    const key = e.key.toLowerCase();
    if (!["e", "q", "d", "u"].includes(key) || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.composedPath()[0] as HTMLElement;
    if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "")) return;
    if (key === "u") {
      if (!lectureId()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      return void (session ? stop() : start());
    }
    if (!session) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (key === "d") session.toggleMeter();
    else session.ask(key === "q");
  },
  true,
);
for (const type of ["keypress", "keyup"] as const) {
  window.addEventListener(type, (e) => session?.ownsKeyEvent(e) && e.stopImmediatePropagation(), true);
}

// A playlist moves to the next lecture without a page load: start over for it.
let shown = lectureId();
setInterval(() => {
  const id = lectureId();
  if (id === shown) return;
  shown = id;
  stop();
  lecture = null;
  if (id) void start();
}, 1000);

// With autoplay off the lecture video stays empty until the Viewer presses play: start then.
document.addEventListener("play", () => !session && void start(), true);
void start();

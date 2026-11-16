// The camera view (a demo window, opened from the face meter): your own camera picture with the
// face mesh on it, the live readings against their lines, and TRIGGER whenever your face alone
// would set Unstuck off. A page of Unstuck's own, so the picture never enters youtube.com, and it is
// shown here and goes nowhere (ADR 0002). The numbers come from Unstuck's camera page, so they are
// exactly the ones the YouTube tab works with; this page runs its own face model only to draw a
// mesh that keeps up with the picture.
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Detector, FACE_DEFAULTS, FACE_LINES_VERSION, RULES, type FaceLines } from "../core/rules.ts";
import type { FaceReading } from "../core/types.ts";
import { drawFaceMesh, meshPoints, meshShape } from "../content/facemesh.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const video = $<HTMLVideoElement>("video");
const canvas = $<HTMLCanvasElement>("#mesh");
const stage = $(".stage");
const status = $(".status");
const banner = $(".banner");
const SHAPE = meshShape(FaceLandmarker);
const RANGE: Record<keyof FaceLines, [number, number]> = { frownAt: [0, 0.6], lidsAt: [0, 0.4], tiltAt: [0, 30], leanAt: [1, 1.3] };
const SHOW: Record<keyof FaceLines, (v: number) => string> = {
  frownAt: (v) => v.toFixed(2),
  lidsAt: (v) => v.toFixed(2),
  tiltAt: (v) => `${v.toFixed(0)}°`,
  leanAt: (v) => `${v.toFixed(2)}×`,
};

/** The lines you set in the face meter. */
async function applyLines() {
  const { settings } = (await chrome.storage.local.get("settings")) as { settings?: { faceLines?: Partial<FaceLines> & { v?: number } } };
  const mine: Partial<FaceLines> = settings?.faceLines?.v === FACE_LINES_VERSION ? settings.faceLines : {};
  for (const k of Object.keys(FACE_DEFAULTS) as (keyof FaceLines)[]) RULES[k] = (mine[k] ?? 0) > 0 ? mine[k]! : FACE_DEFAULTS[k];
}
chrome.storage.onChanged.addListener((c) => void (c.settings && applyLines()));

// ── getting out: Esc or ✕ Close, whatever state the window is in ────────────

function close() {
  void chrome.windows
    .getCurrent()
    .then((w) => (w.id !== undefined ? chrome.windows.remove(w.id) : window.close()))
    .catch(() => window.close());
}
$<HTMLButtonElement>("button.close").onclick = close;
addEventListener("keydown", (e) => e.key === "Escape" && close());

// ── readings from Unstuck's camera page ─────────────────────────────────

let last: { r: FaceReading; at: number } | null = null;
let firedAt = 0;
const fired: string[] = [];
const test = new Detector(); // the face rule on its own, always "playing", like the face meter
test.handle({ kind: "play", wall: Date.now(), t: 0 });
const channel = new BroadcastChannel("unstuck-camera");
const hello = () => channel.postMessage({ hello: true }); // also keeps the camera page running while this is open
hello();
setInterval(hello, 1000);
channel.onmessage = (e) => {
  const r = e.data?.reading as FaceReading | undefined;
  if (!r) return;
  last = { r, at: Date.now() };
  if (r.present && !r.lookingAway && r.detail?.ready) {
    const [c] = test.handle({ kind: "face", wall: r.wall, t: 0, frown: r.frown, lids: r.lids, tilt: r.tilt, lean: r.lean });
    if (c?.type === "stuck") fire(c.reason.startsWith("leaned") ? "lean in" : `confused look (${c.reason.match(/\(([^)]*)\)/)?.[1] ?? ""})`);
  }
  paint();
};

function reading() {
  return last && Date.now() - last.at < 2000 ? last.r : null;
}

function fire(why: string) {
  firedAt = Date.now();
  banner.textContent = `TRIGGER · ${why}`;
  banner.classList.add("on");
  stage.classList.add("fire");
  setTimeout(() => Date.now() - firedAt >= 2400 && (banner.classList.remove("on"), stage.classList.remove("fire")), 2500);
  fired.unshift(`${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ${why}`);
  $(".log").textContent = `Triggered: ${fired.slice(0, 4).join(" · ")}`;
}

function paint() {
  const r = reading();
  const values: Record<keyof FaceLines, number> = { frownAt: r?.frown ?? 0, lidsAt: r?.lids ?? 0, tiltAt: Math.abs(r?.tilt ?? 0), leanAt: r?.lean ?? 1 };
  for (const k of Object.keys(values) as (keyof FaceLines)[]) {
    const chip = document.querySelector<HTMLElement>(`.chip[data-k="${k}"]`)!;
    const [lo, hi] = RANGE[k];
    const at = (v: number) => `${Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100}%`;
    chip.classList.toggle("hot", Boolean(r) && values[k] >= RULES[k]);
    chip.querySelector<HTMLElement>(".v")!.textContent = r ? SHOW[k](values[k]) : "–";
    chip.querySelector<HTMLElement>(".fill")!.style.width = at(values[k]);
    chip.querySelector<HTMLElement>(".tick")!.style.left = at(RULES[k]);
    chip.querySelector<HTMLElement>(".n")!.textContent = `${chip.querySelector(".n")!.textContent!.split(" ·")[0]} · line ${SHOW[k](RULES[k])}`;
  }
  const f = test.faceStatus(Date.now());
  $(".confused .hold").style.transform = `scaleX(${f.confused})`;
  $(".lean .hold").style.transform = `scaleX(${f.lean})`;
  status.textContent = !r
    ? "Waiting for Unstuck's numbers: switch Unstuck on in the YouTube tab"
    : !r.present
      ? "No face in view"
      : r.lookingAway
        ? "Looking away"
        : !r.detail?.ready
          ? "Learning your resting face…"
          : `Reading your face · hold ${RULES.faceHoldSec} s to trigger`;
}
setInterval(paint, 500);

// ── the picture and its mesh ────────────────────────────────────────────

async function start() {
  await applyLines();
  paint();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  } catch (e) {
    status.textContent = `No camera (${(e as Error).name}). Allow it on Unstuck's setup page.`;
    return;
  }
  video.srcObject = stream;
  await video.play();
  const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("wasm"));
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: chrome.runtime.getURL("assets/face_landmarker.task"), delegate },
    runningMode: "VIDEO" as const,
    numFaces: 1,
  });
  const lm = await FaceLandmarker.createFromOptions(fileset, options("GPU")).catch(() => FaceLandmarker.createFromOptions(fileset, options("CPU")));
  const frame = () => {
    const pts = lm.detectForVideo(video, performance.now()).faceLandmarks[0];
    const r = reading();
    const glow = Math.max(0, 1 - (Date.now() - firedAt) / 1500);
    const hot = { brows: Boolean(r && r.frown >= RULES.frownAt), lids: Boolean(r && r.lids >= RULES.lidsAt), tilt: Boolean(r && Math.abs(r.tilt) >= RULES.tiltAt), glow };
    if (pts) drawFaceMesh(canvas, { pts: meshPoints(pts), shape: SHAPE }, hot, { frame: true, aspect: video.videoWidth / video.videoHeight });
    else canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    video.requestVideoFrameCallback(frame);
  };
  video.requestVideoFrameCallback(frame);
}
void start();

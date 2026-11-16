// The camera page (ADR 0001, 0002). Runs MediaPipe on this laptop and sends out Face
// readings: a handful of numbers, about 6 times a second. No image ever leaves this page.
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceMesh, FaceReading } from "../core/types.ts";
import { meshPoints, meshShape } from "../content/facemesh.ts";

let running = false;
let stream: MediaStream | null = null;
let landmarker: FaceLandmarker | null = null;

// The demo view. The face meter asks for the mesh (points, not an image) while it is open. The
// camera view, a window of Unstuck's own, hears every reading on this channel, and while it is
// open the camera keeps running even when the video is paused.
let meshWanted = false;
let viewSeen = 0;
let pauseWanted = false;
const SHAPE = meshShape(FaceLandmarker);
const channel = new BroadcastChannel("unstuck-camera");
channel.onmessage = (e) => {
  if (e.data?.hello) viewSeen = Date.now();
};
const viewOpen = () => Date.now() - viewSeen < 2500;

// The Viewer's own resting face, from the last 3 minutes of readings while facing the screen.
// Faces differ a lot at rest (brows, glasses, light), so everything is measured against these.
const WINDOW = 1080; // ~3 min at ~6 readings a second
const recent = { brow: [] as number[], squint: [] as number[], width: [] as number[], pitch: [] as number[], roll: [] as number[] };
/** The usual head angle comes from the last ~30 s only: sitting with a tilted head soon becomes "straight". */
const ROLL_WINDOW = 180;
const keep = (a: number[], v: number) => {
  a.push(v);
  if (a.length > WINDOW) a.shift();
};
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== "offscreen") return;
  if (msg.kind === "face-start") {
    pauseWanted = false;
    void start();
  }
  if (msg.kind === "face-pause") {
    pauseWanted = true;
    if (!viewOpen()) pause();
  }
  if (msg.kind === "face-mesh") meshWanted = Boolean(msg.on);
  if (msg.kind === "face-stop") stop();
});

async function start() {
  if (running) return;
  running = true;
  let s: MediaStream;
  try {
    s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 15 } });
  } catch (e) {
    running = false;
    chrome.runtime.sendMessage({ kind: "camera-denied", error: String(e) });
    return;
  }
  if (!running) return s.getTracks().forEach((t) => t.stop()); // paused while it was starting
  stream = s;
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("wasm"));
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: chrome.runtime.getURL("assets/face_landmarker.task"), delegate },
    runningMode: "VIDEO" as const,
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
  // Loaded once; a paused camera keeps it (and the resting face below), so it comes back quickly.
  landmarker ??= await FaceLandmarker.createFromOptions(fileset, options("GPU")).catch(() => FaceLandmarker.createFromOptions(fileset, options("CPU")));

  const loop = () => {
    if (!running || !landmarker) return;
    if (pauseWanted && !viewOpen()) return pause();
    try {
      const { reading, mesh } = read(landmarker, video);
      chrome.runtime.sendMessage({ kind: "face", reading, ...(meshWanted && mesh ? { mesh } : {}) }).catch(() => {});
      channel.postMessage({ reading });
    } catch {}
    setTimeout(loop, 160);
  };
  loop();
}

/** The camera stops (its light goes off), but the page keeps the model and the Viewer's resting face. */
function pause() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function stop() {
  pause();
  landmarker?.close();
  landmarker = null;
}

function read(lm: FaceLandmarker, video: HTMLVideoElement): { reading: FaceReading; mesh: FaceMesh | null } {
  const res = lm.detectForVideo(video, performance.now());
  const pts = res.faceLandmarks[0];
  return { reading: readingOf(res, video), mesh: pts ? { pts: meshPoints(pts), shape: SHAPE } : null };
}

function readingOf(res: ReturnType<FaceLandmarker["detectForVideo"]>, video: HTMLVideoElement): FaceReading {
  const pts = res.faceLandmarks[0];
  const wall = Date.now();
  if (!pts) return { wall, present: false, lookingAway: false, frown: 0, lids: 0, tilt: 0, lean: 1 };
  const score: Record<string, number> = {};
  for (const c of res.faceBlendshapes[0]?.categories ?? []) score[c.categoryName] = c.score;

  const left = pts[234];
  const right = pts[454];
  const nose = pts[1];
  const eyes = { y: (pts[33].y + pts[263].y) / 2 };
  const chin = pts[152];
  const width = right.x - left.x;
  const yaw = (nose.x - left.x) / (width || 1); // 0.5 = facing the screen
  const pitch = (nose.y - eyes.y) / ((chin.y - eyes.y) || 1); // grows when looking down
  // Sideways tilt: the angle of the line between the outer eye corners, in real pixels (x and y are
  // normalised separately, so they're scaled back first).
  const roll = (Math.atan2((pts[263].y - pts[33].y) * video.videoHeight, (pts[263].x - pts[33].x) * video.videoWidth) * 180) / Math.PI;

  const browDown = ((score.browDownLeft ?? 0) + (score.browDownRight ?? 0)) / 2;
  const squint = ((score.eyeSquintLeft ?? 0) + (score.eyeSquintRight ?? 0)) / 2;
  const facing = Math.abs(yaw - 0.5) < 0.12;
  if (facing) {
    keep(recent.brow, browDown);
    keep(recent.squint, squint);
    keep(recent.width, width);
    keep(recent.pitch, pitch);
    recent.roll.push(roll);
    if (recent.roll.length > ROLL_WINDOW) recent.roll.shift();
  }
  const ready = recent.brow.length >= 18; // ~3 s of facing the screen
  // The low quarter of the last 3 minutes is "at rest": two minutes of frowning (testing!) don't move
  // it, and a few raised-eyebrow moments don't drag it down.
  const browRest = ready ? pct(recent.brow, 0.25) : browDown;
  const squintRest = ready ? pct(recent.squint, 0.25) : squint;
  const rollUsual = recent.roll.length ? pct(recent.roll, 0.5) : roll;
  const lookDown = ((score.eyeLookDownLeft ?? 0) + (score.eyeLookDownRight ?? 0)) / 2;
  const turned = Math.abs(yaw - 0.5) > 0.2;
  const headDown = ready && pitch > pct(recent.pitch, 0.5) + 0.12;

  return {
    wall,
    present: true,
    lookingAway: turned || headDown || lookDown > 0.6,
    frown: ready ? Math.max(0, browDown - browRest) : 0,
    lids: ready ? Math.max(0, squint - squintRest) : 0,
    tilt: ready && facing ? roll - rollUsual : 0,
    lean: ready ? width / pct(recent.width, 0.5) : 1,
    detail: {
      browDown,
      browRest,
      browInnerUp: score.browInnerUp ?? 0,
      squint,
      squintRest,
      roll,
      rollUsual,
      yaw,
      lookDown,
      ready,
    },
  };
}

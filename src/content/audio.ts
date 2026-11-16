// The last minutes of the video's sound, for lectures: lecturers build one idea up slowly, and their
// captions are often missing or wrong. Recorded on this laptop from the video itself (not the
// microphone), in one-minute pieces, only while it plays, and kept in memory only. Sent with an
// Explanation or a Recap, so the model can listen to what was said.
const MIME = "audio/webm;codecs=opus";

export type Sound = { mime: string; b64: string; sec: number };

export class AudioMemory {
  private video: HTMLVideoElement;
  private keepSec: number;
  private pieceSec: number;
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  /** Finished pieces, oldest first. */
  private pieces: { blob: Blob; sec: number }[] = [];
  /** Seconds recorded in the current piece, counted while recording. */
  private recSec = 0;
  private recFrom = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushed: (() => void) | null = null;
  private off: (() => void)[] = [];
  stopped = false;

  constructor(video: HTMLVideoElement, keepSec = 300, pieceSec = 60) {
    this.video = video;
    this.keepSec = keepSec;
    this.pieceSec = pieceSec;
  }

  /** False when this browser or video can't give its sound. */
  start(): boolean {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported(MIME)) return false;
    try {
      this.stream = (this.video as any).captureStream?.() ?? null;
    } catch {
      this.stream = null; // a video from another site without permission to read it
    }
    if (!this.stream) return false;
    const on = (ev: string, fn: () => void) => {
      this.video.addEventListener(ev, fn);
      this.off.push(() => this.video.removeEventListener(ev, fn));
    };
    on("playing", () => this.resume());
    on("pause", () => this.hold());
    on("waiting", () => this.hold());
    this.stream.addEventListener("addtrack", () => !this.video.paused && this.resume());
    this.timer = setInterval(() => {
      if (this.rec?.state === "recording" && this.elapsed() >= this.pieceSec) void this.cut();
    }, 1000);
    if (!this.video.paused) this.resume();
    return true;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const fn of this.off) fn();
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    } catch {}
    this.rec = null;
    this.pieces = [];
    this.chunks = [];
  }

  /** Everything kept, as base64 pieces (oldest first), including the piece being recorded now. */
  async recent(): Promise<Sound[]> {
    if (this.rec && this.rec.state !== "inactive") await this.cut(!this.video.paused);
    const out: Sound[] = [];
    for (const p of this.pieces) {
      if (p.sec < 0.5 || !p.blob.size) continue;
      out.push({ mime: "audio/webm", b64: await toBase64(p.blob), sec: p.sec });
    }
    return out;
  }

  private elapsed() {
    return this.recSec + (this.rec?.state === "recording" ? (performance.now() - this.recFrom) / 1000 : 0);
  }

  private resume() {
    if (this.stopped || !this.stream) return;
    const tracks = this.stream.getAudioTracks();
    if (!tracks.length) return; // the sound arrives once the video has started; "addtrack" calls again
    if (!this.rec || this.rec.state === "inactive") return this.begin(tracks);
    if (this.rec.state === "paused") {
      this.rec.resume();
      this.recFrom = performance.now();
    }
  }

  private hold() {
    if (this.rec?.state !== "recording") return;
    this.recSec = this.elapsed();
    this.rec.pause();
  }

  private begin(tracks: MediaStreamTrack[]) {
    this.chunks = [];
    this.recSec = 0;
    this.recFrom = performance.now();
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: MIME, audioBitsPerSecond: 32_000 });
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => {
      const sec = this.recSec;
      if (this.chunks.length) this.pieces.push({ blob: new Blob(this.chunks, { type: "audio/webm" }), sec });
      this.chunks = [];
      let total = this.pieces.reduce((s, p) => s + p.sec, 0);
      while (this.pieces.length > 1 && total - this.pieces[0].sec >= this.keepSec) total -= this.pieces.shift()!.sec;
      this.flushed?.();
      this.flushed = null;
    };
    rec.onerror = (e) => console.warn("[unstuck] lecture sound: recorder error", (e as any)?.error?.name ?? e);
    rec.start();
    this.rec = rec;
    console.debug("[unstuck] lecture sound: recording a piece");
  }

  /** Ends the current piece (a file of its own) and, if asked, starts the next one. */
  private cut(again = true): Promise<void> {
    const rec = this.rec;
    if (!rec || rec.state === "inactive") return Promise.resolve();
    this.recSec = this.elapsed();
    const done = new Promise<void>((ok) => (this.flushed = ok));
    rec.stop();
    this.rec = null;
    return done.then(() => {
      if (again && !this.stopped && this.stream) {
        const tracks = this.stream.getAudioTracks();
        if (tracks.length) this.begin(tracks);
      }
    });
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

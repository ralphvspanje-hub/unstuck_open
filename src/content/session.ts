// One Session: a video watched with Unstuck switched on (GLOSSARY.md).
// Signals → Detector → judge (Decision 1) → Offer → Explanation → outcomes in the Offer log.
import { cropAround, fromCrop, normPhrase, parseAnswer, phraseShown, placeMarks, sameThing, thingsToLocate, worthRefining, type ParsedAnswer } from "../core/answer.ts";
import { fullTranscript, mmss, nextSentenceEnd, parseCaptions, parseTranscriptItems, pickTrack, sameLang, transcriptWindow } from "../core/captions.ts";
import { Detector, FACE_DEFAULTS, FACE_LINES_VERSION, OfferGate, RULES, signalLine, type Candidate, type DetectorEvent } from "../core/rules.ts";
import { firstSentence, stripRefs, wrapPhrases } from "../core/textfmt.ts";
import type { Box, CaptionSegment, ExplainRequest, FaceMesh, FaceReading, LocateResponse, Mark, VideoMap } from "../core/types.ts";
import { api, askPage, onCaptions, saveSettings, streamApi, type PlayerInfo, type Settings } from "./bridge.ts";
import { FrameMemory, busyMap, captureFrame, cropFrame, videoContentRect, type Frame } from "./frame.ts";
import { explanationHTML, setHTML } from "./html.ts";
import { addEntry, newId, updateEntry } from "./log.ts";
import { cleanSimHtml, withGuard } from "../core/sim.ts";
import { FaceMeter } from "./meter.ts";
import { SimStage } from "./simstage.ts";
import { drawFigure } from "./figure.ts";
import { Room, type RoomMemory } from "./room.ts";
import { readTranscriptPanel } from "./transcript.ts";
import { AudioMemory } from "./audio.ts";
import { youtubeSite, type Site } from "./sites.ts";
import { Panel, PlayerOverlay, Typer, el, type PanelMemory } from "./ui.ts";

type State = "watching" | "judging" | "offer" | "panel" | "ended";
type Sim = { stage: SimStage; btn: HTMLElement; state: "building" | "running" | "failed"; stop: () => void };

/** A model answer arriving bit by bit. Explanations are fetched ahead, while the Offer shows (Q23). */
class AnswerStream {
  raw = "";
  done = false;
  error = "";
  /** When it was asked for, and when its first text came: shown in the "think first" test. */
  readonly askedAt = performance.now();
  firstAt = 0;
  /** The server lets this one think first (follow-ups; the first answer in the "think first" test). */
  readonly thinks: boolean;
  private subs = new Set<() => void>();
  stop: () => void;
  /** `more`: fields that take a moment to gather (a lecture's sound), added before the request goes out. */
  constructor(path: string, body: unknown, more?: Promise<object>) {
    const b = body as Partial<ExplainRequest> | undefined;
    this.thinks = path === "/explain" && (b?.mode === "followup" || b?.think === true);
    let stopped = false;
    let stopNow = () => {};
    this.stop = () => {
      stopped = true;
      stopNow();
    };
    void (more ?? Promise.resolve({})).catch(() => ({})).then((extra) => {
      if (stopped) return;
      stopNow = this.open(path, { ...(body as object), ...extra });
    });
  }
  private open(path: string, body: unknown): () => void {
    return streamApi(path, body, {
      delta: (s) => {
        this.firstAt ||= performance.now();
        this.raw += s;
        this.emit();
      },
      done: () => {
        this.done = true;
        this.emit();
      },
      error: (e) => {
        this.error = e;
        this.done = true;
        this.emit();
      },
    });
  }
  get parsed(): ParsedAnswer {
    return parseAnswer(this.raw.replace(/<error>[\s\S]*?<\/error>/g, ""), this.done);
  }
  get serverError() {
    return this.raw.match(/<error>([\s\S]*?)<\/error>/)?.[1] ?? this.error;
  }
  on(fn: () => void) {
    this.subs.add(fn);
    fn();
    return () => this.subs.delete(fn);
  }
  private emit() {
    for (const fn of this.subs) fn();
  }
}

export class Session {
  private segs: CaptionSegment[] = [];
  private map?: VideoMap;
  private detector = new Detector();
  private gate = new OfferGate();
  private state: State = "watching";
  private overlay: PlayerOverlay;
  private panel: Panel | null = null;
  private explained: { id: string; t: number; text: string }[] = [];
  private cleanup: (() => void)[] = [];
  private lastTime = 0;
  private rate = 1;
  private oursUntil = 0;
  private faceAway: { since: number; t: number; reported: boolean } | null = null;
  private hidCaptions = false;
  private pausedAt = 0;
  private rewindWatch: { id: string; until: number } | null = null;
  private stopRender: (() => void) | null = null;
  private mock = false;
  private meter: FaceMeter | null = null;
  /** The face rule run on its own for the meter: always "playing", so it shows when the face alone would fire. */
  private meterTest: Detector | null = null;
  private cameraAwayTimer: ReturnType<typeof setTimeout> | undefined;
  private cameraOffForAway = false;
  /** The camera stopped because the video has been paused for a while; it comes back on play. */
  private cameraPaused = false;
  private cameraPauseTimer: ReturnType<typeof setTimeout> | undefined;
  /** Where the Viewer dragged the panel to, kept in settings across videos. */
  private panelMemory: PanelMemory = {
    get: (fs) => (fs ? this.settings.panelRectFs : this.settings.panelRect) ?? null,
    set: (fs, r) => {
      if (fs) this.settings.panelRectFs = r;
      else this.settings.panelRect = r;
      void saveSettings(fs ? { panelRectFs: r } : { panelRect: r });
    },
  };
  /** Where the Viewer put the windows in the Room, kept in settings across videos. */
  private roomMemory: RoomMemory = {
    get: (w) => (w === "panel" ? this.settings.roomPanel : this.settings.roomSim) ?? null,
    set: (w, f) => {
      if (w === "panel") this.settings.roomPanel = f;
      else this.settings.roomSim = f;
      void saveSettings(w === "panel" ? { roomPanel: f } : { roomSim: f });
    },
  };
  /** While the chat is open, the video makes room for it (GLOSSARY.md). */
  private room: Room;
  /** The last few seconds of frames: an Offer explains the moment the Viewer got stuck, not the moment it shows. */
  private frames: FrameMemory;
  /** This panel's simulations: hidden ones keep building, or keep their state. */
  private sims: Sim[] = [];
  private shownSim: Sim | null = null;
  private lastReading: { r: FaceReading; at: number } | null = null;
  /** The video's language, from its caption track. Answers are written in it. */
  private lang = "";
  stopped = false;

  private player: HTMLElement;
  private video: HTMLVideoElement;
  private info: PlayerInfo;
  private settings: Settings;
  /** YouTube or a lecture host: the parts of a Session that differ per site. */
  private site: Site;
  /** The last minutes of the video's sound (lectures only). */
  private sound: AudioMemory | null = null;

  constructor(player: HTMLElement, video: HTMLVideoElement, info: PlayerInfo, settings: Settings, site?: Site) {
    this.player = player;
    this.video = video;
    this.info = info;
    this.settings = settings;
    this.site = site ?? youtubeSite(player, info.author);
    this.overlay = new PlayerOverlay(player, () => videoContentRect(video, player));
    this.room = new Room(player, video, { enabled: settings.room !== false && this.site.room, memory: this.roomMemory });
    this.frames = new FrameMemory(video);
    // Face lines the Viewer set in the face meter.
    const mine = settings.faceLines?.v === FACE_LINES_VERSION ? settings.faceLines : undefined;
    for (const k of Object.keys(FACE_DEFAULTS) as (keyof typeof FACE_DEFAULTS)[]) {
      const v = mine?.[k];
      RULES[k] = typeof v === "number" && v > 0 ? v : FACE_DEFAULTS[k];
    }
    this.room.onSettled = () => this.panel?.place();
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<boolean> {
    let health: { mock: boolean };
    try {
      health = await api("/health");
    } catch (e) {
      console.debug("[unstuck] health failed", String(e));
      this.overlay.toast(`<span>${escapeText(String((e as Error)?.message ?? e))}</span>`, 8000);
      return false;
    }
    this.mock = Boolean(health.mock);
    this.welcome();
    this.listen();
    if (this.site.sound) {
      this.sound = new AudioMemory(this.video);
      if (!this.sound.start()) this.sound = null;
      console.debug(`[unstuck] lecture sound: ${this.sound ? "keeping the last 5 minutes" : "not available"}`);
    }
    void this.loadCaptions();
    if (this.settings.camera) void this.startCamera();
    return true;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.dropSims();
    this.room.destroy();
    this.frames.clear();
    this.sound?.stop();
    for (const fn of this.cleanup) fn();
    clearTimeout(this.cameraAwayTimer);
    clearTimeout(this.cameraPauseTimer);
    this.stopRender?.();
    this.overlay.destroy();
    void this.panel?.close();
    if (this.hidCaptions) {
      this.player.classList.remove("unstuck-hide-cc");
      void askPage("captions-off");
    }
    chrome.runtime.sendMessage({ kind: "camera-stop" }).catch(() => {});
  }

  private welcome() {
    this.overlay.toast(
      `<span><b>Unstuck is on</b>${this.mock ? " · mock mode" : ""}</span><span class="keys"><kbd>E</kbd> explain this <kbd>U</kbd> on/off</span>${this.site.alwaysFor ? `<label><input type="checkbox"> always for ${escapeText(this.site.alwaysFor)}</label>` : ""}`,
      5000,
      (root) => {
        const box = root.querySelector("input");
        if (!box) return;
        box.checked = Boolean(this.info.channelId && this.settings.alwaysOnChannels.includes(this.info.channelId));
        box.onchange = () => {
          if (!this.info.channelId) return;
          const set = new Set(this.settings.alwaysOnChannels);
          if (box.checked) set.add(this.info.channelId);
          else set.delete(this.info.channelId);
          this.settings.alwaysOnChannels = [...set];
          void saveSettings({ alwaysOnChannels: this.settings.alwaysOnChannels });
        };
      },
    );
  }

  // ── captions and the Video map ───────────────────────────────────────────

  private async loadCaptions() {
    if (this.site.captions) {
      // A lecture host's own captions. Without them the Session still works: it listens (lecture sound).
      try {
        const { segs, lang } = await this.site.captions();
        this.lang = lang;
        if (segs.length >= 3 && !this.stopped) {
          this.segs = segs;
          console.debug(`[unstuck] captions: ${segs.length} lines from the lecture host`);
          void this.buildMap();
        } else console.debug("[unstuck] captions: none from the lecture host; Unstuck listens instead");
      } catch (e) {
        console.warn("[unstuck] lecture captions failed", e);
      }
      return;
    }
    const pick = pickTrack(this.info);
    if (!pick) return;
    this.lang = pick.lang;
    const use = (segs: CaptionSegment[], how: string) => {
      if (segs.length < 3 || segs.length < this.segs.length * 0.5) return;
      const first = !this.segs.length;
      this.segs = segs;
      console.debug(`[unstuck] captions: ${segs.length} lines via ${how} (${pick.lang})`);
      if (first) void this.buildMap();
    };
    this.cleanup.push(
      onCaptions((c) => {
        if (c.videoId && c.videoId !== this.info.videoId) return;
        if (c.tlang) return; // a translation the Viewer picked; keep the original
        if (c.lang && !sameLang(c.lang, pick.lang)) return; // e.g. captions of an AI-dubbed language
        use(parseCaptions(c.body), "player");
      }),
    );
    const until = async (ms: number) => {
      for (let t = 0; t < ms && !this.segs.length && !this.stopped; t += 200) await new Promise((r) => setTimeout(r, 200));
      return this.segs.length > 0;
    };
    // 1. Captions the player already loaded, or loads once we switch them on (ADR 0003).
    for (const c of (await askPage<{ body: string; lang: string | null }[]>("cached-captions", { videoId: this.info.videoId })) ?? []) {
      if (!c.lang || sameLang(c.lang, pick.lang)) use(parseCaptions(c.body), "player cache");
    }
    if (!this.segs.length) {
      if (!this.info.captionsOn) {
        this.hidCaptions = true;
        this.player.classList.add("unstuck-hide-cc");
      }
      await askPage("captions-on", { lang: pick.lang, trackKind: pick.kind });
    }
    if (await until(3000)) return;
    // 2. Off and on again, so the player fetches them once more.
    console.debug("[unstuck] captions: none yet, asking the player to fetch them again");
    await askPage("captions-refetch");
    if (await until(3000)) return;
    // 3. YouTube's own transcript panel.
    console.debug("[unstuck] captions: still none, reading the transcript panel");
    if (this.stopped) return;
    use(parseTranscriptItems(await readTranscriptPanel()), "transcript panel");
    if (!this.segs.length && !this.stopped) {
      this.overlay.toast(`<span>Couldn't read this video's captions, so Unstuck can't follow along.</span>`, 7000);
    }
  }

  private async buildMap() {
    try {
      this.map = await api<VideoMap>("/map", { title: this.info.title, lang: this.lang, transcript: fullTranscript(this.segs), durationSec: this.info.durationSec || this.video.duration || 0 });
      this.detector.setDenseParts(this.map.denseParts);
    } catch (e) {
      console.warn("[unstuck] video map failed", e);
    }
  }

  // ── Signals ──────────────────────────────────────────────────────────────

  private listen() {
    const v = this.video;
    const on = (t: EventTarget, ev: string, fn: (e: any) => void) => {
      t.addEventListener(ev, fn);
      this.cleanup.push(() => t.removeEventListener(ev, fn));
    };
    const ad = () => this.site.isAd();
    const ours = () => performance.now() < this.oursUntil;
    this.lastTime = v.currentTime;
    this.rate = v.playbackRate;

    on(v, "timeupdate", () => {
      if (!ad() && !v.seeking) this.lastTime = v.currentTime;
    });
    on(v, "seeking", () => {
      if (ad()) return;
      const from = this.lastTime;
      const to = v.currentTime;
      this.lastTime = to;
      if (!ours() && this.rewindWatch && Date.now() < this.rewindWatch.until && from - to >= 3) {
        void updateEntry(this.rewindWatch.id, { explanationOutcome: "rewound" });
        this.rewindWatch = null;
      }
      this.feed({ kind: "seek", wall: Date.now(), from, to, programmatic: ours() });
    });
    on(v, "ratechange", () => {
      if (ad()) return;
      const prev = this.rate;
      this.rate = v.playbackRate;
      if (!ours()) this.feed({ kind: "rate", wall: Date.now(), t: v.currentTime, rate: v.playbackRate, prev });
    });
    on(v, "pause", () => {
      this.cameraForPlayback();
      if (!ad()) this.feed({ kind: "pause", wall: Date.now(), t: v.currentTime });
    });
    on(v, "play", () => {
      if (ad()) return;
      // Playing the video means you're back to the video: the chat folds down to its header
      // (still there to reread) and the Room gives the video its place back.
      this.cameraForPlayback();
      if (this.shownSim) this.hideSim();
      if (!ours() && this.room.enabled && this.panel && !this.panel.collapsed) this.panel.fold(true);
      // Marks belong to the paused frame: on a moving picture they'd point at the wrong things.
      this.overlay.clearMarks();
      for (const r of this.panel?.shadow.querySelectorAll(".ref:not(.off)") ?? []) r.classList.add("off");
      this.feed({ kind: "play", wall: Date.now(), t: v.currentTime });
    });
    on(v, "ended", () => !ad() && this.showSessionCard());
    on(document, "visibilitychange", () => {
      this.feed({ kind: "away", wall: Date.now(), t: v.currentTime, away: document.hidden, why: "tab" });
      this.cameraAway();
    });
    const tick = setInterval(() => {
      if (ad()) return;
      this.feed({ kind: "tick", wall: Date.now(), t: v.currentTime, playing: !v.paused });
      void this.frames.keep();
    }, 500);
    this.cleanup.push(() => clearInterval(tick));
    const onMsg = (m: any) => m?.kind === "face" && this.onFace(m.reading as FaceReading, m.mesh as FaceMesh | undefined);
    chrome.runtime.onMessage.addListener(onMsg);
    this.cleanup.push(() => chrome.runtime.onMessage.removeListener(onMsg));
  }

  private async startCamera() {
    const res = await chrome.runtime.sendMessage({ kind: "camera-start" }).catch(() => null);
    if (res?.ok) {
      if (this.meter) chrome.runtime.sendMessage({ kind: "camera-mesh", on: true }).catch(() => {}); // a new camera page forgets
      return;
    }
    const why = res?.reason === "no-model" ? "the face model isn't installed (npm run fetch-model)" : "camera access is needed (a setup tab opened)";
    this.overlay.toast(`<span>Running without the camera: ${why}.</span>`, 6000);
  }

  /** Away from the tab for a while: the camera goes off. Back: it comes on again. */
  private cameraAway() {
    if (!this.settings.camera) return;
    clearTimeout(this.cameraAwayTimer);
    if (document.hidden) {
      this.cameraAwayTimer = setTimeout(() => {
        if (!document.hidden || this.stopped) return;
        this.cameraOffForAway = true;
        console.debug(`[unstuck] camera off: the tab was hidden for ${RULES.cameraOffAwaySec} s`);
        chrome.runtime.sendMessage({ kind: "camera-stop" }).catch(() => {});
      }, RULES.cameraOffAwaySec * 1000);
    } else if (this.cameraOffForAway) {
      this.cameraOffForAway = false;
      this.cameraPaused = false;
      this.lastReading = null;
      void this.startCamera();
      this.overlay.toast(`<span>Welcome back: the camera is on again</span>`, 2500);
      this.cameraForPlayback();
    }
  }

  /**
   * The camera films only while it can matter: while the video plays, for a few seconds after a
   * pause (a confused pause still brings an Offer), and while the face meter is open.
   */
  private cameraForPlayback() {
    clearTimeout(this.cameraPauseTimer);
    if (!this.settings.camera || this.cameraOffForAway || this.stopped) return;
    if (!this.video.paused || this.meter) {
      if (this.cameraPaused) {
        this.cameraPaused = false;
        void this.startCamera();
      }
      return;
    }
    this.cameraPauseTimer = setTimeout(() => {
      if (!this.video.paused || this.meter || this.cameraPaused || this.stopped) return;
      this.cameraPaused = true;
      this.lastReading = null;
      chrome.runtime.sendMessage({ kind: "camera-pause" }).catch(() => {});
    }, RULES.faceAfterPauseSec * 1000);
  }

  private onFace(r: FaceReading, mesh?: FaceMesh) {
    this.lastReading = { r, at: Date.now() };
    if (mesh && this.meter) this.meter.drawMesh(mesh, r);
    this.paintMeter();
    if (this.site.isAd()) return;
    const away = !r.present || r.lookingAway;
    if (away) {
      this.faceAway ??= { since: r.wall, t: this.video.currentTime, reported: false };
      if (!this.faceAway.reported && r.wall - this.faceAway.since >= 2000) {
        this.faceAway.reported = true;
        this.feed({ kind: "away", wall: this.faceAway.since, t: this.faceAway.t, away: true, why: "face" });
      }
      return;
    }
    if (this.faceAway?.reported) this.feed({ kind: "away", wall: r.wall, t: this.video.currentTime, away: false, why: "face" });
    this.faceAway = null;
    const face = { kind: "face", wall: r.wall, t: this.video.currentTime, frown: r.frown, lids: r.lids ?? 0, tilt: r.tilt ?? 0, lean: r.lean } as const;
    if (this.meterTest && r.detail?.ready) {
      const [c] = this.meterTest.handle(face);
      if (c?.type === "stuck") this.meter?.fire(c.reason.startsWith("leaned") ? "lean in" : `confused look (${c.reason.match(/\(([^)]*)\)/)?.[1] ?? ""})`);
      this.paintMeter();
    }
    this.feed(face);
  }

  // ── the face meter (D) ───────────────────────────────────────────────────

  toggleMeter() {
    if (this.meter) {
      this.meter.el.remove();
      this.meter = null;
      this.meterTest = null;
      chrome.runtime.sendMessage({ kind: "camera-mesh", on: false }).catch(() => {});
      this.cameraForPlayback();
      return;
    }
    const m = (this.meter = new FaceMeter());
    this.meterTest = new Detector();
    this.cameraForPlayback(); // the camera stays on while the meter is open, also when paused
    chrome.runtime.sendMessage({ kind: "camera-mesh", on: true }).catch(() => {});
    m.onCameraView = () => chrome.runtime.sendMessage({ kind: "open-camera-view" }).catch(() => {});
    this.meterTest.handle({ kind: "play", wall: Date.now(), t: 0 });
    m.onClose = () => this.toggleMeter();
    m.onLines = (lines) => {
      this.settings.faceLines = { ...lines, v: FACE_LINES_VERSION };
      void saveSettings({ faceLines: this.settings.faceLines });
      this.paintMeter();
    };
    m.bounds = () => {
      const b = this.player.getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width, height: b.height };
    };
    this.overlay.mount(m.el);
    m.el.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" });
    this.paintMeter();
    // Keeps the countdowns and "no readings" honest when no readings arrive.
    const tick = setInterval(() => (this.meter === m ? this.paintMeter() : clearInterval(tick)), 1000);
    this.cleanup.push(() => clearInterval(tick));
  }

  private paintMeter() {
    if (!this.meter) return;
    const now = Date.now();
    const last = this.lastReading && now - this.lastReading.at < 2500 ? this.lastReading.r : null;
    const f = this.detector.faceStatus(now);
    const test = this.meterTest?.faceStatus(now) ?? f;
    const yes = "yes: a trigger now goes to the judge. (No cooldown while this meter is open.)";
    const why = !this.settings.camera
      ? "no, the camera is off. Turn it on in Unstuck's setup page (click the extension's icon)."
      : !last
        ? "no face readings yet, waiting for the camera…"
        : !last.present
          ? "no, there's no face in view."
          : last.lookingAway
            ? "no, you're looking away (that counts toward a Missed moment)."
            : !last.detail?.ready
              ? "not yet: learning your resting face. Look at the screen for a few seconds."
              : this.state !== "watching"
                ? "no, an Offer or the chat is open."
                : !f.live
                  ? `no, the video is paused. (A look in the first ${RULES.faceAfterPauseSec} s after a pause still counts; then the camera stops, except while this meter is open.)`
                  : f.fired
                    ? "it just fired. Relax your face to re-arm."
                    : yes;
    this.meter.update(last, { confusedHold: test.confused, leanHold: test.lean, counts: why, ok: why === yes });
  }

  private watching() {
    return !document.hidden && !this.faceAway?.reported;
  }

  private feed(e: DetectorEvent) {
    if (this.stopped) return;
    for (const c of this.detector.handle(e)) void this.onCandidate(c);
  }

  // ── moments ──────────────────────────────────────────────────────────────

  private async onCandidate(c: Candidate) {
    // A confused look (or leaning in) while an older Offer is still showing takes its place: the
    // Viewer is stuck on this moment now. It is a swap, not one more pop-up, so no cooldown.
    const replacing = this.state === "offer" && c.type === "stuck" && Boolean(c.face) && this.overlay.offerShowing !== null;
    // While the face meter is open you're testing: no cooldown, so you can try again right away.
    if (!replacing && (this.state !== "watching" || (!this.meter && !this.gate.canOffer(Date.now())))) {
      if (c.type === "stuck") this.meter?.note(`${c.reason}, but ${this.state !== "watching" ? "an Offer or the panel was open" : "Unstuck was cooling down"}.`);
      return;
    }
    if (c.type === "missed") return this.offerMissed(c);

    this.state = "judging";
    const id = newId();
    // The picture from the moment itself (a look began seconds ago), for the judge and the Explanation alike.
    const { frame, thumb } = this.frames.at(c.t);
    const line = signalLine(c.signals, c.dense);
    // Rewinding the same part again needs no second opinion.
    let score: number | undefined;
    if (!c.sure) {
      try {
        ({ score } = await api<{ score: number }>("/judge", {
          title: this.info.title,
          topic: this.map?.topic,
          // A lecture without captions: the outline (slide titles) is what there is to go on.
          transcript: transcriptWindow(this.segs, c.t - 30, c.t + 1) || this.site.outline?.(c.t) || "",
          signalLine: line,
          frameB64: frame?.b64,
        }));
      } catch (e) {
        console.warn("[unstuck] judge failed", e);
      }
    }
    const offered = c.sure || (score ?? 0) >= RULES.offerAt;
    console.debug(`[unstuck] ${c.reason}: ${c.sure ? "sure, no judge" : `judge ${score?.toFixed(2) ?? "failed"}`} → ${offered ? "Offer" : "no Offer"}`);
    this.meter?.note(
      `${c.reason} at ${mmss(c.t)} → ${c.sure ? "sure, no judge needed" : `judge ${score?.toFixed(2) ?? "failed"}`} → ${offered ? "Offer" : `no Offer (needs ${RULES.offerAt.toFixed(2)})`}`,
    );
    void addEntry({ id, wall: Date.now(), videoId: this.info.videoId ?? "", videoTime: c.t, type: "stuck", source: "offer", signals: c.signals, score, offered });
    if (!offered || this.state !== "judging") {
      // The older Offer, if it is still up, stays.
      if (this.state === "judging") this.state = this.overlay.offerShowing ? "offer" : "watching";
      return;
    }
    // Wait for the speaker to finish their sentence, but only briefly after a look: the Viewer is
    // stuck right now, and every second takes the video further from what they got stuck on.
    await this.untilSentenceEnds(c.face ? 1.5 : 5);
    if (this.state !== "judging" || this.stopped) return;
    this.offerStuck(id, line, frame, thumb, c.reason);
  }

  private async untilSentenceEnds(maxWait: number) {
    const target = nextSentenceEnd(this.segs, this.video.currentTime, maxWait);
    const t0 = Date.now();
    while (this.video.currentTime < target && !this.video.paused && Date.now() - t0 < maxWait * 1000 + 500 && !this.stopped) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /** A lecture's last minutes of sound, for the request about to go out (nothing on YouTube). */
  private soundNow(): Promise<object> | undefined {
    if (!this.sound) return undefined;
    return this.sound.recent().then((pieces) => {
      const sec = pieces.reduce((n, p) => n + p.sec, 0);
      console.debug(`[unstuck] lecture sound for this answer: ${pieces.length} piece(s), ${Math.round(sec)} s`);
      return pieces.length ? { audio: pieces.map(({ mime, b64 }) => ({ mime, b64 })), audioSec: sec } : {};
    });
  }

  private explainBody(frame: Frame | undefined, mode: ExplainRequest["mode"], signal: string, extra: Partial<ExplainRequest> = {}): ExplainRequest {
    const t = frame?.t ?? this.video.currentTime;
    return {
      title: this.info.title,
      lang: this.lang,
      map: this.map,
      transcript: transcriptWindow(this.segs, t - 90, t + 1),
      videoTime: t,
      signalLine: signal,
      frameB64: frame?.b64,
      earlier: this.explained.slice(-4).map((e) => e.text.slice(0, 300)),
      outline: this.site.outline?.(t) || undefined,
      mode,
      ...(mode === "explain" && this.settings.thinkFirst ? { think: true } : {}),
      ...extra,
    };
  }

  /** The Stuck Offer on screen: the moment it is about, and how to end it if a newer one takes its place. */
  private stuckOffer: { t: number; end: (outcome: "replaced") => void } | null = null;

  private offerStuck(id: string, line: string, frame: Frame | undefined, thumb: HTMLCanvasElement | null, reason: string) {
    this.stuckOffer?.end("replaced");
    this.state = "offer";
    this.gate.offered(Date.now());
    const stream = new AnswerStream("/explain", this.explainBody(frame, "explain", line), this.soundNow());
    // Taking it jumps back to that moment (openExplanation pauses on the frame the model saw).
    const back = frame && this.video.currentTime - frame.t > 1.5;
    let ended = false;
    const end = (outcome: "dismissed" | "faded" | "unseen" | "replaced") => {
      if (ended) return;
      ended = true;
      void updateEntry(id, { offerOutcome: outcome });
      stream.stop();
      if (this.stuckOffer === mine) this.stuckOffer = null;
      // A newer Offer may already be on its way (judging): leave its state alone.
      if (this.state === "offer") this.state = "watching";
    };
    const mine = (this.stuckOffer = { t: frame?.t ?? this.video.currentTime, end });
    const why = whyOffered(reason);
    this.overlay.showOffer({
      title: "Stuck? Here's the idea",
      sub: `${why ? `${why} · ` : ""}${back ? `about ${mmss(frame!.t)}, takes you back there` : "about this moment"}`,
      acceptLabel: "Explain",
      thumb,
      onAccept: () => {
        ended = true;
        this.stuckOffer = null;
        void updateEntry(id, { offerOutcome: "accepted" });
        this.openExplanation(id, stream, frame, line);
      },
      onDismiss: () => end("dismissed"),
      onTimeout: () => end(this.watching() ? "faded" : "unseen"),
    });
  }

  /** The Viewer asks without an Offer (Q20). Every Ask is a Stuck moment we didn't spot. */
  /**
   * E: takes the pop-up on screen (unless it is about a moment long gone), or explains now.
   * Q (`now`): always explains what is on screen right now; a pop-up gives way.
   */
  ask(now = false) {
    const offer = this.overlay.offerShowing;
    if (offer && (this.state === "offer" || this.state === "judging")) {
      const stale = this.stuckOffer && this.video.currentTime - this.stuckOffer.t > 15;
      if (!now && !stale) return offer.accept();
      this.stuckOffer?.end("replaced");
      offer.close();
      if (this.state === "offer") this.state = "watching";
    }
    if (this.state === "panel") return (this.panel?.shadow.querySelector("input") as HTMLInputElement | null)?.focus();
    if (this.state === "ended") return;
    this.state = "panel";
    const id = newId();
    const frame = captureFrame(this.video);
    const t = frame?.t ?? this.video.currentTime;
    const line = signalLine([], this.detector.densePartAt(t));
    void addEntry({ id, wall: Date.now(), videoId: this.info.videoId ?? "", videoTime: t, type: "stuck", source: "ask", signals: [], offered: false });
    this.openExplanation(id, new AnswerStream("/explain", this.explainBody(frame, "explain", line), this.soundNow()), frame, line);
  }

  private pauseOurs() {
    this.oursUntil = performance.now() + 700;
    this.site.pause();
    this.video.pause(); // already done by the player, unless the page script is missing
  }

  private seekOurs(t: number) {
    this.oursUntil = performance.now() + 900;
    this.video.currentTime = Math.max(0, t);
  }

  private openPanel(title: string, at: number) {
    this.state = "panel";
    this.pauseOurs();
    const panel = this.mountPanel(new Panel(this.player, this.panelMemory));
    panel.setHeader(title, mmss(at));
    return panel;
  }

  /** A new panel goes into the Room: the video moves over to make space for it. */
  private mountPanel(panel: Panel) {
    this.panel = panel;
    panel.onFold = (on) => {
      if (on) this.hideSim(); // a simulation goes with the chat, and comes back with its button
      this.room.sync();
    };
    this.room.setPanel(panel);
    this.room.sync();
    return panel;
  }

  /** The panel has gone: the video goes back where it was. */
  private unmountPanel() {
    const p = this.panel;
    this.panel = null;
    this.room.setPanel(null);
    this.room.sync();
    void p?.close();
  }

  /**
   * The chat: an Explanation, or a Recap when `missed` is given (then follow-ups get the whole
   * missed part as their transcript, and "Jump back" stands in for "Simpler, please").
   */
  private openExplanation(id: string, stream: AnswerStream, frame: Frame | undefined, line: string, missed?: { from: number; to: number }) {
    this.overlay.offerShowing?.close();
    // Pause on the exact frame the model saw, so the Marks line up with it.
    if (frame && Math.abs(this.video.currentTime - frame.t) > 0.25) this.seekOurs(frame.t);
    this.pausedAt = frame?.t ?? this.video.currentTime;
    const panel = this.openPanel(missed ? "What you missed" : "Here's the idea", missed ? missed.from : this.pausedAt);
    const body = (mode: ExplainRequest["mode"], extra: Partial<ExplainRequest>) =>
      this.explainBody(frame, mode, line, { ...(missed ? { transcript: transcriptWindow(this.segs, missed.from - 20, missed.to + 1) } : {}), ...extra });
    // A chat: every answer and every question stays in the panel, newest at the bottom.
    const thread = el("div", "thread");
    panel.body.replaceChildren(thread);
    const history: { role: "viewer" | "unstuck"; text: string }[] = [];
    let current = stream;
    let firstAnswer = true;

    // Follow the newest text down, unless the Viewer scrolled up to reread something.
    let stick = true;
    panel.body.addEventListener("scroll", () => {
      const b = panel.body;
      stick = b.scrollHeight - b.scrollTop - b.clientHeight < 48;
    });
    const follow = () => {
      if (stick) panel.body.scrollTop = panel.body.scrollHeight;
    };
    new ResizeObserver(follow).observe(thread);

    const ask = (q: string) => {
      const bubble = el("div", "turn viewer");
      bubble.textContent = q;
      thread.append(bubble);
      bubble.animate([{ opacity: 0, transform: "translateY(8px) scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(.34,1.56,.64,1)" });
      history.push({ role: "viewer", text: q });
      stick = true;
      follow();
    };

    const show = (s: AnswerStream, fast: boolean) => {
      this.stopRender?.(); // an answer still being written stops where it is, and stays
      current = s;
      const turn = el("div", "turn unstuck");
      const text = el("div", "text");
      const sketch = el("div", "sketch");
      turn.append(text, sketch);
      thread.append(turn);
      setHTML(text, `<div class="thinking"><i></i><i></i><i></i></div>`);

      // Marks: found on the frame by a second call, each drawn the moment its [[phrase]]
      // types out. The phrase turns coral at the same moment; until then it is plain text.
      const drawn = new Set<string>();
      const keyOf = (m: Mark, i: number) => normPhrase(m.phrase) || `#${i}`;
      let placed: Mark[] | null = null;
      let shown = "";
      let typed = false;
      const typer = new Typer(text, (t) => explanationHTML(t, (p) => (drawn.has(normPhrase(p)) ? "ref" : "ref off")), fast ? 110 : 70);
      const drawDue = () => {
        if (!placed || current !== s || this.panel !== panel || this.stopped || !this.video.paused) return;
        let more = false;
        placed.forEach((m, i) => {
          const key = keyOf(m, i);
          if (drawn.has(key) || !(typed || phraseShown(shown, m.phrase))) return;
          if (!drawn.size) {
            // This answer's first Mark replaces the previous answer's; their phrases go plain.
            this.overlay.clearMarks();
            this.overlay.useFrame(busyMap(this.video));
            for (const r of thread.querySelectorAll(".ref:not(.off)")) if (!turn.contains(r)) r.classList.add("off");
          }
          this.overlay.drawMark(m, drawn.size === 0);
          drawn.add(key);
          more = true;
        });
        if (more) typer.refresh();
      };
      typer.onCut = (cut) => {
        shown = cut;
        drawDue();
      };
      void typer.finished.then(() => {
        typed = true;
        drawDue();
      });

      let started = false;
      let marksAsked = false;
      let sketchDrawn = false;
      let playShown = false;
      let recorded = false;
      const off = s.on(() => {
        const p = s.parsed;
        if (p.text) {
          started = true;
          typer.push(p.marks?.length ? wrapPhrases(p.text, p.marks.map((m) => m.phrase)) : p.text);
        }
        if (p.textDone && started) typer.end();
        if (p.marks && !marksAsked) {
          marksAsked = true;
          void this.locate(p.marks, frame).then((m) => {
            placed = m;
            drawDue();
          });
        }
        if (p.figure && !sketchDrawn) {
          sketchDrawn = true;
          const fig = p.figure;
          if (fig !== "none") void typer.finished.then(() => drawFigure(sketch, fig));
        }
        if (p.play && !playShown) {
          playShown = true;
          const idea = p.play;
          void typer.finished.then(() => this.addPlayButton(turn, idea, () => s.parsed.text, frame, id));
        }
        if (s.done && !recorded) {
          recorded = true;
          const err = s.serverError;
          if (err && !p.text) setHTML(text, `<p class="error">Couldn't get an answer: ${escapeText(err)}</p>`);
          if (this.settings.thinkFirst && s.firstAt) {
            // The "think first" test: how long the first word took, and whether it thought first.
            const ms = s.firstAt - s.askedAt;
            turn.append(el("div", "timing", `first word after ${(ms / 1000).toFixed(1)} s · ${s.thinks ? "thought first" : "no thinking"}`));
          }
          if (p.text) {
            history.push({ role: "unstuck", text: p.text });
            if (firstAnswer && !missed) this.remember(id, p.text); // the Session card keeps the first answer
            firstAnswer = false;
          }
        }
      });
      this.stopRender = () => {
        off();
        typer.stop();
        s.stop();
      };
    };
    show(stream, true);

    const gotIt = el("button", "btn primary", "Got it ✓");
    const simpler = el("button", "btn", missed ? `Jump back to ${mmss(missed.from)}` : "Simpler, please");
    const row = el("div", "row");
    row.append(gotIt, simpler);
    const askRow = el("div", "ask", `<input type="text" placeholder="Ask a follow-up…" enterkeyhint="send">`);
    const input = askRow.querySelector("input")!;
    shieldKeys(input, () => panel.onSubmit());
    panel.foot.replaceChildren(row, askRow);

    const lastAnswer = () => history.filter((h) => h.role === "unstuck").at(-1)?.text ?? current.parsed.text;
    gotIt.onclick = missed
      ? async () => {
          void updateEntry(id, { explanationOutcome: "got_it" }, { keepFirst: ["explanationOutcome"] });
          this.overlay.clearMarks();
          await panel.celebrate();
          this.closePanel(this.pausedAt);
        }
      : () => this.gotIt(id);
    simpler.onclick = missed
      ? () => this.closePanel(missed.from)
      : () => {
          void updateEntry(id, { explanationOutcome: "simpler" }, { keepFirst: ["explanationOutcome"] });
          ask("Simpler, please");
          show(new AnswerStream("/explain", body("simpler", { previous: lastAnswer(), thread: history.slice(-8) }), this.soundNow()), false);
        };
    panel.onSubmit = () => {
      const q = input.value.trim();
      if (!q) return;
      input.value = "";
      void updateEntry(id, { question: q });
      ask(q);
      show(new AnswerStream("/explain", body("followup", { previous: lastAnswer(), question: q, thread: history.slice(-8, -1) }), this.soundNow()), false);
    };
    panel.onClose = () => this.closePanel(this.pausedAt);
    thread.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("a.ts") as HTMLElement | null;
      if (a) this.closePanel(Number(a.dataset.t));
      const r = (e.target as HTMLElement).closest(".ref:not(.off)") as HTMLElement | null;
      if (r) this.overlay.pulseMark(r.dataset.ref ?? "");
    });
    // Pointing at a coral phrase makes its Mark wink (at most once a second per phrase).
    let lastPulse = { key: "", at: 0 };
    thread.addEventListener("mouseover", (e) => {
      const r = (e.target as HTMLElement).closest(".ref:not(.off)") as HTMLElement | null;
      if (!r) return;
      const key = normPhrase(r.dataset.ref ?? "");
      if (key === lastPulse.key && performance.now() - lastPulse.at < 1000) return;
      lastPulse = { key, at: performance.now() };
      this.overlay.pulseMark(key);
    });
  }

  /** Where the things a Mark points at are on the frame. Marks that can't be found are dropped. */
  private async locate(marks: Mark[], frame: Frame | undefined): Promise<Mark[]> {
    if (!frame || !marks.length) return [];
    const things = thingsToLocate(marks);
    let boxes: LocateResponse["boxes"] = {};
    if (things.length) {
      try {
        ({ boxes } = await api<LocateResponse>("/locate", { frameB64: frame.b64, things }));
      } catch (e) {
        console.warn("[unstuck] locate failed", e);
        return [];
      }
      boxes = await this.lookCloser(boxes);
    }
    const placed = placeMarks(marks, boxes);
    console.debug(`[unstuck] marks: ${placed.length} of ${marks.length} found on the frame`);
    return placed;
  }

  /** A second, zoomed-in look at each small thing, on the paused video at full resolution. */
  private async lookCloser(boxes: LocateResponse["boxes"]): Promise<LocateResponse["boxes"]> {
    const out = { ...boxes };
    await Promise.all(
      Object.entries(boxes).map(async ([thing, b]) => {
        if (!b || !worthRefining(b)) return;
        const crop = cropAround(b);
        const b64 = cropFrame(this.video, crop);
        if (!b64) return;
        try {
          const r = (await api<LocateResponse>("/locate", { frameB64: b64, things: [thing], zoomed: true })).boxes[thing];
          const closer: Box | null = r ? fromCrop(crop, r) : null;
          if (closer && sameThing(b, closer)) out[thing] = closer;
          else console.debug(`[unstuck] marks: zoomed look at "${thing}" disagreed, keeping the first box`);
        } catch {}
      }),
    );
    return out;
  }

  // ── "▶ Play with it" ─────────────────────────────────────────────────────

  private addPlayButton(turn: HTMLElement, idea: string, explanation: () => string, frame: Frame | undefined, id: string) {
    if (this.panel === null || !turn.isConnected) return;
    const btn = el("button", "play-btn", `<span class="tri">▶</span><span class="lbl"><b>Play with it</b><span></span></span>`);
    btn.querySelector(".lbl span")!.textContent = idea;
    turn.append(btn);
    btn.animate([{ opacity: 0, transform: "translateY(6px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.34,1.56,.64,1)" });
    let sim: Sim | null = null;
    btn.onclick = () => {
      if (!sim) sim = this.buildSim(idea, explanation(), frame, id, btn);
      else if (sim.state === "failed") return;
      else if (this.shownSim === sim) this.hideSim();
      else this.showSim(sim);
    };
  }

  /** Builds a simulation (on click only: it takes 10-20 s) over the paused video; retries once if it breaks. */
  private buildSim(idea: string, explanation: string, frame: Frame | undefined, id: string, btn: HTMLElement): Sim {
    const stage = new SimStage(idea);
    const sim: Sim = { stage, btn, state: "building", stop: () => {} };
    this.sims.push(sim);
    this.room.layerRoot.append(stage.el);
    this.showSim(sim, false);
    stage.onClose = () => this.hideSim();

    const t = frame?.t ?? this.video.currentTime;
    const build = (failed?: { html: string; error: string }) => {
      const s = new AnswerStream("/sim", {
        title: this.info.title,
        lang: this.lang,
        topic: this.map?.topic,
        transcript: transcriptWindow(this.segs, t - 90, t + 1),
        explanation,
        idea,
        frameB64: frame?.b64,
        failed,
      });
      sim.stop = () => s.stop();
      const off = s.on(() => {
        stage.progress(s.raw.length / 9000);
        if (!s.done) return;
        off();
        const html = cleanSimHtml(s.raw);
        const retry = (error: string) => {
          if (failed) return give(error);
          console.debug(`[unstuck] simulation broke (${error}), retrying once`);
          stage.retrying();
          build({ html: html ?? s.raw.slice(0, 24000), error });
        };
        if (!html) return retry(s.serverError || "the answer wasn't a complete web page");
        stage.onState = (state, message) => {
          if (state === "running") {
            sim.state = "running";
            void updateEntry(id, { played: "ok" });
            this.labelSim(sim);
            if (stage.hidden) btn.animate([{ transform: "scale(1)" }, { transform: "scale(1.035)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-in-out" });
          } else if (sim.state === "running") {
            console.debug(`[unstuck] simulation error while running, left as is: ${message}`);
          } else retry(message ?? "unknown error");
        };
        stage.load(withGuard(html));
      });
    };
    const give = (why: string) => {
      console.debug(`[unstuck] simulation failed: ${why}`);
      void updateEntry(id, { played: "failed" });
      sim.state = "failed";
      stage.failed("Couldn't build a working simulation for this one. The explanation and sketch still stand.");
      this.labelSim(sim);
    };
    build();
    return sim;
  }

  private showSim(sim: Sim, animateIn = true) {
    if (this.shownSim && this.shownSim !== sim) this.hideSim();
    this.shownSim = sim;
    this.room.setSim(sim.stage);
    this.room.sync();
    if (animateIn) sim.stage.show();
    this.labelSim(sim);
  }

  private hideSim() {
    const sim = this.shownSim;
    if (!sim) return;
    this.shownSim = null;
    sim.stage.hide();
    this.room.setSim(null);
    this.room.sync();
    this.labelSim(sim);
  }

  /** The button says what clicking it will do. */
  private labelSim(sim: Sim) {
    const label =
      sim.state === "failed"
        ? "No simulation this time"
        : this.shownSim === sim
          ? "Hide the simulation"
          : sim.state === "building"
            ? "Building in the background…"
            : "Open the simulation";
    sim.btn.querySelector(".lbl b")!.textContent = label;
    sim.btn.classList.toggle("failed", sim.state === "failed");
    sim.btn.classList.toggle("open", this.shownSim === sim);
  }

  /** Esc: hides the simulation on screen, if there is one; says whether it did. */
  closeSim(): boolean {
    if (!this.shownSim) return false;
    this.hideSim();
    return true;
  }

  /** The panel closed: simulations go with it. */
  private dropSims() {
    for (const s of this.sims) {
      s.stop();
      s.stage.destroy();
    }
    this.sims = [];
    this.shownSim = null;
    this.room.setSim(null);
  }

  private remember(id: string, text: string) {
    const known = this.explained.find((e) => e.id === id);
    if (known) known.text = text;
    else this.explained.push({ id, t: this.pausedAt, text });
    void updateEntry(id, { explanation: stripRefs(text).slice(0, 800) });
  }

  private async gotIt(id: string) {
    void updateEntry(id, { explanationOutcome: "got_it" }, { keepFirst: ["explanationOutcome"] });
    this.rewindWatch = { id, until: Date.now() + 20_000 };
    const panel = this.panel;
    this.overlay.clearMarks();
    await panel?.celebrate();
    this.closePanel(this.pausedAt - 3);
  }

  private closePanel(resumeAt: number) {
    this.dropSims();
    this.stopRender?.();
    this.stopRender = null;
    this.overlay.clearMarks();
    this.unmountPanel();
    this.seekOurs(resumeAt);
    this.oursUntil = performance.now() + 900;
    this.site.play();
    if (this.video.paused) this.video.play().catch(() => {});
    this.state = "watching";
  }

  // ── Missed moments ───────────────────────────────────────────────────────

  private offerMissed(c: Extract<Candidate, { type: "missed" }>) {
    this.state = "offer";
    this.gate.offered(Date.now());
    const id = newId();
    void addEntry({ id, wall: Date.now(), videoId: this.info.videoId ?? "", videoTime: c.from, type: "missed", source: "offer", signals: [`away ${Math.round(c.awaySec)} s`], offered: true });
    const jump = { label: `Jump back to ${mmss(c.from)}`, onClick: () => accept(() => this.closePanel(c.from)) };
    const accept = (then: () => void) => {
      void updateEntry(id, { offerOutcome: "accepted" });
      then();
    };
    const buttons = c.recap ? [{ label: "Recap", primary: true, onClick: () => accept(() => this.openRecap(id, c)) }, jump] : [{ ...jump, primary: true }];
    this.overlay.showOffer({
      title: `You missed ${duration(c.to - c.from)}`,
      sub: c.recap ? "Catch up in ten seconds" : "That's a lot to recap. Jump back?",
      buttons,
      onDismiss: () => {
        void updateEntry(id, { offerOutcome: "dismissed" });
        this.state = "watching";
      },
      onTimeout: () => {
        void updateEntry(id, { offerOutcome: this.watching() ? "faded" : "unseen" });
        this.state = "watching";
      },
    });
  }

  /** "What you missed": a Recap that opens as a chat, so the Viewer can ask about the part they missed. */
  private openRecap(id: string, c: Extract<Candidate, { type: "missed" }>) {
    const frame = captureFrame(this.video);
    const line = `The viewer was away and missed ${mmss(c.from)} to ${mmss(c.to)} of the video. They got a short recap of that part and now ask about it.`;
    const s = new AnswerStream("/recap", { title: this.info.title, lang: this.lang, transcript: transcriptWindow(this.segs, c.from, c.to), from: c.from, to: c.to }, this.soundNow());
    this.openExplanation(id, s, frame, line, { from: c.from, to: c.to });
  }

  // ── the Session card ─────────────────────────────────────────────────────

  private showSessionCard() {
    if (!this.explained.length || this.state === "panel") return;
    this.state = "ended";
    const n = this.explained.length;
    const panel = this.mountPanel(new Panel(this.player, this.panelMemory));
    panel.setHeader(`Unstuck ${n === 1 ? "once" : `${n} times`}`, "");
    panel.tangle(false);
    const list = el("ul", "card-list");
    for (const e of [...this.explained].sort((a, b) => a.t - b.t)) {
      const li = el("li", "", `<span class="t">${mmss(e.t)}</span>`);
      li.append(document.createTextNode(firstSentence(e.text)));
      li.onclick = () => {
        this.closePanel(e.t);
      };
      list.append(li);
    }
    panel.body.replaceChildren(list);
    const copy = el("button", "btn primary", "Copy as notes");
    const close = el("button", "btn", "Close");
    const row = el("div", "row");
    row.append(copy, close);
    panel.foot.replaceChildren(row);
    copy.onclick = async () => {
      const md = [`# ${this.info.title}`, "", ...this.explained.map((e) => `- **${mmss(e.t)}** ${stripRefs(e.text).replace(/\n+/g, " ")}`)].join("\n");
      await navigator.clipboard.writeText(md).catch(() => {});
      copy.textContent = "Copied ✓";
    };
    const done = () => {
      this.unmountPanel();
      this.state = "watching";
    };
    close.onclick = done;
    panel.onClose = done;
  }

  /** For the key handler: is this keystroke typed into our own panel? */
  ownsKeyEvent(e: KeyboardEvent): boolean {
    const target = e.composedPath()[0];
    return Boolean(this.panel && target instanceof Node && this.panel.shadow.contains(target));
  }

  submitFromKey() {
    this.panel?.onSubmit();
  }
}

/** Why an Offer showed up, in a few words, so a surprising one explains itself. */
function whyOffered(reason: string): string {
  if (reason.startsWith("looked confused")) return "You looked confused";
  if (reason.startsWith("leaned")) return "You leaned in";
  if (reason.startsWith("rewound the same part again")) return "You rewound this twice";
  if (reason.startsWith("rewound")) return "You rewound";
  if (reason.startsWith("slowed")) return "You slowed it down";
  if (reason.startsWith("paused")) return "You paused";
  return "";
}

/** Keys typed into our input must never reach YouTube's shortcuts (space and k play, f is fullscreen). */
function shieldKeys(input: HTMLInputElement, onEnter: () => void) {
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    input.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === "keydown" && e.key === "Enter") {
        e.preventDefault();
        onEnter();
      }
    });
  }
}

function duration(sec: number) {
  const s = Math.round(sec);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function escapeText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

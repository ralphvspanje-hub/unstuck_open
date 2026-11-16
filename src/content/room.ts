// The Room (GLOSSARY.md, ADR 0006): while the chat is open, YouTube's own player moves into the
// space Unstuck's windows leave free and the rest of the page fades out, so nothing covers the
// video. When the Viewer is done (folds or closes the chat, or plays on) it all goes back.
import { defaultPanel, defaultSim, fromFrac, keepOnScreen, toFrac, videoSpot, type FracRect, type Rect } from "../core/room.ts";
import { BASE_CSS, SIM_CSS } from "./styles.ts";

/** What the Room needs from the chat panel. */
export type RoomPanel = { host: HTMLElement; collapsed: boolean; dock: (r: Rect | null) => void; onDock: (r: Rect | null) => void };
/** What the Room needs from a simulation's stage. */
export type RoomSim = { el: HTMLElement; place: (r: Rect) => void; onMoved: (r: Rect | null) => void };
/** Where the Viewer put the windows in the Room, kept across videos. */
export type RoomMemory = { get: (w: "panel" | "sim") => FracRect | null; set: (w: "panel" | "sim", f: FracRect | null) => void };

const MIN = { panel: { width: 260, height: 160 }, sim: { width: 280, height: 180 } };
const GLIDE = { duration: 520, easing: "cubic-bezier(.2,.85,.25,1)" };

// On YouTube's page, not in a shadow root: it styles YouTube's own elements while the Room is on.
const PAGE_CSS = `
html[unstuck-room] { overflow: hidden !important; }
html[unstuck-room], html[unstuck-room] body { background: #0c0d10 !important; }
[unstuck-room-away] { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important;
  transition: opacity .22s ease, visibility 0s linear .22s !important; }
[unstuck-room-back] { transition: opacity .3s ease !important; }
[unstuck-room-path] { background: transparent !important; box-shadow: none !important; }
`;
const playerCss = (r: Rect) => `
[unstuck-room-player] { position: fixed !important; left: ${r.left}px !important; top: ${r.top}px !important;
  width: ${r.width}px !important; height: ${r.height}px !important; margin: 0 !important; z-index: 2200 !important;
  transform-origin: 0 0 !important; border-radius: 14px !important; overflow: hidden !important;
  box-shadow: 0 18px 60px rgba(0,0,0,.5) !important; }`;

export class Room {
  /** Simulations live here, outside the player: YouTube's end screen can't cover them, and they can go anywhere. */
  readonly layer: HTMLElement;
  readonly layerRoot: ShadowRoot;
  /** False when the Viewer switched the Room off on the setup page: windows float over the video. */
  readonly enabled: boolean;
  /** After the video has settled in a new place. */
  onSettled: () => void = () => {};

  private player: HTMLElement;
  private video: HTMLVideoElement;
  private memory: RoomMemory;
  private panel: RoomPanel | null = null;
  private sim: RoomSim | null = null;
  private style: HTMLStyleElement | null = null;
  private marked = new Map<Element, string>();
  private moved = false;
  private scrollY = 0;
  private anim: Animation | null = null;
  private kicking = false;
  private watch: MutationObserver;
  private cleanup: (() => void)[] = [];

  constructor(player: HTMLElement, video: HTMLVideoElement, o: { enabled: boolean; memory: RoomMemory }) {
    this.player = player;
    this.video = video;
    this.enabled = o.enabled;
    this.memory = o.memory;
    this.layer = document.createElement("unstuck-room");
    this.layer.style.cssText = "position:fixed;inset:0;z-index:2290;pointer-events:none;display:block;";
    this.layerRoot = this.layer.attachShadow({ mode: "open" });
    this.layerRoot.appendChild(document.createElement("style")).textContent = BASE_CSS + SIM_CSS;
    this.mountLayer();
    const onResize = () => !this.kicking && this.sync(false);
    const onFullscreen = () => {
      this.mountLayer();
      if (this.moved) this.mark();
      this.sync(false);
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFullscreen);
    // Theatre mode moves the player to another part of the page: fade out the new neighbours.
    this.watch = new MutationObserver(() => this.moved && requestAnimationFrame(() => this.moved && this.mark()));
    const flexy = document.querySelector("ytd-watch-flexy");
    if (flexy) this.watch.observe(flexy, { attributes: true, attributeFilter: ["theater", "fullscreen"] });
    this.cleanup.push(
      () => window.removeEventListener("resize", onResize),
      () => document.removeEventListener("fullscreenchange", onFullscreen),
      () => this.watch.disconnect(),
    );
  }

  setPanel(p: RoomPanel | null) {
    this.panel = p;
    if (!p) return;
    p.onDock = (r) => {
      this.memory.set("panel", r && toFrac(r, ...this.screen()));
      this.sync();
    };
    p.host.addEventListener("pointerdown", () => (this.layer.style.zIndex = "2290"), true);
  }

  setSim(s: RoomSim | null) {
    this.sim = s;
    if (!s) return;
    s.onMoved = (r) => {
      this.memory.set("sim", r && toFrac(r, ...this.screen()));
      this.sync();
    };
    s.el.onpointerdown = () => (this.layer.style.zIndex = "2310"); // the one you touch comes to the front
  }

  /** The chat is open (and not folded): the Viewer is "in Unstuck". */
  get active() {
    return Boolean(this.panel && !this.panel.collapsed);
  }

  /** Puts every window and the video where they belong now. `glide` animates the video there. */
  sync(glide = true) {
    const [W, H] = this.screen();
    const docked = this.active && this.enabled;
    let panel: Rect | null = null;
    if (this.panel) {
      const mine = this.memory.get("panel");
      panel = docked ? (mine ? keepOnScreen(fromFrac(mine, W, H), W, H, MIN.panel) : defaultPanel(W, H)) : null;
      this.panel.dock(panel);
      if (!panel && !this.panel.collapsed) panel = rectOf(this.panel.host);
    }
    let sim: Rect | null = null;
    if (this.sim) {
      const mine = this.memory.get("sim");
      sim = mine ? keepOnScreen(fromFrac(mine, W, H), W, H, MIN.sim) : defaultSim(W, H, panel ?? defaultPanel(W, H));
      this.sim.place(sim);
    }
    if (docked && this.canMove()) {
      const aspect = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
      this.moveVideo(videoSpot(W, H, [panel, sim].filter((r): r is Rect => Boolean(r)), aspect), glide);
    } else this.restoreVideo(glide);
  }

  /** The Session ends: everything back at once. */
  destroy() {
    this.restoreVideo(false);
    for (const fn of this.cleanup) fn();
    this.layer.remove();
    this.style?.remove();
  }

  // ── the video ───────────────────────────────────────────────────────────

  private screen(): [number, number] {
    return [document.documentElement.clientWidth || window.innerWidth, window.innerHeight];
  }

  /** In fullscreen the player can move only if YouTube made a bigger part of the page fullscreen. */
  private canMove() {
    const fs = document.fullscreenElement;
    return !fs || (fs !== this.player && fs.contains(this.player));
  }

  private moveVideo(spot: Rect, glide: boolean) {
    this.change(() => {
      if (!this.moved) {
        this.scrollY = window.scrollY;
        document.documentElement.setAttribute("unstuck-room", "");
        this.mark();
        this.player.setAttribute("unstuck-room-player", "");
        this.moved = true;
      }
      this.css(playerCss(spot));
    }, glide);
  }

  private restoreVideo(glide: boolean) {
    if (!this.moved) return;
    this.change(() => {
      this.player.removeAttribute("unstuck-room-player");
      this.css("");
      this.unmark();
      document.documentElement.removeAttribute("unstuck-room");
      window.scrollTo({ top: this.scrollY, behavior: "instant" });
      this.moved = false;
    }, glide);
  }

  /**
   * Changes the layout, lets YouTube lay its video out in the player's new box, then (FLIP) starts
   * the picture where it was on screen and glides it to the new place. Only transforms animate,
   * so it stays smooth, and YouTube lays the video out once, not every frame.
   */
  private change(apply: () => void, glide: boolean) {
    const from = this.picture();
    this.anim?.cancel();
    this.anim = null;
    apply();
    this.kick();
    const to = this.picture();
    if (!glide || !from || !to) return this.onSettled();
    const p = this.player.getBoundingClientRect();
    const s = from.width / to.width;
    const tx = from.left - p.left - s * (to.left - p.left);
    const ty = from.top - p.top - s * (to.top - p.top);
    if (Math.abs(tx) < 1 && Math.abs(ty) < 1 && Math.abs(s - 1) < 0.005) return this.onSettled();
    this.player.style.transformOrigin = "0 0";
    this.anim = this.player.animate([{ transform: `translate(${tx}px, ${ty}px) scale(${s})` }, { transform: "none" }], GLIDE);
    this.anim.finished.then(
      () => {
        this.player.style.transformOrigin = "";
        this.anim = null;
        this.onSettled();
      },
      () => {},
    );
  }

  /** YouTube sizes its video to the player only when the window resizes: tell it to look again. */
  private kick() {
    this.kicking = true;
    try {
      window.dispatchEvent(new Event("resize"));
    } finally {
      this.kicking = false;
    }
  }

  /** The video picture on screen right now, mid-glide included (letterboxing taken off). */
  private picture(): Rect | null {
    const v = this.video.getBoundingClientRect();
    if (!v.width || !v.height) return null;
    const vw = this.video.videoWidth || 16;
    const vh = this.video.videoHeight || 9;
    const k = Math.min(v.width / vw, v.height / vh);
    return { left: v.left + (v.width - vw * k) / 2, top: v.top + (v.height - vh * k) / 2, width: vw * k, height: vh * k };
  }

  // ── the rest of the page ────────────────────────────────────────────────

  private css(player: string) {
    if (!this.style) {
      this.style = document.createElement("style");
      this.style.id = "unstuck-room-css";
      document.head.append(this.style);
    }
    this.style.textContent = PAGE_CSS + player;
  }

  /** Everything beside the player's line of parents fades out; the parents themselves go see-through. */
  private mark() {
    const root = document.fullscreenElement ?? document.body;
    const keep = new Set<Element>();
    for (let el: Element = this.player; el !== root && el.parentElement; ) {
      const parent: Element = el.parentElement;
      this.set(parent, "unstuck-room-path", keep);
      for (const sib of parent.children) if (sib !== el && !ours(sib)) this.set(sib, "unstuck-room-away", keep);
      if (parent === root) break;
      el = parent;
    }
    for (const [el, attr] of [...this.marked]) if (!keep.has(el)) this.unset(el, attr);
  }

  private set(el: Element, attr: string, keep: Set<Element>) {
    keep.add(el);
    const had = this.marked.get(el);
    if (had === attr) return;
    if (had) el.removeAttribute(had);
    el.setAttribute(attr, "");
    this.marked.set(el, attr);
  }

  private unset(el: Element, attr: string) {
    el.removeAttribute(attr);
    this.marked.delete(el);
    if (attr !== "unstuck-room-away") return;
    el.setAttribute("unstuck-room-back", ""); // fades back in
    setTimeout(() => el.removeAttribute("unstuck-room-back"), 350);
  }

  private unmark() {
    for (const [el, attr] of [...this.marked]) this.unset(el, attr);
  }

  private mountLayer() {
    const parent = document.fullscreenElement ?? document.body;
    if (this.layer.parentElement !== parent) parent.append(this.layer);
  }
}

const ours = (el: Element) => el.tagName.startsWith("UNSTUCK-") || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(el.tagName);

function rectOf(el: HTMLElement): Rect {
  const b = el.getBoundingClientRect();
  return { left: b.left, top: b.top, width: b.width, height: b.height };
}

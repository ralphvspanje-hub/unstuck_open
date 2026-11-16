// What the Viewer sees: the Offer, the panel, Marks on the frame and the knot.
import { animate } from "motion";
import { keepOnScreen } from "../core/room.ts";
import type { Mark } from "../core/types.ts";
import { cornerGrips, dragWindow, type DragMode } from "./drag.ts";
import type { Busy } from "./frame.ts";
import { safeCut, setHTML } from "./html.ts";
import { MarkLayer } from "./marks.ts";
import { BASE_CSS, OFFER_CSS, PANEL_CSS, knotSvg } from "./styles.ts";

const spring = { type: "spring", bounce: 0.45, visualDuration: 0.38 } as const;
type Rect = { left: number; top: number; width: number; height: number };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) setHTML(e, html);
  return e;
}

function shadowHost(tag: string, css: string, hostStyle: string) {
  const host = document.createElement(tag);
  host.style.cssText = hostStyle;
  const root = host.attachShadow({ mode: "open" });
  root.appendChild(el("style", "", "")).textContent = BASE_CSS + css;
  return { host, root };
}

export type OfferButton = { label: string; primary?: boolean; onClick: () => void };
export type OfferHandle = { close: () => void; accept: () => void; el: HTMLElement };

/** Everything that lives inside the player, so it also works in fullscreen. */
export class PlayerOverlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private marks: MarkLayer;
  private offer: OfferHandle | null = null;
  private resize: ResizeObserver;
  private picture: () => Rect;

  /** `picture` says where the video picture sits inside the player (it may be letterboxed). */
  constructor(player: HTMLElement, picture: () => Rect) {
    this.picture = picture;
    ({ host: this.host, root: this.root } = shadowHost(
      "unstuck-overlay",
      OFFER_CSS,
      "position:absolute;inset:0;z-index:70;pointer-events:none;display:block;",
    ));
    player.appendChild(this.host);
    this.marks = new MarkLayer(this.root);
    this.marks.onFirst = (x, y) => this.fly({ x, y });
    this.resize = new ResizeObserver(() => this.marks.relayout(this.picture()));
    this.resize.observe(player);
  }

  showOffer(o: {
    title: string;
    sub: string;
    /** A small picture of the moment it is about, in place of the knot. */
    thumb?: HTMLCanvasElement | null;
    buttons?: OfferButton[];
    /** With onAccept: the label of the button that takes the Offer (it shows the E key too). */
    acceptLabel?: string;
    onAccept?: () => void;
    onDismiss: () => void;
    onTimeout: () => void;
    ttlMs?: number;
  }): OfferHandle {
    this.offer?.close();
    const card = el("div", "offer card");
    card.append(o.thumb ?? el("div", "", knotSvg("wiggle")).firstElementChild!);
    const msg = el("div", "msg", `<b></b><span></span>`);
    msg.querySelector("b")!.textContent = o.title;
    msg.querySelector("span")!.textContent = o.sub;
    card.append(msg);
    const actions = el("div", "actions");
    let closed = false;
    const close = (how: "accept" | "dismiss" | "timeout" | "silent") => {
      if (closed) return;
      closed = true;
      timer.cancel();
      animate(card, { opacity: 0, scale: 0.85, y: 8 }, { duration: 0.18 }).finished.then(() => card.remove());
      if (this.offer?.el === card) this.offer = null;
      if (how === "accept") o.onAccept?.();
      if (how === "dismiss") o.onDismiss();
      if (how === "timeout") o.onTimeout();
    };
    if (o.onAccept && o.acceptLabel) {
      const go = el("button", "btn primary go", `<span></span><kbd>E</kbd>`);
      go.querySelector("span")!.textContent = o.acceptLabel;
      go.onclick = (e) => {
        e.stopPropagation();
        close("accept");
      };
      actions.append(go);
    }
    let primary: HTMLButtonElement | null = null;
    for (const b of o.buttons ?? []) {
      const btn = el("button", `btn${b.primary ? " primary go" : ""}`, b.primary ? `<span></span><kbd>E</kbd>` : "");
      (b.primary ? btn.querySelector("span")! : btn).textContent = b.label;
      if (b.primary) primary = btn;
      btn.onclick = (e) => {
        e.stopPropagation();
        close("silent");
        b.onClick();
      };
      actions.append(btn);
    }
    if (o.onAccept) card.onclick = () => close("accept"); // the whole card takes it, not just the button
    const x = el("button", "x", "✕");
    x.title = "Not now";
    x.onclick = (e) => {
      e.stopPropagation();
      close("dismiss");
    };
    actions.append(x);
    card.append(actions);
    const bar = el("div", "timer");
    card.append(bar);
    this.root.append(card);
    animate(card, { opacity: [0, 1], scale: [0.6, 1], y: [14, 0] }, spring);
    const timer = bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: o.ttlMs ?? 8000, easing: "linear", fill: "forwards" });
    timer.finished.then(() => close("timeout"), () => {});
    card.onmouseenter = () => timer.pause();
    card.onmouseleave = () => timer.play();
    // Clicks inside the Offer must not reach the player (it would pause/play the video).
    for (const ev of ["click", "mousedown", "dblclick"]) card.addEventListener(ev, (e) => e.stopPropagation());
    // E takes the Offer, or presses its main button (Recap).
    this.offer = { el: card, close: () => close("silent"), accept: () => (o.onAccept ? close("accept") : primary?.click()) };
    return this.offer;
  }

  /** Something else that lives on the video, like the face meter. */
  mount(node: HTMLElement) {
    this.root.append(node);
  }

  get offerShowing() {
    return this.offer;
  }

  toast(html: string, ms = 5000, onMount?: (root: HTMLElement) => void) {
    const t = el("div", "toast card", knotSvg() + html);
    for (const ev of ["click", "mousedown"]) t.addEventListener(ev, (e) => e.stopPropagation());
    this.root.append(t);
    onMount?.(t);
    animate(t, { opacity: [0, 1], y: [-10, 0] }, spring);
    let timer = setTimeout(hide, ms);
    t.onmouseenter = () => clearTimeout(timer);
    t.onmouseleave = () => (timer = setTimeout(hide, 1500));
    function hide() {
      animate(t, { opacity: 0, y: -10 }, { duration: 0.2 }).finished.then(() => t.remove());
    }
  }

  /** One Mark over the paused frame. The knot flies to the first one of an answer. */
  drawMark(m: Mark, first: boolean) {
    this.marks.draw(m, this.picture(), first);
  }

  /** The paused frame the next Marks are drawn on, so arrows and labels find its calm parts. */
  useFrame(busy: Busy | null) {
    this.marks.busy = busy;
  }

  pulseMark(phrase: string) {
    this.marks.pulse(phrase);
  }

  private fly(to: { x: number; y: number }) {
    const f = el("div", "flyer", knotSvg());
    this.root.append(f);
    const from = { x: this.host.clientWidth - 60, y: this.host.clientHeight - 90 };
    f.style.left = "0px";
    f.style.top = "0px";
    animate(f, { x: [from.x, to.x], y: [from.y, to.y], scale: [1, 0.6], rotate: [0, 200] }, { duration: 0.45, ease: [0.5, 0, 0.2, 1] })
      .finished.then(() => animate(f, { opacity: 0, scale: 0.2 }, { duration: 0.25 }).finished)
      .then(() => f.remove());
  }

  clearMarks() {
    this.marks.clear();
  }

  destroy() {
    this.offer?.close();
    this.resize.disconnect();
    this.host.remove();
  }
}

/** Reveals streamed text at a steady, readable pace, faster when it falls behind. */
export class Typer {
  private full = "";
  private shown = 0;
  private streaming = true;
  private raf = 0;
  private last = 0;
  private resolveDone!: () => void;
  readonly finished = new Promise<void>((r) => (this.resolveDone = r));

  private target: HTMLElement;
  private render: (text: string) => string;
  private cps: number;
  /** Called with the text shown so far, just before it is painted (Marks draw when their phrase appears). */
  onCut: (shown: string) => void = () => {};

  constructor(target: HTMLElement, render: (text: string) => string, cps = 70) {
    this.target = target;
    this.render = render;
    this.cps = cps;
  }

  push(full: string) {
    this.full = full;
    this.kick();
  }
  end() {
    this.streaming = false;
    this.kick();
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  /** Paint again (a phrase's look changed). While typing, the next frame does this anyway. */
  refresh() {
    if (!this.raf && this.full) this.paint();
  }
  private paint() {
    const complete = !this.streaming && this.shown >= this.full.length;
    const cut = safeCut(this.full, Math.floor(this.shown), !this.streaming);
    this.onCut(cut);
    setHTML(this.target, this.render(cut) + (complete ? "" : `<span class="caret"></span>`));
    return complete;
  }
  private kick() {
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }
  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const behind = this.full.length - this.shown;
    const rate = behind > 240 ? 600 : behind > 90 ? 180 : this.cps;
    this.shown = Math.min(this.full.length, this.shown + rate * dt);
    const complete = this.paint();
    if (complete) {
      this.raf = 0;
      this.resolveDone();
    } else if (this.shown < this.full.length || this.streaming) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.raf = 0;
    }
  };
}

export type PanelRect = { left: number; top: number; width: number; height: number };
/** Where the Viewer put the panel, kept across videos; one place for normal view, one for fullscreen. */
export type PanelMemory = { get: (fullscreen: boolean) => PanelRect | null; set: (fullscreen: boolean, r: PanelRect | null) => void };
const MIN = { width: 260, height: 160 };

/**
 * The panel over YouTube's right column, or at the player's right edge in fullscreen; in the Room
 * (room.ts) it docks where the Room says. The Viewer can drag it by its header, resize it from any
 * corner, fold it down to its header, and double-click the header to send it back.
 */
export class Panel {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  readonly box: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly foot: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private atEl: HTMLDivElement;
  private knot: SVGSVGElement;
  private placer = () => this.place();
  /** Theatre mode and layout changes resize the player without resizing the window. */
  private resize = new ResizeObserver(() => this.place());
  onClose: () => void = () => {};
  onSubmit: () => void = () => {};
  /** Folded down to its header (true) or opened up again. */
  onFold: (on: boolean) => void = () => {};
  /** Moved or resized while docked in the Room (null: double-clicked back to the Room's own place). */
  onDock: (r: PanelRect | null) => void = () => {};

  private player: HTMLElement;
  private memory: PanelMemory | null;
  private folded = false;
  private docked: PanelRect | null = null;
  private minBtn: HTMLButtonElement;

  constructor(player: HTMLElement, memory: PanelMemory | null = null) {
    this.player = player;
    this.memory = memory;
    ({ host: this.host, root: this.root } = shadowHost("unstuck-panel", PANEL_CSS, "position:fixed;z-index:2300;display:block;"));
    this.box = el("div", "panel card");
    const head = el("div", "head", knotSvg() + `<div class="title"></div><div class="at"></div>`);
    this.knot = head.querySelector("svg")!;
    this.titleEl = head.querySelector(".title")!;
    this.atEl = head.querySelector(".at")!;
    this.minBtn = el("button", "x min", "–");
    this.minBtn.title = "Make it small";
    this.minBtn.onclick = () => this.fold(!this.folded);
    const x = el("button", "x", "✕");
    x.title = "Close";
    x.onclick = () => this.onClose();
    head.append(this.minBtn, x);
    head.title = "Drag to move · double-click to put it back";
    head.addEventListener("pointerdown", (e) => !(e.target as HTMLElement).closest("button") && this.drag(e, "move"));
    head.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      if (this.docked) return this.onDock(null);
      this.memory?.set(Boolean(document.fullscreenElement), null);
      this.place();
    });
    this.body = el("div", "body");
    this.foot = el("div", "foot");
    this.box.append(head, this.body, this.foot, ...cornerGrips((e, corner) => this.drag(e, corner)));
    this.root.append(this.box);
    this.place();
    for (const ev of ["scroll", "resize"]) window.addEventListener(ev, this.placer, { passive: true });
    document.addEventListener("fullscreenchange", this.placer);
    this.resize.observe(player);
    animate(this.box, { opacity: [0, 1], x: [48, 0] }, { type: "spring", bounce: 0.25, visualDuration: 0.4 });
  }

  /** The element an <input> lives in, so key handling can recognise our own typing. */
  get shadow() {
    return this.root;
  }

  setHeader(title: string, at = "") {
    this.titleEl.textContent = title;
    this.atEl.textContent = at;
  }

  tangle(on: boolean) {
    this.knot.classList.toggle("untangled", !on);
  }

  /** "Got it": the knot untangles and a check pops, then the panel glides away. */
  async celebrate() {
    this.tangle(false);
    const check = el(
      "div",
      "",
      `<svg class="check" viewBox="0 0 84 84"><circle cx="42" cy="42" r="40"/><path d="M24 43 L37 56 L61 30"/></svg>`,
    ).firstElementChild as SVGSVGElement;
    this.root.append(check);
    const p = check.querySelector("path")!;
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    animate(check, { scale: [0.3, 1], opacity: [0, 1] }, { type: "spring", bounce: 0.55, visualDuration: 0.3 });
    await p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 260, delay: 90, fill: "forwards", easing: "ease-out" }).finished;
    await new Promise((r) => setTimeout(r, 260));
  }

  get collapsed() {
    return this.folded;
  }

  /** Fold down to the header bar, or open up again. */
  fold(on: boolean) {
    if (on === this.folded) return;
    this.folded = on;
    this.box.classList.toggle("collapsed", on);
    this.minBtn.textContent = on ? "+" : "–";
    this.minBtn.title = on ? "Make it big again" : "Make it small";
    this.place();
    this.onFold(on);
  }

  /** In the Room, the panel sits where the Room puts it; null sends it back to its own place. */
  dock(r: PanelRect | null) {
    this.docked = r;
    this.place();
  }

  private clamp(r: PanelRect): PanelRect {
    return keepOnScreen(r, window.innerWidth, window.innerHeight, MIN);
  }

  private apply(r: PanelRect) {
    const fs = Boolean(document.fullscreenElement);
    const head = (this.box.querySelector(".head") as HTMLElement | null)?.offsetHeight ?? 52;
    Object.assign(this.host.style, {
      position: fs ? "absolute" : "fixed",
      left: `${r.left}px`,
      top: `${r.top}px`,
      right: "auto",
      bottom: "auto",
      width: `${r.width}px`,
      height: `${this.folded ? head + 2 : r.height}px`,
    });
  }

  /** Moving or resizing with the pointer; the result is remembered (by the Room, when docked). */
  private drag(e: PointerEvent, mode: DragMode) {
    const b = this.host.getBoundingClientRect();
    const fs = Boolean(document.fullscreenElement);
    const height = this.folded ? (this.docked?.height ?? this.memory?.get(fs)?.height ?? 480) : b.height;
    dragWindow(e, mode, { left: b.left, top: b.top, width: b.width, height }, {
      min: MIN,
      box: this.box,
      apply: (r) => this.apply(r),
      end: (r) => (this.docked ? this.onDock(r) : this.memory?.set(fs, r)),
    });
  }

  place() {
    const fs = document.fullscreenElement;
    const s = this.host.style;
    const mine = this.memory?.get(Boolean(fs));
    if (fs && this.host.parentElement !== fs) fs.appendChild(this.host);
    if (!fs && this.host.parentElement !== document.body) document.body.appendChild(this.host);
    if (this.docked && !this.folded) return this.apply(this.docked);
    if (mine) return this.apply(this.clamp(mine));
    if (fs) {
      if (this.host.parentElement !== fs) fs.appendChild(this.host);
      Object.assign(s, { position: "absolute", top: "16px", right: "16px", bottom: this.folded ? "auto" : "76px", left: "auto", width: "min(400px, 38%)", height: this.folded ? "54px" : "auto" });
      return;
    }
    if (this.host.parentElement !== document.body) document.body.appendChild(this.host);
    const p = this.player.getBoundingClientRect();
    const sec = document.querySelector("#secondary")?.getBoundingClientRect();
    const top = Math.max(p.top, 64);
    const height = Math.max(320, Math.min(window.innerHeight - top - 16, Math.max(p.height, 420)));
    if (sec && sec.width >= 300 && sec.left >= p.right - 2) {
      Object.assign(s, { position: "fixed", top: `${top}px`, left: `${sec.left}px`, right: "auto", bottom: "auto", width: `${Math.min(sec.width, 440)}px`, height: `${height}px` });
    } else {
      // No column beside the player (theatre mode, a narrow window): sit on the player's right
      // side, but end above its control bar, so settings, theatre mode and fullscreen stay reachable.
      const bar = this.player.querySelector(".ytp-chrome-bottom")?.getBoundingClientRect();
      const bottom = (bar?.height ? bar.top : p.bottom - 48) - 10;
      const t = Math.max(p.top + 10, 64);
      const w = Math.round(Math.min(400, Math.max(300, p.width * 0.4)));
      Object.assign(s, { position: "fixed", top: `${t}px`, left: `${p.right - w - 10}px`, right: "auto", bottom: "auto", width: `${w}px`, height: `${Math.max(220, bottom - t)}px` });
    }
    if (this.folded) s.height = `${((this.box.querySelector(".head") as HTMLElement | null)?.offsetHeight ?? 52) + 2}px`;
  }

  async close() {
    this.resize.disconnect();
    for (const ev of ["scroll", "resize"]) window.removeEventListener(ev, this.placer);
    document.removeEventListener("fullscreenchange", this.placer);
    await animate(this.box, { opacity: 0, x: 40 }, { duration: 0.22 }).finished;
    this.host.remove();
  }
}

export { el };

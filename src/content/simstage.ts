// "▶ Play with it": the window where a simulation is built and runs. In the Room it sits under
// the video by default; the Viewer can drag it by its header and resize it from any corner.
// The simulation itself lives in the sandbox page (src/sim/sim.ts) inside an iframe.
import { animate } from "motion";
import type { Rect } from "../core/room.ts";
import { cornerGrips, dragWindow, type DragMode } from "./drag.ts";
import { setHTML } from "./html.ts";
import { knotSvg } from "./styles.ts";

export type SimState = "running" | "error";

export class SimStage {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private building: HTMLDivElement;
  private bar: HTMLElement;
  private note: HTMLElement;
  private frame: HTMLIFrameElement | null = null;
  /** The page on show. Kept, because the frame reloads whenever YouTube moves the player (theatre mode). */
  private page: string | null = null;
  onClose: () => void = () => {};
  onState: (state: SimState, message?: string) => void = () => {};
  /** Dragged or resized by the Viewer (null: double-clicked back to its own place). */
  onMoved: (r: Rect | null) => void = () => {};

  constructor(idea: string) {
    this.el = document.createElement("div");
    this.el.className = "sim card";
    setHTML(
      this.el,
      `<div class="s-head" title="Drag to move · double-click to put it back"><span class="tri">▶</span><b></b><button class="x" title="Hide (Esc). The button under the explanation brings it back.">✕</button></div>
       <div class="s-body"><div class="building">${knotSvg("wiggle")}<p>Building a simulation for you…</p><div class="prog"><i></i></div><small>usually 10–20 s</small></div></div>`,
    );
    this.el.querySelector("b")!.textContent = idea;
    this.body = this.el.querySelector(".s-body")!;
    this.building = this.el.querySelector(".building")!;
    this.bar = this.el.querySelector(".prog i")!;
    this.note = this.el.querySelector(".building p")!;
    (this.el.querySelector("button.x") as HTMLButtonElement).onclick = (e) => {
      e.stopPropagation();
      this.onClose();
    };
    const head = this.el.querySelector<HTMLElement>(".s-head")!;
    head.addEventListener("pointerdown", (e) => !(e.target as HTMLElement).closest("button") && this.drag(e, "move"));
    head.addEventListener("dblclick", (e) => !(e.target as HTMLElement).closest("button") && this.onMoved(null));
    this.el.append(...cornerGrips((e, corner) => this.drag(e, corner)));
    // Clicks on the stage must not reach the player underneath (it would play the video).
    for (const ev of ["click", "mousedown", "dblclick", "wheel"]) this.el.addEventListener(ev, (e) => e.stopPropagation());
    window.addEventListener("message", this.onMessage);
    animate(this.el, { opacity: [0, 1], scale: [0.97, 1] }, { type: "spring", bounce: 0.2, visualDuration: 0.35 });
  }

  progress(frac: number) {
    this.bar.style.width = `${Math.round(Math.max(0.04, Math.min(0.97, frac)) * 100)}%`;
  }

  retrying() {
    this.note.textContent = "That one broke. Fixing it…";
    this.progress(0.05);
    this.showBuilding();
  }

  failed(text: string) {
    this.showBuilding();
    this.building.querySelector(".prog")?.remove();
    this.building.querySelector("small")?.remove();
    this.building.querySelector(".knot")?.classList.remove("wiggle");
    this.note.textContent = text;
  }

  /** Runs a page in a fresh sandbox frame. */
  load(html: string) {
    this.frame?.remove();
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.setAttribute("allow", "");
    f.src = chrome.runtime.getURL("sim.html");
    this.page = html;
    this.frame = f;
    this.body.append(f);
  }

  private showBuilding() {
    this.frame?.remove();
    this.frame = null;
    this.building.style.display = "";
  }

  private onMessage = (e: MessageEvent) => {
    if (!this.frame || e.source !== this.frame.contentWindow || !e.data?.unstuckSim) return;
    const { state, message } = e.data as { state?: string; message?: string };
    // "ready" comes once per load of the sandbox page, including reloads after YouTube moved
    // the player: send the page again each time, so the simulation never goes blank.
    if (state === "ready" && this.page) {
      this.frame.contentWindow!.postMessage({ unstuckSim: true, html: this.page }, "*");
    } else if (state === "running") {
      this.building.style.display = "none";
      this.frame.classList.add("on");
      this.onState("running");
    } else if (state === "escape") {
      this.onClose();
    } else if (state === "error") {
      this.onState("error", String(message ?? "unknown error").slice(0, 500));
    }
  };

  hidden = false;

  /** Where the Room puts it (screen pixels). */
  place(r: Rect) {
    Object.assign(this.el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  private drag(e: PointerEvent, mode: DragMode) {
    const b = this.el.getBoundingClientRect();
    dragWindow(e, mode, { left: b.left, top: b.top, width: b.width, height: b.height }, {
      min: { width: 280, height: 180 },
      box: this.el,
      apply: (r) => this.place(r),
      end: (r) => this.onMoved(r),
    });
  }

  /** Out of the way, but kept: a build goes on, and a running simulation keeps its state. */
  hide() {
    if (this.hidden) return;
    this.hidden = true;
    animate(this.el, { opacity: 0, scale: 0.97 }, { duration: 0.18 }).finished.then(() => this.hidden && this.el.classList.add("hidden"));
  }

  show() {
    if (!this.hidden) return;
    this.hidden = false;
    this.el.classList.remove("hidden");
    animate(this.el, { opacity: [0, 1], scale: [0.97, 1] }, { type: "spring", bounce: 0.2, visualDuration: 0.3 });
  }

  destroy() {
    window.removeEventListener("message", this.onMessage);
    this.el.remove();
  }
}

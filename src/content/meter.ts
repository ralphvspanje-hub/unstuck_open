// The face meter (press D), a test bench for the face trigger. It runs the real face rule on the
// Viewer's face as if the video were playing, and says TRIGGER whenever the face part alone would
// fire, also while paused or with the chat open. Drag the white line on a bar to set that line;
// it is saved and used for real. Numbers only (ADR 0002).
import { FACE_DEFAULTS, RULES, type FaceLines } from "../core/rules.ts";
import type { Rect } from "../core/room.ts";
import type { FaceMesh, FaceReading } from "../core/types.ts";
import { cornerGrips, dragWindow, type DragMode } from "./drag.ts";
import { drawFaceMesh } from "./facemesh.ts";
import { setHTML } from "./html.ts";

export type MeterStatus = { confusedHold: number; leanHold: number; counts: string; ok: boolean };

/** What each bar shows, from left to right. */
const RANGE: Record<keyof FaceLines, [number, number]> = { frownAt: [0, 0.6], lidsAt: [0, 0.4], tiltAt: [0, 30], leanAt: [1, 1.3] };
const NAME: Record<keyof FaceLines, string> = { frownAt: "Brows", lidsAt: "Eyelids", tiltAt: "Head tilt", leanAt: "Lean in" };
const LINE: Record<keyof FaceLines, (v: number) => string> = {
  frownAt: (v) => v.toFixed(2),
  lidsAt: (v) => v.toFixed(2),
  tiltAt: (v) => `${v.toFixed(0)}°`,
  leanAt: (v) => `${v.toFixed(2)}×`,
};

const row = (key: keyof FaceLines, tip: string) =>
  `<div class="m-row" data-key="${key}" title="${tip}"><span class="name"></span><div class="bar" title="Drag the white line to move it"><i class="fill"></i><i class="tick"></i></div><span class="num"></span></div>`;

const SKELETON = `
<div class="m-head" title="Drag to move"><b>Face meter</b><span class="m-tag">test</span><button class="x" title="Close (D)">✕</button></div>
<canvas class="m-face" title="Your face as Unstuck sees it: points only, never a picture"></canvas>
<div class="m-group confused">
  <div class="m-gt"><b>Confused look</b><small>any <i>two</i> of these past their line</small></div>
  ${row("frownAt", "How much lower your brows are than at rest")}
  ${row("lidsAt", "How much tighter your eyelids are than at rest")}
  ${row("tiltAt", "How far your head is tilted, either way, from how you held it over the last half minute")}
  <div class="hold"></div>
</div>
<div class="m-or">or</div>
<div class="m-group lean">
  <div class="m-gt"><b>Lean in</b><small>on its own</small></div>
  ${row("leanAt", "How much closer your face is than usual")}
  <div class="hold"></div>
</div>
<div class="m-rule">Hold one of them for ${RULES.faceHoldSec} s → <b>TRIGGER</b>. Relax to re-arm.</div>
<div class="m-fire" aria-live="polite"></div>
<div class="m-log"></div>
<div class="m-small"></div>
<div class="m-counts"></div>
<div class="m-note">After a trigger, a real pop-up also needs: the video playing, no chat or Offer open, ${RULES.cooldownSec} s since the last Offer, the judge saying an explanation would help (≥ ${RULES.offerAt}), and the speaker finishing their sentence.</div>
<div class="m-foot"><button class="btn view" title="Your camera picture with the mesh on it, in a window of Unstuck's own (for demos)">Camera view ↗</button><button class="btn reset" title="Back to brows ${FACE_DEFAULTS.frownAt}, eyelids ${FACE_DEFAULTS.lidsAt}, head tilt ${FACE_DEFAULTS.tiltAt}°, lean ${FACE_DEFAULTS.leanAt}">Reset the lines</button></div>`;

export class FaceMeter {
  readonly el: HTMLDivElement;
  onClose: () => void = () => {};
  /** A line was moved (or reset): the Session saves it, and the rules use it from now on. */
  onLines: (lines: FaceLines) => void = () => {};
  /** Open the camera view window. */
  onCameraView: () => void = () => {};
  private firedAt = 0;
  /** The player it sits in, in screen pixels: it can be moved and resized within it. */
  bounds: () => Rect = () => ({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
  private q = <T extends Element = HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
  /** The last 10 s of readings, so a peak can be read after the fact. */
  private recent: { at: number; d: NonNullable<FaceReading["detail"]> }[] = [];
  private fired: { at: Date; why: string }[] = [];
  private fireTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "meter card";
    setHTML(this.el, SKELETON);
    this.q("button.x").onclick = (e) => {
      e.stopPropagation();
      this.onClose();
    };
    this.q("button.view").onclick = (e) => {
      e.stopPropagation();
      this.onCameraView();
    };
    this.q("button.reset").onclick = (e) => {
      e.stopPropagation();
      Object.assign(RULES, FACE_DEFAULTS);
      this.onLines({ ...FACE_DEFAULTS });
    };
    for (const ev of ["click", "mousedown", "dblclick"]) this.el.addEventListener(ev, (e) => e.stopPropagation());
    this.q(".m-head").addEventListener("pointerdown", (e) => !(e.target as HTMLElement).closest("button") && this.drag(e, "move"));
    this.el.append(...cornerGrips((e, corner) => this.drag(e, corner)));
    for (const bar of this.el.querySelectorAll<HTMLElement>(".bar")) bar.addEventListener("pointerdown", (e) => this.moveLine(e, bar));
  }

  update(r: FaceReading | null, s: MeterStatus) {
    this.bar("frownAt", r?.frown ?? 0, (r?.frown ?? 0).toFixed(2));
    this.bar("lidsAt", r?.lids ?? 0, (r?.lids ?? 0).toFixed(2));
    this.bar("tiltAt", Math.abs(r?.tilt ?? 0), `${(r?.tilt ?? 0) >= 0 ? "+" : "−"}${Math.abs(r?.tilt ?? 0).toFixed(0)}°`);
    this.bar("leanAt", r?.lean ?? 1, `${(r?.lean ?? 1).toFixed(2)}×`);
    this.q(".confused .hold").style.transform = `scaleX(${s.confusedHold})`;
    this.q(".lean .hold").style.transform = `scaleX(${s.leanHold})`;
    const d = r?.detail;
    const now = Date.now();
    if (d && r.wall !== this.recent.at(-1)?.at) this.recent.push({ at: r.wall, d });
    this.recent = this.recent.filter((x) => now - x.at < 10_000);
    const peak = (k: "browDown" | "squint") => Math.max(...this.recent.map((x) => x.d[k])).toFixed(2);
    const tilts = this.recent.map((x) => Math.abs(x.d.roll - x.d.rollUsual));
    this.q(".m-small").textContent = d
      ? `raw: brows down ${d.browDown.toFixed(2)} (peak ${peak("browDown")}), rest ${d.browRest.toFixed(2)} · eyelids ${d.squint.toFixed(2)} (peak ${peak("squint")}), rest ${d.squintRest.toFixed(2)} · ` +
        `head ${d.roll.toFixed(0)}°, your usual ${d.rollUsual.toFixed(0)}° (most tilt ${Math.max(0, ...tilts).toFixed(0)}°) · peaks are the last 10 s`
      : "";
    const counts = this.q(".m-counts");
    counts.textContent = `Real pop-up right now: ${s.counts}`;
    counts.classList.toggle("ok", s.ok);
  }

  /** The face as points, lit where it is past a line, glowing right after a trigger. */
  drawMesh(mesh: FaceMesh, r: FaceReading) {
    const glow = Math.max(0, 1 - (Date.now() - this.firedAt) / 1500);
    const hot = { brows: r.frown >= RULES.frownAt, lids: r.lids >= RULES.lidsAt, tilt: Math.abs(r.tilt ?? 0) >= RULES.tiltAt, glow };
    drawFaceMesh(this.q<HTMLCanvasElement>(".m-face"), mesh, hot);
  }

  /** The face part would have fired just now. */
  fire(why: string) {
    this.firedAt = Date.now();
    this.fired = [{ at: new Date(), why }, ...this.fired].slice(0, 4);
    const f = this.q(".m-fire");
    f.textContent = `TRIGGER: ${why}`;
    f.classList.add("on");
    f.animate([{ transform: "scale(.92)", opacity: 0.4 }, { transform: "scale(1.04)", opacity: 1 }, { transform: "scale(1)" }], { duration: 380, easing: "ease-out" });
    clearTimeout(this.fireTimer);
    this.fireTimer = setTimeout(() => f.classList.remove("on"), 4000);
    const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    this.q(".m-log").textContent = `Triggered: ${this.fired.map((x) => `${time(x.at)} ${x.why}`).join(" · ")}`;
  }

  /** What happened with the latest real Stuck candidate (hover the status line). */
  note(text: string) {
    this.q(".m-counts").title = `Last real one: ${text}`;
  }

  private bar(key: keyof FaceLines, value: number, num: string) {
    const [lo, hi] = RANGE[key];
    const at = (v: number) => `${Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100}%`;
    const r = this.q(`.m-row[data-key="${key}"]`);
    const fill = r.querySelector<HTMLElement>(".fill")!;
    fill.style.width = at(value);
    fill.classList.toggle("hot", value >= RULES[key]);
    r.querySelector<HTMLElement>(".tick")!.style.left = at(RULES[key]);
    r.querySelector(".num")!.textContent = num;
    r.querySelector(".name")!.textContent = `${NAME[key]} ${LINE[key](RULES[key])}`;
  }

  /** Dragging along a bar moves its line there. */
  private moveLine(e: PointerEvent, bar: HTMLElement) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const key = bar.parentElement!.dataset.key as keyof FaceLines;
    const [lo, hi] = RANGE[key];
    const set = (x: number) => {
      const b = bar.getBoundingClientRect();
      const v = lo + Math.max(0.02, Math.min(0.98, (x - b.left) / b.width)) * (hi - lo);
      RULES[key] = key === "tiltAt" ? Math.round(v) : Math.round(v * 100) / 100;
      bar.querySelector<HTMLElement>(".tick")!.style.left = `${((RULES[key] - lo) / (hi - lo)) * 100}%`;
      bar.parentElement!.querySelector(".name")!.textContent = `${NAME[key]} ${LINE[key](RULES[key])}`;
    };
    bar.setPointerCapture(e.pointerId);
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
      this.onLines({ frownAt: RULES.frownAt, lidsAt: RULES.lidsAt, tiltAt: RULES.tiltAt, leanAt: RULES.leanAt });
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  }

  private drag(e: PointerEvent, mode: DragMode) {
    const b = this.el.getBoundingClientRect();
    const place = (r: Rect) => {
      const p = this.bounds();
      Object.assign(this.el.style, { left: `${r.left - p.left}px`, top: `${r.top - p.top}px`, right: "auto", width: `${r.width}px`, height: `${r.height}px` });
      this.el.classList.add("sized");
    };
    dragWindow(e, mode, { left: b.left, top: b.top, width: b.width, height: b.height }, { min: { width: 240, height: 160 }, box: this.el, bounds: this.bounds, apply: place, end: place });
  }
}

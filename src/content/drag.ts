// Moving or resizing one of Unstuck's windows (the chat, a simulation, the face meter) with the pointer.
import { keepOnScreen, type Rect } from "../core/room.ts";

/** "move" drags the whole window; a corner (top/bottom + left/right) resizes from there, the opposite corner stays put. */
export type DragMode = "move" | "tl" | "tr" | "bl" | "br";
export const CORNERS = ["tl", "tr", "bl", "br"] as const;

/** The four corner grips of a window, each starting a resize from its corner. */
export function cornerGrips(onDown: (e: PointerEvent, corner: DragMode) => void): HTMLElement[] {
  return CORNERS.map((c) => {
    const g = document.createElement("div");
    g.className = `grip ${c}`;
    g.title = "Drag to resize";
    g.addEventListener("pointerdown", (e) => onDown(e, c));
    return g;
  });
}

export function dragWindow(
  e: PointerEvent,
  mode: DragMode,
  start: Rect,
  o: {
    min: { width: number; height: number };
    box: HTMLElement;
    apply: (r: Rect) => void;
    end: (r: Rect) => void;
    /** Where the window must stay (screen pixels); the whole window by default. */
    bounds?: () => Rect;
  },
) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId); // keeps the pointer even over a simulation's frame
  const x0 = e.clientX;
  const y0 = e.clientY;
  let last = start;
  let frame = 0;
  o.box.classList.add(mode === "move" ? "dragging" : "resizing");
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    const B = o.bounds?.() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const r = { ...start };
    if (mode === "move") {
      r.left += dx;
      r.top += dy;
      const k = keepOnScreen({ ...r, left: r.left - B.left, top: r.top - B.top }, B.width, B.height, o.min);
      last = { ...k, left: k.left + B.left, top: k.top + B.top };
    } else {
      if (mode[1] === "r") r.width = Math.max(o.min.width, start.width + dx);
      else {
        r.width = Math.max(o.min.width, start.width - dx);
        r.left = start.left + start.width - r.width; // the right edge stays put
      }
      if (mode[0] === "b") r.height = Math.max(o.min.height, start.height + dy);
      else {
        r.height = Math.max(o.min.height, start.height - dy);
        r.top = start.top + start.height - r.height; // the bottom edge stays put
      }
      // A moving edge stops at the edge of the screen; the others stay where they are.
      const left = Math.max(r.left, B.left + 8);
      const top = Math.max(r.top, B.top + 8);
      const right = Math.min(r.left + r.width, B.left + B.width - 8);
      const bottom = Math.min(r.top + r.height, B.top + B.height - 8);
      last = { left, top, width: Math.max(o.min.width, right - left), height: Math.max(o.min.height, bottom - top) };
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => o.apply(last));
  };
  const up = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
    o.box.classList.remove("dragging", "resizing");
    if (last !== start) o.end(last);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}

// The Viewer's face as a mesh of points (the demo view): in the face meter, and over the camera
// picture in the camera view. Drawn from face points, which are numbers, on this laptop only (ADR 0002).
import type { FaceMesh, MeshShape } from "../core/types.ts";

type Conn = { start: number; end: number }[];
type Landmarks = {
  FACE_LANDMARKS_FACE_OVAL: Conn;
  FACE_LANDMARKS_LEFT_EYEBROW: Conn;
  FACE_LANDMARKS_RIGHT_EYEBROW: Conn;
  FACE_LANDMARKS_LEFT_EYE: Conn;
  FACE_LANDMARKS_RIGHT_EYE: Conn;
  FACE_LANDMARKS_LEFT_IRIS: Conn;
  FACE_LANDMARKS_RIGHT_IRIS: Conn;
  FACE_LANDMARKS_LIPS: Conn;
};

/** The outlines worth drawing, as pairs of point numbers, from MediaPipe's own lists (pass FaceLandmarker). */
export function meshShape(L: Landmarks): MeshShape {
  const flat = (...cs: Conn[]) => cs.flat().flatMap((e) => [e.start, e.end]);
  return {
    oval: flat(L.FACE_LANDMARKS_FACE_OVAL),
    brows: flat(L.FACE_LANDMARKS_LEFT_EYEBROW, L.FACE_LANDMARKS_RIGHT_EYEBROW),
    eyes: flat(L.FACE_LANDMARKS_LEFT_EYE, L.FACE_LANDMARKS_RIGHT_EYE),
    irises: flat(L.FACE_LANDMARKS_LEFT_IRIS, L.FACE_LANDMARKS_RIGHT_IRIS),
    lips: flat(L.FACE_LANDMARKS_LIPS),
  };
}

/** Points as x, y pairs (0-1 over the camera picture), 3 decimals: small enough to send 6 times a second. */
export function meshPoints(pts: { x: number; y: number }[]): number[] {
  return pts.flatMap((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);
}

/** What lights up: the parts past their line, and a glow (0-1) right after a trigger. */
export type MeshHot = { brows: boolean; lids: boolean; tilt: boolean; glow: number };

const CORAL = "#ff7a59";
const LINE = "rgba(244,244,245,.6)";

/**
 * Draws the mesh, mirrored like a selfie. `frame`: the points cover the whole canvas, which sits on
 * the camera picture; otherwise the face is fitted into the canvas. `aspect`: the camera's width/height.
 */
export function drawFaceMesh(c: HTMLCanvasElement, mesh: FaceMesh, hot: MeshHot, o: { frame?: boolean; aspect?: number } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth;
  const H = c.clientHeight;
  if (!W || !H) return;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const P = mesh.pts;
  const n = P.length / 2;
  if (!n) return;
  const aspect = o.aspect ?? 4 / 3;
  let sx = W;
  let sy = H;
  let ox = 0;
  let oy = 0;
  if (!o.frame) {
    // Fit the face itself into the canvas, in real proportions.
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const x = (1 - P[2 * i]) * aspect;
      const y = P[2 * i + 1];
      [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
    }
    const pad = 10;
    const k = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1));
    sx = k * aspect;
    sy = k;
    ox = (W - (x1 - x0) * k) / 2 - x0 * k;
    oy = (H - (y1 - y0) * k) / 2 - y0 * k;
  }
  const at = (i: number): [number, number] => [ox + (1 - P[2 * i]) * sx, oy + P[2 * i + 1] * sy];

  g.fillStyle = "rgba(244,244,245,.28)";
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i);
    g.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
  }
  const lines = (pairs: number[], color: string, width: number, glow = 0) => {
    g.save();
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = "round";
    if (glow) {
      g.shadowColor = CORAL;
      g.shadowBlur = glow;
    }
    g.beginPath();
    for (let k = 0; k + 1 < pairs.length; k += 2) {
      if (pairs[k] >= n || pairs[k + 1] >= n) continue;
      const [ax, ay] = at(pairs[k]);
      const [bx, by] = at(pairs[k + 1]);
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
    }
    g.stroke();
    g.restore();
  };
  const s = mesh.shape;
  lines(s.oval, hot.glow ? `rgba(255,122,89,${0.35 + 0.65 * hot.glow})` : LINE, 1.5, 22 * hot.glow);
  lines(s.lips, LINE, 1.2);
  lines(s.irises, "rgba(244,244,245,.45)", 1);
  lines(s.eyes, hot.lids ? CORAL : "rgba(244,244,245,.8)", hot.lids ? 2.6 : 1.4, hot.lids ? 10 : 0);
  lines(s.brows, hot.brows ? CORAL : "rgba(244,244,245,.85)", hot.brows ? 3.2 : 1.7, hot.brows ? 10 : 0);
  // Head tilt: the line through the outer eye corners, drawn on past the face.
  if (n > 263) {
    const [ax, ay] = at(33);
    const [bx, by] = at(263);
    const [dx, dy] = [bx - ax, by - ay];
    g.save();
    g.setLineDash([5, 5]);
    g.strokeStyle = hot.tilt ? CORAL : "rgba(244,244,245,.35)";
    g.lineWidth = hot.tilt ? 2.2 : 1.2;
    g.beginPath();
    g.moveTo(ax - dx * 0.45, ay - dy * 0.45);
    g.lineTo(bx + dx * 0.45, by + dy * 0.45);
    g.stroke();
    g.restore();
  }
}

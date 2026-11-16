// Turns Signals into Stuck candidates and Missed moments (design.md steps 4 and 5).
// Pure: the content script feeds it events, the tests feed it scripted ones.
import type { DensePart } from "./types.ts";

/**
 * The face lines the Viewer can set by dragging them in the face meter (D); kept in settings.
 * 13 Nov 2026: brows 0.2 and eyelids 0.1 fired too easily, so 0.25 and 0.15. Head tilt in degrees
 * away from the Viewer's own usual angle, either way.
 */
export const FACE_DEFAULTS = { frownAt: 0.25, lidsAt: 0.15, tiltAt: 8, leanAt: 1.08 };
/** Saved lines from before this version are ignored, so a change of the defaults reaches the Viewer. */
export const FACE_LINES_VERSION = 2;
export type FaceLines = typeof FACE_DEFAULTS;

// The calm defaults. For trying Unstuck out, "frequent mode" gives many more Offers: its value is in
// the comment next to each line it changes.
export const RULES = {
  rewindMin: 3, // frequent mode: 2
  rewindMax: 30,
  /** A pause this long is a Signal. */
  pauseSec: 3, // frequent mode: 2.5
  /** Count pauses only inside Dense parts. */
  pauseDenseOnly: true, // frequent mode: false
  faceHoldSec: 1.5,
  /**
   * A confused look is two of these three past their line at once, each measured against the
   * Viewer's own usual face: lowered brows, tightened eyelids, a head tilt (either way). One alone
   * is often something else: brows alone concentrating, a tilt alone resting the head on a hand
   * (13 Nov 2026). Tune them with the face meter (D).
   */
  frownAt: FACE_DEFAULTS.frownAt, // brows alone: 0.15 too sensitive, 0.25 and 0.3 still too often
  lidsAt: FACE_DEFAULTS.lidsAt,
  tiltAt: FACE_DEFAULTS.tiltAt,
  /** Once a confused look or a lean crosses its line, the hold only breaks below this share of the line (a frown wobbles). */
  faceRelease: 0.75, // 0.6 let a concentrating brow keep a hold going
  leanAt: FACE_DEFAULTS.leanAt, // was 1.12
  missedMinSec: 15, // frequent mode: 10
  /** Away longer than this: offer only "Jump back", no Recap. */
  recapMaxSec: 180,
  /** No new Offer within this many seconds of the last one. */
  cooldownSec: 120, // frequent mode: 25
  /** The camera switches off after the YouTube tab has been hidden this long, and back on on return. */
  cameraOffAwaySec: 60,
  /**
   * After a pause the camera stays on, and the face still counts, this long; then the camera stops
   * until the video plays again (13 Nov 2026: it kept filming through long pauses).
   */
  faceAfterPauseSec: 5,
  /** How long a Signal stays in the line we send to the judge. */
  memorySec: 60,
  /** Judge score from which an Offer appears. */
  offerAt: 0.7, // frequent mode: 0.45. Tested 12 Nov 2026: real content ~0.9, intros and sponsor reads ~0.46-0.54
  /** Rewinding the same part again within this window is a sure sign: Offer without asking the judge. */
  repeatRewindSec: 60,
};

export type DetectorEvent =
  | { kind: "tick"; wall: number; t: number; playing: boolean }
  | { kind: "seek"; wall: number; from: number; to: number; programmatic?: boolean }
  | { kind: "rate"; wall: number; t: number; rate: number; prev: number }
  | { kind: "pause"; wall: number; t: number }
  | { kind: "play"; wall: number; t: number }
  | { kind: "away"; wall: number; t: number; away: boolean; why: "tab" | "face" }
  | { kind: "face"; wall: number; t: number; frown: number; lids: number; tilt?: number; lean: number };

export type Candidate =
  /** `t`: the moment it is about (for a face, when the look began). `face`: it came from the face. */
  | { type: "stuck"; t: number; reason: string; signals: string[]; dense?: DensePart; sure?: boolean; face?: boolean }
  | { type: "missed"; from: number; to: number; awaySec: number; recap: boolean };

type Remembered = { wall: number; text: string };

export class Detector {
  private dense: DensePart[] = [];
  private memory: Remembered[] = [];
  private pausedAt: { wall: number; t: number; fired: boolean } | null = null;
  /** When the face started holding (wall clock), and where the video was at that moment. */
  private faceSince: { confused: number | null; lean: number | null; confusedT: number; leanT: number; fired: boolean } = {
    confused: null,
    lean: null,
    confusedT: 0,
    leanT: 0,
    fired: false,
  };
  private awayReasons = new Set<"tab" | "face">();
  private awayStart: { wall: number; t: number } | null = null;
  private lastT = 0;
  private playing = false;
  private rewinds: { wall: number; from: number; to: number }[] = [];

  setDenseParts(parts: DensePart[]) {
    this.dense = parts;
  }

  /** For the face meter: how far each face hold has got (0-1), and whether faces count right now. */
  faceStatus(wall: number) {
    const f = this.faceSince;
    const hold = (since: number | null) => (since === null ? 0 : Math.min(1, (wall - since) / 1000 / RULES.faceHoldSec));
    return { confused: hold(f.confused), lean: hold(f.lean), fired: f.fired, playing: this.playing, live: this.faceLive(wall) };
  }

  /** The face counts while the video plays, and for a few seconds after a pause (a confused pause). */
  private faceLive(wall: number) {
    return this.playing || (this.pausedAt !== null && wall - this.pausedAt.wall <= RULES.faceAfterPauseSec * 1000);
  }

  densePartAt(t: number): DensePart | undefined {
    return this.dense.find((d) => t >= d.start && t <= d.end);
  }

  /** Signals from the last minute, newest last, for the judge's one-line description. */
  recentSignals(wall: number): string[] {
    this.memory = this.memory.filter((m) => wall - m.wall <= RULES.memorySec * 1000);
    return this.memory.map((m) => m.text);
  }

  private remember(wall: number, text: string) {
    this.memory.push({ wall, text });
  }

  private stuck(wall: number, t: number, reason: string): Extract<Candidate, { type: "stuck" }> {
    this.remember(wall, reason);
    return { type: "stuck", t, reason, signals: [...this.recentSignals(wall)], dense: this.densePartAt(t) };
  }

  handle(e: DetectorEvent): Candidate[] {
    const out: Candidate[] = [];
    switch (e.kind) {
      case "seek": {
        if (e.programmatic) break;
        const back = e.from - e.to;
        if (back >= RULES.rewindMin && back <= RULES.rewindMax) {
          this.rewinds = this.rewinds.filter((r) => e.wall - r.wall <= RULES.repeatRewindSec * 1000);
          // Same part again: this rewind's range overlaps an earlier one.
          const again = this.rewinds.some((r) => e.to <= r.from && e.from >= r.to);
          this.rewinds.push({ wall: e.wall, from: e.from, to: e.to });
          const c = this.stuck(e.wall, e.from, again ? `rewound the same part again (${Math.round(back)} s)` : `rewound ${Math.round(back)} s`);
          if (again && c.type === "stuck") c.sure = true;
          out.push(c);
        } else if (back > RULES.rewindMax) {
          this.remember(e.wall, `jumped back ${Math.round(back)} s`);
        }
        this.lastT = e.to;
        break;
      }
      case "rate": {
        if (e.rate < e.prev) out.push(this.stuck(e.wall, e.t, `slowed the video down to ${e.rate}×`));
        break;
      }
      case "pause": {
        this.playing = false;
        this.pausedAt = { wall: e.wall, t: e.t, fired: false };
        break;
      }
      case "play": {
        this.playing = true;
        this.pausedAt = null;
        break;
      }
      case "face": {
        out.push(...this.face(e));
        break;
      }
      case "away": {
        out.push(...this.away(e));
        break;
      }
      case "tick": {
        this.playing = e.playing;
        this.lastT = e.t;
        const p = this.pausedAt;
        const where = !RULES.pauseDenseOnly || this.densePartAt(p?.t ?? 0);
        // A pause while away from the screen is a coffee break, not a Stuck moment.
        if (p && !p.fired && !e.playing && (e.wall - p.wall) / 1000 >= RULES.pauseSec && where && !this.awayReasons.size) {
          p.fired = true;
          out.push(this.stuck(e.wall, p.t, `paused for ${RULES.pauseSec}+ s`));
        }
        break;
      }
    }
    return out;
  }

  private face(e: Extract<DetectorEvent, { kind: "face" }>): Candidate[] {
    const f = this.faceSince;
    // Start at the line, but only stop well below it, so a frown that wobbles around the line still holds.
    const hold = (v: number, at: number, release: number, since: number | null) =>
      since !== null ? (v >= release ? since : null) : v >= at ? e.wall : null;
    const look = confusedLook(e.frown, e.lids, e.tilt ?? 0);
    const was = { confused: f.confused, lean: f.lean };
    f.confused = hold(look.level, 1, RULES.faceRelease, f.confused);
    f.lean = hold(e.lean, RULES.leanAt, 1 + (RULES.leanAt - 1) * RULES.faceRelease, f.lean);
    if (was.confused === null && f.confused !== null) f.confusedT = e.t;
    if (was.lean === null && f.lean !== null) f.leanT = e.t;
    if (f.confused === null && f.lean === null) f.fired = false;
    // Anywhere in the video, not only in Dense parts: the judge weighs the content.
    if (f.fired || !this.faceLive(e.wall)) return [];
    const held = (since: number | null) => since !== null && (e.wall - since) / 1000 >= RULES.faceHoldSec;
    if (held(f.confused) || held(f.lean)) {
      f.fired = true;
      const s = `${RULES.faceHoldSec}+ s`;
      // About the moment the look began: by now the video has moved on (and moves on further while
      // the judge thinks and the Offer waits), and that frame is the one that confused them.
      const c = held(f.confused)
        ? this.stuck(e.wall, f.confusedT, `looked confused (${look.signs.join(", ")}) for ${s}`)
        : this.stuck(e.wall, f.leanT, `leaned in for ${s}`);
      return [{ ...c, face: true }];
    }
    return [];
  }

  private away(e: Extract<DetectorEvent, { kind: "away" }>): Candidate[] {
    const wasAway = this.awayReasons.size > 0;
    if (e.away) this.awayReasons.add(e.why);
    else this.awayReasons.delete(e.why);
    const isAway = this.awayReasons.size > 0;
    if (!wasAway && isAway) {
      this.awayStart = { wall: e.wall, t: e.t };
      return [];
    }
    if (wasAway && !isAway && this.awayStart) {
      const from = this.awayStart.t;
      const awaySec = (e.wall - this.awayStart.wall) / 1000;
      this.awayStart = null;
      // Only what actually played while they were gone counts (paused-then-left = nothing missed).
      const played = e.t - from;
      if (played >= RULES.missedMinSec) {
        return [{ type: "missed", from, to: e.t, awaySec, recap: played <= RULES.recapMaxSec }];
      }
    }
    return [];
  }
}

/**
 * How far into a confused look the face is: 1 when two of brows, eyelids and head tilt are at their
 * line, so the second strongest decides (one alone doesn't count). `signs` names those two.
 */
export function confusedLook(frown: number, lids: number, tilt = 0) {
  const parts = [
    { sign: "frowning", v: frown / RULES.frownAt },
    { sign: "eyelids tight", v: lids / RULES.lidsAt },
    { sign: "head tilted", v: Math.abs(tilt) / RULES.tiltAt },
  ].sort((a, b) => b.v - a.v);
  return { level: parts[1].v, signs: [parts[0].sign, parts[1].sign] };
}

/** Cooldown between Offers (Q10). Asks skip it. */
export class OfferGate {
  private last = -Infinity;
  canOffer(wall: number) {
    return (wall - this.last) / 1000 >= RULES.cooldownSec;
  }
  /** Seconds until the next Offer may show (0 = now). */
  waitSec(wall: number) {
    return Math.max(0, RULES.cooldownSec - (wall - this.last) / 1000);
  }
  offered(wall: number) {
    this.last = wall;
  }
}

/** The one line of text about the Viewer that goes to the judge, never an image (ADR 0002). */
export function signalLine(signals: string[], dense?: DensePart): string {
  const where = dense ? ` This moment is inside a part the video map marks as dense: ${dense.why}.` : "";
  if (!signals.length) return `The viewer asked for an explanation themselves.${where}`;
  const [latest, ...rest] = [...signals].reverse();
  const before = rest.length ? ` Earlier in the last minute the viewer also: ${rest.reverse().join("; ")}.` : "";
  return `The viewer just ${latest}.${before}${where}`;
}

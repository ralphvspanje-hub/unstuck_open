// Shared shapes. Names follow GLOSSARY.md.

/** One caption line. Times are video seconds. */
export type CaptionSegment = { start: number; end: number; text: string };

export type KeyTerm = { term: string; t: number; gist: string };
export type DensePart = { start: number; end: number; why: string };

/** A short account of the whole video, made once per Session. */
export type VideoMap = { topic: string; keyTerms: KeyTerm[]; denseParts: DensePart[] };

export type MomentType = "stuck" | "missed";
/** "replaced": a newer Stuck moment (a confused look) took its place while it was still showing. */
export type OfferOutcome = "accepted" | "dismissed" | "faded" | "unseen" | "replaced";
export type ExplanationOutcome = "got_it" | "simpler" | "rewound";

/** [ymin, xmin, ymax, xmax], normalised to 0-1000 over the frame (Gemini's box_2d). */
export type Box = [number, number, number, number];

/**
 * Something drawn over the paused frame, tied to a [[phrase]] in the Explanation's text.
 * - arrow: points at one thing (the usual Mark)
 * - outline: circles one small thing among similar ones (a term in an equation)
 * - spotlight: dims everything else ("look here")
 * - flow: something moves from `find` to `to` (current, data, a force)
 * Boxes come from a separate locate call, or straight from the answer.
 */
export type Mark = {
  phrase: string;
  kind: "arrow" | "outline" | "spotlight" | "flow";
  find: string;
  to?: string;
  label: string;
  box?: Box;
  toBox?: Box;
};

/** `zoomed`: the image is a crop around a first guess, for a second, tighter look. */
export type LocateRequest = { frameB64: string; things: string[]; zoomed?: boolean };
export type LocateResponse = { boxes: Record<string, Box | null> };

/** Numbers describing the Viewer's face at one instant. Never an image (ADR 0002). */
export type FaceReading = {
  wall: number;
  present: boolean;
  lookingAway: boolean;
  /** How much more the brows are lowered than the Viewer's own resting face (0 = as usual). */
  frown: number;
  /** How much more the eyelids are tightened than at rest. */
  lids: number;
  /** Head tilted sideways, degrees from the Viewer's usual angle of the last half minute (either sign). */
  tilt: number;
  /** Face width relative to the Viewer's own baseline; 1 = usual distance. */
  lean: number;
  /** The raw numbers behind it, for the face meter (D). Numbers only, like everything here. */
  detail?: {
    browDown: number;
    browRest: number;
    browInnerUp: number;
    squint: number;
    squintRest: number;
    /** The head's sideways angle right now, and the Viewer's usual one (degrees). */
    roll: number;
    rollUsual: number;
    yaw: number;
    lookDown: number;
    ready: boolean;
  };
};

/** Outlines on the face mesh, as pairs of point numbers. */
export type MeshShape = { oval: number[]; brows: number[]; eyes: number[]; irises: number[]; lips: number[] };
/** The face as points (x, y pairs, 0-1 over the camera picture), for the demo view only. Numbers, never an image. */
export type FaceMesh = { pts: number[]; shape: MeshShape };

/** One line in the Offer log. Placed by video and by time in the video (Q24). */
export type LogEntry = {
  id: string;
  wall: number;
  videoId: string;
  videoTime: number;
  type: MomentType;
  source: "offer" | "ask";
  signals: string[];
  score?: number;
  /** False when the judge said no, or for Asks. */
  offered: boolean;
  offerOutcome?: OfferOutcome;
  explanationOutcome?: ExplanationOutcome;
  question?: string;
  explanation?: string;
  /** "▶ Play with it": was a simulation opened, and did it run? */
  played?: "ok" | "failed";
};

// Requests the extension sends to the local server.

export type MapRequest = { title: string; lang?: string; transcript: string; durationSec: number };

export type JudgeRequest = {
  title: string;
  topic?: string;
  transcript: string;
  signalLine: string;
  frameB64?: string;
};

export type ExplainRequest = {
  title: string;
  /** The video's language code, e.g. "en". Answers are written in it. */
  lang?: string;
  map?: VideoMap;
  transcript: string;
  videoTime: number;
  signalLine: string;
  frameB64?: string;
  earlier: string[];
  mode: "explain" | "simpler" | "followup";
  previous?: string;
  question?: string;
  /** The panel's conversation so far, oldest first (follow-ups and "simpler"). */
  thread?: { role: "viewer" | "unstuck"; text: string }[];
  /** Let the first answer think too (a test setting; follow-ups always think a little). */
  think?: boolean;
  /** The last minutes of the video's sound, oldest first, for lectures (no captions, or poor ones). */
  audio?: { mime: string; b64: string }[];
  /** How many seconds of sound `audio` covers. */
  audioSec?: number;
  /** The lecture's outline from its host (slide titles and chapters with their times), when it has one. */
  outline?: string;
};

/** "▶ Play with it": a small interactive simulation of the idea just explained. */
export type SimRequest = {
  title: string;
  lang?: string;
  topic?: string;
  transcript: string;
  explanation: string;
  /** What the Viewer can move and what they'll see, from the Explanation's <play> line. */
  idea: string;
  frameB64?: string;
  /** A retry: the version that crashed and its error. */
  failed?: { html: string; error: string };
};

export type RecapRequest = {
  title: string;
  lang?: string;
  transcript: string;
  from: number;
  to: number;
  /** A lecture's last minutes of sound, as in ExplainRequest. */
  audio?: { mime: string; b64: string }[];
  audioSec?: number;
};

// Where the video is: YouTube, or a lecture on Panopto. The Session is the same on both; a Site
// supplies the parts that differ (captions, ads, play and pause, the Room, the "always on" label).
import type { CaptionSegment } from "../core/types.ts";

export type Site = {
  kind: "youtube" | "panopto";
  /** The host's own captions. Without this, the Session reads YouTube's player (ADR 0003). */
  captions?: () => Promise<{ segs: CaptionSegment[]; lang: string }>;
  /** The lecture's outline near video time `t` (slide titles, chapters), when the host has one. */
  outline?: (t: number) => string;
  /** Record the video's sound for Explanations (lectures: slow, and captions often missing or poor). */
  sound: boolean;
  /** An ad is playing: signals then mean nothing. */
  isAd: () => boolean;
  play: () => void;
  pause: () => void;
  /** Move the video aside while the chat is open (ADR 0006). YouTube only for now. */
  room: boolean;
  /** The checkbox in the welcome note: "always for …". Empty: no checkbox (Panopto always starts). */
  alwaysFor: string;
};

/** YouTube: play and pause go through its own player (src/page/page.ts), so it doesn't undo them later. */
export function youtubeSite(player: HTMLElement, channel: string): Site {
  const tell = (order: "play" | "pause") => document.dispatchEvent(new CustomEvent("unstuck-player", { detail: order }));
  return {
    kind: "youtube",
    sound: false,
    isAd: () => player.classList.contains("ad-showing"),
    play: () => tell("play"),
    pause: () => tell("pause"),
    room: true,
    alwaysFor: channel || "this channel",
  };
}

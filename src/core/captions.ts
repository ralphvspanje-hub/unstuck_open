// Caption parsing and transcript windows. Pure; used by the content script and tests.
import type { CaptionSegment } from "./types.ts";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** YouTube's json3 caption format: { events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }] }. */
export function parseJson3(raw: string | object): CaptionSegment[] {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const events: any[] = Array.isArray((data as any)?.events) ? (data as any).events : [];
  const out: CaptionSegment[] = [];
  for (const e of events) {
    if (!Array.isArray(e.segs) || typeof e.tStartMs !== "number") continue;
    const text = clean(e.segs.map((s: any) => s?.utf8 ?? "").join(""));
    if (!text) continue;
    const start = e.tStartMs / 1000;
    out.push({ start, end: start + (e.dDurationMs ?? 0) / 1000, text });
  }
  return sortAndTrim(out);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z#0-9]+);/gi, (m, n) => ENTITIES[n] ?? m);

/** YouTube's srv3/timedtext XML: <p t="ms" d="ms">text <s>words</s></p>. */
export function parseSrv3(xml: string): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  const re = /<p\b[^>]*?\bt="(\d+)"[^>]*?(?:\bd="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  for (const m of xml.matchAll(re)) {
    const text = clean(decode(m[3].replace(/<[^>]+>/g, "")));
    if (!text) continue;
    const start = Number(m[1]) / 1000;
    out.push({ start, end: start + Number(m[2] ?? 0) / 1000, text });
  }
  return sortAndTrim(out);
}

/** Either format, whichever the player happened to load. */
export function parseCaptions(body: string): CaptionSegment[] {
  const s = body.trimStart();
  if (s.startsWith("{")) return parseJson3(s);
  if (s.startsWith("<")) return parseSrv3(s);
  return [];
}

/**
 * Lines read from YouTube's "Show transcript" panel (the fallback in ADR 0003). Each has a
 * timestamp like "1:05"; some layouts also prefix the text with "1:05 1 minute, 5 seconds".
 */
export function parseTranscriptItems(items: { ts?: string; text: string }[]): CaptionSegment[] {
  const spoken = /^(?:\d+:)?\d+:\d{2}\s+(?:(?:\d+\s+(?:hours?|minutes?|seconds?),?\s*)+)?/;
  const out: CaptionSegment[] = [];
  for (const it of items) {
    const ts = it.ts?.trim() || it.text.match(/^(?:\d+:)?\d+:\d{2}/)?.[0];
    if (!ts) continue;
    const text = clean(it.ts ? it.text : it.text.replace(spoken, ""));
    if (!text) continue;
    out.push({ start: ts.split(":").map(Number).reduce((a, n) => a * 60 + n, 0), end: 0, text });
  }
  out.sort((a, b) => a.start - b.start);
  out.forEach((s, i) => (s.end = out[i + 1]?.start ?? s.start + 5));
  return out;
}

// Auto-captions overlap: each line stays up until the next one replaces it. Clip every
// segment to the next one's start so a window never counts a line twice.
function sortAndTrim(segs: CaptionSegment[]): CaptionSegment[] {
  segs.sort((a, b) => a.start - b.start);
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i].end > segs[i + 1].start) segs[i].end = Math.max(segs[i].start, segs[i + 1].start);
  }
  return segs;
}

export const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
};

/**
 * Transcript of [from, to] as "[mm:ss] text" lines, one line per `every` seconds,
 * so the model can point back to times.
 */
export function transcriptWindow(segs: CaptionSegment[], from: number, to: number, every = 10): string {
  const lines: string[] = [];
  let bucket = -1;
  let current: string[] = [];
  for (const s of segs) {
    if (s.end < from || s.start > to) continue;
    const b = Math.floor(s.start / every);
    if (b !== bucket) {
      if (current.length) lines.push(current.join(" "));
      bucket = b;
      current = [`[${mmss(s.start)}]`];
    }
    current.push(s.text);
  }
  if (current.length) lines.push(current.join(" "));
  return lines.join("\n");
}

/** The whole transcript, for the Video map. Capped so a 4-hour video stays affordable. */
export function fullTranscript(segs: CaptionSegment[], maxChars = 240_000): string {
  const all = transcriptWindow(segs, 0, Infinity, 15);
  return all.length > maxChars ? all.slice(0, maxChars) + "\n[transcript cut off here]" : all;
}

/**
 * When to show an Offer: the end of the speaker's current sentence (Q23), found as a
 * caption ending in . ? ! or a pause in speech of at least `gap` seconds. Never later
 * than `t + maxWait`.
 */
export function nextSentenceEnd(segs: CaptionSegment[], t: number, maxWait = 5, gap = 0.6): number {
  const limit = t + maxWait;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.end < t) continue;
    if (s.start > limit) break;
    const next = segs[i + 1];
    const endsSentence = /[.?!…]["')\]]*$/.test(s.text);
    const pauseAfter = !next || next.start - s.end >= gap;
    if (endsSentence || pauseAfter) return Math.min(Math.max(s.end, t), limit);
  }
  return limit;
}

/** Language codes match on their first part: "en" = "en-US". */
export const sameLang = (a?: string | null, b?: string | null) =>
  Boolean(a && b && a.split("-")[0].toLowerCase() === b.split("-")[0].toLowerCase());

export type Track = { lang: string; kind: string; name: string };

/**
 * The captions in the video's own language. YouTube says which track belongs to the default
 * audio; trust that first (videos with AI dubbing list auto-captions in 20+ languages).
 * Without it: a hand-made track in the auto-captions' language, the auto-captions themselves
 * (one language means it's the spoken one), then English.
 */
export function pickTrack(info: { tracks: Track[]; defaultCaption: { lang: string; kind: string } | null }): Track | undefined {
  const { tracks, defaultCaption: def } = info;
  if (def) {
    const manual = tracks.find((t) => t.kind !== "asr" && sameLang(t.lang, def.lang));
    return manual ?? tracks.find((t) => sameLang(t.lang, def.lang) && t.kind === def.kind) ?? { lang: def.lang, kind: def.kind, name: "" };
  }
  const asr = tracks.filter((t) => t.kind === "asr");
  if (asr.length === 1) return tracks.find((t) => t.kind !== "asr" && sameLang(t.lang, asr[0].lang)) ?? asr[0];
  return (
    tracks.find((t) => t.kind !== "asr" && sameLang(t.lang, "en")) ??
    tracks.find((t) => sameLang(t.lang, "en")) ??
    tracks.find((t) => t.kind !== "asr") ??
    tracks[0]
  );
}

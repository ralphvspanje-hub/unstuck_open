// Panopto, the lecture-recording host many universities use: what its viewer page tells us about a
// recording. Its DeliveryInfo answer (undocumented, read defensively) has the title, the length,
// whether captions exist, the slide titles with their times ("Contents") and Panopto's own AI
// chapters; GenerateSRT gives the captions as an SRT file.
import { mmss } from "./captions.ts";
import type { CaptionSegment } from "./types.ts";

export type OutlineItem = { t: number; title: string };

export type Lecture = {
  id: string;
  title: string;
  durationSec: number;
  /** Panopto's caption track index for GenerateSRT, or null when the recording has no captions. */
  captionTrack: number | null;
  outline: OutlineItem[];
};

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** The parts of a DeliveryInfo answer Unstuck uses. */
export function lectureFrom(id: string, info: any): Lecture {
  const d = info?.Delivery ?? {};
  const tracks: any[] = Array.isArray(d.AvailableCaptions) ? d.AvailableCaptions : [];
  const first = tracks[0];
  const track = d.HasCaptions && first != null ? (num(first?.Language) ?? num(first) ?? 1) : null;
  const items: OutlineItem[] = [];
  const add = (list: unknown) => {
    for (const x of Array.isArray(list) ? list : []) {
      const t = num(x?.Time) ?? num(x?.StartTime) ?? num(x?.Start) ?? num(x?.AbsoluteTime);
      const title = str(x?.Caption) || str(x?.Title) || str(x?.Name) || str(x?.Text) || str(x?.Data);
      if (t !== null && title && title.length <= 160) items.push({ t, title });
    }
  };
  add(d.Timestamps); // slide titles, as in the viewer's Contents tab
  add(d.AIChapters); // Panopto's own chapters
  items.sort((a, b) => a.t - b.t);
  const outline = items.filter((x, i) => i === 0 || x.title !== items[i - 1].title || x.t - items[i - 1].t > 5);
  return { id, title: str(d.SessionName) || "Lecture", durationSec: num(d.Duration) ?? 0, captionTrack: track, outline };
}

/** The outline as lines for the model, with the part being watched marked. At most `max` lines around now. */
export function outlineText(outline: OutlineItem[], now: number, max = 60): string {
  if (!outline.length) return "";
  let cur = -1;
  for (let i = 0; i < outline.length; i++) if (outline[i].t <= now + 0.5) cur = i;
  const from = Math.max(0, Math.min(cur - Math.floor(max / 2), outline.length - max));
  return outline
    .slice(from, from + max)
    .map((x, i) => `${mmss(x.t)} ${x.title}${from + i === cur ? "   ← now" : ""}`)
    .join("\n");
}

/** SRT ("1\n00:00:01,000 --> 00:00:04,000\ntext") to caption segments. */
export function parseSrt(srt: string): CaptionSegment[] {
  const sec = (s: string) => {
    const m = s.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000 : null;
  };
  const out: CaptionSegment[] = [];
  for (const block of srt.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const start = sec(a);
    const end = sec(b);
    const text = lines
      .slice(at + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (start !== null && end !== null && text) out.push({ start, end, text });
  }
  return out;
}

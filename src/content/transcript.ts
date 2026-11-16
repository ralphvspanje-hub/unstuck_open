// Fallback for captions (ADR 0003): read YouTube's own "Show transcript" panel, then close it.
// Used only when the player's caption data doesn't arrive.

const PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
const SEGMENTS = "ytd-transcript-segment-renderer, transcript-segment-view-model";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readTranscriptPanel(): Promise<{ ts?: string; text: string }[]> {
  document.documentElement.classList.add("unstuck-reading-transcript"); // keeps the panel invisible meanwhile
  try {
    if (!document.querySelector(SEGMENTS)) {
      (document.querySelector("#description-inline-expander #expand, tp-yt-paper-button#expand") as HTMLElement | null)?.click();
      await sleep(400);
      const btn = document.querySelector<HTMLElement>("ytd-video-description-transcript-section-renderer button, button[aria-label='Show transcript']");
      if (!btn) return [];
      btn.click();
    }
    for (let i = 0; i < 30 && !document.querySelector(SEGMENTS); i++) await sleep(200);
    await sleep(300);
    const items = [...document.querySelectorAll<HTMLElement>(SEGMENTS)].map((seg) => {
      const ts = seg.querySelector<HTMLElement>(".segment-timestamp")?.innerText;
      const text = seg.querySelector<HTMLElement>(".segment-text")?.innerText;
      return ts && text ? { ts, text } : { text: seg.innerText.replace(/\s+/g, " ") };
    });
    // Close whichever panel holds the transcript (older layout, or the newer "In this video").
    const panel = document.querySelector(SEGMENTS)?.closest("ytd-engagement-panel-section-list-renderer") ?? document.querySelector(PANEL);
    const close = panel?.querySelector<HTMLElement>('#visibility-button button, button[aria-label="Close"], button[aria-label*="Close"]');
    if (close) close.click();
    else panel?.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
    return items;
  } finally {
    setTimeout(() => document.documentElement.classList.remove("unstuck-reading-transcript"), 300);
  }
}

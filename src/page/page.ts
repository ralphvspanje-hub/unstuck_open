// Runs in YouTube's own JavaScript world, from the very start of the page (ADR 0003).
// 1. Sees the caption data the player itself loads (YouTube blocks fetching it directly).
// 2. Calls the player API (switch captions on, read video details) for the content script.
// Talks to the content script with window.postMessage only.

const FROM_PAGE = "unstuck-page";
const FROM_CONTENT = "unstuck-content";
const post = (msg: Record<string, unknown>) => window.postMessage({ source: FROM_PAGE, ...msg }, location.origin);
const isCaptionUrl = (u: string) => u.includes("/api/timedtext");

// Captions can load before the content script listens (e.g. the Viewer had CC on at page
// load), so keep the last few per video and hand them over when asked.
const cache = new Map<string, { lang: string | null; body: string }[]>();

function report(url: string, body: string) {
  if (!body || body.length < 10) return;
  const u = new URL(url, location.href);
  const videoId = u.searchParams.get("v");
  const lang = u.searchParams.get("lang");
  const tlang = u.searchParams.get("tlang");
  if (videoId && !tlang) {
    cache.set(videoId, [...(cache.get(videoId) ?? []), { lang, body }].slice(-3));
    if (cache.size > 5) cache.delete(cache.keys().next().value!);
  }
  post({ kind: "captions", videoId, lang, tlang, body });
}

function bodyOf(xhr: XMLHttpRequest): string {
  if (xhr.responseType === "" || xhr.responseType === "text") return xhr.responseText;
  if (xhr.responseType === "json") return JSON.stringify(xhr.response);
  if (xhr.responseType === "arraybuffer") return new TextDecoder().decode(xhr.response);
  return "";
}

const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
  const u = String(url);
  if (isCaptionUrl(u)) {
    this.addEventListener("load", () => {
      try {
        report(u, bodyOf(this));
      } catch {}
    });
  }
  return (origOpen as any).call(this, method, url, ...rest);
} as any;

const origFetch = window.fetch;
window.fetch = async function (this: any, input: RequestInfo | URL, init?: RequestInit) {
  const res = await origFetch.call(this, input, init);
  try {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (isCaptionUrl(url)) res.clone().text().then((b) => report(url, b), () => {});
  } catch {}
  return res;
};

type Track = { languageCode?: string; kind?: string; vss_id?: string; displayName?: string };

function player(): any {
  return document.getElementById("movie_player");
}

function info() {
  const p = player();
  const pr = p?.getPlayerResponse?.();
  const d = pr?.videoDetails ?? {};
  const list = pr?.captions?.playerCaptionsTracklistRenderer;
  const tracks = list?.captionTracks ?? [];
  const on: Track | undefined = p?.getOption?.("captions", "track");
  // The caption track that goes with the audio that plays by default (the original language,
  // even when YouTube offers AI-dubbed audio and auto-captions in 20 other languages).
  const audio = list?.audioTracks?.[list?.defaultAudioTrackIndex ?? 0];
  const def = tracks[audio?.defaultCaptionTrackIndex ?? audio?.captionTrackIndices?.[0] ?? -1];
  return {
    videoId: d.videoId ?? null,
    title: d.title ?? document.title,
    channelId: d.channelId ?? null,
    author: d.author ?? "",
    isLive: Boolean(d.isLive),
    durationSec: Number(d.lengthSeconds) || 0,
    tracks: tracks.map((t: any) => ({ lang: t.languageCode, kind: t.kind ?? "", name: t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? "" })),
    captionsOn: Boolean(on?.languageCode),
    defaultCaption: def ? { lang: def.languageCode, kind: def.kind ?? "" } : null,
  };
}

function captionsOn(lang: string, kind: string): boolean {
  const p = player();
  if (!p?.setOption) return false;
  p.loadModule?.("captions");
  const list: Track[] = p.getOption?.("captions", "tracklist") ?? [];
  const isAsr = (t: Track) => t.kind === "asr" || String(t.vss_id ?? "").startsWith("a.");
  const track = list.find((t) => t.languageCode === lang && isAsr(t) === (kind === "asr")) ?? list.find((t) => t.languageCode === lang);
  p.setOption("captions", "track", track ?? { languageCode: lang });
  if (p.isSubtitlesOn && !p.isSubtitlesOn()) p.toggleSubtitlesOn?.();
  return true;
}

/** Off and on again: makes the player fetch the captions once more. */
async function captionsRefetch() {
  const p = player();
  if (!p?.toggleSubtitles) return false;
  p.toggleSubtitles();
  await new Promise((r) => setTimeout(r, 400));
  p.toggleSubtitles();
  if (p.isSubtitlesOn && !p.isSubtitlesOn()) p.toggleSubtitlesOn?.();
  return true;
}

// Play and pause go through YouTube's player, not the <video> element: the player keeps its own
// idea of playing, and pausing the element behind its back gets undone by the player's next
// layout pass (a resize, theatre mode, the Room). A DOM event runs its listener at once, also
// across script worlds, so the player knows before anything else happens.
document.addEventListener("unstuck-player", (e) => {
  const order = (e as CustomEvent).detail;
  const p = player();
  if (order === "pause") p?.pauseVideo?.();
  else if (order === "play") p?.playVideo?.();
});

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== FROM_CONTENT) return;
  const { kind, id } = e.data;
  try {
    if (kind === "info") post({ kind: "reply", id, data: info() });
    else if (kind === "cached-captions") post({ kind: "reply", id, data: cache.get(e.data.videoId) ?? [] });
    else if (kind === "captions-on") post({ kind: "reply", id, data: captionsOn(e.data.lang, e.data.trackKind) });
    else if (kind === "captions-refetch") void captionsRefetch().then((data) => post({ kind: "reply", id, data }));
    else if (kind === "captions-off") {
      const p = player();
      if (p?.isSubtitlesOn?.()) p.toggleSubtitles?.();
      post({ kind: "reply", id, data: true });
    }
  } catch (err) {
    post({ kind: "reply", id, error: String(err) });
  }
});

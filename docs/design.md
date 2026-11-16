# Unstuck: design for v1

Status: built (v1), November 2026. Terms are defined in [GLOSSARY.md](../GLOSSARY.md); decisions with their reasons are in [adr/](adr/).

## What it is

A Chrome extension on youtube.com. Switch it on for a video. It notices when you are stuck or missed something, and offers help before you ask.

v1 started as a personal tool. It is worth more than that only if it passes the checks below.

## How a Session goes

1. **Switch on.** An Unstuck button sits in the player's control bar, with an "always on for this channel" option. The camera light comes on. The button is disabled for Shorts, live streams and videos without captions.
2. **Video map.** Flash reads the full transcript once, in the background. It notes what the video is about, its key terms and where they are introduced, and its Dense parts.
3. **Watching.** Unstuck collects Signals:
   - Player actions
   - leaving the tab
   - Face readings, made on the laptop as numbers only ([ADR 0002](adr/0002-face-never-leaves-the-laptop.md))

   It sleeps during ads. Skipping an ad is not a Player action.
4. **Missed moment.** The video keeps playing for 15 s or more while you are not watching: the tab is hidden, or your face is gone or looking away. When you are back, an Offer shows two buttons: "Recap" and "Jump back to 12:40". If you were away more than 3 minutes, it shows only "Jump back".
5. **Stuck candidate.** Any one of these makes a Stuck candidate:
   - you rewind 3–30 s
   - you slow the video down
   - you pause more than 3 s in a Dense part
   - you look confused or lean in for 1.5 s or more, anywhere in the video (changed 12 Nov 2026: Dense parts only was too rare; the judge weighs the content). A confused look is two of lowered brows, tightened eyelids and a head tilt at once (13 Nov 2026): one alone is often something else (brows alone concentrating, a tilt alone resting the head on a hand). The tilt counts either way, from the Viewer's usual angle over the last half minute, so sitting with a tilted head soon becomes "straight". Each is measured against the Viewer's own resting face over the last few minutes, not a fixed level. Learning the Viewer's own confused face from their Asks was considered and left out: people sometimes ask without looking confused. The lines are set by the Viewer in the face meter (D), a test bench that shows TRIGGER whenever the face alone would fire. A head shake would need faster face readings than ~6 a second, and a shrug a body model with the shoulders in view.

   Gemini Decision 1 then judges it from three inputs: the last ~30 s of transcript, the current frame, and one line of text describing the Signals. The judge answers "would a short explanation help right now?", and an Offer fires when the score is at least 0.7 (`RULES.offerAt`). On real content it scores about 0.9; on intros and sponsor reads about 0.5. Rewinding the same part twice within a minute is sure enough to skip the judge. The judge is only asked about Stuck candidates rather than polled like Negotiation Radar, so there is no rising-edge logic; the cooldown prevents repeats.

   **Frequent mode.** For trying Unstuck out, lower thresholds give many more Offers: rewind from 2 s, pauses of 2.5 s anywhere (not while away), Missed from 10 s, Offer at 0.45, cooldown 25 s. The numbers above are the defaults; the frequent value sits in a comment next to each one in `RULES`.
6. **Offer.**
   - It appears at the end of the speaker's sentence, bottom-right inside the player, and fades after ~8 s.
   - After an Offer, there is a 2-minute cooldown before the next one.
   - The Explanation starts being written as soon as the Offer appears, so it is ready on click.
7. **Explanation.**
   - **Opening it:** clicking pauses the video. A panel glides in over YouTube's right column, or in at the player's right edge in fullscreen, and the text types itself out.
   - **What the model gets:** about 90 s of transcript, the current frame, the Video map and earlier Explanations from this Session.
   - **Visuals first.** Most Explanations come with a Figure, and the text works as its caption ([ADR 0005](adr/0005-figures-are-drawn-by-code-not-by-the-model.md)). Curves and numbers get an exact plot: the model gives the formula, Unstuck draws it. Structures, steps and comparisons get a small HTML figure, which the server checks on a render before it is shown. Both build up on screen piece by piece, in a small fixed palette. Physical things on the frame get none, because the Marks point at the real thing; plain definitions stay text-only.
   - **The moment itself:** a Stuck moment is noticed seconds after it happens (a look is held 1.5 s, the judge thinks, the Offer waits for the end of the sentence). Unstuck keeps the last 10 s of frames, so the judge and the Explanation see the frame from when the Viewer got stuck, the Offer shows a small picture of it, and taking it goes back there (13 Nov 2026: a look at an airflow diagram got an explanation of whatever came 5 s later).
   - **On the frame:** usually one Mark or none, at most two, each tied to a phrase in the text that lights up when its Mark draws. Most are arrows that point at the exact thing; a circle is only for one small thing among similar ones (13 Nov 2026: boxes around big or long things looked clumsy). The answer names what to point at; a separate locate call finds it on the frame, then takes a second, zoomed-in look at small things for a tight fit. Marks that can't be found are dropped rather than drawn in the wrong place, and so are Marks on most of the picture or on top of another Mark. Arrows and labels go where the frame is calm, away from text and lines. Marks clear when the video plays.
   - **Simulations ("▶ Play with it").** When the idea has something worth moving (a parameter, a rate, a threshold, an input), the answer ends with one line saying what, and a button appears under it. Clicking it has a stronger model (Gemini 4 Hydrogen, free on a free-tier key within a daily quota, thinking a little first) write a small self-contained web page, 10–20 s, made only on click and never prefetched; when that model is busy or its quota is used up, Flash builds it instead (`UNSTUCK_VISUAL_MODEL` picks another, `""` switches it off). It fills the paused video with 1–3 controls and live readouts, in Unstuck's colours. Spatial ideas (a machine, orbits, a molecule, radar off a shape) are 3D with three.js, which ships inside the extension: drag to turn, scroll to zoom. Everything else stays 2D. It runs in a locked-down sandbox with no network ([ADR 0004](adr/0004-simulations-run-in-a-sandbox-page.md)). If it crashes or comes back unusable, it is rebuilt once with the error; otherwise the button says so. Esc or ✕ only hides it: the button toggles it, it keeps its state, and a build keeps going while hidden.
   - **Tables:** a comparison of 2–4 things may come as a small table.
   - **Formulas** are typeset as in a textbook.
   - **Buttons:** "Got it" resumes the video 3 s earlier. "Simpler, please" rewrites it. A box takes follow-up questions.
8. **Ask.** A key and a button get an Explanation at any time.
9. **Session card.** When the video ends, a card lists the Stuck moments and their Explanations, ready to copy.

## Feel: satisfying, smooth, playful

- **Motion:** the Offer pops in with a slight bounce and the panel glides. Explanation text types itself out. "Got it" snaps a ✓ and the video rolls on.
- **Making room:** opening the chat never covers the video. The video glides beside the chat and the rest of YouTube fades out (the Room); a simulation slides in underneath. Folding, closing or playing glides it all back to exactly where it was.
- **Mascot:** a small knot that tangles when you are stuck and untangles on "Got it".
- **Sound:** off by default, so it does not clash with the video's audio. Soft pops can be switched on.
- **Tone:** friendly and plain. A little wit is allowed in the framing, never in the content. It reuses the speaker's own examples.

## Offer log

For every Offer and Ask it records:
- the video and the time in the video
- the type of moment
- the Signals, as numbers
- the Offer outcome and the Explanation outcome
- any question you typed

It is stored in the extension, on the laptop only. Its shape would allow creator maps later; nothing is shared now.

## How it is built

- **Content script on youtube.com:**
  - Player actions, the current frame and the Offer and panel UI.
  - Captions come from the player's own caption request ([ADR 0003](adr/0003-captions-from-the-players-own-request.md)), in three steps: captions already loaded, then switching them off and on so the player fetches them again, then reading YouTube's "Show transcript" panel.
- **Offscreen document:** the camera and MediaPipe, producing Face readings. Camera permission belongs to the extension, never to youtube.com ([ADR 0001](adr/0001-chrome-extension-camera-on-extension-origin.md)).
- **Service worker:** Session state and the rules, and the calls to the local server.
- **Local Node server:**
  - Listens on 127.0.0.1:4717 and accepts only the extension's origin. Every call is a POST, because Chrome leaves the Origin header off an extension's GET requests.
  - Holds the Gemini key, from its environment (`GEMINI_API_KEY`), and is started by hand (`npm run dev`). Without a key it runs in mock mode. The key is never written to a file or logged.
  - Calls Decision 1 and Flash.
- **The Room** ([ADR 0006](adr/0006-the-room-moves-youtubes-own-player.md)) moves YouTube's own player with `position: fixed`, fades everything beside its line of parents, and glides it with a FLIP transform. `src/core/room.ts` places the windows and finds the biggest free spot for the video; `src/content/room.ts` does the moving. Simulations live in the Room's own layer outside the player, so they can go anywhere and YouTube's end screen can't cover them.
- **Figures** come in the same streamed answer as the text: the text types out first, then the Figure appears. Plots are a JSON description drawn by `src/core/plot.ts`. HTML figures are held back by the server, rendered in headless Chromium, looked at by Flash-Lite (OK or a fix, within 7 s), then cleaned in the panel (no scripts, links, media or `url()`) and shown in their own shadow root.
- **Tooling:** TypeScript, esbuild (simpler than Vite for extension bundles), Node's built-in test runner, a Playwright smoke test on real YouTube. No UI framework. Motion (vanilla JS) for the springs. KaTeX renders formulas as MathML, so no fonts have to be loaded into YouTube's page.

Visuals considered and not chosen:
- **Mermaid diagrams:** only boxes and arrows.
- **AI-generated images:** slow, and text inside them is unreliable.
- **Model-written animations or interactive code:** quality varies, and they would need a sandboxed page.

## Models and cost

- **Gemini Decision 1** judges Stuck candidates.
- **The cheapest current Gemini Flash model that accepts images** writes the Video map, Explanations and Recaps. It is a single config value. Each is one call in a fixed pipeline (judge, answer, locate the Marks, check a Figure), not an agent. The first answer doesn't think, so its first word comes in ~1–2 s; follow-up questions think a little (thinking level low), since they are more open and the Viewer is waiting for them anyway (13 Nov 2026).
- **Expected cost:** about $0.10–0.20 per hour of video. Most of it is Figures and their checks, each well under a cent.

## Checks, in order

1. It is still switched on after 2 weeks.
2. At least half of the Offers you saw were accepted: Accepted, against Dismissed plus Faded. Unseen ones do not count.
3. When you are not stuck, there is at most about one Offer per 10 minutes.

Asks count as misses.

## Testing, kept lean

It does not have to be bulletproof yet, and usage limits matter.
- **Replay:** Sessions record Signals and Asks. They replay offline with cached model answers, so tuning the rules costs no new calls.
- **Explanation test set:** about 10 real Stuck moments, used for one round of prompt comparison. Each Explanation is scored on five points: correct, uses what is on screen, short, does not repeat itself, and the Figure is correct and readable.
- **YouTube quirks covered now:** ads, moving to the next video, fullscreen, and light and dark mode. The rest waits.

## Build order

1. The whole loop end to end, rough: one rule → Offer → Explanation.
2. Recording and replay.
3. Tuning on your first real Sessions.
4. Polish and the playful layer.

## Not in v1

- Spoken answers
- Thresholds that tune themselves
- Boredom detection
- Sites other than YouTube
- Shorts and live streams
- Sharing any data

# AGENTS.md: helping someone set up Unstuck

You are a coding agent helping a person install Unstuck, a Chrome extension that notices when they get stuck in a
YouTube explainer or a Panopto lecture and offers a visual explanation. What it does is in [README.md](README.md);
this file is how to get it running for them, and what to check when it doesn't.

## What you can do, and what only they can do

- **You:** check Node, install, download the face model, build, run the tests, start the optional local server,
  and diagnose problems.
- **Only the person:** load the extension in Chrome, sign in to Google AI Studio and create a key, paste the key into
  Unstuck's setup page, allow the camera. Tell them exactly what to click, one step at a time.
- **The key is theirs.** Never ask them to paste their Gemini key into this conversation, and never write it to a
  file, a log, a commit, or a command line. In the default setup they paste it straight into Unstuck's setup page.
  For the local server they put it in the server's environment themselves (see below).

## Default setup: the key in the extension, no server

1. **Node 23.6 or newer:** `node -v`. Unstuck runs TypeScript directly; an older Node fails at the first `npm run`.
   Chrome is required (Safari can't load it; other Chromium browsers are untested). It was built and tested on macOS.
2. **Install and build**, from the repo root:
   ```bash
   npm install
   npm run fetch-model   # MediaPipe face model from storage.googleapis.com, ~3.6 MB; optional (no camera without it)
   npm run build         # writes dist/
   ```
   Check that `dist/manifest.json` exists. Optional sanity check: `npm run typecheck && npm test`.
3. **Load it.** Give them the absolute path of `dist/` (from `pwd`), then: `chrome://extensions` → switch on
   **Developer mode** (top right) → **Load unpacked** → choose that folder. The setup page opens by itself.
4. **The key.** Ask whether they want free or paid, and explain the difference in one or two lines:
   - **Free:** no cost; daily limits per project; Google may use what Unstuck sends (video frames, the transcript,
     for lectures their sound; never the face) to improve its products.
   - **Paid:** the same key with billing turned on for its project in AI Studio; pay per use, higher limits, and the
     data isn't used to improve Google's products.

   Either way: [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → copy → paste on
   Unstuck's setup page → **Save**. The page tries the key once and shows "Key saved ✓". As of November 2026 every
   model Unstuck uses has a free tier.
5. **The camera (optional):** **Allow camera** on the setup page. Chrome asks there, on the extension's own page,
   never on YouTube.
6. **First run:** a YouTube explainer → play → click the 🪢 knot in the player's control bar if it isn't on → press
   **E**. The video pauses and an explanation starts typing within a few seconds. **U** switches Unstuck off and on.

After any code change: `npm run build`, the round arrow on Unstuck in `chrome://extensions`, then reload the tab.

## Choosing models, or another provider

- The four model names are constants at the top of `src/ai/gemini.ts`: `FLASH` (answers), `FLASH_FALLBACK` (when
  Flash is busy or out of quota), `DECISION` (the judge, `gemini-decision-1`) and `VISUAL` (simulations; `""` turns
  it off so the usual models build them). Change, rebuild, reload.
- Every model call is in `src/ai/gemini.ts`, and the prompts are in `src/ai/prompts.ts`. Another provider means
  rewriting `gemini.ts` behind the same functions. The judge needs a model that returns a score from 0 to 1 for
  "would a short explanation help right now?"; the threshold is `RULES.offerAt` in `src/core/rules.ts`.

## Optional: the local server

For development, or for the HTML figure check (the server renders figures in headless Chromium and lets the model
check them). The extension uses the server only while **no** key is saved on the setup page.

```bash
npx playwright install chromium                    # once
read -s GEMINI_API_KEY && export GEMINI_API_KEY    # the person types or pastes it in their own terminal
npm run dev                                        # builds dist/, starts 127.0.0.1:4717
```

Or from a secrets manager, e.g. `op run --env-file=.env -- npm run dev` with `.env` holding only a reference
(`GEMINI_API_KEY=op://<vault>/<item>/credential`). `.env*` is ignored by git; keep it that way.

- No key: the server runs in **mock mode** (canned answers, no network), useful to test the UI.
- It answers only the extension id fixed by the `key` in `extension/manifest.json`. A plain `curl` gets no reply,
  which is expected; check it's up with `lsof -iTCP:4717 -sTCP:LISTEN`. If the manifest `key` is changed or
  removed, the id changes and the server refuses the extension.
- Port taken: `UNSTUCK_PORT=<port>` for both `npm run build` and the server.
- Model overrides without a rebuild: `UNSTUCK_FLASH_MODEL`, `UNSTUCK_FLASH_FALLBACK`, `UNSTUCK_DECISION_MODEL`,
  `UNSTUCK_VISUAL_MODEL`.

## When something's wrong

| What they see | Why, and what to do |
|---|---|
| Setup page says "Not connected" | No key saved and no server running. Save a key on the setup page. |
| The key isn't accepted | A typo, or a key from a project without the Gemini API. Create a new one in AI Studio. |
| Answers stop, errors mention 429 or quota | The day's free quota is used up. Wait until the next day (it resets at midnight Pacific) or turn on billing. |
| First words take long, or "busy" | The model is under load; Unstuck falls back to Flash-Lite by itself. |
| No Offers pop up | Normal at first: an Offer needs the video playing, the judge scoring ≥ 0.7, and 2 minutes since the last one. Press **D** for the face meter, which also lists what a real Offer still needs. **E** always asks directly. For many more Offers, use the frequent-mode values in the comments in `src/core/rules.ts`. |
| The camera never starts | Allow it on the setup page. On macOS also System Settings → Privacy & Security → Camera → Chrome. |
| The screen edges glow (macOS) | macOS's Edge Light, not Unstuck: the green camera icon in the menu bar turns it off. |
| A video with no captions gets weak answers | Unstuck explains from the transcript and frames; without captions it has only the frames. |
| Code changes don't show | `npm run build`, reload the extension, then reload the tab. |

## If you change the code

- Use the words in [GLOSSARY.md](GLOSSARY.md); the reasons behind the design are in [docs/adr/](docs/adr/).
- The camera picture never leaves the laptop: only numbers come out of the camera page ([ADR 0002](docs/adr/0002-face-never-leaves-the-laptop.md)).
- Never commit keys or `.env` files.
- Checks: `npm run typecheck`, `npm test`. End to end: start the server in mock mode (`npm run server`), then
  `npm run smoke` (first time: `npx playwright install chromium`). More variants are in the README under Tests.

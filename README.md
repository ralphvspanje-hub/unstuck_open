# 🪢 Unstuck

A Chrome extension that watches how you watch a video (a YouTube explainer, or a recorded lecture on Panopto) and, when you get stuck, offers a short visual explanation before you ask. It pauses on the frame you got stuck on, explains it, points at the thing it's about, and can build a small simulation you can play with. It also notices when you missed a part and offers a Recap.

It can read your face (optional, on your own laptop: the picture never leaves it) and uses Google's Gemini models: Gemini Decision 1 decides whether an explanation would help, Flash-Lite writes it, Gemini 4 Hydrogen builds the simulations. Or bring another provider's key: OpenAI, Anthropic, Mistral, xAI, OpenRouter, a local model, or any OpenAI-compatible API.

A prototype (v1). Design: [docs/design.md](docs/design.md). Words: [GLOSSARY.md](GLOSSARY.md). Decisions: [docs/adr/](docs/adr/). **Setting it up with a coding agent?** Point it at [AGENTS.md](AGENTS.md).

## Set it up

You need **Chrome** (not Safari), **Node 23.6 or newer** (to build it once; it runs TypeScript directly) and an API key: **Gemini** (free is fine), or another provider's.

### 1. Build it

```bash
git clone https://github.com/ralphvspanje-hub/unstuck_open.git unstuck
cd unstuck
npm install
npm run fetch-model   # the MediaPipe face model, ~3.6 MB (skip it and Unstuck works without the camera)
npm run build         # makes dist/
```

### 2. Load it in Chrome

1. Go to `chrome://extensions`, switch on **Developer mode** (top right), click **Load unpacked** and pick the `dist` folder.
2. Unstuck's setup page opens by itself (later: click the Unstuck icon in the toolbar). Pin the icon: the puzzle piece next to the address bar, then the pin next to **Unstuck**.

### 3. Add a key

Create a key at [Google AI Studio](https://aistudio.google.com/apikey) (**Create API key**), paste it on the setup page and click **Save**. Unstuck tries it once, then keeps it encrypted in this browser and sends it only to Google ([ADR 0007](docs/adr/0007-the-viewers-own-key-in-the-extension.md)). With a key saved, the extension calls Gemini itself: no server, no terminal.

Free or paid is a setting on the key's project in AI Studio, not a different key:

| | Free | Paid |
|---|---|---|
| How | A new key, as above | The same key, with billing turned on for its project in AI Studio |
| Cost | Nothing | Pay per use: see [Google's pricing page](https://ai.google.dev/gemini-api/docs/pricing) |
| Limits | Per day and per project. When they're used up, calls fail until the next day; Unstuck falls back to a lighter model where it can | Much higher |
| What Google does with it | Google may use what Unstuck sends (frames of the video, its transcript, for a lecture its sound; never your face) to improve its products | Not used to improve Google's products |

As of November 2026 every model Unstuck uses has a free tier: `gemini-decision-1`, `gemini-flash-latest`, `gemini-flash-lite-latest` and `gemini-4-hydrogen`. Your own limits are at [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit).

**Another provider instead.** Pick it in the **Model provider** list on the setup page: OpenAI, Anthropic (Claude), Mistral, xAI (Grok), OpenRouter (one key for many models, Claude and open models too), Ollama or LM Studio on your own computer (no key, free and private), or any OpenAI-compatible API by its address (Groq, Together, DeepSeek, your own server...). Paste the key, click **List models**, pick one (and, if you like, a stronger one for Simulations) and **Save**: Unstuck tries it with one tiny answer first. Chrome asks once to allow an address it doesn't know yet.

Gemini is what Unstuck was built on and stays the best fit. With another provider ([ADR 0009](docs/adr/0009-any-providers-key-gemini-by-default.md)):
- the judge is a prompt asking for a score, instead of Gemini Decision 1;
- a lecture's sound isn't sent (its captions and slides are);
- Marks need a model that can see images and point well, so pick a vision model;
- only Gemini has a free API tier (local models are free, but run on your computer).

For Ollama, start it with `OLLAMA_ORIGINS=chrome-extension://*` if it refuses Unstuck.

### 4. The camera (optional)

On the setup page, click **Allow camera**. Unstuck then notices a confused look (two of: brows down, eyelids tight, head tilted) or leaning in, each measured against your own usual face. Without the camera it works from what you do with the player (rewinding, pausing, slowing down). Press **D** on a video for the face meter, which shows what it sees.

On macOS Tahoe the screen may glow around its edges when the camera turns on. That's macOS's **Edge Light**, not Unstuck: turn it off from the green camera icon in the menu bar.

### 5. Use it

Open a YouTube explainer and click the 🪢 knot in the player's control bar (on a Panopto lecture Unstuck starts by itself). When you look stuck, a small Offer pops up: press **E** to take it. Press **E** any time to ask about what's on screen; **U** switches Unstuck off and on. More below, under [Using it](#using-it).

After changing code: `npm run build`, click the round arrow on Unstuck in `chrome://extensions`, then reload the video's tab.

## Other ways to run it

### Other models

Other providers' models are picked on the setup page (above). The Gemini models are four constants at the top of [src/ai/gemini.ts](src/ai/gemini.ts): `FLASH` (answers), `FLASH_FALLBACK` (used when Flash is busy or out of quota), `DECISION` (the judge) and `VISUAL` (simulations; `""` switches it off). Change them, `npm run build`, and reload the extension. Every model call is in `src/ai/`: `gemini.ts` for Gemini, `chat.ts` for the OpenAI-compatible and Anthropic formats, `provider.ts` for the switch and `presets.ts` for the list on the setup page.

### A local server that holds the key (for development)

Instead of a key in the extension, a small local server can hold one in its environment. It adds one thing the extension can't do: it renders HTML figures in headless Chromium and lets the model check them before you see them.

```bash
npx playwright install chromium     # once, for the figure check
read -s GEMINI_API_KEY && export GEMINI_API_KEY   # type or paste the key: not echoed, not in your shell history
npm run dev                         # builds dist/ and starts the server on 127.0.0.1:4717
```

Or load the key from a secrets manager, for example 1Password: `op run --env-file=.env -- npm run dev`, with `.env` holding only a reference (`GEMINI_API_KEY=op://<vault>/<item>/credential`). `.env` files are ignored by git.

- The extension only uses the server while no key is saved on the setup page.
- The server answers only Unstuck's extension id (`cbbnmjbdbobjhmndkdbfeckdhgghdloa`, fixed by the `key` in `extension/manifest.json`), so a plain `curl` gets nothing back: that's expected.
- Its models can be changed without a rebuild: `UNSTUCK_FLASH_MODEL`, `UNSTUCK_FLASH_FALLBACK`, `UNSTUCK_DECISION_MODEL`, `UNSTUCK_VISUAL_MODEL`. Another port: `UNSTUCK_PORT=<port>` for both `npm run build` and the server.
- **Mock mode:** without a key, `npm run dev` runs the server with canned answers and no Gemini calls. Handy for UI work.

## Using it

- **Stuck:** rewind 3–30 s, slow the video down, pause for 3 s in a dense part, or look confused (two of: brows down, eyelids tight, head tilted) or lean in for 1.5 s, all measured against your own usual face. Unstuck asks Gemini Decision 1 whether a quick explanation would help (it must score 0.7 or more). If yes, an Offer pops up at the end of the speaker's sentence (after a look, it waits at most 1.5 s). The Offer is about the moment you got stuck, not the moment it shows: it carries a small picture of that frame, and taking it goes back there. Rewinding the same part twice within a minute skips the judge. Take it with its **Explain [E]** button, by clicking anywhere on it, or by pressing **E**.
- **Explanation:** the video pauses on the frame it explains, Marks show what it's about, only when there's something to find: usually an arrow at the exact thing (or a small circle, a spotlight or a flow), each tied to a coral phrase in the text; hover the phrase to make its Mark wink, and a Figure builds up: an exact plot for curves and numbers, or a small figure for structures and steps, checked by the server on a render before you see it. Comparisons can come as a small table. Use **Got it ✓**, **Simpler, please**, or type a follow-up.
- **▶ Play with it:** a button under most answers, saying what the visual would show (left out when there's nothing to show, like a name or a definition). Click it and a small interactive simulation is built for that idea (10–20 s) and opens underneath the video, in 3D when the idea is spatial (drag to turn it). You can also just ask for one in the chat. It runs in a sandbox with no network. **Esc** or ✕ hides it; the same button opens it again, as you left it. A simulation that's still building keeps building while hidden.
- **On and off:** press **U** or click the knot in the player's control bar. The welcome pop-up shows the two keys a Viewer needs: **E** explain, **U** on/off (Q and D are on the setup page, under "For testing").
- **Lectures (Panopto):** on a Panopto lecture (`*.hosted.panopto.com`, `*.cloud.panopto.eu`, also embedded in a course site) Unstuck starts by itself once the video plays; the knot at the top left of the video switches it off. It uses Panopto's captions when there are any, its Outline (slide titles and chapters), and the last 5 minutes of the lecture's sound, which Gemini listens to with each Explanation and Recap ([ADR 0008](docs/adr/0008-lectures-send-their-last-minutes-of-sound.md)). No Room on Panopto yet: the chat floats over the video.
- **Ask:** press **E** or click **?** in the control bar at any time. With a pop-up showing, **E** takes it (back to its moment); **Q** always explains what's on screen right now. Each pop-up says why it came ("You rewound", "You looked confused"), and a confused look replaces an older pop-up that's still up.
- **Making room:** while the chat is open, the video glides over beside it and the rest of YouTube fades out, so nothing covers the video; a simulation goes underneath it. Fold the chat with **–**, close it, or play the video, and everything goes back exactly where it was. Playing folds the chat to its header, so you can open it again with **+** to reread. Switch it off on the setup page (toolbar icon).
- **Moving things:** drag the chat, a simulation or the face meter by its header and resize it from any corner (the grips show when the pointer is over it); the video moves into the biggest space that's left. Double-click a header to put it back. Places are remembered across videos. Marks clear when the video plays, because they belong to the paused frame.
- **Camera:** it films only while it can matter. It stops 5 s after you pause (a confused look in those 5 s still brings a pop-up) and comes back when you play; it also switches off when the YouTube tab has been hidden for a minute. While the face meter is open it stays on.
- **Thinking (test):** follow-up questions think a little first. On the setup page you can let the first answer think too, to compare; every answer then shows how long its first word took.
- **Face meter (test):** press **D**. It runs the face rule on your face as if the video were playing and shows **TRIGGER** whenever your face alone would set it off, also while paused or with the chat open, with a log of the times. A confused look is any two of brows, eyelids and head tilt past their lines together for 1.5 s (the tilt either way, from how you held your head over the last half minute); leaning in counts on its own. Drag the white line on a bar to move that line; it's saved and used for real (Reset the lines puts them back). Below, whether a real pop-up could happen right now, and what else one needs (the judge, the end of the sentence, the cooldown). At the top, your face as Unstuck sees it: a mesh of points, the brows and eyes turning coral past their lines.
- **Camera view (demo):** **Camera view ↗** in the face meter opens a window of Unstuck's own with your camera picture, the mesh on it, the four numbers against their lines and a big TRIGGER. The picture stays in that window and goes nowhere; Unstuck itself works from the numbers. While it is open the camera keeps running, also when the video is paused. **Esc** or **✕ Close** closes it; it always opens as a small window, also from full-screen YouTube. 
- **Missed:** if the video kept playing for 10 s or more while you were in another tab or looking away, you get **Recap** / **Jump back**. The Recap opens as a chat: ask about the part you missed, and the answers know all of it.
- **End of video:** a Session card lists what you got stuck on, ready to copy as notes.
- **Stats:** the toolbar icon shows the three v1 checks and exports the Offer log.

## How it fits together

| Part | File | Job |
|---|---|---|
| Page script (YouTube's world) | `src/page/page.ts` | sees the captions the player loads, calls the player API |
| Content script | `src/content/` | Signals, the Session loop, Offer, panel, Marks, Figures, Simulations |
| Core logic (pure, tested) | `src/core/` | caption parsing, Stuck/Missed rules, answer parsing, guard |
| Lecture host | `src/content/panopto.ts`, `src/core/panopto.ts`, `src/content/audio.ts` | Panopto: finds the lecture video, its captions and Outline, keeps the Lecture sound |
| Sites | `src/content/sites.ts` | what differs per site (captions, play and pause, the Room) |
| Model calls | `src/ai/` | prompts (`prompts.ts`), Gemini (`gemini.ts`), other providers (`chat.ts`, `provider.ts`), shared by the server and the extension |
| Background worker | `src/background/background.ts` | calls Gemini with the Viewer's own key (kept locked, `keystore.ts`), or the local server; owns the camera page |
| Camera page | `src/offscreen/offscreen.ts` | MediaPipe → Face readings (numbers only) |
| Local server | `server/` | holds the key; Decision 1 judges, Flash writes |

Prompts live in `src/ai/prompts.ts`. Detection thresholds are in `src/core/rules.ts` (`RULES`). The Offer bar (`offerAt`) is there too. The defaults are calm: at most one Offer every 2 minutes. For trying it out, **frequent mode** gives many more; its value is in the comment next to each threshold it changes.

## Tests

```bash
npm test             # unit tests for the core logic and the provider formats
npm run typecheck
npm run server       # in one terminal (mock mode is fine), then:
npm run smoke        # end-to-end on real YouTube in Playwright's Chromium
HEADED=1 npm run smoke   # visible window: tests the player-captions path
CAMERA=1 npm run smoke   # fake webcam: tests the camera plumbing
HEADED=1 ROOM=1 AT=328 npm run smoke   # the Room: nothing overlaps, everything goes back
PROVIDER=openai npm run smoke    # another provider, set up on the setup page, against a fake one (no key, no server)
PROVIDER=anthropic npm run smoke # the same in Anthropic's format; PROVIDER=reasoning: a model that turns down temperature
# Next to your running server: a test copy on another port, with a mock server there
UNSTUCK_OUT=dist-test UNSTUCK_PORT=4718 npm run build
UNSTUCK_MOCK=1 UNSTUCK_PORT=4718 node server/index.ts &
UNSTUCK_OUT=dist-test HEADED=1 ROOM=1 AT=328 npm run smoke
```

Headless Chromium gets empty captions from YouTube (a bot check), so the plain smoke run exercises the transcript-panel fallback. First time: `npx playwright install chromium`.

## Privacy

- Your face is read on this laptop and turned into numbers. No image of you is stored or sent ([ADR 0002](docs/adr/0002-face-never-leaves-the-laptop.md)).
- Gemini gets the video's transcript, frames of the *video*, and one line of text about what you did ("rewound 12 s"). For a lecture also its Outline and the last 5 minutes of its sound.
- A Viewer's own key is kept encrypted in the browser and sent only to their provider. On Google's free plan, Google may use what is sent to improve its products; other providers have their own terms.
- The Offer log stays in the extension's storage.

## License

[MIT](LICENSE).

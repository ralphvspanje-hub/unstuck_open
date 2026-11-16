// End-to-end smoke test on real YouTube, with the server in mock mode (no Gemini calls).
// Needs: npm run build, the server running (npm run server), and `npx playwright install chromium`.
// Usage: node scripts/smoke.ts [videoId]   Screenshots go to /tmp/unstuck-smoke-*.png
// Next to a running real server: build a test copy (UNSTUCK_OUT=dist-test UNSTUCK_PORT=4718 npm run build),
// start a mock server on that port (UNSTUCK_MOCK=1 UNSTUCK_PORT=4718 node server/index.ts), then UNSTUCK_OUT=dist-test.
import { chromium, type Page } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FAKE_KEY, startFakeProvider } from "./fake-provider.ts";

const VIDEO = process.argv[2] || "aircAruvnKk"; // 3Blue1Brown, "But what is a neural network?"
const AT = Number(process.env.AT || 90); // where to start watching, in seconds
const dist = resolve(process.env.UNSTUCK_OUT || "dist");
const shot = (page: Page, name: string) => page.screenshot({ path: `/tmp/unstuck-smoke-${name}.png` });
const step = (s: string) => console.log(`• ${s}`);
const errors: string[] = [];

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "unstuck-")), {
  channel: "chromium",
  // Headless gets empty captions from YouTube (bot check), which exercises the transcript-panel
  // fallback. HEADED=1 opens a real window, where the player's own captions come through.
  headless: !process.env.HEADED,
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--autoplay-policy=no-user-gesture-required",
    "--disable-blink-features=AutomationControlled",
    // CAMERA=1: a fake webcam (a test pattern, no face) to check the camera plumbing.
    ...(process.env.CAMERA ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : []),
    // FAKE_VIDEO=clip.y4m: that clip plays as the webcam (a face, for the demo view).
    ...(process.env.FAKE_VIDEO ? [`--use-file-for-fake-video-capture=${process.env.FAKE_VIDEO}`] : []),
  ],
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const camera = Boolean(process.env.CAMERA);
  await sw.evaluate(({ camera, off }) => chrome.storage.local.set({ cameraGranted: camera, settings: { camera, alwaysOnChannels: [], room: !off } }), { camera, off: Boolean(process.env.ROOM_OFF) });
  if (camera) {
    await sw.evaluate(() => {
      (self as any).faces = [];
      chrome.runtime.onMessage.addListener((m: any) => {
        if (m?.kind === "face") (self as any).faces.push(m.reading);
      });
    });
  }
  step(`extension loaded: ${sw.url().split("/")[2]}`);

  if (process.env.PANOPTO) {
    // A public recorded lecture on Panopto (STScI, "Galaxy Collisions", no login, no captions): Unstuck
    // starts by itself, puts its knot button on the video, keeps the lecture's sound, and Q explains with it.
    const lp = ctx.pages()[0] ?? (await ctx.newPage());
    const logs: string[] = [];
    lp.on("console", (m) => m.text().includes("[unstuck]") && logs.push(m.text()));
    await lp.goto(process.env.PANOPTO_URL || "https://cloudproject.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id=1289da3c-1e1e-4403-a92c-a995003df76f", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await lp.waitForTimeout(6000);
    await lp.evaluate(() => {
      const v = [...document.querySelectorAll("video")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (v) {
        v.currentTime = 600;
        void v.play();
      }
    });
    await lp.waitForSelector("unstuck-overlay", { state: "attached", timeout: 30_000 });
    step(`Unstuck started on Panopto; knot button: ${(await lp.locator("unstuck-button").count()) ? "yes" : "NO"}`);
    await lp.waitForTimeout(14_000); // some lecture sound to keep
    await shot(lp, "panopto-playing");
    await lp.locator("video#primaryVideo, video").first().hover().catch(() => {});
    await lp.keyboard.press("q");
    await lp.waitForSelector("unstuck-panel", { timeout: 20_000 }).catch(() => {});
    await lp.waitForTimeout(6000);
    const panel = (await lp.locator("unstuck-panel .turn.unstuck .text").first().innerText().catch(() => "(no panel)")).replace(/\s+/g, " ").slice(0, 160);
    step(`panel: ${panel}`);
    const paused = await lp.evaluate(() => [...document.querySelectorAll("video")].map((v) => v.paused));
    step(`videos paused while explaining: ${JSON.stringify(paused)}`);
    step(`console: ${logs.filter((l) => /captions|sound|health/.test(l)).join(" | ").slice(0, 600)}`);
    await shot(lp, "panopto-explained");
    await ctx.close();
    process.exit(0);
  }

  if (process.env.KEY) {
    // Direct mode, the Viewer's own key: a made-up key must be refused by Google (one real request,
    // no quota used), nothing saved, and the error said in words a Viewer understands.
    const setup = await ctx.newPage();
    await setup.goto(`chrome-extension://${sw.url().split("/")[2]}/setup.html`);
    const send = (m: unknown) => setup.evaluate((m) => chrome.runtime.sendMessage(m), m);
    step(`not a key: ${JSON.stringify(await send({ kind: "key-save", key: "hello there" }))}`);
    step(`made-up key: ${JSON.stringify(await send({ kind: "key-save", key: "AIzaSyD" + "x".repeat(32) }))}`);
    step(`saved after both: ${JSON.stringify(await send({ kind: "key-status" }))}`);
    const stored = await sw.evaluate(() => chrome.storage.local.get(null).then((all) => Object.keys(all)));
    step(`storage keys: ${stored.join(", ")}`);
    // The page itself, as a new Viewer sees it: a key typed in and refused.
    await setup.reload();
    await setup.waitForTimeout(800);
    await setup.fill("#key", "AIzaSyD" + "y".repeat(32));
    await setup.click("#key-save");
    await setup.waitForFunction(() => !document.querySelector("#key-status")?.textContent?.includes("Checking"), null, { timeout: 15_000 });
    step(`after Save: "${await setup.locator("#key-status").innerText()}"`);
    await setup.setViewportSize({ width: 900, height: 1100 });
    await setup.screenshot({ path: "/tmp/unstuck-smoke-setup.png", fullPage: true });
    await ctx.close();
    process.exit(0);
  }

  // PROVIDER=openai|anthropic|reasoning: another provider (ADR 0009), set up on the setup page the way a
  // Viewer would, against a fake one on this machine; the rest of the run then goes through it.
  let fake: Awaited<ReturnType<typeof startFakeProvider>> | null = null;
  if (process.env.PROVIDER) {
    fake = await startFakeProvider();
    const anthropic = process.env.PROVIDER === "anthropic";
    const setup = await ctx.newPage();
    await setup.goto(`chrome-extension://${sw.url().split("/")[2]}/setup.html`);
    const settle = async () => {
      await setup.waitForFunction(() => !/Trying|Asking|Checking/.test(document.querySelector("#key-status")?.textContent ?? ""), null, { timeout: 30_000 });
      return setup.locator("#key-status").innerText();
    };
    await setup.selectOption("#provider", anthropic ? "anthropic" : "custom");
    await setup.fill("#base-url", `http://127.0.0.1:${fake.port}/v1`);
    await setup.fill("#model", "fake-vision-1");
    await setup.fill("#key", "wrong-key");
    await setup.click("#key-save");
    step(`provider ${process.env.PROVIDER}, wrong key: "${await settle()}"`);
    await setup.fill("#key", FAKE_KEY);
    await setup.click("#list-models");
    step(`listed: "${await settle()}" (${await setup.locator("#models option").count()} in the picker)`);
    await setup.fill("#model", process.env.PROVIDER === "reasoning" ? "fake-reasoning" : "fake-vision-1");
    await setup.fill("#sim-model", "fake-sim-2");
    await setup.click("#key-save");
    step(`saved: "${await settle()}" · "${await setup.locator("#key-saved-what").innerText()}"`);
    await setup.waitForTimeout(600);
    step(`connection: "${await setup.locator("#server").textContent()}"`);
    await setup.close();
  }

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  if (fake) await page.bringToFront(); // a tab behind another one paints no video frames
  if (process.env.TRACE_PLAY) {
    // Who starts the video? Logs every play() in the page's own world, with where it came from.
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        console.log(`[unstuck] TRACE play() at ${this.currentTime.toFixed(1)}: ${new Error().stack?.split("\n").slice(2, 7).map((l) => l.trim().slice(0, 90)).join(" < ")}`);
        return play.call(this);
      };
      document.addEventListener("pause", (e) => console.log(`[unstuck] TRACE pause event at ${(e.target as HTMLMediaElement).currentTime.toFixed(1)}`), true);
      document.addEventListener("play", (e) => console.log(`[unstuck] TRACE play event at ${(e.target as HTMLMediaElement).currentTime.toFixed(1)}`), true);
    });
  }
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("[unstuck]")) errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO}`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("consent.")) {
    step("consent page: rejecting all");
    await page.getByRole("button", { name: /reject all/i }).first().click();
    await page.waitForURL(/youtube\.com\/watch/);
  }

  await page.waitForSelector("#movie_player video", { timeout: 30_000 });
  // The in-page cookie popup (EU) covers everything until answered.
  const bump = page.locator("ytd-consent-bump-v2-lightbox button", { hasText: /reject all/i }).first();
  if (await bump.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    step("cookie popup: rejecting all");
    await bump.click();
  }
  await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
    v.muted = true;
    void v.play();
  });
  for (let i = 0; i < 60; i++) {
    const ad = await page.evaluate(() => document.querySelector("#movie_player")?.classList.contains("ad-showing"));
    if (!ad) break;
    if (i === 0) step("ad playing, waiting");
    await page.locator(".ytp-skip-ad-button, .ytp-ad-skip-button-modern").first().click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  await page.waitForSelector(".unstuck-toggle", { timeout: 20_000 });
  const state = await page.getAttribute(".unstuck-toggle", "data-state");
  step(`Unstuck button in the control bar (state: ${state})`);
  const gotCaptions = new Promise<string>((res) => page.on("console", (m) => m.text().includes("[unstuck] captions:") && m.text().includes("lines") && res(m.text())));
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".unstuck-toggle")!.click());
  await page.waitForSelector("unstuck-overlay .toast", { timeout: 10_000 });
  step(`toast: "${(await page.locator("unstuck-overlay .toast").innerText()).replace(/\s+/g, " ")}"`);
  await shot(page, "1-on");

  step("waiting for captions and the Video map");
  const how = await Promise.race([gotCaptions, page.waitForTimeout(25_000).then(() => "")]);
  if (!how) throw new Error("captions were not captured within 25 s");
  step(how.replace("[unstuck] ", ""));
  await page.waitForTimeout(1500); // the Video map request
  if (camera) {
    await page.waitForTimeout(4000);
    const faces = (await sw.evaluate(() => (self as any).faces)) as any[];
    const offscreen = await sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as any] }).then((c) => c.length));
    if (!faces.length) throw new Error(`no Face readings arrived (offscreen pages: ${offscreen})`);
    step(`camera: ${faces.length} Face readings in ~5 s from the offscreen page, latest ${JSON.stringify(faces.at(-1))}`);
    // The camera films only while it can matter: it stops 5 s after a pause and comes back on play.
    const readings = () => sw.evaluate(() => (self as any).faces.length as number);
    const pages = () => sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as any] }).then((c) => c.length));
    const video = (play: boolean) => page.evaluate((p) => { const v = document.querySelector<HTMLVideoElement>("#movie_player video")!; p ? void v.play() : v.pause(); }, play);
    await video(false);
    await page.waitForTimeout(1000);
    const a0 = await readings();
    await page.waitForTimeout(2000);
    const a1 = await readings();
    step(`paused: still ${a1 - a0} readings in the next 2 s (the first 5 s after a pause still count)`);
    await page.waitForTimeout(4500);
    const b0 = await readings();
    await page.waitForTimeout(2000);
    const b1 = await readings();
    step(`paused 7.5 s: ${b1 - b0} readings in 2 s → camera ${b1 === b0 ? "off" : "STILL ON"}; camera page kept: ${(await pages()) === 1}`);
    await video(true);
    await page.waitForTimeout(3000);
    const c1 = await readings();
    step(`played again: ${c1 - b1} readings in 3 s → camera ${c1 > b1 ? "on" : "STILL OFF"}`);
  }

  if (process.env.FOLD) {
    // Folding or resizing the chat while an answer is still typing must not cut the answer off.
    const full = async () => (await page.locator("unstuck-panel .turn.unstuck .text").first().innerText()).replace(/\s+/g, " ").trim();
    for (const how of ["fold", "resize"]) {
      await page.locator("#movie_player").hover();
      await page.keyboard.press("e");
      await page.waitForFunction(() => (document.querySelector("unstuck-panel")?.shadowRoot?.querySelector(".turn.unstuck .text")?.textContent ?? "").length > 15, null, { timeout: 30_000 });
      if (how === "fold") {
        await page.locator("unstuck-panel .head .min").click();
        await page.waitForTimeout(4000);
        await page.locator("unstuck-panel .head .min").click();
      } else {
        const g = (await page.locator("unstuck-panel .grip.bl").boundingBox())!;
        await page.mouse.move(g.x + 9, g.y + 9);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) await page.mouse.move(g.x + 9 + i * 12, g.y + 9 - i * 15);
        await page.mouse.up();
      }
      await page.waitForTimeout(5000);
      const text = await full();
      const caret = await page.locator("unstuck-panel .turn.unstuck .caret").count();
      step(`${how} while typing: answer ends "…${text.slice(-50)}" (${text.length} chars, still typing=${caret > 0})`);
      await shot(page, `fold-${how}`);
      await page.locator("unstuck-panel .head button.x:not(.min)").click();
      await page.waitForTimeout(1200);
    }
    await ctx.close();
    process.exit(0);
  }

  if (process.env.REPLACE) {
    // An Offer from a rewind is still up when a confused look comes: the look's Offer takes its place.
    await page.evaluate((at) => {
      const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
      v.currentTime = at;
      void v.play();
    }, AT);
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
      v.currentTime -= 8;
    });
    await page.waitForSelector("unstuck-overlay .offer", { timeout: 15_000 });
    const sub = () => page.locator("unstuck-overlay .offer .msg span").innerText().catch(() => "—");
    step(`rewound 8 s → Offer: "${await sub()}"`);
    await page.locator("unstuck-overlay .offer").hover(); // keeps it up, like a Viewer reading it
    const send = (f: { frown: number; lids: number }) =>
      sw.evaluate((r) => chrome.tabs.query({ url: "*://www.youtube.com/*" }).then((tabs) => Promise.all(tabs.map((t) => chrome.tabs.sendMessage(t.id!, { kind: "face", reading: r }).catch(() => {})))), {
        wall: Date.now(), present: true, lookingAway: false, frown: f.frown, lids: f.lids, tilt: 0, lean: 1,
        detail: { browDown: 0.3 + f.frown, browRest: 0.3, browInnerUp: 0.05, squint: 0.2 + f.lids, squintRest: 0.2, roll: 3, rollUsual: 3, yaw: 0.5, lookDown: 0.1, ready: true },
      });
    await page.waitForTimeout(1500);
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      await send({ frown: 0.35, lids: 0.25 });
      await page.waitForTimeout(160);
    }
    await page.waitForFunction(() => /confused/.test(document.querySelector("unstuck-overlay")?.shadowRoot?.querySelector(".offer .msg span")?.textContent ?? ""), null, { timeout: 12_000 }).catch(() => {});
    step(`a confused look while it was up → Offer now: "${await sub()}", Offers on screen: ${await page.locator("unstuck-overlay .offer").count()}`);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    const log = (await sw.evaluate(() => chrome.storage.local.get("log").then((r: any) => r.log ?? []))) as any[];
    step(`Offer log: ${log.map((e: any) => `${e.signals?.at(-1) ?? e.source}: ${e.offerOutcome ?? "showing"}`).join(" | ")}`);
    await shot(page, "replace-offer");
    const before = await page.evaluate(() => document.querySelector<HTMLVideoElement>("#movie_player video")!.currentTime);
    await page.locator("#movie_player").hover();
    await page.keyboard.press("q");
    await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
    const after = await page.evaluate(() => document.querySelector<HTMLVideoElement>("#movie_player video")!.currentTime);
    const log2 = (await sw.evaluate(() => chrome.storage.local.get("log").then((r: any) => r.log ?? []))) as any[];
    step(`pressed Q with the pop-up up: chat opened at ${after.toFixed(1)} s (was at ${before.toFixed(1)} s, so ${Math.abs(after - before) < 1.5 ? "right now" : "it JUMPED"}); pop-ups left: ${await page.locator("unstuck-overlay .offer").count()}; log: ${log2.map((e: any) => `${e.source}: ${e.offerOutcome ?? "-"}`).join(" | ")}`);
    await ctx.close();
    process.exit(0);
  }

  if (process.env.MOMENT) {
    // A confused look: the Offer must be about the moment the look began, and taking it goes back there.
    await page.evaluate((at) => {
      const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
      v.currentTime = at;
      void v.play();
    }, AT);
    await page.waitForTimeout(4000);
    const now = () => page.evaluate(() => document.querySelector<HTMLVideoElement>("#movie_player video")!.currentTime);
    const send = (f: { frown: number; lids: number }) =>
      sw.evaluate((r) => chrome.tabs.query({ url: "*://www.youtube.com/*" }).then((tabs) => Promise.all(tabs.map((t) => chrome.tabs.sendMessage(t.id!, { kind: "face", reading: r }).catch(() => {})))), {
        wall: Date.now(), present: true, lookingAway: false, frown: f.frown, lids: f.lids, tilt: 0, lean: 1,
        detail: { browDown: 0.3 + f.frown, browRest: 0.3, browInnerUp: 0.05, squint: 0.2 + f.lids, squintRest: 0.2, roll: 3, rollUsual: 3, yaw: 0.5, lookDown: 0.1, ready: true },
      });
    const lookAt = await now();
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      await send({ frown: 0.35, lids: 0.25 });
      await page.waitForTimeout(160);
    }
    for (let i = 0; i < 4; i++) {
      await send({ frown: 0, lids: 0 });
      await page.waitForTimeout(160);
    }
    await page.waitForSelector("unstuck-overlay .offer", { timeout: 15_000 });
    const shownAt = await now();
    const sub = await page.locator("unstuck-overlay .offer .msg span").innerText();
    const thumb = await page.locator("unstuck-overlay .offer canvas.thumb").count();
    step(`confused look began at ${lookAt.toFixed(1)} s; Offer showed at ${shownAt.toFixed(1)} s (${((Date.now() - t0) / 1000).toFixed(1)} s after the look began), thumbnail=${thumb === 1}, says "${sub}"`);
    await shot(page, "moment-offer");
    await page.locator("unstuck-overlay .offer .msg").click();
    await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
    await page.waitForTimeout(800);
    const pausedAt = await now();
    step(`took it: the video went back to ${pausedAt.toFixed(1)} s (the look began at ${lookAt.toFixed(1)} s; off by ${Math.abs(pausedAt - lookAt).toFixed(1)} s)`);
    await shot(page, "moment-explained");
    await ctx.close();
    process.exit(0);
  }

  if (process.env.DEMO) {
    // The demo view: the face meter's mesh, then the camera view window (needs CAMERA=1 FAKE_VIDEO=a face clip).
    await page.locator("#movie_player").hover();
    await page.keyboard.press("d");
    await page.waitForSelector("unstuck-overlay .meter", { timeout: 5000 });
    await page.waitForTimeout(5000);
    const inked = () =>
      page.evaluate(() => {
        const c = document.querySelector("unstuck-overlay")!.shadowRoot!.querySelector<HTMLCanvasElement>(".meter .m-face")!;
        const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      });
    const faces = (await sw.evaluate(() => (self as any).faces)) as any[];
    const lastFace = faces.at(-1);
    step(`meter: ${await inked()} pixels of mesh drawn; latest reading present=${lastFace?.present}, ready=${lastFace?.detail?.ready}, tilt ${lastFace?.tilt?.toFixed?.(1)}°`);
    await shot(page, "demo-meter");
    const popup = ctx.waitForEvent("page", { timeout: 10_000 });
    await page.locator("unstuck-overlay .meter button.view").click();
    const view = await popup;
    await view.waitForLoadState();
    await view.waitForTimeout(4000);
    step(`camera view: "${await view.locator(".status").innerText()}"; chips ${(await view.locator(".chip .v").allInnerTexts()).join(" / ")}`);
    await view.screenshot({ path: "/tmp/unstuck-smoke-demo-view-straight.png" });
    await view.waitForTimeout(4500); // the clip tilts the head after 6 s
    step(`after the tilt: chips ${(await view.locator(".chip .v").allInnerTexts()).join(" / ")}, hot: ${(await view.locator(".chip.hot .n").allInnerTexts()).join(", ") || "none"}`);
    await view.screenshot({ path: "/tmp/unstuck-smoke-demo-view-tilted.png" });
    await shot(page, "demo-meter-tilted");
    await ctx.close();
    process.exit(0);
  }

  if (process.env.CAMVIEW) {
    // The camera view opened from a full-screen window: it must come up as a normal window you can
    // get out of (on a Mac it used to open full screen, with no close button in sight), and Esc closes it.
    const sw0 = sw;
    const mainId = await sw0.evaluate(() => chrome.windows.getLastFocused().then((w) => w.id!));
    await sw0.evaluate((id) => chrome.windows.update(id, { state: "fullscreen" }), mainId);
    await page.waitForTimeout(2500);
    step(`main window: ${await sw0.evaluate((id) => chrome.windows.get(id).then((w) => w.state), mainId)}`);
    await page.locator("#movie_player").hover();
    await page.keyboard.press("d");
    await page.waitForSelector("unstuck-overlay .meter", { timeout: 5000 });
    const popup = ctx.waitForEvent("page", { timeout: 10_000 });
    await page.locator("unstuck-overlay .meter button.view").click();
    const view = await popup;
    await view.waitForLoadState();
    await view.waitForTimeout(2500);
    const states = await sw0.evaluate(() => chrome.windows.getAll({ populate: true }).then((ws) => ws.map((w) => `${w.type} ${w.state} ${w.width}x${w.height} ${w.tabs?.[0]?.url?.split("/").pop()}`)));
    step(`windows: ${states.join(" | ")}`);
    await view.screenshot({ path: "/tmp/unstuck-smoke-camview.png" });
    const closeBtn = await view.locator("button.close").count();
    step(`close button: ${closeBtn ? "yes" : "NO"}`);
    const closed = view.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false);
    await view.keyboard.press("Escape").catch(() => {}); // the window can close before the key is let go
    step(`Esc closes it: ${(await closed) ? "yes" : "NO"}`);
    const again = ctx.waitForEvent("page", { timeout: 10_000 });
    await page.locator("unstuck-overlay .meter button.view").click();
    const view2 = await again;
    await view2.waitForLoadState();
    const closed2 = view2.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false);
    await view2.locator("button.close").click().catch(() => {});
    step(`opened again, ✕ Close closes it: ${(await closed2) ? "yes" : "NO"}; windows left: ${await sw0.evaluate(() => chrome.windows.getAll().then((ws) => ws.length))}`);
    await ctx.close();
    process.exit(0);
  }

  if (process.env.METER) {
    // Just the face meter: press D, look, stop. (The fake camera shows no face.)
    await page.locator("#movie_player").hover();
    await page.keyboard.press("d");
    await page.waitForSelector("unstuck-overlay .meter", { timeout: 5000 });
    await page.waitForTimeout(2500);
    step(`face meter: "${(await page.locator("unstuck-overlay .meter .m-counts").innerText()).trim()}"`);
    await shot(page, "meter");
    const mbox = async () => (await page.locator("unstuck-overlay .meter").boundingBox())!;
    const mdrag = async (sel: string, dx: number, dy: number) => {
      const b = (await page.locator(sel).boundingBox())!;
      const [sx, sy] = [b.x + Math.min(40, b.width / 2), b.y + b.height / 2];
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
      await page.mouse.up();
      await page.waitForTimeout(200);
    };
    const m0 = await mbox();
    await mdrag("unstuck-overlay .meter .m-head", -200, 60);
    const m1 = await mbox();
    await mdrag("unstuck-overlay .meter .grip.tl", -60, -40);
    const m2 = await mbox();
    step(`face meter dragged by (${Math.round(m1.x - m0.x)}, ${Math.round(m1.y - m0.y)}); top-left corner: ${Math.round(m1.width)}×${Math.round(m1.height)} → ${Math.round(m2.width)}×${Math.round(m2.height)}, bottom-right kept=${Math.abs(m1.x + m1.width - m2.x - m2.width) < 2 && Math.abs(m1.y + m1.height - m2.y - m2.height) < 2}`);
    await shot(page, "meter-moved");
    // Scripted face readings (no real face in a test browser), sent the way the camera page sends them.
    await page.evaluate(() => document.querySelector<HTMLVideoElement>("#movie_player video")!.pause());
    const faceFor = async (ms: number, f: { frown?: number; lids?: number; tilt?: number; lean?: number }) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const reading = {
          wall: Date.now(), present: true, lookingAway: false, frown: f.frown ?? 0, lids: f.lids ?? 0, tilt: f.tilt ?? 0, lean: f.lean ?? 1,
          detail: { browDown: 0.3 + (f.frown ?? 0), browRest: 0.3, browInnerUp: 0.05, squint: 0.2 + (f.lids ?? 0), squintRest: 0.2, roll: 4 + (f.tilt ?? 0), rollUsual: 4, yaw: 0.5, lookDown: 0.1, ready: true },
        };
        await sw.evaluate((r) => chrome.tabs.query({ url: "*://www.youtube.com/*" }).then((tabs) => Promise.all(tabs.map((t) => chrome.tabs.sendMessage(t.id!, { kind: "face", reading: r }).catch(() => {})))), reading);
        await page.waitForTimeout(160);
      }
    };
    const fireText = () => page.locator("unstuck-overlay .meter .m-fire.on").innerText().catch(() => "—");
    await faceFor(2500, { frown: 0.4 });
    step(`video paused; brows only for 2.5 s: ${await fireText()}`);
    await faceFor(2500, { tilt: 15 });
    step(`head tilt only for 2.5 s: ${await fireText()}`);
    await faceFor(600, {});
    await faceFor(2200, { frown: 0.32, tilt: -12 });
    step(`brows + head tilted the other way for 2.2 s: ${await fireText()}`);
    await shot(page, "meter-tilt");
    await faceFor(900, {});
    await faceFor(2200, { frown: 0.32, lids: 0.2 });
    step(`brows + eyelids for 2.2 s: ${await fireText()}`);
    await shot(page, "meter-trigger");
    await faceFor(900, {});
    await faceFor(2200, { lean: 1.15 });
    step(`lean in for 2.2 s: ${await fireText()}; log: "${await page.locator("unstuck-overlay .meter .m-log").innerText()}"`);
    const bar = (await page.locator('unstuck-overlay .meter .m-row[data-key="frownAt"] .bar').boundingBox())!;
    await page.mouse.click(bar.x + (bar.width * 0.2) / 0.6, bar.y + bar.height / 2); // 0.20 on a 0-0.6 bar
    await page.waitForTimeout(400);
    const saved = await sw.evaluate(() => chrome.storage.local.get("settings").then((r: any) => r.settings?.faceLines));
    step(`clicked the brows bar at 0.20: label "${await page.locator('unstuck-overlay .meter .m-row[data-key="frownAt"] .name').innerText()}", saved ${JSON.stringify(saved)}`);
    await shot(page, "meter-lines");
    await page.keyboard.press("d");
    await page.waitForTimeout(300);
    step(`pressed D again: meter ${(await page.locator("unstuck-overlay .meter").count()) ? "still open" : "closed"}`);
    await ctx.close();
    process.exit(0);
  }

  if (process.env.PANEL) {
    // U switches Unstuck off and on; the panel can be dragged, resized, folded, and remembers.
    const state = () => page.locator(".unstuck-toggle").getAttribute("data-state");
    await page.locator("#movie_player").hover();
    await page.keyboard.press("u");
    await page.waitForTimeout(600);
    const off = await state();
    await page.keyboard.press("u");
    await page.waitForSelector("unstuck-overlay .toast .keys", { timeout: 10_000 });
    step(`U: ${off} → ${await state()}, pop-up says "${(await page.locator("unstuck-overlay .toast .keys").innerText()).replace(/\s+/g, " ")}"`);
    await page.waitForTimeout(2500);
    await page.keyboard.press("e");
    await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
    await page.waitForTimeout(800);
    const rect = () => page.evaluate(() => { const r = document.querySelector("unstuck-panel")!.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
    const dragBy = async (sel: string, dx: number, dy: number) => {
      const b = (await page.locator(sel).boundingBox())!;
      const sx = b.x + (sel.includes("head") ? 60 : b.width / 2);
      const sy = b.y + b.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(sx + (dx * i) / 12, sy + (dy * i) / 12);
      await page.mouse.up();
      await page.waitForTimeout(300);
    };
    const r0 = await rect();
    await dragBy("unstuck-panel .head", -300, 40);
    const r1 = await rect();
    step(`dragged the header by (-300, +40): moved by (${r1.x - r0.x}, ${r1.y - r0.y})`);
    await dragBy("unstuck-panel .grip.bl", -80, -60);
    const r2 = await rect();
    step(`resized from the bottom-left corner: ${r1.w}×${r1.h} → ${r2.w}×${r2.h}, right edge kept=${r1.x + r1.w === r2.x + r2.w}`);
    await shot(page, "panel-moved");
    await page.locator("unstuck-panel .head .min").click();
    await page.waitForTimeout(300);
    const r3 = await rect();
    await page.locator("unstuck-panel .head .min").click();
    await page.waitForTimeout(300);
    step(`fold: height ${r2.h} → ${r3.h} → ${(await rect()).h}`);
    await page.locator("unstuck-panel .head button.x:not(.min)").click();
    await page.waitForSelector("unstuck-panel", { state: "detached", timeout: 5000 });
    await page.waitForTimeout(800);
    await page.locator("#movie_player").hover();
    await page.keyboard.press("e");
    await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
    await page.waitForTimeout(500);
    const r4 = await rect();
    step(`closed and asked again: panel at the remembered spot=${r4.x === r2.x && r4.y === r2.y && r4.w === r2.w}`);
    await page.locator("unstuck-panel .head").dblclick({ position: { x: 60, y: 20 } });
    await page.waitForTimeout(300);
    const r5 = await rect();
    step(`double-click: back to its own spot=${r5.x === r0.x && r5.y === r0.y}`);
    if (camera) {
      const cams = () => sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as any] }).then((c) => c.length));
      // Playwright keeps every page "visible", however it's hidden. So tell Unstuck's own script
      // world that the tab is hidden, exactly as Chrome would: hidden=true plus the event.
      const cdp = await ctx.newCDPSession(page);
      const worlds: { id: number; name: string }[] = [];
      cdp.on("Runtime.executionContextCreated", (e: any) => worlds.push({ id: e.context.id, name: e.context.name }));
      await cdp.send("Runtime.enable");
      await page.waitForTimeout(300);
      const world = worlds.find((w) => w.name === "Unstuck")?.id;
      if (!world) throw new Error(`Unstuck's script world not found (${worlds.map((w) => w.name).join(", ")})`);
      const setHidden = (on: boolean) =>
        cdp.send("Runtime.evaluate", { contextId: world, expression: `Object.defineProperty(document, "hidden", { configurable: true, get: () => ${on} }); document.dispatchEvent(new Event("visibilitychange"))` });
      const other = page;
      const vis = () => cdp.send("Runtime.evaluate", { contextId: world, expression: "document.hidden ? 'hidden' : 'visible'", returnByValue: true }).then((r: any) => r.result.value);
      await setHidden(true);
      step(`told Unstuck the tab is hidden (${await vis()}); camera pages: ${await cams()}`);
      const t0 = Date.now();
      let offAt = 0;
      while (Date.now() - t0 < 80_000 && !offAt) {
        await other.waitForTimeout(5000);
        if (!(await cams())) offAt = Date.now() - t0;
      }
      step(`camera ${offAt ? `went off after ${Math.round(offAt / 1000)} s away` : "stayed on for 80 s away"} (tab ${await vis()})`);
      await setHidden(false);
      let onAt = 0;
      for (let i = 0; i < 16 && !onAt; i++) {
        await page.waitForTimeout(500);
        if (await cams()) onAt = (i + 1) * 500;
      }
      step(`back on the tab (${await vis()}): camera ${onAt ? `on again after ${(onAt / 1000).toFixed(1)} s` : "still off after 8 s"}`);
    }
    await ctx.close();
    process.exit(0);
  }

  if (process.env.ROOM) {
    // The Room: with the chat open the video moves beside it, a simulation goes underneath,
    // nothing overlaps, and folding, playing or closing puts everything back where it was.
    type R = { x: number; y: number; w: number; h: number } | null;
    const geo = () =>
      page.evaluate(() => {
        const r = (el: Element | null | undefined) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
        };
        const player = document.querySelector("#movie_player")!;
        const mast = document.querySelector("#masthead-container");
        const ms = mast && getComputedStyle(mast);
        return {
          player: r(player),
          video: r(player.querySelector("video")),
          panel: r(document.querySelector("unstuck-panel")),
          sim: r(document.querySelector("unstuck-room")?.shadowRoot?.querySelector(".sim:not(.hidden)")),
          room: document.documentElement.hasAttribute("unstuck-room"),
          masthead: ms ? ms.visibility === "visible" && Number(ms.opacity) > 0.99 : null,
          faded: document.querySelectorAll("[unstuck-room-away]").length,
          scrollY: Math.round(scrollY),
          theatre: document.querySelector("ytd-watch-flexy")?.hasAttribute("theater") ?? false,
          marks: document.querySelector("unstuck-overlay")?.shadowRoot?.querySelectorAll(".marks-layer .spot, .marks-layer .pen, .marks-layer .flow-group").length ?? 0,
          play: (() => {
            const v = player.querySelector("video") as HTMLVideoElement;
            return `${v.paused ? "paused" : "playing"} at ${v.currentTime.toFixed(1)} s`;
          })(),
        };
      });
    const fmt = (b: R) => (b ? `${b.w}×${b.h} at ${b.x},${b.y}` : "–");
    const clash = (a: R, b: R) => Boolean(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
    const same = (a: R, b: R) => Boolean(a && b && Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2);
    const report = async (label: string) => {
      await page.waitForTimeout(900); // the glide takes ~0.5 s
      const g = await geo();
      const hits = [clash(g.player, g.panel) && "video×chat", clash(g.player, g.sim) && "video×sim"].filter(Boolean);
      step(`${label}: room=${g.room}, video ${fmt(g.player)} (picture ${fmt(g.video)}), chat ${fmt(g.panel)}${g.sim ? `, sim ${fmt(g.sim)}` : ""}; overlaps: ${hits.join(", ") || "none"}; faded ${g.faded}, masthead shown=${g.masthead}; ${g.play}, ${g.marks} Marks`);
      await shot(page, `room-${label.replace(/\W+/g, "-").slice(0, 40)}`);
      return g;
    };
    const dragBy = async (sel: string, dx: number, dy: number) => {
      const b = (await page.locator(sel).boundingBox())!;
      const sx = b.x + (/head/.test(sel) ? 70 : b.width / 2);
      const sy = b.y + b.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 14; i++) await page.mouse.move(sx + (dx * i) / 14, sy + (dy * i) / 14);
      await page.mouse.up();
    };
    await page.evaluate((at) => {
      const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
      v.currentTime = at;
      void v.play();
    }, AT);
    await page.waitForTimeout(2500);
    const before = await report("before");
    await page.locator("#movie_player").hover();
    await page.keyboard.press("e");
    await page.waitForTimeout(250);
    await shot(page, "room-mid-glide");
    await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
    const open = await report("chat open");
    step(`  YouTube laid its video out in the new box: ${same(open.player, open.video)}`);
    const btn = await page.waitForSelector("unstuck-panel .play-btn", { timeout: 40_000 });
    await btn.click();
    await page.waitForSelector("unstuck-room .sim iframe.on", { timeout: 60_000 });
    await report("simulation open");
    await dragBy("unstuck-room .sim .s-head", 0, -380);
    await report("sim dragged up");
    await page.locator("unstuck-room .sim .s-head").dblclick({ position: { x: 70, y: 14 } });
    await report("sim double-clicked back");
    await dragBy("unstuck-panel .grip.bl", -140, 0);
    await report("chat made wider");
    await dragBy("unstuck-room .sim .grip.tr", -160, 90);
    const tr = await report("sim resized from its top-right corner");
    step(`  the simulation's bottom-left corner stayed put: ${tr.sim?.x === 12 && (tr.sim?.y ?? 0) + (tr.sim?.h ?? 0) === 888}`);
    await page.locator("unstuck-panel .head").dblclick({ position: { x: 70, y: 20 } });
    await page.keyboard.press("Escape");
    await report("chat reset, Esc hid the sim");
    await page.locator("unstuck-panel .head .min").click();
    const folded = await report("folded");
    step(`  back where it was: video=${same(folded.player, before.player)}, picture=${same(folded.video, before.video)}, scroll ${before.scrollY}→${folded.scrollY}, faded left=${folded.faded}`);
    await page.locator("unstuck-panel .head .min").click();
    await report("unfolded");
    await page.evaluate(() => void document.querySelector<HTMLVideoElement>("#movie_player video")!.play());
    const played = await report("pressed play");
    step(`  playing folds the chat (height ${played.panel?.h}) and gives the video back: ${same(played.player, before.player)}`);

    await page.evaluate(() => (document.querySelector(".ytp-size-button") as HTMLElement)?.click());
    await page.waitForTimeout(1500);
    const theatre = await report("theatre, chat folded");
    await page.locator("unstuck-panel .head .min").click();
    await report("theatre, chat open");
    await page.evaluate(() => (document.querySelector("#movie_player .ytp-size-button") as HTMLElement)?.click());
    await page.waitForTimeout(1200);
    const toggled = await report("switched to default mode inside the room");
    step(`  theatre=${toggled.theatre}; video still in its spot: ${clash(toggled.player, toggled.panel) ? "NO" : "yes"}`);
    await page.locator("unstuck-panel .head button.x:not(.min)").click();
    const closed = await report("closed");
    step(`  closed: room=${closed.room}, chat gone=${!closed.panel}, video back in ${closed.theatre ? "theatre" : "default"} mode (was theatre ${fmt(theatre.player)})`);
    if (errors.length) console.log(`\nConsole:\n  ${[...new Set(errors)].slice(0, 25).join("\n  ")}`);
    await ctx.close();
    process.exit(0);
  }

  if (process.env.RECAP) {
    // "What you missed" is a chat: away from the tab while it plays, take the Recap, ask about it.
    await page.evaluate((at) => {
      const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
      v.currentTime = at;
      void v.play();
    }, AT);
    await page.waitForTimeout(2000);
    // Playwright keeps pages "visible", so tell Unstuck's own script world the tab is hidden.
    const cdp = await ctx.newCDPSession(page);
    const worlds: { id: number; name: string }[] = [];
    cdp.on("Runtime.executionContextCreated", (e: any) => worlds.push({ id: e.context.id, name: e.context.name }));
    await cdp.send("Runtime.enable");
    await page.waitForTimeout(300);
    const world = worlds.find((w) => w.name === "Unstuck")?.id;
    const setHidden = (on: boolean) =>
      cdp.send("Runtime.evaluate", { contextId: world, expression: `Object.defineProperty(document, "hidden", { configurable: true, get: () => ${on} }); document.dispatchEvent(new Event("visibilitychange"))` });
    await setHidden(true);
    await page.waitForTimeout(12_500);
    await setHidden(false);
    await page.waitForSelector("unstuck-overlay .offer", { timeout: 10_000 });
    step(`back after 12.5 s away: Offer "${(await page.locator("unstuck-overlay .offer .msg").innerText()).replace(/\s+/g, " ")}"`);
    await page.locator("unstuck-overlay .offer .btn.primary").click();
    await page.waitForFunction(() => {
      const t = document.querySelector("unstuck-panel")?.shadowRoot?.querySelector(".turn.unstuck .text");
      return t && !t.querySelector(".caret, .thinking") && (t.textContent ?? "").length > 20;
    }, null, { timeout: 30_000 });
    const head = await page.locator("unstuck-panel .head .title").innerText();
    const buttons = await page.locator("unstuck-panel .foot .row .btn").allInnerTexts();
    step(`"${head}" opened as a chat: buttons ${buttons.join(" / ")}, follow-up box=${(await page.locator("unstuck-panel .ask input").count()) === 1}`);
    await page.click("unstuck-panel .ask input");
    await page.keyboard.type("what was the main point of that part?");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const turns = document.querySelector("unstuck-panel")?.shadowRoot?.querySelectorAll(".thread .turn") ?? [];
      const last = turns[turns.length - 1];
      return turns.length >= 3 && last?.classList.contains("unstuck") && !last.querySelector(".caret, .thinking") && (last.textContent ?? "").length > 20;
    }, null, { timeout: 45_000 });
    const turns = await page.evaluate(() =>
      [...(document.querySelector("unstuck-panel")!.shadowRoot!.querySelectorAll(".thread .turn") as NodeListOf<HTMLElement>)].map((t) => `${t.classList.contains("viewer") ? "you" : "unstuck"}: ${t.innerText.replace(/\s+/g, " ").slice(0, 80)}`),
    );
    step(`asked about it, chat:\n    ${turns.join("\n    ")}`);
    await shot(page, "recap-chat");
    await ctx.close();
    process.exit(0);
  }

  if (process.env.LAYOUT) {
    // The panel must never cover the player's control bar, also in theatre mode.
    await page.locator("#movie_player").hover();
    await page.keyboard.press("e");
    await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
    const check = async (label: string) => {
      await page.waitForTimeout(900);
      await page.locator("#movie_player").hover(); // shows the control bar
      const r = await page.evaluate(() => {
        const box = (el: Element | null) => el?.getBoundingClientRect();
        const panel = box(document.querySelector("unstuck-panel"))!;
        const hit = (b?: DOMRect) => Boolean(b && b.width && panel.left < b.right && b.left < panel.right && panel.top < b.bottom && b.top < panel.bottom);
        return {
          theatre: document.querySelector("ytd-watch-flexy")?.hasAttribute("theater") ?? false,
          covers: ["ytp-size-button", "ytp-fullscreen-button", "ytp-settings-button"].filter((c) => hit(box(document.querySelector(`.${c}`)))),
        };
      });
      step(`${label} (theatre=${r.theatre}): panel covers ${r.covers.length ? r.covers.join(", ") : "no player controls"}`);
      await shot(page, `layout-${label.replace(/\W+/g, "-")}`);
    };
    await check("default layout");
    await page.evaluate(() => (document.querySelector(".ytp-size-button") as HTMLElement)?.click());
    await check("after theatre mode");
    await ctx.close();
    process.exit(0);
  }

  if (process.env.SIM) {
    // "▶ Play with it": ask, wait for the button, build the simulation, move a control.
    await page.evaluate((at) => {
      const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
      v.currentTime = at;
      void v.play();
    }, AT);
    await page.waitForTimeout(3000);
    await page.locator("#movie_player").hover();
    await page.keyboard.press("e");
    await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
    // SIM_ASK: ask for a particular simulation in the chat, like a Viewer would.
    let btn = process.env.SIM_ASK ? null : await page.waitForSelector("unstuck-panel .play-btn", { timeout: 40_000 }).catch(() => null);
    if (!btn) {
      await page.waitForFunction(() => !document.querySelector("unstuck-panel")?.shadowRoot?.querySelector(".caret, .thinking"), null, { timeout: 30_000 }).catch(() => {});
      const ask = process.env.SIM_ASK || "Can you make me a simulation of this that I can play with?";
      step(`asking: "${ask}"`);
      await page.click("unstuck-panel .ask input");
      await page.keyboard.type(ask);
      await page.keyboard.press("Enter");
      btn = await page.waitForSelector("unstuck-panel .turn.unstuck:last-child .play-btn", { timeout: 45_000 }).catch(() => null);
    }
    if (!btn) throw new Error("no ▶ Play with it button appeared");
    if (process.env.SIM_ASK) {
      const said = (await page.locator("unstuck-panel .turn.unstuck").last().locator(".text").innerText()).replace(/\s+/g, " ");
      step(`answer: "${said.slice(0, 200)}${said.length > 200 ? "…" : ""}"`);
    }
    step(`button: "${(await btn.innerText()).replace(/\s+/g, " ")}"`);
    await shot(page, "5-play-button");
    const t0 = Date.now();
    await btn.click();
    const outcome = await Promise.race([
      page.waitForSelector("unstuck-room .sim iframe.on", { timeout: 120_000 }).then(() => "running"),
      page.waitForFunction(() => /Couldn't build/.test(document.querySelector("unstuck-room")?.shadowRoot?.querySelector(".sim .building p")?.textContent ?? ""), null, { timeout: 120_000 }).then(() => "failed"),
    ]);
    step(`simulation ${outcome} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const kind = await page.frames().find((f) => f.url().endsWith("/sim.html"))?.evaluate(() => (typeof (window as any).THREE !== "undefined" ? `3D (three.js r${(window as any).THREE.REVISION})` : "2D")).catch(() => "?");
    step(`it is ${kind}`);
    await page.waitForTimeout(1200);
    await shot(page, "6-sim");
    let sim = page.frames().find((f) => f.url().endsWith("/sim.html"));
    const range = sim?.locator("input[type=range]").first();
    if (range && (await range.count())) {
      await range.evaluate((el: HTMLInputElement) => {
        el.value = String(Number(el.min) + (Number(el.max) - Number(el.min)) * 0.85);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(800);
      step("moved the first slider to 85%");
      await shot(page, "7-sim-moved");
    } else step("no range slider in the simulation (it may use buttons or dragging)");
    const net = await sim?.evaluate(() => fetch("https://example.com").then(() => "reached the internet!", (e) => `blocked (${e.name})`)).catch((e) => `blocked (${String(e).slice(0, 60)})`);
    step(`network from inside the simulation: ${net}`);
    // Theatre mode moves the player (which reloads frames) and puts the chat on the player.
    for (const mode of ["theatre", "default"]) {
      await page.evaluate(() => (document.querySelector(".ytp-size-button") as HTMLElement)?.click());
      await page.waitForTimeout(3000);
      const f = page.frames().find((x) => x.url().endsWith("/sim.html"));
      const drawn = await f?.evaluate(() => Boolean(document.querySelector("canvas,svg")) || document.body.innerText.trim().length > 20).catch(() => false);
      const overlap = await page.evaluate(() => {
        const st = document.querySelector("unstuck-room")!.shadowRoot!.querySelector(".sim")!.getBoundingClientRect();
        const pn = document.querySelector("unstuck-panel")!.getBoundingClientRect();
        return st.left < pn.right && pn.left < st.right && st.top < pn.bottom && pn.top < st.bottom;
      });
      step(`${mode} mode: simulation ${drawn ? "still drawn" : "BLANK"}, ${overlap ? "OVERLAPS the chat" : "clear of the chat"}`);
      await shot(page, `8-sim-${mode}`);
    }
    sim = page.frames().find((f) => f.url().endsWith("/sim.html"));
    const shown = async () => ((await page.locator("unstuck-room .sim:not(.hidden)").count()) ? "shown" : "hidden");
    const label = async () => (await page.locator("unstuck-panel .play-btn .lbl b").last().innerText()).trim();
    await sim?.evaluate(() => ((window as any).__unstuckMark = 42)).catch(() => {});
    await page.locator("unstuck-room .sim .s-head button").click();
    await page.waitForTimeout(500);
    step(`clicked ✕: stage ${await shown()}, button says "${await label()}"`);
    await btn.click();
    await page.waitForTimeout(500);
    const kept = await sim?.evaluate(() => (window as any).__unstuckMark).catch(() => undefined);
    step(`clicked the button again: stage ${await shown()}, state kept=${kept === 42}, button says "${await label()}"`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    step(`Esc: stage ${await shown()}`);

    // The end of the video: YouTube's end screen must not cover the simulation; playing hides it.
    await btn.click();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
      v.currentTime = v.duration - 0.05;
    });
    await page.waitForTimeout(3000);
    const top = await page.evaluate(() => {
      const st = document.querySelector("unstuck-room")!.shadowRoot!.querySelector(".sim")!.getBoundingClientRect();
      const el = document.elementFromPoint(st.left + st.width / 2, st.top + st.height / 2);
      const end = document.querySelector(".html5-endscreen, .ytp-endscreen-content, .ytp-fullscreen-grid");
      return { top: el?.tagName.toLowerCase() + (el?.className ? `.${String(el.className).split(" ")[0]}` : ""), endscreen: Boolean(end && (end as HTMLElement).offsetParent) };
    });
    step(`video ended (end screen showing=${top.endscreen}): on top of the simulation is <${top.top}>`);
    await shot(page, "9-sim-at-end");
    await page.evaluate(() => void document.querySelector<HTMLVideoElement>("#movie_player video")!.play());
    await page.waitForTimeout(800);
    step(`pressed play: stage ${await shown()}, button says "${await label()}"`);
    await ctx.close();
    process.exit(0);
  }

  const mock = (await page.locator("unstuck-overlay .toast").innerText().catch(() => "")).includes("mock");
  await page.evaluate((at) => {
    const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
    v.currentTime = at;
    void v.play();
  }, AT);
  await page.waitForTimeout(3000);
  if (mock) {
    // Mock judge always says "stuck": rewind 10 s like a stuck Viewer would, and take the Offer.
    step("rewinding 10 s");
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("#movie_player video")!;
      v.currentTime -= 10;
    });
    await page.waitForSelector("unstuck-overlay .offer", { timeout: 12_000 });
    step(`Offer: "${(await page.locator("unstuck-overlay .offer .msg").innerText()).replace(/\s+/g, " ")}", button "${(await page.locator("unstuck-overlay .offer .go").innerText().catch(() => "none")).replace(/\s+/g, " ")}"`);
    await shot(page, "2-offer");
    await page.click("unstuck-overlay .offer .go");
  } else {
    // The real judge decides for itself (it rightly calls the intro easy), so ask directly.
    step("real Gemini: pressing E to ask");
    await page.locator("#movie_player").hover();
    await page.keyboard.press("e");
  }
  await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
  const sketched = await page.waitForSelector("unstuck-panel .sketch svg, unstuck-panel .sketch .figure-html", { timeout: 30_000 }).then(() => true, () => false);
  await page.waitForTimeout(3500); // let the Sketch draw and the Marks land
  const paused = await page.evaluate(() => document.querySelector<HTMLVideoElement>("#movie_player video")!.paused);
  const marks = await page.evaluate(() => {
    const root = document.querySelector("unstuck-overlay")?.shadowRoot;
    return [...(root?.querySelectorAll(".marks-layer .spot, .marks-layer .pen, .marks-layer .flow-group") ?? [])].map((m) => m.getAttribute("class")).join(", ") || "none";
  });
  const refs = await page.locator("unstuck-panel .text .ref:not(.off)").allInnerTexts();
  const math = await page.locator("unstuck-panel .text math").count();
  const firstText = (await page.locator("unstuck-panel .turn.unstuck .text").first().innerText()).replace(/\s+/g, " ");
  const figKind = await page.evaluate(() => (document.querySelector("unstuck-panel")?.shadowRoot?.querySelector(".sketch .figure-html") ? "HTML figure" : document.querySelector("unstuck-panel")?.shadowRoot?.querySelector(".sketch svg") ? "plot/SVG figure" : "no figure"));
  step(`panel: video paused=${paused}, Marks: ${marks}, coral phrases: ${refs.join(" / ") || "none"}, ${math} formula(s), ${figKind}`);
  step(`answer: "${firstText.slice(0, 160)}${firstText.length > 160 ? "…" : ""}"`);
  await shot(page, "3-explanation");

  // Typing in the follow-up box must not trigger YouTube shortcuts (k = play/pause, f = fullscreen).
  await page.click("unstuck-panel .ask input");
  await page.keyboard.type("keep it short, what is a logit?");
  const stillPaused = await page.evaluate(() => document.querySelector<HTMLVideoElement>("#movie_player video")!.paused);
  const fullscreen = await page.evaluate(() => Boolean(document.fullscreenElement));
  step(`typed a follow-up: video still paused=${stillPaused}, fullscreen=${fullscreen}`);
  await page.keyboard.press("Enter");
  // Chat: first answer, the question bubble, then a second answer that has finished typing.
  await page.waitForFunction(() => {
    const root = document.querySelector("unstuck-panel")?.shadowRoot;
    const turns = root?.querySelectorAll(".thread .turn") ?? [];
    const last = turns[turns.length - 1];
    return turns.length >= 3 && last?.classList.contains("unstuck") && !last.querySelector(".caret, .thinking") && (last.textContent ?? "").length > 20;
  }, null, { timeout: 45_000 });
  const turns = await page.evaluate(() =>
    [...(document.querySelector("unstuck-panel")!.shadowRoot!.querySelectorAll(".thread .turn") as NodeListOf<HTMLElement>)].map((t) => `${t.classList.contains("viewer") ? "you" : "unstuck"}: ${t.innerText.replace(/\s+/g, " ").slice(0, 70)}`),
  );
  step(`follow-up answered, chat kept:\n    ${turns.join("\n    ")}`);
  await page.waitForTimeout(1500);
  const visuals = await page.locator("unstuck-panel .play-btn .lbl span").allInnerTexts();
  step(`visual buttons: ${visuals.length} → ${visuals.map((v) => `"${v.slice(0, 70)}"`).join(" | ")}`);
  await shot(page, "3b-chat");

  await page.click("unstuck-panel button.btn.primary");
  await page.waitForSelector("unstuck-panel", { state: "detached", timeout: 5000 });
  await page.waitForTimeout(800);
  const playing = await page.evaluate(() => !document.querySelector<HTMLVideoElement>("#movie_player video")!.paused);
  step(`"Got it": panel closed, video playing=${playing}`);

  await page.locator("#movie_player").hover();
  await page.keyboard.press("e");
  await page.waitForSelector("unstuck-panel .text p", { timeout: 30_000 });
  step('pressed E: Ask opened a panel');
  await page.waitForTimeout(4500); // the Marks draw once their phrase has typed out
  await shot(page, "4-ask");

  const log = (await sw.evaluate(() => chrome.storage.local.get("log").then((r) => r.log ?? []))) as any[];
  step(`Offer log: ${log.length} entries → ${log.map((e: any) => `${e.source}/${e.type} offer=${e.offerOutcome ?? "-"} expl=${e.explanationOutcome ?? "-"} q=${e.question ? "yes" : "no"}`).join(" | ")}`);
  if (fake) {
    const by = new Map<string, number>();
    for (const c of fake.calls) by.set(`${c.kind} ${c.model}${c.stream ? " (streamed)" : ""}${c.image ? " +frame" : ""}`, (by.get(`${c.kind} ${c.model}${c.stream ? " (streamed)" : ""}${c.image ? " +frame" : ""}`) ?? 0) + 1);
    step(`the fake provider got ${fake.calls.length} calls (${fake.calls[0]?.api}):\n    ${[...by].map(([k, n]) => `${n}× ${k}`).join("\n    ")}`);
    await fake.close();
  }
} finally {
  if (errors.length) console.log(`\nConsole errors/warnings:\n  ${[...new Set(errors)].slice(0, 15).join("\n  ")}`);
  await ctx.close();
}

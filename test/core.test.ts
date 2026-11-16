import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJson3, parseSrv3, parseCaptions, parseTranscriptItems, pickTrack, transcriptWindow, nextSentenceEnd, mmss } from "../src/core/captions.ts";
import { Detector, OfferGate, RULES, confusedLook, signalLine } from "../src/core/rules.ts";
import { cropAround, fitMark, fromCrop, parseAnswer, parseMarks, namespaceSvgIds, phraseShown, placeMarks, sameThing, thingsToLocate, worthRefining } from "../src/core/answer.ts";
import { formatText, firstSentence, safeCut, stripRefs, toSeconds, wrapPhrases } from "../src/core/textfmt.ts";
import { checkRequest, extensionIdFromKey } from "../src/core/guard.ts";
import { cleanSimHtml, withGuard, SIM_GUARD } from "../src/core/sim.ts";
import { compile, niceTicks, cleanPlotSpec, plotSvg } from "../src/core/plot.ts";
import { parseFigure } from "../src/core/answer.ts";
import { checkedFigures } from "../src/ai/figures.ts";
import { ROOM, defaultPanel, defaultSim, fromFrac, toFrac, videoSpot, type Rect } from "../src/core/room.ts";
import { lectureFrom, outlineText, parseSrt } from "../src/core/panopto.ts";

const json3 = {
  events: [
    { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: "Hello and" }, { utf8: " welcome." }] },
    { tStartMs: 3000, dDurationMs: 5000, segs: [{ utf8: "\n" }] },
    { tStartMs: 3500, dDurationMs: 3000, segs: [{ utf8: "Today: softmax" }] },
    { tStartMs: 12000, dDurationMs: 2000, segs: [{ utf8: "and logits" }] },
  ],
};

test("json3 captions: joins segments, skips blank events, clips overlaps", () => {
  const segs = parseJson3(json3);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].text, "Hello and welcome.");
  assert.equal(segs[0].end, 3.5); // clipped to the next line's start
  assert.equal(segs[1].text, "Today: softmax");
});

test("srv3 captions: strips inner tags and decodes entities", () => {
  const xml = `<timedtext><body><p t="1000" d="2000">Tom &amp; Jerry</p><p t="4000" d="500"><s>it&#39;s</s><s> fine</s></p></body></timedtext>`;
  const segs = parseSrv3(xml);
  assert.deepEqual(segs.map((s) => s.text), ["Tom & Jerry", "it's fine"]);
  assert.equal(segs[1].start, 4);
  assert.equal(parseCaptions(xml).length, 2);
  assert.equal(parseCaptions(JSON.stringify(json3)).length, 3);
  assert.equal(parseCaptions("garbage").length, 0);
});

test("transcript window buckets lines with timestamps", () => {
  const w = transcriptWindow(parseJson3(json3), 0, 20);
  assert.equal(w, "[00:00] Hello and welcome. Today: softmax\n[00:12] and logits");
  assert.equal(mmss(3725), "1:02:05");
});

test("Offers wait for the end of the sentence, but never too long", () => {
  const segs = parseJson3(json3);
  assert.equal(nextSentenceEnd(segs, 1), 3.5); // "welcome." ends the sentence
  assert.equal(nextSentenceEnd(segs, 5), 6.5); // pause after "softmax" (next line at 12 s)
  const talky = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ start: i, end: i + 1, text: "and then" }));
  assert.equal(nextSentenceEnd(talky, 0, 5), 5);
});

test("a short rewind is a Stuck candidate; tiny nudges, long jumps and our own seeks are not", () => {
  const d = new Detector();
  assert.equal(d.handle({ kind: "seek", wall: 0, from: 100, to: 88 }).length, 1);
  assert.equal(d.handle({ kind: "seek", wall: 1, from: 100, to: 100 - RULES.rewindMin + 0.5 }).length, 0);
  assert.equal(d.handle({ kind: "seek", wall: 2, from: 300, to: 100 }).length, 0);
  assert.equal(d.handle({ kind: "seek", wall: 3, from: 100, to: 90, programmatic: true }).length, 0);
  const [c] = d.handle({ kind: "seek", wall: 4000, from: 60, to: 50 });
  assert.equal(c.type, "stuck");
  if (c.type === "stuck") assert.deepEqual(c.signals.slice(-1), ["rewound 10 s"]);
});

test("slowing down is a Stuck candidate, speeding up is not", () => {
  const d = new Detector();
  assert.equal(d.handle({ kind: "rate", wall: 0, t: 10, rate: 0.75, prev: 1 }).length, 1);
  assert.equal(d.handle({ kind: "rate", wall: 1, t: 10, rate: 1.5, prev: 1 }).length, 0);
});

test("a long pause counts once; outside Dense parts only if allowed; never while away", () => {
  const d = new Detector();
  d.setDenseParts([{ start: 50, end: 80, why: "new formula" }]);
  d.handle({ kind: "pause", wall: 0, t: 60 });
  assert.equal(d.handle({ kind: "tick", wall: 1000, t: 60, playing: false }).length, 0);
  const [c] = d.handle({ kind: "tick", wall: RULES.pauseSec * 1000 + 100, t: 60, playing: false });
  assert.equal(c?.type, "stuck");
  if (c?.type === "stuck") assert.match(signalLine(c.signals, c.dense), /^The viewer just paused for [\d.]+\+ s\. This moment is inside a part the video map marks as dense: new formula\.$/);
  assert.equal(d.handle({ kind: "tick", wall: 12000, t: 60, playing: false }).length, 0);

  const outside = new Detector();
  outside.handle({ kind: "pause", wall: 0, t: 20 });
  assert.equal(outside.handle({ kind: "tick", wall: 5000, t: 20, playing: false }).length, RULES.pauseDenseOnly ? 0 : 1);

  const away = new Detector();
  away.handle({ kind: "away", wall: 0, t: 20, away: true, why: "face" });
  away.handle({ kind: "pause", wall: 0, t: 20 });
  assert.equal(away.handle({ kind: "tick", wall: 5000, t: 20, playing: false }).length, 0);
});

test("frowning for 2 s during a Dense part fires once, then re-arms after relaxing", () => {
  const d = new Detector();
  d.setDenseParts([{ start: 0, end: 100, why: "x" }]);
  d.handle({ kind: "play", wall: 0, t: 10 });
  const frown = (wall: number, f: number) => d.handle({ kind: "face", wall, t: 10 + wall / 1000, frown: f, lids: 0.3, lean: 1 });
  assert.equal(frown(0, 0.6).length, 0);
  assert.equal(frown(1000, 0.6).length, 0);
  assert.equal(frown(2100, 0.6).length, 1);
  assert.equal(frown(3000, 0.6).length, 0);
  frown(4000, 0);
  frown(5000, 0.6);
  assert.equal(frown(7100, 0.6).length, 1);
});

test("a frown that wobbles around the line still holds; only a real drop breaks it", () => {
  const d = new Detector();
  d.handle({ kind: "play", wall: 0, t: 10 });
  const at = RULES.frownAt;
  const frown = (wall: number, f: number) => d.handle({ kind: "face", wall, t: 10, frown: f, lids: 0.3, lean: 1 });
  const wobble = [at + 0.05, at * 0.85, at + 0.03, at * 0.8, at + 0.05];
  const fired = wobble.flatMap((f, i) => frown(i * 400, f));
  assert.equal(fired.length, 1); // 1.6 s of wobbling, never far below the line
  const e = new Detector();
  e.handle({ kind: "play", wall: 0, t: 10 });
  e.handle({ kind: "face", wall: 0, t: 10, frown: at + 0.05, lids: 0.3, lean: 1 });
  e.handle({ kind: "face", wall: 800, t: 10, frown: at * 0.3, lids: 0.3, lean: 1 }); // relaxed: the hold breaks
  assert.equal(e.handle({ kind: "face", wall: 1700, t: 10, frown: at + 0.05, lids: 0.3, lean: 1 }).length, 0);
});

test("a face trigger is about the moment the look began, not the moment it fired", () => {
  const d = new Detector();
  d.handle({ kind: "play", wall: 0, t: 100 });
  const look = (wall: number) => d.handle({ kind: "face", wall, t: 100 + wall / 1000, frown: 0.4, lids: 0.3, lean: 1 });
  look(0);
  look(800);
  const [c] = look(1600);
  assert.equal(c?.type === "stuck" && c.t, 100);
  assert.equal(c?.type === "stuck" && c.face, true);
});

test("typing never hides the rest of an answer behind a stray $ or an unclosed [[", () => {
  const stray = "The round exhaust stays hot because it costs $5 million to cool and the hot gas in the middle is trapped by the cooler air around it.";
  assert.equal(safeCut(stray, stray.length, true), stray); // done: all of it shows
  assert.ok(safeCut(stray, stray.length - 5).length > stray.indexOf("trapped"), "a $ left open for 60+ characters is just a dollar sign");
  const open = "The [[hot core keeps its heat because the gas in the middle is surrounded by more hot gas on every side.";
  assert.equal(safeCut(open, open.length, true), open.replace("[[", "")); // a dangling [[ is dropped at the end
  // Still hidden while it is plausibly about to close: a short formula or phrase being typed.
  assert.equal(safeCut("so $x^2 + y", 11), "so ");
  assert.equal(safeCut("the [[gat", 9), "the ");
  assert.equal(safeCut("so $x^2$ is big", 6), "so $x^2$");
});

test("a confused look is two of brows, eyelids and head tilt; one alone doesn't count", () => {
  const run = (frown: number, lids: number, tilt = 0) => {
    const d = new Detector();
    d.handle({ kind: "play", wall: 0, t: 10 });
    return [0, 800, 1600].flatMap((wall) => d.handle({ kind: "face", wall, t: 10, frown, lids, tilt, lean: 1 }));
  };
  const [B, L, T] = [RULES.frownAt + 0.02, RULES.lidsAt + 0.02, RULES.tiltAt + 2];
  assert.equal(run(RULES.frownAt * 2, 0).length, 0); // brows alone: concentrating
  assert.equal(run(0, RULES.lidsAt * 3).length, 0); // eyelids alone: squinting
  assert.equal(run(0, 0, RULES.tiltAt * 3).length, 0); // a tilt alone: resting the head on a hand
  assert.equal(run(RULES.frownAt * 0.9, RULES.lidsAt * 2).length, 0); // the second strongest decides
  assert.equal(run(B, L).length, 1);
  const [c] = run(B, 0, -T); // tilting the other way counts the same
  assert.equal(c?.type === "stuck" && c.reason.includes("frowning") && c.reason.includes("head tilted"), true);
  assert.equal(run(0, L, T).length, 1);
  assert.deepEqual(confusedLook(RULES.frownAt, RULES.lidsAt * 4).level, 1);
});

test("a confused look counts outside Dense parts too, and for 5 s after a pause, not later", () => {
  const d = new Detector();
  d.handle({ kind: "play", wall: 0, t: 10 });
  const frown = (wall: number) => d.handle({ kind: "face", wall, t: 10 + wall / 1000, frown: 0.4, lids: 0.3, lean: 1 });
  frown(0);
  const [c] = frown(2100);
  assert.equal(c?.type, "stuck");
  assert.equal(c?.type === "stuck" && c.dense, undefined);
  assert.equal(d.faceStatus(2100).fired, true);
  const p = new Detector();
  p.handle({ kind: "pause", wall: 0, t: 10 });
  p.handle({ kind: "face", wall: 0, t: 10, frown: 0.4, lids: 0.3, lean: 1 });
  assert.equal(p.handle({ kind: "face", wall: 2100, t: 10, frown: 0.4, lids: 0.3, lean: 1 }).length, 1); // a confused pause
  const late = new Detector();
  late.handle({ kind: "pause", wall: 0, t: 10 });
  const after = RULES.faceAfterPauseSec * 1000;
  late.handle({ kind: "face", wall: after + 100, t: 10, frown: 0.4, lids: 0.3, lean: 1 });
  assert.equal(late.handle({ kind: "face", wall: after + 2200, t: 10, frown: 0.4, lids: 0.3, lean: 1 }).length, 0);
  assert.equal(late.faceStatus(after + 2200).live, false);
});

test("Missed moment: only what played while away counts; long absences get no Recap", () => {
  const d = new Detector();
  d.handle({ kind: "away", wall: 0, t: 100, away: true, why: "tab" });
  const [m] = d.handle({ kind: "away", wall: 40_000, t: 140, away: false, why: "tab" });
  assert.deepEqual(m, { type: "missed", from: 100, to: 140, awaySec: 40, recap: true });
  // paused, then left for 5 minutes: video time did not move
  d.handle({ kind: "away", wall: 50_000, t: 140, away: true, why: "tab" });
  assert.equal(d.handle({ kind: "away", wall: 350_000, t: 141, away: false, why: "tab" }).length, 0);
  // away 10 minutes while playing
  d.handle({ kind: "away", wall: 400_000, t: 200, away: true, why: "face" });
  const [long] = d.handle({ kind: "away", wall: 1_000_000, t: 800, away: false, why: "face" });
  assert.equal(long.type === "missed" && long.recap, false);
});

test("tab and face away overlap: the moment ends only when both are back", () => {
  const d = new Detector();
  d.handle({ kind: "away", wall: 0, t: 0, away: true, why: "face" });
  d.handle({ kind: "away", wall: 1000, t: 1, away: true, why: "tab" });
  assert.equal(d.handle({ kind: "away", wall: 20_000, t: 20, away: false, why: "tab" }).length, 0);
  assert.equal(d.handle({ kind: "away", wall: 30_000, t: 30, away: false, why: "face" }).length, 1);
});

test("cooldown and the signal line", () => {
  const g = new OfferGate();
  assert.ok(g.canOffer(0));
  g.offered(0);
  assert.ok(!g.canOffer(RULES.cooldownSec * 1000 - 1));
  assert.ok(g.canOffer(RULES.cooldownSec * 1000));
  assert.equal(signalLine(["slowed the video down to 0.75×", "rewound 12 s"]), "The viewer just rewound 12 s. Earlier in the last minute the viewer also: slowed the video down to 0.75×.");
  assert.match(signalLine([]), /asked/);
});

test("streamed answer: partial text, marks and sketch appear as they close", () => {
  let p = parseAnswer("<text>The ŷ is the model's gu");
  assert.equal(p.text, "The ŷ is the model's gu");
  assert.equal(p.textDone, false);
  p = parseAnswer("<text>Done.</te");
  assert.equal(p.text, "Done.");
  const full = `<text>Done.</text>\n<marks>[{"box_2d":[100,200,300,400],"label":"ŷ","kind":"circle"}]</marks>\n<sketch>\`\`\`svg\n<svg viewBox="0 0 400 240"><line x1="0" y1="0" x2="10" y2="10"/></svg>\n\`\`\`</sketch>`;
  p = parseAnswer(full, true);
  assert.equal(p.marks?.[0].label, "ŷ");
  assert.ok(p.figure && p.figure !== "none" && p.figure.kind === "svg" && p.figure.svg.startsWith("<svg") && p.figure.svg.endsWith("</svg>"));
  assert.equal(parseAnswer("plain answer, no tags", true).text, "plain answer, no tags");
});

test("marks: at most two, one spotlight, a flow needs somewhere to go", () => {
  const m = parseMarks(`[{"phrase":"gate","kind":"spotlight","find":"orange bar"},{"phrase":"drain","kind":"spotlight"},{"phrase":"x","kind":"flow","find":"a","to":"b"}]`);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].kind, m[1].kind], ["spotlight", "arrow"]);
  assert.equal(m[1].find, "drain"); // no description: look for the phrase itself
  assert.equal(parseMarks(`[{"phrase":"current","kind":"flow","find":"source"}]`)[0].kind, "arrow");
  assert.deepEqual(parseMarks(`[{"phrase":"current","kind":"flow","find":"source","to":"drain"}]`)[0].to, "drain");
  // Boxes straight from the answer still work: clamped, and broken ones dropped.
  const old = parseMarks(`[{"box_2d":[-5,0,500,1200]},{"box_2d":[5,5,1,1]},{"box":[1,1,2,2],"kind":"zap"}]`);
  assert.deepEqual(old.map((o) => o.box), [[0, 0, 500, 1000], [1, 1, 2, 2]]);
  assert.equal(old[1].kind, "arrow"); // pointing is the default
  assert.deepEqual(parseMarks("not json"), []);
});

test("marks are located on the frame; the ones not found are dropped", () => {
  const marks = parseMarks(`[{"phrase":"gate","kind":"outline","find":"orange bar"},{"phrase":"current","kind":"flow","find":"source","to":"drain"}]`);
  assert.deepEqual(thingsToLocate(marks), ["orange bar", "source", "drain"]);
  const placed = placeMarks(marks, { "orange bar": [1, 2, 3, 4], source: [5, 6, 7, 8], drain: null });
  assert.deepEqual(placed.map((p) => p.phrase), ["gate"]);
  assert.deepEqual(placeMarks(marks, { "orange bar": null, source: [5, 6, 7, 8], drain: [1, 1, 9, 9] })[0].toBox, [1, 1, 9, 9]);
});

test("marks fit what was found: circles only around small things, nothing piled up or on the whole picture", () => {
  const mk = (phrase: string, kind: string, box: number[]) => ({ phrase, kind, find: phrase, label: "", box }) as any;
  const [small, long, big] = placeMarks([mk("a", "outline", [100, 100, 200, 220]), mk("b", "outline", [100, 400, 900, 560])], {})
    .concat(placeMarks([mk("c", "outline", [100, 100, 600, 600])], {}));
  assert.deepEqual([small.kind, long.kind, big.kind], ["outline", "arrow", "arrow"]); // a tall column and a big area get an arrow
  assert.equal(placeMarks([mk("all", "spotlight", [0, 0, 800, 900])], {}).length, 0);
  assert.equal(placeMarks([mk("all", "arrow", [0, 0, 900, 900])], {}).length, 0);
  const piled = placeMarks([mk("grid", "arrow", [200, 400, 800, 700]), mk("gap", "arrow", [300, 450, 600, 650]), mk("wave", "arrow", [200, 50, 600, 380])], {});
  assert.deepEqual(piled.map((m) => m.phrase), ["grid", "wave"]); // "gap" sits inside "grid"
  assert.equal(fitMark(mk("f", "flow", [0, 0, 1000, 1000]))?.kind, "flow");
});

test("zoomed second look: crop, map back, and trust it only when it agrees", () => {
  const b: [number, number, number, number] = [400, 400, 440, 440];
  const crop = cropAround(b);
  assert.deepEqual(crop, [320, 320, 520, 520]);
  assert.deepEqual(fromCrop(crop, [400, 400, 600, 600]), [400, 400, 440, 440]);
  assert.ok(sameThing(b, [405, 398, 445, 436]));
  assert.ok(!sameThing(b, [480, 480, 520, 520])); // a neighbour
  assert.ok(!sameThing(b, [320, 320, 520, 520])); // the whole crop
  assert.ok(worthRefining(b) && !worthRefining([0, 0, 900, 500]));
  assert.deepEqual(cropAround([10, 950, 60, 990]), [0, 870, 140, 1000]); // clamped at the edge
});

test("an answer may list its marks before its text", () => {
  let p = parseAnswer(`<marks>[{"phrase":"gate","find":"orange bar"}]</marks>\n<text>The [[ga`);
  assert.equal(p.marks?.[0].phrase, "gate");
  assert.equal(p.text, "The [[ga");
  p = parseAnswer(`<marks>[{"phrase":"gate"`);
  assert.equal(p.text, "");
  assert.equal(p.marks, null);
});

test("[[phrases]]: shown as refs, never cut in half while typing", () => {
  const refs = (p: string) => (p === "gate" ? "ref" : "ref off");
  assert.equal(
    formatText("the [[gate]] and [[a <b>]]", (t) => t, refs),
    `<p>the <span class="ref" data-ref="gate">gate</span> and <span class="ref off" data-ref="a &lt;b&gt;">a &lt;b&gt;</span></p>`,
  );
  assert.equal(safeCut("the [[gate]] opens", 7), "the [[gate]]");
  assert.equal(safeCut("the [[ga", 8), "the ");
  assert.equal(safeCut("cost $x+1$ now", 7), "cost $x+1$");
  assert.ok(phraseShown("the [[Gate]] op", "gate"));
  assert.ok(!phraseShown("the [[ga", "gate"));
  assert.equal(stripRefs("the [[gate]] opens"), "the gate opens");
  // The model forgot the brackets: the first whole-word match outside math gets them.
  assert.equal(wrapPhrases("the gates; the Input  layer and $layer$", ["gate", "input layer"]), "the gates; the [[Input  layer]] and $layer$");
  assert.equal(wrapPhrases("$x$ then x", ["x"]), "$x$ then [[x]]");
  assert.equal(wrapPhrases("the [[gate]] and the gate", ["gate"]), "the [[gate]] and the gate");
  assert.equal(firstSentence("The [[gate]] opens. Then more."), "The gate opens.");
  // The model sometimes puts the brackets in the Mark's phrase too: never wrap twice.
  assert.equal(parseMarks(`[{"phrase":"[[output layer]]","find":"x"}]`)[0].phrase, "output layer");
  assert.equal(wrapPhrases("the [[output layer]] lights", ["[[output layer]]"]), "the [[output layer]] lights");
  assert.equal(formatText("a [[[[b]]]]", (t) => t), `<p>a [[<span class="ref" data-ref="b">b</span>]]</p>`);
});

test("sketch ids are namespaced, including url() and href references", () => {
  const svg = `<svg><defs><marker id="a"/></defs><line marker-end="url(#a)"/><use href="#a"/></svg>`;
  assert.equal(namespaceSvgIds(svg, "s1"), `<svg><defs><marker id="s1-a"/></defs><line marker-end="url(#s1-a)"/><use href="#s1-a"/></svg>`);
});

test("text formatting escapes HTML and renders math, bold, times and lists", () => {
  const html = formatText("A <b> **big** idea, see (04:12) and $x^2$.\n- one\n- two\nEnd", (t, d) => `[${d ? "D" : "i"}:${t}]`);
  assert.equal(
    html,
    `<p>A &lt;b&gt; <strong>big</strong> idea, see (<a class="ts" data-t="252">04:12</a>) and [i:x^2].</p><ul><li>one</li><li>two</li></ul><p>End</p>`,
  );
  assert.equal(formatText("price is $5 and $", (t) => `[${t}]`), "<p>price is [5 and]</p>");
  assert.equal(toSeconds("1:02:03"), 3723);
  assert.equal(firstSentence("The **log** punishes $p$ hard. More here."), "The log punishes p hard.");
});

test("server guard: only this extension, only via 127.0.0.1", () => {
  const opts = { port: 4717, extensionId: "abc" };
  const ok = { method: "POST", host: "127.0.0.1:4717", origin: "chrome-extension://abc", marker: "1" };
  assert.equal(checkRequest(ok, opts), null);
  assert.equal(checkRequest({ ...ok, origin: "https://evil.example" }, opts), "bad origin");
  assert.equal(checkRequest({ ...ok, host: "evil.example:8787" }, opts), "bad host");
  assert.equal(checkRequest({ ...ok, marker: undefined }, opts), "missing X-Unstuck header");
  assert.equal(checkRequest({ ...ok, method: "OPTIONS" }, opts), "no preflight");
});

test("extension id from a manifest key matches Chrome's scheme", () => {
  // Known pair from Chrome's docs-style example: any key gives 32 chars in a-p.
  const id = extensionIdFromKey(Buffer.from("hello").toString("base64"));
  assert.match(id, /^[a-p]{32}$/);
});

test("transcript panel fallback: timestamps, spoken-time prefixes, end times", () => {
  const segs = parseTranscriptItems([
    { text: "0:14 14 seconds And I want you to take a moment." },
    { text: "1:05 1 minute, 5 seconds This is a 3." },
    { ts: "1:02:03", text: " Long video line " },
    { text: "no timestamp here" },
  ]);
  assert.deepEqual(segs.map((s) => [s.start, s.text]), [[14, "And I want you to take a moment."], [65, "This is a 3."], [3723, "Long video line"]]);
  assert.equal(segs[0].end, 65);
});

test("rewinding the same part twice within a minute is a sure Stuck candidate", () => {
  const d = new Detector();
  const [a] = d.handle({ kind: "seek", wall: 0, from: 100, to: 90 });
  assert.equal(a.type === "stuck" && a.sure, undefined);
  const [b] = d.handle({ kind: "seek", wall: 8000, from: 97, to: 88 });
  assert.equal(b.type === "stuck" && b.sure, true);
  if (b.type === "stuck") assert.match(b.reason, /same part again/);
  // a different part, or the same part much later, is not sure
  const [c] = d.handle({ kind: "seek", wall: 20_000, from: 300, to: 290 });
  assert.equal(c.type === "stuck" && c.sure, undefined);
  const [e] = d.handle({ kind: "seek", wall: 200_000, from: 99, to: 89 });
  assert.equal(e.type === "stuck" && e.sure, undefined);
});

test("caption track: the original language, not the first of 21 AI-dub languages", () => {
  // Real track list of a video with AI dubbing (12 Nov 2026): Arabic comes first.
  const langs = ["ar", "bn", "nl", "en", "fr", "de", "iw", "hi", "id", "it", "ja", "ko", "ml", "pl", "pt", "pa", "ru", "es", "ta", "te", "uk"];
  const tracks = langs.map((lang) => ({ lang, kind: "asr", name: "" }));
  assert.equal(pickTrack({ tracks, defaultCaption: { lang: "en", kind: "asr" } })?.lang, "en");
  assert.equal(pickTrack({ tracks, defaultCaption: null })?.lang, "en"); // no hint: English, not Arabic
  // a hand-made track beats auto-captions in the same language
  const withManual = [{ lang: "en", kind: "asr", name: "" }, { lang: "en-GB", kind: "", name: "English (UK)" }, { lang: "ar", kind: "", name: "Arabic" }];
  assert.equal(pickTrack({ tracks: withManual, defaultCaption: { lang: "en", kind: "asr" } })?.name, "English (UK)");
  // one auto-caption language means that's what is spoken
  assert.equal(pickTrack({ tracks: [{ lang: "nl", kind: "asr", name: "" }, { lang: "de", kind: "", name: "Deutsch" }], defaultCaption: null })?.lang, "nl");
});

test("the language line names the video's language", async () => {
  const { languageLine } = await import("../src/ai/prompts.ts");
  assert.equal(languageLine("en"), "The video is in English. Write everything, including figure labels, in English.");
  assert.match(languageLine("nl-NL"), /in Dutch\./);
  assert.match(languageLine(), /language the video is spoken in/);
});

test("play line: known once closed, empty when there's nothing to move", () => {
  assert.equal(parseAnswer("<text>Hi.</text><play>Drag the bias</pl").play, null);
  assert.equal(parseAnswer("<text>Hi.</text><play>\n Drag the  bias \n</play>").play, "Drag the bias");
  assert.equal(parseAnswer("<text>Hi.</text><play></play>").play, "");
  assert.equal(parseAnswer("<text>Hi.</text>", true).play, "");
});

test("simulation page: fences stripped, guard first in <head>", () => {
  const page = "<!doctype html><html><head><title>x</title></head><body><canvas></canvas></body></html>";
  assert.equal(cleanSimHtml("```html\n" + page + "\n```"), page);
  assert.equal(cleanSimHtml("Sure! Here it is:\n" + page + "\nEnjoy"), page);
  assert.equal(cleanSimHtml("no page here"), null);
  // Cut off before its closing tags: kept, the browser finishes it.
  assert.equal(cleanSimHtml("<!doctype html><html><body><canvas></canvas><script>go()</script>"), "<!doctype html><html><body><canvas></canvas><script>go()</script>");
  assert.equal(cleanSimHtml("<html><body><p>just words</p></body></html>"), null); // nothing to play with
  assert.ok(withGuard(page).startsWith("<!doctype html><html><head>" + SIM_GUARD + "<title>"));
  assert.ok(withGuard("<html><body></body></html>").startsWith("<html><head>" + SIM_GUARD + "</head>"));
  // 3D: three.js from the extension right after the guard; a CDN copy is dropped.
  const scene = `<html><head><script src="https://cdn.example/three.min.js"></script></head><body><script>new THREE.Scene()</script></body></html>`;
  assert.equal(withGuard(scene), `<html><head>${SIM_GUARD}<script src="three.js"></script></head><body><script>new THREE.Scene()</script></body></html>`);
  assert.ok(!withGuard(page).includes("three.js"));
});

test("tables: header row, separator skipped, cells formatted", () => {
  const html = formatText("Two kinds:\n| | ReLU | sigmoid |\n|---|:---:|---|\n| range | **0 to ∞** | 0 to 1 |\nDone.", (t) => t);
  assert.equal(
    html,
    "<p>Two kinds:</p><table><thead><tr><th></th><th>ReLU</th><th>sigmoid</th></tr></thead><tbody><tr><td>range</td><td><strong>0 to ∞</strong></td><td>0 to 1</td></tr></tbody></table><p>Done.</p>",
  );
});

test("formulas: arithmetic and functions only, by the usual rules", () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  near(compile("1/(1+exp(-(x-10)))")!(10), 0.5);
  near(compile("sigmoid(x)")!(0), 0.5);
  near(compile("-x^2")!(3), -9);
  near(compile("2^3^2")!(0), 512);
  near(compile("2*pi*x")!(1), 2 * Math.PI);
  near(compile("max(0, x) − 1")!(-4), -1);
  near(compile("3·x + 1e-3")!(1), 3.001);
  for (const bad of ["2x", "alert(1)", "x*", "constructor", "x)(", ""]) assert.equal(compile(bad), null, bad);
});

test("plots: round ticks, bad formulas dropped, true curves drawn", () => {
  assert.deepEqual(niceTicks(0, 10), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(-8, 16), [-5, 0, 5, 10, 15]);
  assert.equal(cleanPlotSpec({ plot: { x: [0, 1], curves: [{ f: "eval(x)" }] } }), null);
  const spec = cleanPlotSpec({ plot: { x: [-8, 16], curves: [{ f: "sigmoid(x)", label: "b = 0" }, { f: "nope(" }, { f: "sigmoid(x-10)", label: "b = -10", key: true }], arrow: { from: [1, 0.5], to: [9, 0.5], label: "slides" } } })!;
  assert.equal(spec.curves!.length, 2);
  const svg = plotSvg(spec);
  assert.ok(!/NaN|Infinity/.test(svg));
  assert.equal((svg.match(/<path d="M[^"]*" fill="none"/g) ?? []).length, 2); // two curves (the arrowhead is a path too)
  assert.ok(svg.includes('stroke="#ff7a59" stroke-width="3.2"')); // the key curve is coral
  assert.ok(svg.includes('marker-end="url(#head)"'));
  const bars = plotSvg(cleanPlotSpec({ bars: [{ label: "ReLU", value: 2 }, { label: "sigmoid", value: 0.5, key: true }] })!);
  assert.equal((bars.match(/<rect /g) ?? []).length, 2);
});

test("figure section: plot JSON, HTML, an old SVG, or nothing", () => {
  assert.equal((parseFigure('{"plot":{"x":[0,1],"curves":[{"f":"x"}]}}') as any).kind, "plot");
  assert.equal((parseFigure('```html\n<div><style>.a{}</style>hi</div>\n```') as any).kind, "html");
  assert.equal((parseFigure('<svg viewBox="0 0 4 4"><line x1="0" y1="0" x2="1" y2="1"/></svg>') as any).kind, "svg");
  assert.equal(parseFigure("  "), null);
  assert.equal(parseAnswer("<text>Hi.</text><figure></figure>").figure, "none");
  assert.equal(parseAnswer("<text>Hi.</text><figure>{").figure, null);
});

test("figure check: only HTML figures, held back until complete, the rest streams through", async () => {
  const seen: string[] = [];
  const check = async (html: string, explanation: string) => {
    seen.push(`${explanation}|${html}`);
    return "<div>fixed</div>";
  };
  const chunks = ["<marks>[]</marks><text>The idea.</text><fig", "ure><div>dr", "aft</div></figure><play>x</play>"];
  async function* gen() {
    yield* chunks;
  }
  let out = "";
  for await (const c of checkedFigures(gen(), check)) out += c;
  assert.equal(out, "<marks>[]</marks><text>The idea.</text><figure><div>fixed</div></figure><play>x</play>");
  assert.deepEqual(seen, ["The idea.|<div>draft</div>"]);
  // A plot is drawn by Unstuck itself: no check.
  seen.length = 0;
  async function* plot() {
    yield '<text>T</text><figure>{"plot":{}}</figure>';
  }
  out = "";
  for await (const c of checkedFigures(plot(), check)) out += c;
  assert.equal(out, '<text>T</text><figure>{"plot":{}}</figure>');
  assert.equal(seen.length, 0);
});

const hit = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const inside = (r: Rect, W: number, H: number) => r.left >= ROOM.gap && r.top >= ROOM.gap && r.left + r.width <= W - ROOM.gap && r.top + r.height <= H - ROOM.gap;

test("the Room: the video takes the free space left of the chat, as big as fits", () => {
  const [W, H] = [1440, 900];
  const panel = defaultPanel(W, H);
  assert.equal(panel.left + panel.width, W - ROOM.gap);
  assert.equal(panel.height, H - 2 * ROOM.gap);
  const v = videoSpot(W, H, [panel], 16 / 9);
  assert.ok(!hit(v, panel) && inside(v, W, H));
  assert.equal(v.width, panel.left - 2 * ROOM.gap); // width-bound: fills the whole space beside the chat
  assert.ok(Math.abs(v.width / v.height - 16 / 9) < 0.01);
  assert.ok(Math.abs(v.top - (H - v.height) / 2) <= 1); // centred top to bottom
});

test("the Room: with a simulation, the video sits above it and nothing overlaps", () => {
  const [W, H] = [1440, 900];
  const panel = defaultPanel(W, H);
  const sim = defaultSim(W, H, panel);
  assert.ok(!hit(sim, panel) && sim.top + sim.height === H - ROOM.gap);
  const v = videoSpot(W, H, [panel, sim], 16 / 9);
  assert.ok(!hit(v, panel) && !hit(v, sim) && inside(v, W, H));
  assert.ok(v.top + v.height <= sim.top - ROOM.gap);
  assert.ok(v.width > 500, `video ${v.width} px wide`);
});

test("the Room: windows the Viewer moved push the video to the other side", () => {
  const [W, H] = [1440, 900];
  const panel = { left: 12, top: 12, width: 420, height: 876 }; // dragged to the left edge
  const v = videoSpot(W, H, [panel], 16 / 9);
  assert.ok(v.left >= panel.left + panel.width + ROOM.gap && !hit(v, panel));
  const sim = defaultSim(W, H, panel);
  assert.ok(sim.left > panel.left + panel.width, "the simulation goes to the wider side too");
  const tall = { left: 700, top: 12, width: 400, height: 876 }; // in the middle: the bigger side wins
  const v2 = videoSpot(W, H, [tall], 16 / 9);
  assert.ok(v2.left + v2.width <= tall.left - ROOM.gap && v2.width === tall.left - 2 * ROOM.gap);
});

test("the Room: no free space still leaves a small video; portrait videos fit by height", () => {
  const [W, H] = [1440, 900];
  const v = videoSpot(W, H, [{ left: 0, top: 0, width: W, height: H }], 16 / 9);
  assert.equal(v.width, ROOM.minVideo);
  const p = videoSpot(W, H, [defaultPanel(W, H)], 9 / 16);
  assert.equal(p.height, H - 2 * ROOM.gap);
  const r = { left: 100, top: 50, width: 400, height: 300 };
  assert.deepEqual(fromFrac(toFrac(r, W, H), W, H), r);
});

test("Panopto: captions from an SRT file", () => {
  const srt = "1\r\n00:00:01,500 --> 00:00:04,000\r\nWelcome to <i>Strategy</i>\r\nof Innovation.\r\n\r\n2\r\n00:01:02,250 --> 00:01:05,000\r\nToday: dominant designs.\r\n";
  assert.deepEqual(parseSrt(srt), [
    { start: 1.5, end: 4, text: "Welcome to Strategy of Innovation." },
    { start: 62.25, end: 65, text: "Today: dominant designs." },
  ]);
  assert.deepEqual(parseSrt(""), []);
});

test("Panopto: a lecture's title, captions and outline from DeliveryInfo, read defensively", () => {
  const l = lectureFrom("abc", {
    Delivery: {
      SessionName: "BM02MI Session 2",
      Duration: 2774.5,
      HasCaptions: true,
      AvailableCaptions: [{ Language: 1 }],
      Timestamps: [
        { Time: 330, Caption: "Why are you here? Course learning goals" },
        { Time: 315, Caption: "Strategy of Innovation" },
        { Time: 342, Caption: "  Overview " },
        { Time: "bad" },
      ],
      AIChapters: [{ StartTime: 600, Title: "Dominant designs" }],
    },
  });
  assert.equal(l.title, "BM02MI Session 2");
  assert.equal(l.durationSec, 2774.5);
  assert.equal(l.captionTrack, 1);
  assert.deepEqual(l.outline.map((x) => `${x.t} ${x.title}`), ["315 Strategy of Innovation", "330 Why are you here? Course learning goals", "342 Overview", "600 Dominant designs"]);
  // No captions, or an answer we don't understand: still a lecture, just without them.
  assert.equal(lectureFrom("x", { Delivery: { HasCaptions: false, AvailableCaptions: [] } }).captionTrack, null);
  assert.deepEqual(lectureFrom("x", null), { id: "x", title: "Lecture", durationSec: 0, captionTrack: null, outline: [] });
});

test("Panopto: the outline marks the part being watched", () => {
  const outline = [
    { t: 315, title: "Strategy of Innovation" },
    { t: 330, title: "Course learning goals" },
    { t: 342, title: "Overview" },
  ];
  assert.equal(outlineText(outline, 335), "05:15 Strategy of Innovation\n05:30 Course learning goals   ← now\n05:42 Overview");
  assert.equal(outlineText([], 10), "");
  const long = Array.from({ length: 100 }, (_, i) => ({ t: i * 60, title: `Slide ${i}` }));
  const lines = outlineText(long, 50 * 60, 10).split("\n");
  assert.equal(lines.length, 10);
  assert.ok(lines.some((x) => x.includes("Slide 50   ← now")));
});

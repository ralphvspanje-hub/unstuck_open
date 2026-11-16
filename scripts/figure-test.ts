// Compares ways to make an Explanation's figure, on real explanations from 12 Nov 2026:
// SVG drawn once, SVG after a check, HTML once, HTML after a check. (Generated images were
// considered and dropped.)
// The check: the figure is rendered exactly as the chat panel shows it, and the model looks at
// the render and either says OK or returns a fixed figure. Needs the real server running.
// Output: /tmp/unstuck-figures/index.html. Run: node scripts/figure-test.ts
import * as esbuild from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "/tmp/unstuck-figures";
const ORIGIN = "chrome-extension://cbbnmjbdbobjhmndkdbfeckdhgghdloa";

const CASES = [
  {
    id: "b2",
    title: "How the B-2 Spirit Avoids Radar | Stealth Technology Explained",
    explanation:
      "Traditional planes have big vertical tails that act like giant mirrors, bouncing radar waves straight back to the enemy. By removing the tail and blending everything into a smooth wing, the B-2 scatters those radio waves in useless directions.",
  },
  {
    id: "layers",
    title: "But what is a neural network? | Deep learning chapter 1",
    explanation:
      "Each circle is a neuron holding a number between 0 and 1, its activation. The 784 input neurons hold the brightness of each pixel of the image; their values ripple through the two hidden layers, and the brightest of the 10 output neurons is the network's guess.",
  },
  {
    id: "bias",
    title: "But what is a neural network? | Deep learning chapter 1",
    explanation:
      "The bias decides where the neuron switches on. The weighted sum w·x gets the bias b added before the sigmoid squashes it into 0 to 1, so with a bias of −10 the sum has to pass 10 before the neuron lights up: the whole S-curve slides to the right.",
  },
];

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:4717${path}`, { method: "POST", headers: { Origin: ORIGIN, "X-Unstuck": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `server said ${res.status}`);
  return data as T;
}

mkdirSync(OUT, { recursive: true });
const sketchJs = (await esbuild.build({ entryPoints: ["src/content/sketch.ts"], bundle: true, format: "iife", globalName: "SK", write: false, logLevel: "silent" })).outputFiles[0].text;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 400 }, deviceScaleFactor: 2 });
await page.setContent(`<style>body{margin:0;background:#16181d;color:#f4f4f5;font:14px system-ui} #box{width:400px;padding:10px}
.sketch-svg{width:100%;height:auto;display:block;overflow:visible}.sketch-svg text{font-family:"Chalkboard SE","Noteworthy","Comic Sans MS",cursive}</style><div id="box"></div>`);
await page.addScriptTag({ content: sketchJs });

/** Renders a figure as the chat panel would, returns a PNG (base64), and saves it. */
async function render(format: "svg" | "html", code: string, file: string): Promise<string> {
  await page.evaluate(
    async ({ format, code }) => {
      const box = document.getElementById("box")!;
      box.innerHTML = "";
      if (format === "svg") await (window as any).SK.drawSketch(box, code, { fast: true });
      else box.innerHTML = code;
    },
    { format, code },
  );
  await page.waitForTimeout(400);
  const png = await page.locator("#box").screenshot({ path: `${OUT}/${file}` });
  return png.toString("base64");
}

type Cell = { label: string; file?: string; note: string };
const rows: { c: (typeof CASES)[number]; cells: Cell[] }[] = [];
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

for (const c of CASES) {
  console.log(`• ${c.id}`);
  const draw = async (format: "svg" | "html"): Promise<Cell[]> => {
    try {
      const first = await call<{ code: string; ms: number }>("/figure", { format, title: c.title, explanation: c.explanation });
      if (!first.code) return [{ label: `${format.toUpperCase()} once`, note: "no figure in the answer" }];
      const f1 = `${c.id}-${format}-1.png`;
      const shot = await render(format, first.code, f1);
      const check = await call<{ ok: boolean; code: string; ms: number }>("/figure-check", { format, title: c.title, explanation: c.explanation, code: first.code, renderB64: shot });
      const f2 = `${c.id}-${format}-2.png`;
      if (!check.ok) await render(format, check.code, f2);
      return [
        { label: `${format.toUpperCase()} once${format === "svg" ? " (as now)" : ""}`, file: f1, note: secs(first.ms) },
        { label: `${format.toUpperCase()} + check`, file: check.ok ? f1 : f2, note: check.ok ? `check said OK (+${secs(check.ms)})` : `revised after looking (+${secs(check.ms)})` },
      ];
    } catch (e) {
      return [{ label: `${format.toUpperCase()}`, note: `failed: ${String((e as Error).message).slice(0, 120)}` }];
    }
  };
  // One page renders the figures, so strictly one at a time.
  const svg = await draw("svg");
  const html = await draw("html");
  rows.push({ c, cells: [...svg, ...html] });
  for (const cell of rows.at(-1)!.cells) console.log(`  ${cell.label}: ${cell.note}`);
}
await browser.close();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
writeFileSync(
  `${OUT}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>Unstuck figure test</title><style>
body{background:#0e0f12;color:#f4f4f5;font:14px system-ui;margin:24px}h1{font-size:20px}h2{font-size:15px;margin:28px 0 4px}
p.ex{max-width:900px;opacity:.75;margin:0 0 10px;line-height:1.45}.grid{display:grid;grid-template-columns:repeat(2,420px);gap:14px}
.cell{background:#16181d;border-radius:14px;padding:10px}.cell b{display:block;font-size:13px;margin-bottom:2px}.cell small{opacity:.6}
.cell img{display:block;width:400px;margin-top:8px;border-radius:8px}</style>
<h1>Figures for the chat: four ways, three explanations</h1>
${rows
  .map(
    ({ c, cells }) =>
      `<h2>${esc(c.title)}</h2><p class="ex">${esc(c.explanation)}</p><div class="grid">${cells
        .map((x) => `<div class="cell"><b>${esc(x.label)}</b><small>${esc(x.note)}</small>${x.file ? `<img src="${x.file}">` : ""}</div>`)
        .join("")}</div>`,
  )
  .join("")}`,
);
console.log(`\nopen ${OUT}/index.html`);

// Mock mode: no key, no network. Lets the whole loop run so the UI can be built and tested.
import type { Box, ExplainRequest, JudgeRequest, LocateRequest, LocateResponse, MapRequest, RecapRequest, SimRequest, VideoMap } from "../src/core/types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* drip(s: string, signal: AbortSignal) {
  for (let i = 0; i < s.length; i += 14) {
    if (signal.aborted) return;
    await sleep(28);
    yield s.slice(i, i + 14);
  }
}

export async function judge(_r: JudgeRequest) {
  await sleep(200);
  return { score: 0.82, latencyMs: 200 };
}

export async function videoMap(r: MapRequest): Promise<VideoMap> {
  await sleep(600);
  const d = r.durationSec || 600;
  return {
    topic: `(mock) ${r.title}`,
    keyTerms: [],
    denseParts: [
      { start: d * 0.2, end: d * 0.2 + 90, why: "mock dense part" },
      { start: d * 0.55, end: d * 0.55 + 90, why: "mock dense part" },
    ],
  };
}

// The bias slides the S-curve: a plot Unstuck draws exactly.
const PLOT = JSON.stringify({
  plot: {
    x: [-8, 16],
    xLabel: "weighted sum w·x",
    yLabel: "activation",
    curves: [
      { f: "sigmoid(x)", label: "b = 0" },
      { f: "sigmoid(x - 10)", label: "b = −10", key: true },
    ],
    arrow: { from: [1, 0.5], to: [9, 0.5], label: "slides right" },
  },
});

// Layers as an HTML figure: the layout places the labels.
const HTML_FIGURE = `<div class="f"><style>
.f{width:400px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:center;text-align:center;font:13px system-ui;color:#f4f4f5}
.col{display:flex;flex-direction:column;align-items:center;gap:7px}.n{width:18px;height:18px;border-radius:50%;border:2px solid #9aa0aa}
.k .n{border-color:#4f8cff}.o .n:nth-child(2){background:#ff7a59;border-color:#ff7a59}.lab{color:#9aa0aa;font-size:12px;margin-top:4px}.o .lab{color:#ff7a59}
</style><div class="col"><div class="n"></div><div class="n"></div><div class="n"></div><div class="lab">784 pixels in</div></div>
<div class="col k"><div class="n"></div><div class="n"></div><div class="n"></div><div class="lab">hidden layers</div></div>
<div class="col o"><div class="n"></div><div class="n"></div><div class="n"></div><div class="lab">brightest = guess</div></div></div>`;

function answer(r: ExplainRequest): string {
  const text =
    r.mode === "simpler"
      ? "Think of it as a fine for being cocky. Guess wrong while acting very sure, and the fine is huge. Guess right, and you pay almost nothing."
      : r.mode === "followup"
        ? `(mock) You asked: "${r.question}". In the real version, Gemini answers here, using what's on screen.`
        : "(mock) The [[log]] turns a confident wrong guess into a huge penalty: $-\\log(0.01) \\approx 4.6$, while a confident right one costs almost nothing. The penalty flows back into [[the weights]], so the model learns to be sure only when it's right, like the speaker's dice example (01:12).";
  const marks =
    r.mode === "explain"
      ? `[{"phrase":"log","kind":"arrow","find":"the log term","label":"the penalty"},{"phrase":"the weights","kind":"flow","find":"the output","to":"the weights","label":"blame"}]`
      : "[]";
  const play = r.mode === "explain" ? "Drag the weight and the bias and watch where the neuron switches on" : "";
  const figure = r.mode === "explain" ? PLOT : r.mode === "simpler" ? HTML_FIGURE : "";
  return `<marks>${marks}</marks>\n<text>${text}</text>\n<figure>${figure}</figure>\n<play>${play}</play>`;
}

const MOCK_BOXES: Box[] = [
  [380, 300, 620, 560],
  [250, 640, 420, 860],
  [620, 120, 780, 330],
];

export async function locate(r: LocateRequest): Promise<LocateResponse> {
  await sleep(500);
  // Zoomed in: the thing sits in the middle of the crop.
  if (r.zoomed) return { boxes: Object.fromEntries(r.things.map((t) => [t, [330, 330, 670, 670] as Box])) };
  return { boxes: Object.fromEntries(r.things.map((t, i) => [t, MOCK_BOXES[i % MOCK_BOXES.length]])) };
}

export const explain = (r: ExplainRequest, signal: AbortSignal) => drip(answer(r), signal);

export const recap = (r: RecapRequest, signal: AbortSignal) => {
  const lines = r.transcript.split("\n").slice(0, 3).map((l) => `- ${l.replace(/^\[[^\]]+\]\s*/, "").slice(0, 110)}`);
  return drip(`<text>${lines.join("\n") || "- (mock) nothing was said"}</text><marks>[]</marks><figure></figure>`, signal);
};

/** A real, working simulation, so "▶ Play with it" can be tried without the model. */
const SIM = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#16181d;color:#f4f4f5;font:14px system-ui;overflow:hidden}
#top{position:absolute;left:18px;right:18px;top:12px;font-size:15px}
#ctl{position:absolute;left:18px;bottom:14px;display:flex;gap:22px;align-items:center}
label{display:flex;gap:8px;align-items:center;color:#9aa0aa} input{accent-color:#ff7a59;width:170px}
#out{position:absolute;right:18px;bottom:16px;color:#9aa0aa} #out b{color:#ff7a59}
canvas{position:absolute;inset:0;width:100%;height:100%}</style></head><body>
<canvas id="c"></canvas><div id="top">(mock) Drag the bias: watch where the neuron switches on.</div>
<div id="ctl"><label>weight w <input id="w" type="range" min="0.2" max="4" step="0.01" value="1.5"></label>
<label>bias b <input id="b" type="range" min="-6" max="6" step="0.01" value="0"></label></div>
<div id="out"></div>
<script>
const c=document.getElementById("c"),g=c.getContext("2d"),W=document.getElementById("w"),B=document.getElementById("b"),out=document.getElementById("out");
const s=(x)=>1/(1+Math.exp(-x));
function draw(){const r=devicePixelRatio||1,w=innerWidth,h=innerHeight;c.width=w*r;c.height=h*r;g.setTransform(r,0,0,r,0,0);
g.clearRect(0,0,w,h);const L=50,R=w-30,T=60,Bo=h-70,X=(x)=>L+(x+8)/16*(R-L),Y=(y)=>Bo-y*(Bo-T);
g.strokeStyle="rgba(255,255,255,.08)";for(let x=-8;x<=8;x+=2){g.beginPath();g.moveTo(X(x),T);g.lineTo(X(x),Bo);g.stroke()}
g.strokeStyle="#f4f4f5";g.lineWidth=2;g.beginPath();g.moveTo(L,Bo);g.lineTo(R,Bo);g.moveTo(X(0),T-10);g.lineTo(X(0),Bo);g.stroke();
const w0=+W.value,b0=+B.value;g.strokeStyle="#4f8cff";g.lineWidth=2;g.setLineDash([5,5]);g.beginPath();
for(let i=0;i<=300;i++){const x=-8+16*i/300;const y=s(1.5*x);i?g.lineTo(X(x),Y(y)):g.moveTo(X(x),Y(y))}g.stroke();g.setLineDash([]);
g.strokeStyle="#ff7a59";g.lineWidth=3;g.beginPath();for(let i=0;i<=300;i++){const x=-8+16*i/300;const y=s(w0*x+b0);i?g.lineTo(X(x),Y(y)):g.moveTo(X(x),Y(y))}g.stroke();
const on=-b0/w0;if(on>-8&&on<8){g.fillStyle="#ff7a59";g.beginPath();g.arc(X(on),Y(.5),6,0,7);g.fill();g.fillText("switches on at x = "+on.toFixed(2),X(on)+10,Y(.5)-10)}
out.innerHTML="switch-on point <b>x = "+on.toFixed(2)+"</b> · steepness <b>"+(w0/4).toFixed(2)+"</b>"}
W.oninput=B.oninput=draw;addEventListener("resize",draw);draw();
</script></body></html>`;

export const sim = (r: SimRequest, signal: AbortSignal) => drip(SIM, signal);

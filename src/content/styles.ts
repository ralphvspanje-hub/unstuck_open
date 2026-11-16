// Styles for the Shadow DOM parts (Offer, panel, Marks). YouTube's CSS can't reach in.

export const KNOT_TANGLED = "M3 17 C 9 1, 23 1, 19 14 C 15 27, 3 21, 10 12 C 17 3, 29 8, 29 17";
export const KNOT_UNTANGLED = "M3 17 C 7 17, 11 17, 15 17 C 19 17, 21 17, 23 17 C 25 17, 27 17, 29 17";

export const knotSvg = (cls = "") =>
  `<svg class="knot ${cls}" viewBox="0 0 32 32" aria-hidden="true"><path d="${KNOT_TANGLED}"/></svg>`;

/** Resize grips on all four corners of a window; they show when the pointer is over it. */
const gripCss = (box: string) => `
.grip { position: absolute; z-index: 3; touch-action: none; opacity: 0; transition: opacity .15s; }
.${box}:hover .grip { opacity: .3; }
.grip:hover, .${box}.resizing .grip { opacity: .85; }
.grip.bl, .grip.br { bottom: 0; width: 18px; height: 18px; }
.grip.tl, .grip.tr { top: 0; width: 12px; height: 12px; }
.grip.br { right: 0; cursor: nwse-resize; border-bottom-right-radius: 16px;
  background: linear-gradient(135deg, transparent 0 52%, #f4f4f5 52% 60%, transparent 60% 70%, #f4f4f5 70% 78%, transparent 78%); }
.grip.bl { left: 0; cursor: nesw-resize; border-bottom-left-radius: 16px;
  background: linear-gradient(225deg, transparent 0 52%, #f4f4f5 52% 60%, transparent 60% 70%, #f4f4f5 70% 78%, transparent 78%); }
.grip.tr { right: 0; cursor: nesw-resize; border-top-right-radius: 16px;
  background: linear-gradient(45deg, transparent 0 52%, #f4f4f5 52% 62%, transparent 62% 74%, #f4f4f5 74% 84%, transparent 84%); }
.grip.tl { left: 0; cursor: nwse-resize; border-top-left-radius: 16px;
  background: linear-gradient(315deg, transparent 0 52%, #f4f4f5 52% 62%, transparent 62% 74%, #f4f4f5 74% 84%, transparent 84%); }
`;

export const BASE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.knot { width: 28px; height: 28px; flex: none; overflow: visible; }
.knot path { fill: none; stroke: #ff7a59; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round;
  transition: d 700ms cubic-bezier(.34,1.56,.64,1); }
.knot.untangled path { d: path("${KNOT_UNTANGLED}"); }
.knot.wiggle { animation: wiggle 1.4s ease-in-out infinite; }
@keyframes wiggle { 0%,100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg) scale(1.05); } }
.card { font: 14px/1.45 "Roboto", "YouTube Sans", system-ui, sans-serif; color: #f4f4f5;
  background: #16181d; border: 1px solid rgba(255,255,255,.08); border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.3); }
button { font: inherit; color: inherit; cursor: pointer; border: 0; }
.btn { padding: 7px 14px; border-radius: 999px; background: rgba(255,255,255,.1); font-weight: 500;
  transition: background .15s, transform .12s; }
.btn:hover { background: rgba(255,255,255,.18); }
.btn:active { transform: scale(.94); }
.btn.primary { background: #ff7a59; color: #1b0f0b; }
.btn.primary:hover { background: #ff8f73; }
.x { width: 26px; height: 26px; border-radius: 50%; background: transparent; opacity: .6; font-size: 16px; line-height: 26px; }
.x:hover { opacity: 1; background: rgba(255,255,255,.1); }
`;

export const OFFER_CSS = `
.offer { position: absolute; right: 18px; bottom: 70px; display: flex; align-items: center; gap: 10px;
  padding: 10px 10px 10px 12px; max-width: min(480px, calc(100% - 36px)); pointer-events: auto; transform-origin: 90% 100%; }
.offer { cursor: pointer; }
.offer .msg { flex: 1; min-width: 150px; }
.offer .go { display: inline-flex; align-items: center; gap: 7px; padding: 7px 8px 7px 14px; font-weight: 600;
  box-shadow: 0 0 0 0 rgba(255,122,89,.5); animation: go-pulse 2s ease-out 0.6s 2; }
.offer .go kbd { color: #1b0f0b; background: rgba(0,0,0,.12); border-color: rgba(0,0,0,.25); margin: 0; }
@keyframes go-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,122,89,.55); } 70%, 100% { box-shadow: 0 0 0 10px rgba(255,122,89,0); } }
@media (prefers-reduced-motion: reduce) { .offer .go { animation: none; } }
.offer .thumb { width: 112px; height: auto; flex: none; border-radius: 8px; box-shadow: 0 0 0 1px rgba(255,255,255,.12); }
.offer .msg b { display: block; font-size: 14.5px; }
.offer .msg span { opacity: .7; font-size: 12.5px; }
.offer .actions { display: flex; gap: 6px; }
.offer .timer { position: absolute; left: 16px; right: 16px; bottom: 4px; height: 2px; border-radius: 2px;
  background: #ff7a59; opacity: .5; transform-origin: left; }
.marks-layer { position: absolute; z-index: 1; overflow: hidden; pointer-events: none; }
.marks { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
/* Spotlight: a soft-edged window, the rest of the picture dims (darker, never brighter). */
.spot { position: absolute; border-radius: 14px; transform-origin: center;
  box-shadow: 0 0 0 2px rgba(255,122,89,.9), 0 0 0 200vmax rgba(8,9,12,.58), 0 0 28px 6px rgba(8,9,12,.5); }
.pen { fill: none; stroke: #ff7a59; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
.pen.arrow { stroke-width: 4; }
.flow-trail { fill: none; stroke: rgba(255,122,89,.32); stroke-width: 7; stroke-linecap: round; }
.flow { fill: none; stroke: #ffd9cf; stroke-width: 4.5; stroke-linecap: round; stroke-dasharray: 0.1 14;
  animation: flow .8s linear infinite; filter: drop-shadow(0 0 3px rgba(255,122,89,.8)); }
@keyframes flow { to { stroke-dashoffset: -14.1; } }
.flow-head { fill: #ff7a59; }
.flow-end { fill: rgba(255,122,89,.22); stroke: #ff7a59; stroke-width: 2.5; }
.leader { stroke: rgba(255,255,255,.8); stroke-width: 1.5; stroke-linecap: round; }
.marks .label { font: 600 15px "Chalkboard SE", "Noteworthy", "Segoe Print", "Comic Sans MS", cursive;
  fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,.8); stroke-width: 4px; stroke-linejoin: round; }
@media (prefers-reduced-motion: reduce) { .flow { animation: none; stroke-dasharray: none; } }
.meter { position: absolute; z-index: 11; top: 14px; right: 14px; width: 330px; max-height: calc(100% - 28px); overflow: auto;
  padding: 10px 12px 12px; pointer-events: auto; font-size: 12.5px; display: flex; flex-direction: column; gap: 7px; }
.meter .m-head { display: flex; align-items: center; gap: 8px; cursor: grab; user-select: none; touch-action: none; }
.meter.dragging .m-head { cursor: grabbing; }
.meter.sized { overflow: auto; }
.meter .m-head b { flex: 1; font-size: 13px; }
.meter .m-face { display: block; width: 100%; height: 150px; flex: none; border-radius: 10px;
  background: radial-gradient(ellipse at 50% 45%, rgba(255,122,89,.07), rgba(255,255,255,.02) 70%); }
.meter .m-tag { font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #ff7a59; padding: 1px 6px; border-radius: 5px; background: rgba(255,122,89,.12); }
.meter .m-group { display: flex; flex-direction: column; gap: 6px; padding: 8px 9px; border-radius: 10px; background: rgba(255,255,255,.04); }
.meter .m-gt { display: flex; align-items: baseline; gap: 8px; }
.meter .m-gt b { font-size: 12.5px; }
.meter .m-gt small { opacity: .6; font-size: 11.5px; }
.meter .m-or { text-align: center; opacity: .45; font-size: 11px; margin: -3px 0; }
.meter .m-row { display: grid; grid-template-columns: 92px 1fr 44px; align-items: center; gap: 8px; }
.meter .m-row .name { font-variant-numeric: tabular-nums; white-space: nowrap; }
.meter .bar { position: relative; height: 12px; border-radius: 6px; background: rgba(255,255,255,.08); overflow: hidden; cursor: ew-resize; touch-action: none; }
.meter .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: 6px; background: #7d8597;
  transition: width .15s linear, background .2s; }
.meter .fill.hot { background: #ff7a59; }
.meter .tick { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1.5px; background: #fff; border-radius: 2px; box-shadow: 0 0 0 1px rgba(0,0,0,.4); }
.meter .hold { height: 3px; border-radius: 2px; background: #ff7a59; transform-origin: left; transform: scaleX(0); transition: transform .15s linear; }
.meter .num { text-align: right; font-variant-numeric: tabular-nums; opacity: .85; }
.meter .m-rule { opacity: .75; font-size: 12px; }
.meter .m-fire { display: none; padding: 8px 10px; border-radius: 10px; background: #ff7a59; color: #1b0f0b; font-weight: 700; font-size: 13.5px; letter-spacing: .02em; text-align: center; }
.meter .m-fire.on { display: block; }
.meter .m-log { opacity: .75; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.meter .m-log:empty, .meter .m-small:empty { display: none; }
.meter .m-small { opacity: .5; font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.35; }
.meter .m-counts { padding: 6px 9px; border-radius: 8px; background: rgba(255,255,255,.05); opacity: .8; }
.meter .m-counts.ok { opacity: 1; box-shadow: inset 2px 0 0 #ff7a59; }
.meter .m-note { opacity: .55; font-size: 11px; line-height: 1.4; }
.meter .m-foot { display: flex; justify-content: space-between; gap: 8px; }
.meter .m-foot .btn { padding: 4px 10px; font-size: 11.5px; }
${gripCss("meter")}
.flyer { position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; pointer-events: none; }
.toast { position: absolute; left: 16px; top: 16px; display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; pointer-events: auto; font-size: 13px; }
.toast label { display: flex; align-items: center; gap: 6px; opacity: .8; cursor: pointer; }
.toast .keys { display: flex; align-items: center; gap: 5px; opacity: .85; font-size: 12px; white-space: nowrap; }
kbd { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 6px; font: 600 11.5px system-ui;
  color: #f4f4f5; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18); border-bottom-width: 2px; }
.toast .keys kbd + kbd, .toast .keys kbd { margin-left: 4px; }
.toast input { accent-color: #ff7a59; }
`;

/* "▶ Play with it": a simulation's window, in the Room's layer (room.ts), outside the player. */
export const SIM_CSS = `
.sim { position: absolute; display: flex; flex-direction: column; pointer-events: auto; overflow: hidden; }
.sim.hidden { visibility: hidden; pointer-events: none; }
.sim .s-head { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px; border-bottom: 1px solid rgba(255,255,255,.07);
  cursor: grab; user-select: none; touch-action: none; }
.sim.dragging .s-head { cursor: grabbing; }
.sim.dragging, .sim.resizing { box-shadow: 0 22px 60px rgba(0,0,0,.6), 0 3px 10px rgba(0,0,0,.35); }
/* While dragging, the pointer must not fall into the simulation's frame. */
.sim.dragging iframe, .sim.resizing iframe { pointer-events: none; }
.sim .s-head .tri { color: #ff7a59; font-size: 12px; }
.sim .s-head b { flex: 1; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sim .s-body { position: relative; flex: 1; border-radius: 0 0 16px 16px; overflow: hidden; }
.sim iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #16181d; opacity: 0; transition: opacity .4s ease-out; }
.sim iframe.on { opacity: 1; }
.sim .building { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 20px; }
.sim .building .knot { width: 46px; height: 46px; }
.sim .building p { margin: 0; opacity: .85; font-size: 15px; max-width: 420px; }
.sim .building small { opacity: .5; }
.sim .prog { width: 260px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.08); overflow: hidden; }
.sim .prog i { display: block; height: 100%; width: 4%; background: #ff7a59; border-radius: 2px; transition: width .3s ease-out; }
${gripCss("sim")}
`;

export const PANEL_CSS = `
.panel { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; }
.head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 8px 16px; cursor: grab; user-select: none; touch-action: none; }
.panel.dragging .head { cursor: grabbing; }
.panel.dragging, .panel.resizing { box-shadow: 0 22px 60px rgba(0,0,0,.6), 0 3px 10px rgba(0,0,0,.35); }
.panel.collapsed .body, .panel.collapsed .foot, .panel.collapsed .grip { display: none; }
.panel.collapsed .head { padding-bottom: 14px; }
.head .min { font-size: 18px; line-height: 24px; }
${gripCss("panel")}
.head .title { flex: 1; font-weight: 600; font-size: 15px; }
.head .at { opacity: .55; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.body { flex: 1; overflow-y: auto; padding: 4px 18px 12px; scrollbar-width: thin; }
.text { font-size: 15px; line-height: 1.55; }
.text p { margin: 0 0 8px; }
.text ul { margin: 0 0 8px; padding-left: 20px; }
.text code { font: 13px ui-monospace, Menlo, monospace; background: rgba(255,255,255,.08); padding: 1px 5px; border-radius: 5px; }
.text a.ts { color: #8fb3ff; cursor: pointer; text-decoration: underline dotted; }
.text math { font-size: 1.08em; }
.text table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 13.5px; line-height: 1.4; }
.text th { text-align: left; font-weight: 600; color: #ffc2b2; border-bottom: 1px solid rgba(255,255,255,.14); }
.text th, .text td { padding: 5px 8px; vertical-align: top; }
.text tbody tr:nth-child(even) td { background: rgba(255,255,255,.035); }
/* A [[phrase]] whose Mark is on the frame: coral, and pointing at it makes the Mark wink. */
.text .ref { color: #ffc2b2; background: rgba(255,122,89,.16); border-radius: 5px; padding: 0 3px; margin: 0 -1px;
  box-decoration-break: clone; -webkit-box-decoration-break: clone; cursor: default; transition: background .15s; }
.text .ref:hover { background: rgba(255,122,89,.32); }
.text .ref.off { color: inherit; background: none; padding: 0; margin: 0; }
.text .caret { display: inline-block; width: 7px; height: 1.05em; margin-left: 2px; vertical-align: -2px;
  background: #ff7a59; border-radius: 2px; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.thread { display: flex; flex-direction: column; gap: 14px; padding-bottom: 4px; }
.turn.viewer { align-self: flex-end; max-width: 85%; padding: 7px 13px; border-radius: 16px 16px 4px 16px;
  background: rgba(255,122,89,.15); border: 1px solid rgba(255,122,89,.32); color: #ffe7e0; font-size: 14px; line-height: 1.4;
  white-space: pre-wrap; overflow-wrap: anywhere; }
.turn.unstuck + .turn.viewer { margin-top: 2px; }
.sketch { margin: 6px 0 4px; color: #f4f4f5; }
.figure-html { display: block; width: 100%; overflow: hidden; }
.sketch-svg { width: 100%; height: auto; display: block; overflow: visible; }
.sketch-svg text { font-family: "Chalkboard SE", "Noteworthy", "Segoe Print", "Comic Sans MS", cursive; }
.thinking { display: flex; gap: 6px; padding: 6px 0; }
.thinking i { width: 8px; height: 8px; border-radius: 50%; background: #ff7a59; animation: bob 1s ease-in-out infinite; }
.thinking i:nth-child(2) { animation-delay: .15s; } .thinking i:nth-child(3) { animation-delay: .3s; }
@keyframes bob { 0%,100% { transform: translateY(0); opacity: .5; } 50% { transform: translateY(-6px); opacity: 1; } }
.error { color: #ffb4a3; font-size: 13.5px; }
.play-btn { display: flex; align-items: center; gap: 12px; width: 100%; margin: 8px 0 2px; padding: 10px 14px; border-radius: 14px; text-align: left;
  background: rgba(255,122,89,.1); border: 1px solid rgba(255,122,89,.35); transition: background .15s, transform .12s; }
.play-btn:hover { background: rgba(255,122,89,.18); }
.play-btn:active { transform: scale(.98); }
.play-btn .tri { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 50%; padding-left: 2px;
  background: #ff7a59; color: #1b0f0b; font-size: 12px; }
.play-btn .lbl { display: flex; flex-direction: column; gap: 1px; }
.play-btn .lbl span { opacity: .7; font-size: 12.5px; line-height: 1.35; }
.play-btn.open { background: rgba(255,122,89,.22); }
.play-btn.open .tri { font-size: 0; }
.play-btn.open .tri::after { content: ""; width: 9px; height: 9px; border-radius: 2px; background: #1b0f0b; }
.play-btn.failed { opacity: .5; pointer-events: none; }
.play-btn.failed .tri { background: rgba(255,255,255,.2); }
.foot { padding: 10px 14px 14px; border-top: 1px solid rgba(255,255,255,.07); display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; }
.row .btn { flex: 1; padding: 9px 12px; }
.ask { display: flex; gap: 6px; }
.ask input { flex: 1; font: inherit; color: inherit; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
  border-radius: 999px; padding: 8px 14px; outline: none; }
.ask input:focus { border-color: #ff7a59; }
.check { position: absolute; left: 50%; top: 45%; width: 84px; height: 84px; margin: -42px 0 0 -42px; pointer-events: none; }
.check circle { fill: #ff7a59; }
.check path { fill: none; stroke: #1b0f0b; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
.timing { margin-top: 6px; font-size: 11px; opacity: .45; font-variant-numeric: tabular-nums; }
.card-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.card-list li { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.05); cursor: pointer; }
.card-list li:hover { background: rgba(255,255,255,.09); }
.card-list .t { color: #ff7a59; font-variant-numeric: tabular-nums; margin-right: 6px; font-weight: 600; }
.empty { opacity: .7; }
`;

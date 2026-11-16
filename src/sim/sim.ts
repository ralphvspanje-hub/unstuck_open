// The sandbox page for "▶ Play with it" (manifest.json "sandbox"). It has an opaque origin, no
// extension APIs, and a CSP with no network at all, so model-written code can run here but
// can't reach YouTube, the extension or the internet. The content script sends the page in;
// the guard inside it (src/core/sim.ts) reports "running" or the error back to the content script.
addEventListener("message", (e) => {
  if (e.source !== parent || !e.data?.unstuckSim || typeof e.data.html !== "string") return;
  document.open();
  document.write(e.data.html);
  document.close();
});
parent.postMessage({ unstuckSim: true, state: "ready" }, "*");

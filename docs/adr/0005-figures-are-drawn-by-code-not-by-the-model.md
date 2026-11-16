# Figures: the model describes, code draws, and HTML figures are checked on a render

The first Sketches were SVG that the model wrote coordinate by coordinate, blind. They came out abstract and unclear ("a triangle for a flying wing"), with labels on top of lines. On 12 Nov 2026 a side-by-side test on real explanations (`scripts/figure-test.ts`) compared SVG, HTML, both again after the model looked at a render of its own figure, and generated images. The look at the render fixed mechanical faults (raw `$math$`, overlapping labels), but not unclear pictures. HTML laid out labels most cleanly. Generated images were considered but not tried (the key's free tier has no image generation), and on 13 Nov they were dropped.

So an Explanation's Figure is one of three things:
- **A plot.** The model writes a small JSON description (formulas, values, a threshold, an arrow), and `src/core/plot.ts` draws it exactly. Formulas go through a tiny parser that handles arithmetic only, never `eval`.
- **An HTML figure**, for structures, steps and comparisons. The local server holds the `<figure>` section back from the stream, renders it in headless Chromium (Playwright, with scripts off and every request blocked), and shows the render to Flash-Lite. Flash-Lite answers OK or returns a fix, within a 7 s budget; after that the figure goes out unchecked. In the panel it is cleaned (no scripts, links, media or `url()`) and sits in its own shadow root.
- **Nothing**, for definitions and for physical things on the frame. There the Marks point at the real thing, and "Play with it" shows it in 3D.

The local server running a browser is deliberate. The content script can't turn HTML into an image reliably, and the server is on the laptop anyway.

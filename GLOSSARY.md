# Unstuck

A personal assistant that watches how its Viewer watches a video (a YouTube explainer, or a recorded Lecture) and offers help at the moments they need it, before they ask.

## Language

### People

**Viewer**:
The person watching the video and being helped.
_Avoid_: user, player, watcher

**Session**:
One video watched with Unstuck switched on, from switching on until the video ends or the Viewer leaves it.
_Avoid_: run, watch, visit

### Moments

**Stuck moment**:
A point in a video where the Viewer did not understand what was just said or shown.
_Avoid_: confusion, lost moment, trigger

**Missed moment**:
A stretch of a video that kept playing while the Viewer's attention was elsewhere, so they did not take it in.
_Avoid_: distraction, gap, absence

**Stuck candidate**:
A moment where the Signals suggest the Viewer may be stuck, still to be judged against what the video was saying.
_Avoid_: hint, suspicion, trigger

### The video

**Lecture**:
A recorded university lecture on a lecture host (Panopto), watched in its viewer page or embedded in a course site. Often long and slow, with slides, and with captions that are missing or poor.
_Avoid_: course video, recording

**Outline**:
A Lecture's slide titles and chapters with their times, as its host lists them.
_Avoid_: contents, table of contents, chapters list

**Lecture sound**:
The last few minutes of a Lecture's audio, kept on the Viewer's laptop and sent with an Explanation or a Recap, so the model can listen to what was said.
_Avoid_: recording, audio buffer

**Video map**:
A short account of a whole video, made once before helping: what it is about, its key terms and where they are introduced, and its Dense parts.
_Avoid_: summary, outline, index

**Dense part**:
A section of a video that the Video map marks as hard to follow.
_Avoid_: hard part, difficult section

### Signals

**Signal**:
Any observation of the Viewer used to spot a Stuck moment or a Missed moment: a Player action, leaving the tab, or a Face reading.
_Avoid_: event, trigger, cue

**Player action**:
Something the Viewer does with the video player: play, pause, rewind, skip ahead, change speed.
_Avoid_: interaction, input

**Face reading**:
A set of numbers describing the Viewer's face at one instant, such as brow position, gaze direction and distance to the screen. It is numbers, never an image.
_Avoid_: emotion, expression, face data

### Responses

**Offer**:
A small, dismissible prompt asking whether the Viewer wants help with a Stuck moment or a Missed moment. The video keeps playing while it is shown.
_Avoid_: bubble, nudge, popup, notification

**Explanation**:
A short answer that helps the Viewer past a Stuck moment.
_Avoid_: hint, answer, clarification

**Figure**:
The picture in one Explanation, which carries the explanation with the text as its caption: an exact plot of a curve or of values, or a small figure of a structure, steps or a comparison. Physical things on the frame get no Figure; Marks show them.
_Avoid_: sketch, drawing, diagram, image, illustration, visual

**Simulation**:
A small interactive model of the idea in one Explanation, made only when the Viewer asks for it with "Play with it": they move a value, an input or a rule and watch what happens.
_Avoid_: demo, widget, app, playground

**Room**:
The space Unstuck makes while its panel is open: the video moves beside the panel (and above a Simulation) and the rest of YouTube fades out, so nothing of Unstuck covers the video. It ends when the Viewer folds or closes the panel or plays the video, and everything goes back where it was.
_Avoid_: focus mode, study mode, split view, zoom out

**Mark**:
Something drawn over the paused video frame that shows the Viewer where a phrase of the Explanation is: an arrow pointing at one thing, an outline around one small thing, a spotlight on one area, or a flow from one thing to another. Each Mark belongs to one phrase in the text, which lights up when the Mark appears.
_Avoid_: annotation, highlight, pointer

**Ask**:
A request for an Explanation that the Viewer makes themselves, without an Offer. Every Ask is a Stuck moment that was not spotted.
_Avoid_: manual trigger, request, query

**Explanation outcome**:
Whether an Explanation helped: Got it, Simpler (the Viewer asked for a simpler version), or Rewound (the Viewer rewound again soon after).
_Avoid_: rating, feedback

**Recap**:
A short account of what was said during a Missed moment.
_Avoid_: summary, catch-up

**Offer outcome**:
What became of an Offer: Accepted, Dismissed (closed by the Viewer), Faded (shown while the Viewer was watching, left alone), or Unseen (shown while the Viewer was not watching).
_Avoid_: response, result, feedback

**Offer log**:
The record of every Offer and Ask, their outcomes and the Signals behind them, placed by video and by time in the video.
_Avoid_: history, analytics, telemetry

**Session card**:
The card shown when a Session ends, listing its Stuck moments and their Explanations.
_Avoid_: report, study notes, summary

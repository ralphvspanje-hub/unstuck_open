# The Room moves YouTube's own player

While the panel is open, the video has to get out from under Unstuck's windows. We move YouTube's real player (`#movie_player`). It becomes `position: fixed` at the spot the Room picked, everything beside its line of parents fades out, and a window `resize` event tells YouTube to lay its video out in the new box. YouTube does that only on resize events, and does it at once. The move is animated FLIP-style: the picture starts where it was and a transform glides it to the new spot. So YouTube lays the video out once, not once per frame, and the motion stays smooth.

Alternatives we did not choose:

- **Scaling the player with a CSS transform.** No layout work at all, but YouTube's controls and captions shrink with the picture, and the player can't leave its place in the page.
- **Moving the player into our own container.** The player belongs to YouTube's page code, and moving a media element in the DOM pauses or reloads it.
- **Copying frames into our own canvas.** No controls, captions or end screen.

## Consequences

- **No names of YouTube's elements.** The DOM around the player changes between YouTube experiments (sometimes there is an extra `ytw-player` wrapper). So the Room walks up from the player, fades every sibling and makes every parent see-through. Theatre mode moves the player to other parents, so the Room walks again when it changes.
- **Play and pause go through YouTube's player API.** YouTube's player keeps its own playing state and applies it again on every resize. A `<video>` element paused behind its back started playing again as soon as the Room moved it. So Unstuck pauses and plays with the player's own `pauseVideo` and `playVideo`, called from the page-world script over a DOM event, which runs synchronously.
- **Fullscreen is untested.** Automated Chromium won't go fullscreen. If YouTube makes the player itself the fullscreen element, the browser forbids resizing it. The Room then leaves the video alone, and the windows float over it.

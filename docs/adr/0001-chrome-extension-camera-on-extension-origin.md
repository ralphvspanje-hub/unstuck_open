# Run as a Chrome extension on youtube.com, with the camera on the extension's own page

Unstuck needs the frame on screen and timestamped captions, and only code running on youtube.com can get both: an embedded player hides its pixels from the host page, and YouTube blocks direct caption fetching (see 0003). So Unstuck is a Manifest V3 extension, not our own page around an embedded player. The camera does not run in the content script, because calling getUserMedia there would grant camera access to youtube.com itself. It runs in an extension-owned offscreen document, after a one-time permission grant in an extension tab.

## Considered Options

- **Own localhost page with the YouTube IFrame Player API**: quicker to start, but no access to frames (only via a screen-share prompt), no seek events, and transcripts would depend on a server that YouTube sometimes blocks.

# Unstuck: notes for agents

@AGENTS.md

## Language

Use the terms in `GLOSSARY.md` (Viewer, Session, Stuck moment, Missed moment, Stuck candidate, Offer, Explanation, Mark, Recap, Ask, Offer log...) in code, comments and docs. Decisions with reasons are in `docs/adr/`. Read them before "fixing" something that looks odd: captions switched on while hidden (0003), the camera on a separate extension page (0001), no face images to any model (0002).

## Commands

- `npm test`: unit tests (`src/core`). Run after any change there.
- `npm run typecheck`
- `npm run build`: builds `dist/`, then reload the extension in `chrome://extensions`.
- `npm run server`: local server, mock mode without a key.
- `npm run smoke`: end-to-end on real YouTube. Needs the server running. `HEADED=1` and `CAMERA=1` variants.

## Secrets

A Viewer's own key (ADR 0007) is typed by that person into the setup page, kept encrypted by `src/background/keystore.ts`, and sent only to their provider (ADR 0009); never handle one yourself. The local server's key lives only in its environment. Never write a key to a file, log it or echo it, and never commit `.env*`.

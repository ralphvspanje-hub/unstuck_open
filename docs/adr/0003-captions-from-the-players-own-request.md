# Read captions from the player's own caption request

Since 2025–2026, YouTube's caption endpoint returns empty results unless the request carries a proof-of-origin token that only the player creates, so fetching captions directly, from the extension or from a server, is unreliable. Unstuck switches captions on, hides them from view, and reads the caption data the player itself loads, including auto-generated captions. If that fails it falls back to reading the "Show transcript" panel. Captions being switched on while invisible is deliberate, not a bug.

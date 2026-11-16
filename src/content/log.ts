// The Offer log: every Stuck candidate the judge saw, every Offer and every Ask, with outcomes.
// Lives in the extension's storage on this laptop only. Numbers and text, never images.
import type { LogEntry } from "../core/types.ts";

const MAX = 3000;
let queue: Promise<void> = Promise.resolve();

function write(fn: (log: LogEntry[]) => LogEntry[]) {
  queue = queue.then(async () => {
    const { log = [] } = await chrome.storage.local.get("log");
    await chrome.storage.local.set({ log: fn(log as LogEntry[]).slice(-MAX) });
  });
  return queue;
}

export function addEntry(e: LogEntry) {
  return write((log) => [...log, e]);
}

export function updateEntry(id: string, patch: Partial<LogEntry>, opts: { keepFirst?: (keyof LogEntry)[] } = {}) {
  return write((log) =>
    log.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e, ...patch };
      for (const k of opts.keepFirst ?? []) if (e[k] !== undefined) (next as any)[k] = e[k];
      return next;
    }),
  );
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

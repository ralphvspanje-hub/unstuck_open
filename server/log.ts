// Server log: to the terminal and to .logs/server.log, so a debugging session can read it.
// Timings, model names, token counts and errors only. Never the key, never request bodies.
import { appendFileSync, mkdirSync } from "node:fs";

const dir = new URL("../.logs/", import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL("server.log", dir);

export function log(line: string) {
  console.log(line);
  try {
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

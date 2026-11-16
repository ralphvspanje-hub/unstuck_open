// Who may call the local server: only this extension, only on this laptop.
// Otherwise any website you visit could POST to 127.0.0.1 and spend the Gemini key.
import { createHash } from "node:crypto";

export type GuardInput = { method: string; host?: string; origin?: string; marker?: string };

export function checkRequest(req: GuardInput, opts: { port: number; extensionId: string }): string | null {
  const okHosts = [`127.0.0.1:${opts.port}`, `localhost:${opts.port}`];
  if (!req.host || !okHosts.includes(req.host)) return "bad host"; // blocks DNS rebinding
  if (req.method === "OPTIONS") return "no preflight"; // web pages never get a CORS yes
  if (req.origin !== `chrome-extension://${opts.extensionId}`) return "bad origin";
  if (req.marker !== "1") return "missing X-Unstuck header";
  return null;
}

/** Chrome's extension id from the manifest "key": sha256 of the DER key, first 32 hex chars mapped 0-f → a-p. */
export function extensionIdFromKey(base64Key: string): string {
  const hex = createHash("sha256").update(Buffer.from(base64Key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

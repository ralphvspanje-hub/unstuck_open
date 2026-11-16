// The Viewer's own Gemini key. Typed once on the setup page, never stored as plain text: it is
// encrypted with AES-GCM under a key that is generated in this browser profile, cannot be exported,
// and lives in IndexedDB; only the encrypted form goes into chrome.storage. Decrypted in memory when
// a model call needs it, and sent only to Google's Gemini API. Never logged.
const DB = "unstuck-keystore";
const STORE = "keys";
const LOCK = "lock";

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((ok, fail) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
  } finally {
    db.close();
  }
}

/** The lock: an AES key that can encrypt and decrypt here but never be read out. */
async function lock(): Promise<CryptoKey> {
  const have = await idb<CryptoKey | undefined>("readonly", (s) => s.get(LOCK) as IDBRequest<CryptoKey | undefined>);
  if (have) return have;
  const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idb("readwrite", (s) => s.put(made, LOCK));
  return made;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function saveKey(apiKey: string): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lock(), new TextEncoder().encode(apiKey)));
  await chrome.storage.local.set({ geminiKey: { iv: b64(iv), ct: b64(ct) } });
}

export async function loadKey(): Promise<string | null> {
  const { geminiKey } = (await chrome.storage.local.get("geminiKey")) as { geminiKey?: { iv: string; ct: string } };
  if (!geminiKey) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(geminiKey.iv) }, await lock(), unb64(geminiKey.ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null; // the lock is gone (profile data cleared): the key has to be typed again
  }
}

export async function hasKey(): Promise<boolean> {
  return Boolean((await chrome.storage.local.get("geminiKey")).geminiKey);
}

export async function clearKey(): Promise<void> {
  await chrome.storage.local.remove("geminiKey");
}

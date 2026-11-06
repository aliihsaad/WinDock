/** Durable HTTPS sessions only. HTTP credentials remain isolated and memory-only. */
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SESSION_TTL_MS } from "./auth.js";
import { writePrivateJson } from "./private-store.js";

const digest = (token) => createHash("sha256").update(token).digest("hex");
export async function secureSessionStore(directory, { now = Date.now, ttlMs = SESSION_TTL_MS } = {}) {
  const file = join(directory, "sessions.json");
  let entries = [];
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    if (saved.version !== 1 || !Array.isArray(saved.entries) || saved.entries.length > 128) throw new Error("Invalid session state");
    entries = saved.entries.filter((e) => /^[0-9a-f]{64}$/.test(e.hash) && Number.isSafeInteger(e.expires) && e.expires > now());
  } catch (error) { if (error.code !== "ENOENT") throw new Error("Saved secure pairing sessions are unreadable. Restore them or explicitly reset pairing."); }
  const save = (next) => { writePrivateJson(file, { version: 1, entries: next }); entries = next; };
  return {
    issue() {
      const active = entries.filter((e) => e.expires > now());
      if (active.length >= 128) throw Object.assign(new Error("Paired device limit reached. Remove existing pairings on the computer first."), { status: 409 });
      const token = randomBytes(32).toString("base64url");
      save([...active, { hash: digest(token), expires: now() + ttlMs }]);
      return token;
    },
    verify(token) { return typeof token === "string" && /^[\w-]{43}$/.test(token) && entries.some((e) => e.expires > now() && e.hash === digest(token)); },
    revokeAll() { save([]); },
    get size() { return entries.filter((e) => e.expires > now()).length; },
  };
}

/**
 * Pairing and session auth.
 *
 * A 4-digit PIN is shown on the host; a device posts it once and receives an
 * opaque session token. PIN comparison is constant-time, failures are counted
 * per client, and a client is locked out after a threshold. Loopback is trusted
 * so the tray app on the host itself does not have to pair with the machine the
 * user is already sitting at.
 */

import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const PIN_LENGTH = 4;
export const MAX_FAILS = 5;
export const LOCK_MS = 60_000;
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
export const COOKIE_NAME = "windock_session";

/** Cryptographically uniform PIN; avoids the modulo bias of randomBytes % 10. */
export function newPin(length = PIN_LENGTH) {
  let pin = "";
  for (let i = 0; i < length; i += 1) pin += String(randomInt(0, 10));
  return pin;
}

export function isValidPinShape(value, length = PIN_LENGTH) {
  return typeof value === "string" && new RegExp(`^\\d{${length}}$`).test(value);
}

/** Constant-time compare that never leaks length through early return. */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so timing does not distinguish length mismatch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function isLoopback(address) {
  if (typeof address !== "string" || !address) return false;
  const addr = address.startsWith("::ffff:") ? address.slice(7) : address;
  return addr === "127.0.0.1" || addr === "::1" || addr.startsWith("127.");
}

/** Per-client failure tracking with a time-boxed lockout. */
export function createLockout({ maxFails = MAX_FAILS, lockMs = LOCK_MS, now = Date.now } = {}) {
  const entries = new Map();

  function prune(at) {
    for (const [key, entry] of entries) {
      if (entry.until && entry.until <= at) entries.delete(key);
      else if (!entry.until && at - entry.last > lockMs) entries.delete(key);
    }
  }

  return {
    /** @returns {{locked:boolean, retryInMs:number}} */
    status(key) {
      const at = now();
      const entry = entries.get(key);
      if (!entry || !entry.until) return { locked: false, retryInMs: 0 };
      if (entry.until <= at) {
        entries.delete(key);
        return { locked: false, retryInMs: 0 };
      }
      return { locked: true, retryInMs: entry.until - at };
    },
    recordFailure(key) {
      const at = now();
      prune(at);
      const entry = entries.get(key) || { fails: 0, last: at, until: 0 };
      entry.fails += 1;
      entry.last = at;
      if (entry.fails >= maxFails) entry.until = at + lockMs;
      entries.set(key, entry);
      return { locked: Boolean(entry.until), fails: entry.fails };
    },
    recordSuccess(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}

/** Opaque session tokens with an expiry. */
export function createSessionStore({ ttlMs = SESSION_TTL_MS, now = Date.now } = {}) {
  const sessions = new Map();

  function prune(at) {
    for (const [token, expiry] of sessions) if (expiry <= at) sessions.delete(token);
  }

  return {
    issue() {
      const at = now();
      prune(at);
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, at + ttlMs);
      return token;
    },
    verify(token) {
      if (typeof token !== "string" || !token) return false;
      const expiry = sessions.get(token);
      if (expiry === undefined) return false;
      if (expiry <= now()) {
        sessions.delete(token);
        return false;
      }
      return true;
    },
    revokeAll() {
      sessions.clear();
    },
    get size() {
      prune(now());
      return sessions.size;
    },
  };
}

export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export function tokenFromRequest(req) {
  return parseCookies(req?.headers?.cookie)[COOKIE_NAME] || "";
}

export function sessionCookie(token, { secure = false, maxAgeMs = SESSION_TTL_MS } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * The authorization decision for one request.
 * `key` is the rate-limit bucket, normally the remote address.
 */
export function authorize({ req, sessions, lockout, remote, trustLoopback = true }) {
  if (trustLoopback && isLoopback(remote)) return { ok: true, via: "loopback" };
  const status = lockout.status(remote);
  if (status.locked) {
    return { ok: false, via: "locked", retryInMs: status.retryInMs, code: 429 };
  }
  if (sessions.verify(tokenFromRequest(req))) return { ok: true, via: "session" };
  return { ok: false, via: "unauthorized", code: 401 };
}

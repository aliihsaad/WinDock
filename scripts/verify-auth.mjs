/** G6: PIN auth admits the right code, rejects wrong codes, and locks out brute force. */
import { createChecker } from "./lib/assert.mjs";
import {
  newPin,
  isValidPinShape,
  safeEqual,
  isLoopback,
  createLockout,
  createSessionStore,
  parseCookies,
  sessionCookie,
  tokenFromRequest,
  authorize,
  MAX_FAILS,
  LOCK_MS,
  COOKIE_NAME,
} from "../src/auth.js";

const t = createChecker("auth");

// ---- PIN generation and shape ----
const pins = Array.from({ length: 400 }, () => newPin());
t.ok(pins.every((p) => /^\d{4}$/.test(p)), "every generated pin is exactly four digits");
t.ok(new Set(pins).size > 50, `generated pins vary (${new Set(pins).size} distinct of 400)`);
// Uniformity smoke test: a modulo-biased generator would starve some digits.
const digits = new Set(pins.join("").split(""));
t.equal(digits.size, 10, "all ten digits appear across generated pins");

for (const good of ["0000", "1234", "9999"]) t.ok(isValidPinShape(good), `${good} is a valid shape`);
for (const bad of ["", "12", "12345", "12a4", " 123", "1 23", null, 1234, "١٢٣٤"]) {
  t.ok(!isValidPinShape(bad), `invalid shape rejected: ${JSON.stringify(bad)}`);
}

// ---- constant-time comparison ----
t.ok(safeEqual("1234", "1234"), "identical pins compare equal");
t.ok(!safeEqual("1234", "1235"), "differing pins compare unequal");
t.ok(!safeEqual("1234", "123"), "different lengths compare unequal");
t.ok(!safeEqual("", "1234"), "empty input compares unequal");
t.ok(!safeEqual(null, "1234"), "null input compares unequal");
t.ok(!safeEqual(undefined, undefined) === false, "undefined pair does not throw");

// ---- loopback ----
for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.1.5"]) {
  t.ok(isLoopback(addr), `${addr} is loopback`);
}
for (const addr of ["192.168.1.40", "10.0.0.2", "", null, "::ffff:192.168.1.40", "8.8.8.8"]) {
  t.ok(!isLoopback(addr), `${addr} is not loopback`);
}

// ---- lockout ----
let clock = 1_000_000;
const lockout = createLockout({ now: () => clock });
const key = "192.168.1.55";
t.ok(!lockout.status(key).locked, "a fresh client is not locked");
for (let i = 1; i < MAX_FAILS; i += 1) {
  lockout.recordFailure(key);
  t.ok(!lockout.status(key).locked, `not locked after ${i} failure(s)`);
}
const final = lockout.recordFailure(key);
t.ok(final.locked, `locked after ${MAX_FAILS} failures`);
t.ok(lockout.status(key).locked, "status reports the lockout");
t.ok(lockout.status(key).retryInMs > 0, "lockout reports a positive retry delay");
t.ok(!lockout.status("192.168.1.99").locked, "lockout is per-client, not global");

clock += LOCK_MS + 1;
t.ok(!lockout.status(key).locked, "lockout expires after its window");

// A success must clear the counter so a legitimate user is not locked later.
const l2 = createLockout({ now: () => clock });
l2.recordFailure("a");
l2.recordFailure("a");
l2.recordSuccess("a");
for (let i = 1; i < MAX_FAILS; i += 1) l2.recordFailure("a");
t.ok(!l2.status("a").locked, "a successful pairing resets the failure count");

// ---- sessions ----
let sclock = 5_000_000;
const sessions = createSessionStore({ ttlMs: 1000, now: () => sclock });
const token = sessions.issue();
t.ok(typeof token === "string" && token.length >= 32, "issued token is long and opaque");
t.ok(sessions.verify(token), "issued token verifies");
t.ok(!sessions.verify("nope"), "unknown token does not verify");
t.ok(!sessions.verify(""), "empty token does not verify");
t.ok(!sessions.verify(null), "null token does not verify");
t.ok(sessions.issue() !== token, "each issued token is distinct");
sclock += 1001;
t.ok(!sessions.verify(token), "token stops verifying after its ttl");

const revocable = createSessionStore();
const rtok = revocable.issue();
t.ok(revocable.verify(rtok), "token verifies before revocation");
revocable.revokeAll();
t.ok(!revocable.verify(rtok), "regenerating the pin revokes every session");

// ---- cookies ----
const jar = parseCookies(`${COOKIE_NAME}=abc123; other=zzz`);
t.equal(jar[COOKIE_NAME], "abc123", "session cookie is parsed");
t.equal(jar.other, "zzz", "sibling cookies are parsed");
t.deepEqual(parseCookies(null), {}, "null cookie header yields an empty jar");
t.deepEqual(parseCookies("malformed"), {}, "malformed cookie header yields an empty jar");
// The real invariant is not the absence of a "__proto__" key — on a
// null-prototype jar that key is inert — but that nothing reaches
// Object.prototype and that the jar cannot inherit attacker-controlled values.
const hostileJar = parseCookies("__proto__=polluted; constructor=bad");
t.equal(Object.getPrototypeOf(hostileJar), null, "cookie jar has a null prototype");
t.equal({}.polluted, undefined, "Object.prototype is unpolluted after parsing");
t.equal({}.bad, undefined, "constructor key does not pollute Object.prototype");
t.equal(hostileJar.toString, undefined, "jar inherits nothing from Object.prototype");
// Positive control: the jar still stores ordinary cookies correctly.
t.equal(parseCookies("a=1").a, "1", "positive control: a normal cookie is still parsed");

const cookie = sessionCookie("tok");
t.ok(cookie.includes("HttpOnly"), "session cookie is HttpOnly");
t.ok(cookie.includes("SameSite=Lax"), "session cookie is SameSite=Lax");
t.ok(cookie.includes("Path=/"), "session cookie is path-scoped to the root");
t.ok(!cookie.includes("Secure"), "plain http cookie omits Secure");
t.ok(sessionCookie("tok", { secure: true }).includes("Secure"), "https cookie sets Secure");
t.equal(tokenFromRequest({ headers: { cookie: `${COOKIE_NAME}=xyz` } }), "xyz", "token is read from the request");
t.equal(tokenFromRequest({ headers: {} }), "", "absent cookie yields an empty token");

// ---- the authorize decision ----
const asess = createSessionStore();
const alock = createLockout();
const live = asess.issue();
const reqWith = (tok) => ({ headers: { cookie: tok ? `${COOKIE_NAME}=${tok}` : "" }, socket: {} });

t.ok(authorize({ req: reqWith(null), sessions: asess, lockout: alock, remote: "127.0.0.1" }).ok,
  "loopback is authorized without a session");
t.ok(authorize({ req: reqWith(live), sessions: asess, lockout: alock, remote: "192.168.1.5" }).ok,
  "a valid session is authorized from the LAN");

const denied = authorize({ req: reqWith("bogus"), sessions: asess, lockout: alock, remote: "192.168.1.5" });
t.ok(!denied.ok, "an invalid session is refused");
t.equal(denied.code, 401, "an invalid session yields 401");

const blocked = createLockout();
for (let i = 0; i < MAX_FAILS; i += 1) blocked.recordFailure("192.168.1.7");
const locked = authorize({ req: reqWith(live), sessions: asess, lockout: blocked, remote: "192.168.1.7" });
t.ok(!locked.ok, "a locked-out client is refused even with a valid session");
t.equal(locked.code, 429, "a locked-out client yields 429");

t.done("auth verification passed");

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
  createHostCheck,
  isLoopbackHost,
  GLOBAL_MAX_FAILS,
  GLOBAL_LOCK_MS,
  MAX_FAILS,
  LOCK_MS,
  COOKIE_NAME,
} from "../src/auth.js";

const t = createChecker("auth");

// ---- PIN generation and shape ----
const pins = Array.from({ length: 400 }, () => newPin());
t.ok(pins.every((p) => /^\d{6}$/.test(p)), "every generated pin is exactly six digits");
t.ok(new Set(pins).size > 50, `generated pins vary (${new Set(pins).size} distinct of 400)`);
// Uniformity smoke test: a modulo-biased generator would starve some digits.
const digits = new Set(pins.join("").split(""));
t.equal(digits.size, 10, "all ten digits appear across generated pins");

for (const good of ["000000", "123456", "999999"]) t.ok(isValidPinShape(good), `${good} is a valid shape`);
for (const bad of ["", "12", "1234", "12345", "1234567", "12a456", " 12345", "123 56", null, 123456, "١٢٣٤٥٦"]) {
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
for (const addr of ["127.evil.example", "127.invalid", "192.168.1.40", "10.0.0.2", "", null, "::ffff:192.168.1.40", "8.8.8.8"]) {
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
const reqWith = (tok, host = "localhost:8620") => ({ headers: { cookie: tok ? `${COOKIE_NAME}=${tok}` : "", host }, socket: {} });

t.ok(authorize({ req: reqWith(null), sessions: asess, lockout: alock, remote: "127.0.0.1" }).ok,
  "loopback is authorized without a session");
t.ok(authorize({ req: reqWith(null, "127.0.0.1:8620"), sessions: asess, lockout: alock, remote: "127.0.0.1" }).ok,
  "loopback by IP is authorized without a session");
const rebound = authorize({ req: reqWith(null, "evil.example:8620"), sessions: asess, lockout: alock, remote: "127.0.0.1" });
t.ok(!rebound.ok, "a loopback connection with a foreign Host (DNS rebinding) needs a session");
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

// ---- host check (DNS rebinding) ----
const hostOk = createHostCheck({ machine: "Desk-PC", extra: "dock.home.arpa:8620, DOCK-ALIAS.HOME.ARPA.:8620" });
for (const good of ["localhost", "localhost:8620", "127.0.0.1:8620", "192.168.1.40:8620", "[::1]:8620",
  "[fe80::1]:8620", "desk-pc:8620", "DESK-PC.local:8620", "dock.home.arpa:8620", "dock-alias.home.arpa.:8620", "localhost.", "desk-pc."]) {
  t.ok(hostOk(good), `Host ${good} is allowed`);
}
for (const bad of ["", null, undefined, "evil.example", "evil.example:8620", "127.0.0.1.nip.io:8620",
  "app.localhost", "desk-pc.evil.example", "localhost.evil.example", "a b", "attacker.example@localhost",
  "evil.example@127.0.0.1:8620", "evil.example/@localhost", "localhost/x", "localhost?x", "localhost#x", "[::1]x"]) {
  t.ok(!hostOk(bad), `Host ${JSON.stringify(bad)} is refused`);
}
t.ok(isLoopbackHost("localhost:1") && isLoopbackHost("[::1]:1") && isLoopbackHost("127.0.0.1"), "loopback Host names are recognised");
t.ok(!isLoopbackHost("127.evil.example") && !isLoopbackHost("app.localhost") && !isLoopbackHost("192.168.1.4") && !isLoopbackHost("evil.example"), "other Host names are not loopback");
t.ok(!isLoopbackHost("attacker.example@localhost"), "login details in a Host header can't pass as localhost");

// Machine names and explicitly configured aliases may contain underscores.
const underscoreHost = createHostCheck({ machine: "My_PC", extra: "MY_DOCK.home.arpa.:8620" });
for (const good of ["my_pc:8620", "MY_PC.local.", "my_dock.home.arpa:8620"]) {
  t.ok(underscoreHost(good), "underscored machine/allowlisted host is accepted: " + good);
}
for (const bad of ["other_pc", "my_pc.evil.example", "evil@my_pc", "my_pc/x", "my_pc?x", "my_pc#x"]) {
  t.ok(!underscoreHost(bad), "untrusted underscored host stays refused: " + bad);
}

// ---- host-wide failure budget ----
let gclock = 5_000_000;
const glock = createLockout({ now: () => gclock });
for (let i = 0; i < GLOBAL_MAX_FAILS; i += 1) glock.recordFailure(`10.0.${Math.floor(i / 4)}.${i}`);
const fresh = glock.status("10.9.9.9");
t.ok(fresh.locked && fresh.global, "rotating addresses trips the host-wide pairing pause");
const paired = authorize({ req: reqWith(live, "192.168.1.40:8620"), sessions: asess, lockout: glock, remote: "192.168.1.9" });
t.ok(paired.ok, "an already paired phone keeps working during the pairing pause");
gclock += GLOBAL_LOCK_MS + 1;
t.ok(!glock.status("10.9.9.9").locked, "the pairing pause expires");

t.done("auth verification passed");

import { createNowPlayingPoller } from "../public/now-playing.js";
import { createChecker } from "./lib/assert.mjs";
import { createWindowsProvider } from "../src/platform/windows.js";

const t = createChecker("now-playing");
const artwork = "data:image/jpeg;base64,/9j/2Q==";
const metadata = { title: "Track", artist: "Artist", playing: true };
for (const candidate of [artwork, null, "", "https://example.com/image.jpg", "data:image/svg+xml,<svg/>", "data:image/jpeg;base64,\"bad", "data:image/jpeg;base64," + "A".repeat(128 * 1024 + 24)]) {
  const provider = createWindowsProvider({ helperPath: "helper", exec: async () => ({ stdout: JSON.stringify({ ...metadata, artwork: candidate }) }) });
  t.deepEqual(await provider.nowPlaying(), candidate === artwork ? { ...metadata, artwork } : metadata, "media metadata survives absent/invalid artwork; only bounded JPEG data passes through");
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Media polling did not update");
    await sleep(5);
  }
}
let active = false, calls = 0, fail = false;
let media = { title: "First", artist: "Artist", playing: true };
const updates = [];
const poller = createNowPlayingPoller({
  intervalMs: 15,
  isActive: () => active,
  load: async () => { calls++; if (fail) throw new Error("temporary failure"); return media; },
  onChange: value => updates.push(value),
});
try {
  await sleep(50);
  t.equal(calls, 0, "inactive clients do not poll");
  active = true;
  await until(() => updates.length > 0);
  t.deepEqual(updates.at(-1), media, "active client fetches without manual refresh");
  media = { title: "Second", artist: "Other artist", playing: true };
  await until(() => updates.at(-1)?.title === "Second");
  t.deepEqual(updates.at(-1), media, "track and artist update automatically");
  media = { ...media, playing: false };
  await until(() => updates.at(-1)?.playing === false);
  t.equal(updates.at(-1).playing, false, "external pause updates automatically");
  media = null;
  await until(() => updates.at(-1) === null);
  t.equal(updates.at(-1), null, "ended session clears media");
  const previousUpdates = updates.length;
  fail = true;
  const previousCalls = calls;
  await until(() => calls > previousCalls + 1);
  t.equal(updates.length, previousUpdates, "failed requests preserve the last display");
  fail = false; media = { title: "Recovered", playing: true };
  await until(() => updates.at(-1)?.title === "Recovered");
  t.equal(updates.at(-1).title, "Recovered", "polling recovers after an error");
  active = false;
  const inactiveCalls = calls;
  await sleep(50);
  t.equal(calls, inactiveCalls, "polling pauses when hidden, disconnected or unpaired");
  media = { title: "Manual", playing: true };
  await poller.refresh();
  t.equal(updates.at(-1).title, "Manual", "explicit boot/resume refresh still works while inactive");
} finally { poller.stop(); }

let finish, slowCalls = 0;
const slow = createNowPlayingPoller({
  intervalMs: 10, isActive: () => true,
  load: () => { slowCalls++; return new Promise(resolve => { finish = resolve; }); },
  onChange: () => {},
});
try {
  const first = slow.refresh();
  t.equal(slow.refresh(), first, "manual and timer refresh share the pending request");
  await sleep(60);
  t.equal(slowCalls, 1, "a slow request does not accumulate more requests");
  finish(media); await first;
} finally { slow.stop(); }

let timedOut = false, recovered = false, timeoutUpdates = 0;
const timeout = createNowPlayingPoller({
  intervalMs: 15, timeoutMs: 30, isActive: () => true,
  load: signal => recovered ? Promise.resolve(media) : new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => { timedOut = true; recovered = true; reject(new Error("aborted")); }, { once: true });
  }),
  onChange: () => timeoutUpdates++,
});
try {
  await until(() => timeoutUpdates > 0);
  t.ok(timedOut, "unresponsive HTTP fetch is aborted");
  t.ok(timeoutUpdates > 0, "a timeout does not permanently block polling");
} finally { timeout.stop(); }
const stoppedCount = timeoutUpdates;
await sleep(50);
t.equal(timeoutUpdates, stoppedCount, "stopped poller never renders again");
t.done("now-playing verification passed");

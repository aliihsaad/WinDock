// Playwright CLI: run-code --filename=scripts/browser/now-playing.js
// Requires node scripts/now-playing-smoke-host.mjs and its app open in the browser.
async (page) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const check = (condition, message) => { if (!condition) throw new Error(message); console.log("PASS:", message); };
  const textIs = (selector, text) => page.waitForFunction(
    ({ selector, text }) => document.querySelector(selector)?.textContent === text,
    { selector, text }, { timeout: 5500 },
  );
  const fixture = "http://127.0.0.1:18624/state";
  const change = async (data) => {
    const response = await page.request.post(fixture, { data });
    if (!response.ok()) throw new Error("Fixture update failed");
    return response.json();
  };
  await change({ media: { title: "First track", artist: "First artist", playing: true }, delayMs: 0, fail: false });
  await page.setViewportSize({ width: 915, height: 412 });
  // Start with the current shell, including when re-running after a code change.
  await page.evaluate(async () => {
    localStorage.setItem("windock-layout", JSON.stringify({ immersive: false }));
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
  });
  await page.goto("http://127.0.0.1:18623");
  if (await page.locator("#pair").isVisible()) {
    await page.getByRole("textbox", { name: "PIN", exact: true }).fill("864213");
    await page.locator("#pair-form button[type=submit]").click();
  }
  await textIs("#conn", "Connected");
  await textIs(".np__title", "First track");
  await page.evaluate(() => {
    window.mediaRefreshClicks = 0;
    document.querySelector("#refresh").addEventListener("click", () => window.mediaRefreshClicks++);
  });
  let navigations = 0;
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
  // Observe a host track change without a reload, Refresh click or control action.
  const started = Date.now();
  await change({ media: { title: "Second track", artist: "Second artist", playing: true } });
  await textIs(".np__title", "Second track");
  await textIs(".np__artist", "Second artist");
  const trackChangeMs = Date.now() - started;
  console.log("Automatic track change:", trackChangeMs, "ms");
  await change({ media: { title: "Second track", artist: "Second artist", playing: false } });
  await textIs("#nowplaying .eyebrow", "Paused");
  console.log("PASS: external pause updated automatically");
  await change({ media: { title: "Second track", artist: "Second artist", playing: true } });
  await textIs("#nowplaying .eyebrow", "Now playing");
  console.log("PASS: external resume updated automatically");

  await page.locator("#nowplaying button").focus();
  await page.evaluate(() => { window.originalPlaybackButton = document.querySelector("#nowplaying button"); });
  await page.waitForTimeout(2200);
  check(await page.evaluate(() => window.originalPlaybackButton === document.querySelector("#nowplaying button") && document.activeElement === window.originalPlaybackButton), "unchanged media keeps the button and keyboard focus");
  await page.getByRole("button", { name: "Play / pause", exact: true }).click();
  await textIs("#nowplaying .eyebrow", "Paused");
  console.log("PASS: playback control updates its displayed state");

  await change({ media: null });
  await textIs("#nowplaying", "");
  console.log("PASS: ended media session clears automatically");
  await change({ media: { title: "Recovered track", artist: "Recovered artist", playing: true } });
  await textIs(".np__title", "Recovered track");
  // An HTTP outage must not blank the last known track or stop future updates.
  await page.route("**/api/nowplaying", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Temporary outage"}' }));
  await page.waitForTimeout(2200);
  check(await page.locator(".np__title").textContent() === "Recovered track", "temporary HTTP failure preserves the last track");
  await page.unroute("**/api/nowplaying");
  await change({ media: { title: "After outage", artist: "Artist", playing: true } });
  await textIs(".np__title", "After outage");
  console.log("PASS: updates recover after an HTTP failure");

  await change({ delayMs: 3500, resetCounts: true, media: { title: "Slow track", artist: "Slow artist", playing: true } });
  await textIs(".np__title", "Slow track");
  const slow = await (await page.request.get(fixture)).json();
  check(slow.maxActive === 1, "slow provider has only one request in flight");
  await change({ delayMs: 0 });
  await page.screenshot({ path: "output/playwright/now-playing-automatic.png" });
  check(await page.evaluate(() => window.mediaRefreshClicks) === 0, "no Refresh clicks during verification");
  check(navigations === 0, "no page reloads during verification");
  check(errors.length === 0, "no uncaught browser errors");
  console.log("NOW-PLAYING BROWSER REGRESSION PASSED");
  return { passed: true, trackChangeMs, refreshClicks: 0, reloads: navigations, maxConcurrentMediaRequests: slow.maxActive, browserErrors: errors };
}

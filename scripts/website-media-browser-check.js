// Exercise the real website adapter and iframe, without replacing media responses.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  context.setDefaultTimeout(12000);
  const checks = [], errors = [], deviceRequests = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  try {
    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/download-stats') deviceRequests.push(url.pathname);
    });
    tab.on('websocket', socket => deviceRequests.push(socket.url()));
    await tab.goto('http://127.0.0.1:4173');
    await tab.getByRole('button', { name: 'No thanks', exact: true }).click();
    const demo = tab.frameLocator('#demo-frame');
    await demo.locator('#app:not([hidden])').waitFor();
    let frame = tab.frames().find(item => item.url().endsWith('/demo/index.html'));
    const expectTrack = async (title, artist) => {
      await frame.waitForFunction(({ title, artist }) => document.getElementById('island-title').textContent === title && document.getElementById('qc-music-artist').textContent === artist, { title, artist });
      await frame.waitForFunction(() => ['island-artwork', 'qc-artwork'].every(id => { const img = document.getElementById(id); return !img.hidden && img.complete && img.naturalWidth === 160; }));
      check(await demo.locator('#qc-music-title').textContent() === title, `${title}: title and artist update in the notch and card`);
      const artwork = await demo.locator('#island-artwork').getAttribute('src');
      check(artwork.startsWith('data:image/jpeg;base64,') && artwork.length < 128 * 1024 && artwork === await demo.locator('#qc-artwork').getAttribute('src'), `${title}: matching bounded JPEG covers decode`);
      return artwork;
    };
    const first = await expectTrack('Golden Hour Drive', 'The Sample Tapes');
    await tab.locator('#experience').scrollIntoViewIfNeeded();
    await tab.locator('#experience').screenshot({ path: 'output/playwright/website-music-notch.png' });
    await tab.locator('#preview-music').click();
    await demo.locator('#controls[open]').waitFor();
    check((await tab.locator('#demo-note').textContent()).includes('silent'), 'Music shortcut opens controls and explains the silent preview');
    await demo.locator('#qc-music [data-key="media-next"]').click();
    const second = await expectTrack('Midnight Signals', 'Neon Archive');
    await demo.locator('#qc-music-toggle').click();
    await frame.waitForFunction(() => document.getElementById('island-artist').textContent === 'Paused');
    check(await demo.locator('#qc-music-toggle').getAttribute('aria-label') === 'Play', 'Pause updates the card and expanded notch');
    await demo.locator('#qc-music [data-key="media-next"]').click();
    const third = await expectTrack('Slow Tides', 'Coastal Sketches');
    check(await demo.locator('#qc-music-toggle').getAttribute('aria-label') === 'Play', 'Skipping a paused track preserves the paused state');
    check(new Set([first, second, third]).size === 3, 'Each fictional track has distinct cover art');
    await demo.locator('#qc-music-toggle').focus();
    await tab.keyboard.press('Enter');
    await frame.waitForFunction(() => document.getElementById('qc-music-toggle').getAttribute('aria-label') === 'Pause');
    check(true, 'Keyboard activation resumes playback');
    await demo.locator('#qc-music [data-key="media-next"]').click();
    check(await expectTrack('Golden Hour Drive', 'The Sample Tapes') === first, 'Next wraps to the first track with its original artwork');
    await demo.locator('#qc-music [data-key="media-previous"]').click();
    check(await expectTrack('Slow Tides', 'Coastal Sketches') === third, 'Previous wraps to the last track');
    await demo.locator('#toast').waitFor({ state: 'hidden' });
    await tab.locator('#experience').screenshot({ path: 'output/playwright/website-music-controls.png' });
    await tab.locator('#preview-touchpad').click();
    await demo.locator('#input-pad[open]').waitFor();
    await tab.locator('#preview-music').click();
    await demo.locator('#controls[open]').waitFor();
    check(await demo.locator('#input-pad').evaluate(node => !node.open), 'Music shortcut switches cleanly from another demo panel');
    await tab.setViewportSize({ width: 390, height: 844 });
    await tab.locator('#preview-music').click();
    check(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The added shortcut fits the phone layout without horizontal overflow');
    check(await demo.locator('#qc-music').isVisible(), 'The music card remains visible inside the phone preview');
    await tab.locator('#experience').screenshot({ path: 'output/playwright/website-music-phone.png' });
    const command = verb => frame.evaluate(async verb => {
      const { fetch } = await import('../preview-transport.js');
      return (await fetch('/api/control', { method: 'POST', body: JSON.stringify({ verb }) })).status;
    }, verb);
    check(await command('media-stop') === 200, 'The demo handles Stop');
    await frame.waitForFunction(() => document.getElementById('quick-controls-open').dataset.media === 'false');
    check(await demo.locator('#qc-music-title').textContent() === 'Nothing playing', 'Stop clears the song and collapses the notch');
    await demo.locator('#qc-music-toggle').click();
    await expectTrack('Slow Tides', 'Coastal Sketches');
    check(await demo.locator('#qc-music-toggle').getAttribute('aria-label') === 'Pause', 'Play after Stop restores the current song');
    check(await command('shutdown') === 409, 'Unrelated PC commands remain unavailable in the demo');
    check(await demo.locator('audio, video').count() === 0 && deviceRequests.length === 0, 'Music remains silent and makes no host API or WebSocket requests');
    await tab.reload();
    await demo.locator('#app:not([hidden])').waitFor();
    frame = tab.frames().find(item => item.url().endsWith('/demo/index.html'));
    await frame.waitForFunction(() => document.getElementById('island-title')?.textContent === 'Golden Hour Drive');
    check(true, 'Reload resets the sample playlist');
    check(errors.length === 0, `No JavaScript errors: ${errors.join('; ')}`);
    await page.evaluate(report => { window.__websiteMediaReview = report; }, { passed: checks.length, checks });
    console.log(JSON.stringify({ passed: checks.length, checks }));
  } finally { await context.close(); }
}

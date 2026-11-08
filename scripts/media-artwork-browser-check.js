// Local demo only: fixture media and playback commands never touch real PC playback.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 844, height: 390 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(7000);
  const checks = [], errors = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  try {
    const pictures = await page.evaluate(() => ['#ba6a39', '#266d84'].map(color => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
      const paint = canvas.getContext('2d'); paint.fillStyle = color; paint.fillRect(0, 0, 160, 160);
      paint.fillStyle = '#ffffff77'; paint.beginPath(); paint.arc(80, 80, 45, 0, Math.PI * 2); paint.fill();
      return canvas.toDataURL('image/jpeg');
    }));
    const live = await page.evaluate(() => window.__liveMedia || null);
    const first = live?.artwork ? { ...live, playing: true } : { title: 'Evening drive', artist: 'WinDock preview', playing: true, artwork: pictures[0] };
    await context.addInitScript(media => { window.__mediaFixture = media; window.__mediaCommands = []; }, first);
    await context.route('**/demo/app.js', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('const dockFetch = fetch, DockWebSocket = WebSocket, nativeTransport = false;', `
        const DockWebSocket = WebSocket, nativeTransport = false;
        async function dockFetch(url, options) {
          if (url === '/api/nowplaying') return new Response(JSON.stringify({ nowPlaying: window.__mediaFixture }));
          if (url === '/api/control') {
            const { verb } = JSON.parse(options.body);
            if (verb.startsWith('media-')) {
              window.__mediaCommands.push(verb);
              if (verb === 'media-play-pause') window.__mediaFixture.playing = !window.__mediaFixture.playing;
              return new Response(JSON.stringify({ ok: true, verb }));
            }
          }
          return fetch(url, options);
        }
      `);
      await route.fulfill({ response, body });
    });
    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto('http://127.0.0.1:4173/demo/index.html');
    await tab.locator('#app:not([hidden])').waitFor();
    await tab.waitForFunction(title => document.getElementById('island-title').textContent === title, first.title);
    await tab.waitForFunction(() => ['island-artwork', 'qc-artwork'].every(id => { const image = document.getElementById(id); return !image.hidden && image.naturalWidth > 0; }));
    check(true, 'Artwork decodes in both the notch and music card');
    for (const size of [{ width: 844, height: 390 }, { width: 640, height: 320 }, { width: 568, height: 320 }]) {
      await tab.setViewportSize(size);
      const notch = await tab.locator('#quick-controls-open').boundingBox();
      const tiles = await tab.locator('#dock .tile').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      check(notch.width === 312 && notch.height >= 44 && notch.x >= 0 && notch.x + notch.width <= size.width, `Expanded notch and touch target fit ${size.width}x${size.height}`);
      check(tiles.every(top => top >= notch.y + notch.height), `Expanded notch does not overlap dock tiles at ${size.width}x${size.height}`);
      const artwork = await tab.locator('#island-artwork').boundingBox();
      check(artwork.width === 27 && artwork.height === 27, 'Notch artwork keeps its compact square crop');
      if (size.width !== 640) await tab.screenshot({ path: `output/playwright/music-notch-${size.width}.png` });
    }
    await tab.locator('#quick-controls-open').click();
    check(await tab.locator('#controls').evaluate(el => el.open), 'Tapping the expanded notch opens quick controls');
    await tab.screenshot({ path: 'output/playwright/music-card-artwork.png' });
    await tab.locator('#qc-music-toggle').click();
    await tab.waitForFunction(() => document.getElementById('island-artist').textContent === 'Paused');
    check(await tab.locator('#qc-music-toggle').getAttribute('aria-label') === 'Play', 'Paused media remains visible with a working resume button');
    check(await tab.locator('#qc-artwork').getAttribute('src') === first.artwork, 'Pause preserves the loaded cover');
    await tab.locator('#qc-music-toggle').click();
    await tab.waitForFunction(() => document.getElementById('qc-music-toggle').getAttribute('aria-label') === 'Pause');
    await tab.locator('#qc-music [data-key="media-next"]').click();
    await tab.locator('#qc-music [data-key="media-previous"]').click();
    check(JSON.stringify(await tab.evaluate(() => window.__mediaCommands)) === JSON.stringify(['media-play-pause', 'media-play-pause', 'media-next', 'media-previous']), 'All playback buttons send exactly the intended commands');
    await tab.keyboard.press('Escape');
    await tab.evaluate(artwork => { window.__mediaFixture = { title: '<b>A very long second track title that must stay inside the glass notch</b>', artist: 'Second artist', playing: true, artwork }; }, pictures[1]);
    await tab.waitForFunction(() => document.getElementById('island-title').textContent.startsWith('<b>'));
    await tab.waitForFunction(artwork => document.getElementById('island-artwork').getAttribute('src') === artwork && !document.getElementById('island-artwork').hidden, pictures[1]);
    check(await tab.locator('#island-title b').count() === 0, 'Track titles remain plain text');
    check(await tab.locator('#island-title').evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis'), 'Long titles truncate inside the notch');
    await tab.evaluate(() => { window.__mediaFixture.artwork = 'data:image/jpeg;base64,/9j/2Q=='; });
    await tab.waitForFunction(() => document.getElementById('island-artwork').hidden && !document.getElementById('island-art-fallback').hidden);
    check(await tab.locator('#qc-artwork').evaluate(el => el.hidden), 'Invalid image data falls back without losing track metadata');
    await tab.evaluate(() => { document.documentElement.classList.add('perf'); });
    check(await tab.locator('.controls-island').evaluate(el => getComputedStyle(el).backdropFilter) === 'none', 'Performance mode removes the notch blur');
    await tab.evaluate(() => { window.__mediaFixture = null; });
    await tab.waitForFunction(() => document.getElementById('quick-controls-open').dataset.media === 'false');
    check((await tab.locator('#quick-controls-open').boundingBox()).width === 128, 'Ending playback restores the original compact notch');
    check(await tab.locator('#quick-controls-open').getAttribute('aria-label') === 'Open quick controls', 'The idle notch restores its accessible label');
    check(errors.length === 0, `No JavaScript errors: ${errors.join('; ')}`);
    await page.evaluate(report => { window.__mediaArtworkReview = report; }, { passed: checks.length, checks });
    console.log(JSON.stringify({ passed: checks.length, checks }));
  } finally { await context.close(); }
}

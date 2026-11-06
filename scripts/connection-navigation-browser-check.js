// Navigation visibility and compatibility; the Android bridge is simulated only in this demo.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 844, height: 390 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(6000);
  const results = [], errors = [];
  const check = (value, label) => { if (!value) throw new Error(label); results.push(label); };
  try {
    await context.route('**/demo/app.js', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('window.WinDockAndroid = { showPcPicker: showPreviewPcPicker };', `
        window.__connectionsOpened = 0;
        window.WinDockAndroid = location.search.includes('native') ? {
          showConnectionSettings() { window.__connectionsOpened++; },
          showPcPicker: showPreviewPcPicker, showKeyboard() {}
        } : location.search.includes('legacy') ? { showPcPicker: showPreviewPcPicker } : undefined;`);
      await route.fulfill({ response, body });
    });
    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto('http://127.0.0.1:4173/demo/index.html?native');
    await tab.locator('#app:not([hidden])').waitFor();
    for (const size of [{width:844,height:390},{width:640,height:320},{width:568,height:320}]) {
      await tab.setViewportSize(size);
      const entry = await tab.locator('#connection-open').boundingBox();
      const controls = await tab.locator('#quick-controls-open').boundingBox();
      const tiles = await tab.locator('#dock').boundingBox();
      check(entry && controls && tiles && entry.height >= 44 && entry.x >= 0 && entry.x + entry.width <= controls.x && entry.y + entry.height <= tiles.y,
        `Connection is reachable and clear of controls and tiles at ${size.width}x${size.height}`);
    }
    await tab.locator('#connection-open').click();
    check(await tab.evaluate(() => window.__connectionsOpened) === 1, 'One tap opens the native connection destination');
    await tab.locator('#drawer-open').click();
    check(await tab.locator('#drawer-switch-pc').isHidden(), 'New clients have a single connection entry');
    await tab.locator('#drawer-close').click();
    await tab.evaluate(() => { const control = document.getElementById('immersive'); control.checked=false; control.dispatchEvent(new Event('change', {bubbles:true})); });
    await tab.locator('.bar').waitFor();
    const entry = await tab.locator('#connection-open').boundingBox();
    const bar = await tab.locator('.bar').boundingBox();
    check(entry.y + entry.height <= bar.y, 'Classic layout reserves space for Connection');
    await tab.evaluate(() => { document.getElementById('app').hidden=true; document.getElementById('pair').hidden=false; });
    check(await tab.locator('#connection-open').isVisible(), 'Connection is available on the PIN page too');
    await tab.goto('http://127.0.0.1:4173/demo/index.html?legacy');
    await tab.locator('#app:not([hidden])').waitFor();
    check(await tab.locator('#connection-open').isHidden(), 'Older Android clients do not get an unsupported button');
    check(await tab.locator('#drawer-switch-pc').getAttribute('hidden') === null, 'Older Android clients retain Switch PC');
    await tab.goto('http://127.0.0.1:4173/demo/index.html?browser');
    await tab.locator('#app:not([hidden])').waitFor();
    check(await tab.locator('#connection-open').isHidden() && await tab.locator('#drawer-switch-pc').isHidden(), 'Browser clients remain unchanged');
    check(!errors.length, 'No JavaScript runtime errors');
    return { passed: results.length, checks: results };
  } finally { await context.close(); }
}

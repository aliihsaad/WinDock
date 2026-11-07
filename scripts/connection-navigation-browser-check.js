// Exercise the shared drawer with current, older and absent Android bridges.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 844, height: 390 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(6000);
  const results = [], errors = [];
  const check = (value, label) => { if (!value) throw new Error(label); results.push(label); };
  try {
    await context.route('**/demo/app.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      const body = source.replace(/^window\.WinDockAndroid = .*;$/m, `
        window.__connectionsOpened = 0; window.__pickersOpened = 0;
        window.WinDockAndroid = location.search.includes('native') ? {
          showConnectionSettings() { window.__connectionsOpened++; },
          showPcPicker() { window.__pickersOpened++; }, showKeyboard() {}
        } : location.search.includes('legacy') ? { showPcPicker() { window.__pickersOpened++; } } : undefined;`);
      check(body !== source, 'The test installs its simulated Android bridge');
      await route.fulfill({ response, body });
    });
    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto('http://127.0.0.1:4175/demo/index.html?native');
    await tab.locator('#app:not([hidden])').waitFor();
    check(await tab.locator('#connection-open').isHidden(), 'Connection stays inside the closed drawer');
    for (const size of [{width:844,height:390},{width:640,height:320},{width:568,height:320}]) {
      await tab.setViewportSize(size);
      await tab.locator('#drawer-open').click();
      await tab.locator('#drawer').evaluate(async drawer => {
        await Promise.all(drawer.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
      });
      const connection = await tab.locator('#connection-open').boundingBox();
      const picker = await tab.locator('#drawer-switch-pc').boundingBox();
      const actions = await tab.locator('.drawer-actions').boundingBox();
      check(connection && picker && actions && connection.height >= 44 && picker.height >= 44 &&
        Math.abs(connection.y-picker.y) < 1 && picker.x+picker.width <= connection.x &&
        connection.y >= actions.y+actions.height && connection.x+connection.width <= size.width &&
        connection.y+connection.height <= size.height,
        `Both actions sit side by side in the drawer footer at ${size.width}x${size.height}`);
      if(size.width===844) await tab.screenshot({path:'output/playwright/drawer-connection-actions.png'});
      await tab.locator('#drawer-close').click();
    }
    await tab.locator('#drawer-open').click();
    await tab.locator('#drawer-switch-pc').click();
    check(await tab.evaluate(() => window.__pickersOpened===1 && window.__connectionsOpened===0 && !document.getElementById('drawer').open), 'Switch PC closes the drawer and opens only the quick picker');
    await tab.locator('#drawer-open').click();
    await tab.locator('#connection-open').click();
    check(await tab.evaluate(() => window.__connectionsOpened===1 && window.__pickersOpened===1 && !document.getElementById('drawer').open), 'Connection closes the drawer and opens only connection settings');
    await tab.evaluate(() => { const control = document.getElementById('immersive'); control.checked=false; control.dispatchEvent(new Event('change', {bubbles:true})); });
    await tab.locator('#swipe-settings').click();
    check(await tab.locator('#connection-open').isVisible() && await tab.locator('#drawer-switch-pc').isVisible(), 'Classic layout retains both drawer actions');
    await tab.goto('http://127.0.0.1:4175/demo/index.html?legacy');
    await tab.locator('#app:not([hidden])').waitFor();
    await tab.locator('#drawer-open').click();
    check(await tab.locator('#connection-open').isHidden() && await tab.locator('#drawer-switch-pc').isVisible(), 'Older Android clients retain only supported Switch PC');
    await tab.locator('#drawer-switch-pc').click();
    check(await tab.evaluate(() => window.__pickersOpened===1), 'Older Android picker still opens');
    await tab.goto('http://127.0.0.1:4175/demo/index.html?browser');
    await tab.locator('#app:not([hidden])').waitFor();
    await tab.locator('#drawer-open').click();
    check(await tab.locator('#connection-open').isHidden() && await tab.locator('#drawer-switch-pc').isHidden(), 'Browser clients have no unsupported native actions');
    check(!errors.length, 'No JavaScript runtime errors');
    return { passed: results.length, checks: results };
  } finally { await context.close(); }
}

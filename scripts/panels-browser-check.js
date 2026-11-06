// Isolated demo tests: simulated native bridge and control responses only.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 844, height: 390 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(6000);
  const results = [], errors = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); results.push(name); };
  try {
    await context.route('**/demo/app.js', async route => {
      const response = await route.fetch();
      let body = await response.text();
      body = body.replace('import { fetch, WebSocket,', 'import { fetch as previewFetch, WebSocket,');
      body = body.replace('window.WinDockAndroid = { showPcPicker: showPreviewPcPicker };', `
        window.__filesOpened = 0;
        window.WinDockAndroid = { showPcPicker: showPreviewPcPicker,
          ...(location.search.includes('android') ? { showKeyboard() {}, showPhoneSettings() {}, openFiles() { window.__filesOpened++; } } : {}) };
        async function fetch(url, options) {
          if (url === '/api/state') {
            const state = await (await previewFetch(url, options)).json();
            return new Response(JSON.stringify({ ...state, allowDestructive: true }), { headers: { 'content-type': 'application/json' } });
          }
          if (url === '/api/control' && window.__controlFixture) {
            window.__controlCalls = (window.__controlCalls || 0) + 1;
            return new Response(JSON.stringify(window.__controlFixture.body), { status: window.__controlFixture.status || 200, headers: { 'content-type': 'application/json' } });
          }
          return previewFetch(url, options);
        }
      `);
      await route.fulfill({ response, body });
    });
    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto('http://127.0.0.1:4173/demo/index.html');
    await tab.locator('#app:not([hidden])').waitFor();
    await tab.locator('#drawer-open').click();
    check(await tab.locator('.drawer-actions button').count() === 4, 'Drawer has four clear destinations');
    check(await tab.locator('#drawer-edit').innerText() === 'Edit dock', 'Edit dock label explains the action');
    check(await tab.locator('#drawer-updates [data-icon]').getAttribute('data-icon') === 'updates', 'Updates has its own download icon');
    check(await tab.locator('#drawer-fullscreen').count() === 0, 'No redundant fullscreen action in drawer');
    await tab.waitForTimeout(250);
    await tab.screenshot({ path: 'output/playwright/simplified-drawer.png' });
    await tab.locator('#drawer-settings').click();
    check(await tab.locator('#fullscreen').isVisible(), 'Fullscreen remains available in browser Appearance');
    await tab.locator('[data-close="settings"]').click();
    await tab.goto('http://127.0.0.1:4173/demo/index.html?android');
    await tab.locator('#app:not([hidden])').waitFor();
    await tab.locator('#drawer-open').click(); await tab.locator('#drawer-settings').click();
    check(await tab.locator('#fullscreen').isHidden(), 'Native Android hides fullscreen');
    check(await tab.locator('#phone-options').isVisible(), 'Native phone settings remain accessible');
    await tab.locator('[data-close="settings"]').click();
    await tab.locator('#quick-controls-open').click();
    check(await tab.locator('#controls-grid .control-card').count() === 3, 'Primary controls contain Sound, Playback and Display only');
    check(await tab.locator('.quick-controls-shortcuts button:visible').count() === 4, 'Android has all four compact shortcuts');
    for (const size of [{ width: 844, height: 390 }, { width: 640, height: 320 }, { width: 568, height: 320 }]) {
      await tab.setViewportSize(size);
      await tab.waitForTimeout(250); // Measure the settled curtain, after its entrance animation.
      const buttons = await tab.locator('#controls button:visible').evaluateAll(nodes => nodes.map(el => {
        const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      }));
      check(buttons.every(r => r.left >= 0 && r.right <= size.width && r.top >= 0 && r.bottom <= size.height), `All primary controls and shortcuts fit ${size.width}x${size.height}`);
      check(buttons.every(r => r.width >= 40 && r.height >= 40), `Tap targets stay usable at ${size.width}x${size.height}`);
    }
    await tab.setViewportSize({ width: 844, height: 390 });
    await tab.screenshot({ path: 'output/playwright/controls-android-preview.png' });
    const brightness = tab.locator('#controls-grid [data-key="brightness-set"][data-value="50"]');
    await tab.evaluate(() => window.__controlFixture = { body: { ok: true, warning: 'hdr-active' } });
    await brightness.click();
    await tab.waitForFunction(() => document.querySelector('#toast').dataset.warning === 'true');
    check(await tab.locator('#toast').innerText() === 'Command sent. HDR may prevent the brightness from changing.', 'HDR warning is contextual and useful');
    check(await tab.locator('#toast').evaluate(el => el.parentElement.id === 'controls'), 'HDR warning stays visible above the dialog');
    check(await brightness.isEnabled(), 'Warning does not block brightness controls');
    await tab.screenshot({ path: 'output/playwright/controls-hdr-warning.png' });
    await tab.locator('#controls-grid [data-key="volume-up"]').click();
    await tab.waitForFunction(() => document.querySelector('#toast').textContent === 'Control sent');
    check(await tab.locator('#toast').getAttribute('data-warning') === 'false', 'Warning does not stick to unrelated controls');
    for (const body of [{ ok: true }, { ok: true, warning: 'unknown' }]) {
      await tab.evaluate(body => window.__controlFixture = { body }, body);
      await brightness.click();
      await tab.waitForFunction(() => document.querySelector('#toast').textContent === 'Control sent');
      check(await tab.locator('#toast').getAttribute('data-warning') === 'false', 'Older hosts and unknown warning codes keep normal success');
    }
    await tab.evaluate(() => window.__controlFixture = { status: 503, body: { error: 'Display brightness unavailable' } });
    await brightness.click();
    await tab.waitForFunction(() => document.querySelector('#toast').dataset.error === 'true');
    check(await tab.locator('#toast').innerText() === 'Display brightness unavailable', 'Actual brightness failures remain error feedback');
    await tab.locator('#quick-power').click();
    const before = await tab.evaluate(() => window.__controlCalls);
    for (const verb of ['lock', 'sleep', 'restart', 'shutdown']) {
      await tab.locator(`#power-controls [data-key="${verb}"]`).click();
      check(await tab.locator('#confirm').isVisible(), verb + ' still requires confirmation');
      await tab.locator('#confirm-cancel').click();
    }
    check(await tab.evaluate(() => window.__controlCalls) === before, 'Cancelled power actions never send commands');
    // Same operation as Android Back: close the last open sheet.
    await tab.evaluate(() => [...document.querySelectorAll('dialog[open]')].at(-1).close());
    check(await tab.locator('#controls').isVisible() && await tab.locator('#power-controls').isHidden(), 'Android Back returns from Power to quick controls');
    await tab.locator('#quick-files').click();
    check(await tab.evaluate(() => window.__filesOpened) === 1, 'Files & Media opens through the existing Android bridge');
    check(await tab.locator('#controls').isHidden(), 'Files shortcut dismisses curtain');
    check(!errors.length, 'No JavaScript runtime errors');
    return { passed: results.length, checks: results };
  } finally { await context.close(); }
}

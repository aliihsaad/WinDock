// Run with playwright-cli run-code after starting scripts/website-server.mjs.
async (page) => {
  const browser = page.context().browser(), results = [], contexts = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); results.push(name); };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    contexts.push(context);
    await context.addInitScript(() => {
      window.realClipboardCalls = 0;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        read() { window.realClipboardCalls++; throw new Error('Real clipboard must not be read'); },
        readText() { window.realClipboardCalls++; throw new Error('Real clipboard must not be read'); },
        write() { window.realClipboardCalls++; throw new Error('Real clipboard must not be written'); },
        writeText() { window.realClipboardCalls++; throw new Error('Real clipboard must not be written'); },
      } });
    });
    const tab = await context.newPage(), errors = [], clipboardRequests = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('request', request => { if (request.url().includes('/api/clipboard')) clipboardRequests.push(request.url()); });
    await tab.goto('http://127.0.0.1:4173');
    await tab.getByRole('button', { name: 'No thanks', exact: true }).click();
    const demo = tab.frameLocator('#demo-frame');
    await demo.locator('#app:not([hidden])').waitFor();
    check(await tab.locator('.release-highlights article').count() === 4, 'Dedicated release section has four feature highlights');
    check(!(await tab.locator('#next-release').innerText()).includes('IN TESTING'), 'Release section introduces 0.2.5 without a testing label');
    await tab.locator('#download-windows:not([aria-disabled="true"])').waitFor();
    for (const id of ['download-windows', 'download-android', 'download-linux-arch', 'download-linux-deb']) {
      check((await tab.locator('#' + id).getAttribute('href')).includes('/v0.2.4-preview.1/'), id + ' preserves the current public download');
    }
    await tab.locator('[data-preview-clipboard]').click();
    await demo.locator('.pc-clipboard__item').first().waitFor();
    check(await demo.locator('.pc-clipboard__item').count() === 3, 'Release CTA opens three fictional clipboard samples');
    check(await tab.locator('#demo-typing').isHidden(), 'Browsing samples does not paste');
    await demo.locator('.pc-clipboard__item').nth(1).click();
    check((await demo.locator('#pc-clipboard-text').inputValue()).includes('Coffee\nBread'), 'Selecting a sample preserves multiline text');
    check(await tab.locator('#demo-typing').isHidden(), 'Selecting a sample does not paste');
    await demo.locator('#pc-clipboard-text').fill('Edited demo text\nمرحبا 🙂');
    await demo.getByRole('button', { name: 'Try paste', exact: true }).click();
    await tab.waitForFunction(() => document.getElementById('demo-typed-text').textContent === 'Edited demo text\nمرحبا 🙂');
    check((await demo.locator('#pc-clipboard-status').innerText()).includes('Nothing was pasted on your PC'), 'Paste confirms the simulation');
    await demo.locator('#pc-clipboard-close').click();
    check(await demo.locator('.pc-clipboard__item').count() === 0 && await demo.locator('#pc-clipboard-text').inputValue() === '', 'Closing the demo panel clears the samples and editor');
    await tab.locator('#demo-clear-text').click();
    await tab.waitForFunction(() => document.getElementById('demo-typed-text').textContent === 'Your demo text will appear here.');
    check(await tab.locator('#demo-typed-text').innerText() === 'Your demo text will appear here.', 'Demo output can be cleared');
    const frame = tab.frames().find(frame => frame.url().includes('/demo/index.html'));
    check(await frame.evaluate(() => window.realClipboardCalls) === 0 && clipboardRequests.length === 0, 'Demo never calls the real clipboard or a clipboard endpoint');
    await demo.locator('.touchpad-navigation [data-close="input-pad"]').click();
    await tab.locator('#preview-drawer').click();
    await demo.locator('#drawer-updates').click();
    await demo.locator('#updates-check').click();
    await demo.locator('#updates-status').filter({ hasText: 'Demo check complete' }).waitFor();
    check(await demo.locator('#updates-download').isHidden(), 'Simulated update check does not invent a release download');
    await demo.locator('[data-close="updates"]').click();
    await tab.evaluate(() => document.activeElement?.blur());
    for (const width of [1440, 768, 390, 320]) {
      await tab.setViewportSize({ width, height: 1000 });
      await tab.locator('#next-release').scrollIntoViewIfNeeded();
      check(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow at ' + width + 'px');
      const heading = await tab.locator('#release-spotlight-title').boundingBox();
      check(heading.width > 0 && heading.x >= 0 && heading.x + heading.width <= width, 'Release heading fits at ' + width + 'px');
      if (width === 1440 || width === 390) await tab.locator('#next-release').screenshot({ path: 'output/playwright/release-spotlight-' + width + '.png' });
    }
    await tab.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await tab.locator('#next-release').screenshot({ path: 'output/playwright/release-spotlight-dark.png' });
    check(errors.length === 0, 'No uncaught website or demo errors');
    return { passed: results.length, results };
  } finally { for (const context of contexts) await context.close(); }
}

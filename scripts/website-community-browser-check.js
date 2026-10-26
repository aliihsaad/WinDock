// Read-only live Giscus checks. Never signs in, posts, or adds reactions.
// Run with playwright-cli run-code after starting scripts/website-server.mjs.
async (page) => {
  const browser = page.context().browser(), contexts = [], results = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); results.push(name); };
  const createContext = async options => {
    const context = await browser.newContext({ reducedMotion: 'reduce', colorScheme: 'light', viewport: { width: 1440, height: 1000 }, ...options });
    contexts.push(context);
    return context;
  };
  try {
    const context = await createContext(), tab = await context.newPage(), requests = [], errors = [];
    tab.on('request', request => { if (new URL(request.url()).hostname === 'giscus.app') requests.push(request.url()); });
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto('http://127.0.0.1:4173/');
    await tab.getByRole('button', { name: 'No thanks', exact: true }).click();
    await tab.locator('#community').scrollIntoViewIfNeeded();
    check(await tab.locator('#community-feedback').getAttribute('open') === null && requests.length === 0, 'Collapsed feedback makes no Giscus requests');
    await tab.locator('#community').screenshot({ path: 'output/playwright/community-collapsed.png' });
    await tab.locator('#community-feedback summary').focus();
    await tab.keyboard.press('Space');
    await tab.locator('#community-feedback[data-state="ready"]').waitFor();
    const comments = tab.frameLocator('.giscus-frame');
    await comments.locator('.gsc-comment-box').waitFor();
    check((await comments.locator('body').innerText()).includes('Sign in with GitHub'), 'Opening with the keyboard loads the real GitHub sign-in and comment interface');
    const config = await tab.locator('script[src="https://giscus.app/client.js"]').evaluate(el => ({ ...el.dataset }));
    check(config.repo === 'aliihsaad/WinDock' && config.repoId === 'R_kgDOUfO7Ig' && config.categoryId === 'DIC_kwDOUfO7Is4DJr27', 'Embed is connected to the verified WinDock repository and category');
    check(config.mapping === 'number' && config.term === '39', 'Previews and production share discussion #39');
    check(config.reactionsEnabled === '1' && config.inputPosition === 'top', 'Reactions and comment entry are enabled');
    check(await tab.evaluate(() => localStorage.getItem('windock-website-analytics-v1')) === 'declined', 'Functional comments preserve the separate analytics choice');
    await comments.locator('#giscus-theme[href*="noborder_light"]').waitFor({ state: 'attached' });
    await tab.locator('#community').screenshot({ path: 'output/playwright/community-live-light.png' });
    const frameIdentity = await tab.locator('.giscus-frame').elementHandle();
    await tab.locator('#community-feedback summary').click();
    await tab.locator('#community-feedback summary').click();
    check(await frameIdentity.evaluate(el => el === document.querySelector('.giscus-frame')), 'Reopening retains the same iframe and its editing state');
    check(requests.filter(url => url === 'https://giscus.app/client.js').length === 1, 'Giscus client loads only once');
    const href = await tab.locator('#community-github').getAttribute('href');
    await tab.evaluate(() => {
      const target = document.querySelector('.giscus-frame').contentWindow;
      const data = { giscus: { error: 'untrusted', discussion: { url: 'https://example.invalid/' } } };
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://giscus.app', source: window, data }));
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://example.invalid', source: target, data }));
    });
    check(await tab.locator('#community-feedback').getAttribute('data-state') === 'ready' && await tab.locator('#community-github').getAttribute('href') === href, 'Messages from other windows or origins cannot change feedback state or links');
    await tab.locator('#nav-toggle').hover();
    await tab.locator('#theme-toggle').click();
    await comments.locator('#giscus-theme[href*="transparent_dark"]').waitFor({ state: 'attached' });
    check(await frameIdentity.evaluate(el => el === document.querySelector('.giscus-frame')), 'Dark mode updates the real Giscus theme without reloading the iframe');
    await tab.locator('#community').screenshot({ path: 'output/playwright/community-live-dark.png' });
    for (const width of [768, 390, 320]) {
      await tab.setViewportSize({ width, height: 1000 });
      await tab.locator('#community').scrollIntoViewIfNeeded();
      check(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && await comments.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth), 'Website and live comments fit at ' + width + 'px');
      if (width === 320) await tab.locator('#community').screenshot({ path: 'output/playwright/community-live-mobile.png' });
    }
    await tab.locator('#nav-toggle').click();
    await tab.locator('#mobile-theme-toggle').click();
    await tab.keyboard.press('Escape');
    await comments.locator('#giscus-theme[href*="noborder_light"]').waitFor({ state: 'attached' });
    check(true, 'Mobile appearance control also updates Giscus');
    await comments.locator('html').evaluate(() => parent.postMessage({ giscus: { error: 'Discussion not found' } }, 'http://127.0.0.1:4173'));
    await tab.locator('#community-feedback[data-state="unavailable"]').waitFor();
    check(await tab.locator('#community-retry').isVisible(), 'An error from the actual embed shows the fallback');
    await tab.locator('#community-retry').click();
    await tab.locator('#community-feedback[data-state="ready"]').waitFor();
    check(await frameIdentity.evaluate(el => el === document.querySelector('.giscus-frame')) && requests.filter(url => url === 'https://giscus.app/client.js').length === 1, 'Retry after an iframe error reuses the existing Giscus client');
    check(errors.length === 0, 'No uncaught page or iframe errors');

    const failedContext = await createContext(), failed = await failedContext.newPage();
    await failedContext.route('https://giscus.app/client.js', route => route.abort());
    await failed.goto('http://127.0.0.1:4173/');
    await failed.getByRole('button', { name: 'No thanks', exact: true }).click();
    await failed.locator('#community-feedback summary').click();
    await failed.locator('#community-feedback[data-state="unavailable"]').waitFor();
    check(await failed.locator('#community-retry').isVisible() && (await failed.locator('#community-github').getAttribute('href')).startsWith('https://github.com/aliihsaad/WinDock/discussions'), 'Blocked Giscus offers retry and a working GitHub destination');
    await failedContext.unroute('https://giscus.app/client.js');
    await failed.locator('#community-retry').click();
    await failed.locator('#community-feedback[data-state="ready"]').waitFor();
    check(await failed.locator('.giscus-frame').count() === 1 && await failed.locator('#community-retry').isHidden(), 'Retry recovers with one embed');

    const callbackContext = await createContext(), callback = await callbackContext.newPage();
    await callbackContext.route('https://giscus.app/**', route => route.abort());
    await callback.goto('http://127.0.0.1:4173/?giscus=test-only-callback');
    await callback.locator('#community-feedback[open]').waitFor();
    check(true, 'OAuth return opens feedback so the official client can finish sign-in');

    const plainContext = await createContext({ javaScriptEnabled: false }), plain = await plainContext.newPage();
    await plain.goto('http://127.0.0.1:4173/');
    await plain.locator('#community-feedback summary').click();
    check(await plain.locator('#community-github').isVisible(), 'GitHub feedback link remains available without JavaScript');
    return { passed: results.length, results };
  } finally { for (const context of contexts) await context.close(); }
}

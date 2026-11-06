// Run with playwright-cli run-code --filename after scripts/website-server.mjs.
// Uses only the in-memory website demo: never sends real PC actions.
async (page) => {
  const browser = page.context().browser(), results = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
  context.setDefaultTimeout(6000);
  try {
    const tab = await context.newPage(), errors = [], hostRequests = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('request', request => { if (/\/api\//.test(request.url())) hostRequests.push(request.url()); });
    await tab.goto('http://127.0.0.1:4173/demo/index.html');
    await tab.locator('#app:not([hidden])').waitFor();
    const cdp = await context.newCDPSession(tab);
    const shown = id => tab.locator('#' + id).evaluate(el => el.open === true);
    async function swipe(selector, dx, dy, cancelled = false) {
      const box = await tab.locator(selector).first().boundingBox();
      if (!box) throw new Error('Gesture target hidden: ' + selector);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] });
        await tab.waitForTimeout(12);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: cancelled ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      await tab.waitForTimeout(600); // Let motion and generated click suppression settle.
    }
    async function close() { await tab.keyboard.press('Escape'); await tab.locator('#controls').waitFor({ state: 'hidden' }); }
    const tilesBefore = await tab.locator('#dock').textContent();
    const island = await tab.locator('#quick-controls-open').boundingBox();
    const tileBoxes = await tab.locator('#dock .tile').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    check(tileBoxes.every(box => box.y >= island.y + island.height), 'Top island occupies reserved space above every tile');
    await swipe('#dock .tile', 0, 95);
    check(await shown('controls') && !await shown('drawer'), 'Downward dock swipe opens controls directly');
    check(await tab.locator('#toast').isHidden(), 'Opening swipe does not launch a tile or send a control');
    check(await tab.locator('#quick-controls-open').getAttribute('aria-expanded') === 'true', 'Accessible trigger reflects open panel');
    check((await tab.locator('#controls').boundingBox()).y <= 12, 'Curtain is anchored at the top');
    const grid = await tab.locator('#controls-grid').boundingBox();
    for (const name of ['Sound', 'Playback', 'Display']) {
      const card = tab.locator('.control-card').filter({ has: tab.getByRole('heading', { name, exact: true }) });
      const box = await card.boundingBox();
      check(box.y >= grid.y && box.y + box.height <= grid.y + grid.height + 1, name + ' controls visible without scrolling on landscape phone');
    }
    await tab.screenshot({ path: 'output/playwright/quick-controls-phone.png' });
    await close();
    check(await tab.locator('#quick-controls-open').getAttribute('aria-expanded') === 'false', 'Escape closes panel and clears expanded state');
    await tab.locator('#quick-controls-open').click();
    check(await shown('controls'), 'Tap opens quick controls');
    await swipe('#controls-grip', 0, -70);
    check(!await shown('controls'), 'Swipe up on curtain handle closes it');
    await swipe('#quick-controls-open', 90, 2);
    check(!await shown('controls'), 'Horizontal handle drag does not become an opening tap');
    await swipe('#quick-controls-open', 0, 70, true);
    check(!await shown('controls'), 'Cancelled touch does not open controls');
    await swipe('#quick-controls-open', 0, 80);
    check(await shown('controls'), 'Pulling the top handle opens controls');
    await close();
    await swipe('#dock', -150, 0);
    check(!await shown('controls') && !await shown('drawer'), 'Horizontal dock paging does not open a panel');
    check(await tab.locator('#dock').evaluate(el => el.scrollLeft > el.clientWidth / 2), 'Existing horizontal page navigation works');
    await swipe('#dock', 0, -100);
    check(await shown('drawer') && !await shown('controls'), 'Existing upward swipe still opens drawer');
    check(await tab.locator('#drawer-controls, #drawer-capture, #drawer-input').count() === 0, 'Swipe-up drawer has no duplicate quick actions');
    await tab.keyboard.press('Escape'); await tab.locator('#quick-controls-open').click();
    check(await shown('controls') && !await shown('drawer'), 'Quick actions have one home in the curtain');
    check(await tab.locator('#controls-grid [data-key="lock"]').count() === 0, 'Power actions stay out of the primary controls');
    await tab.locator('#quick-power').click();
    await tab.getByRole('button', { name: 'Lock', exact: true }).click();
    check(await shown('confirm'), 'Power action still requires explicit confirmation');
    await tab.locator('#confirm-cancel').click();
    check(await shown('power-controls') && !await shown('confirm'), 'Cancelling power action returns to the Power sheet');
    await tab.locator('[data-close="power-controls"]').click();
    check(await shown('controls'), 'Closing Power returns to quick controls');
    await tab.locator('#quick-input').click();
    await tab.locator('#input-pad[data-ready="true"]').waitFor();
    check(await shown('input-pad') && !await shown('controls'), 'Touch & sign shortcut opens existing input panel');
    await swipe('#touchpad-surface', 0, 90);
    check(await shown('input-pad') && !await shown('controls') && !await shown('drawer'), 'Touchpad vertical motion is not intercepted');
    await tab.getByRole('button', { name: 'Back to dock', exact: true }).click();
    await tab.locator('#quick-controls-open').click();
    await tab.locator('#quick-capture').click();
    check(await shown('capture') && !await shown('controls'), 'Capture shortcut opens existing capture panel');
    await tab.locator('#capture-screenshot').click();
    await tab.locator('#capture-file:not([hidden])').waitFor();
    check((await tab.locator('#capture-file').textContent()).includes('No file created'), 'Capture action still works through the simulated transport');
    await tab.locator('[data-close="capture"]').click();
    await tab.locator('#drawer-open').click();
    await tab.locator('#drawer-edit').click();
    check(await tab.locator('#quick-controls-open').isHidden(), 'Quick trigger stays out of tile-arrangement mode');
    await swipe('#dock', 0, 75);
    check(!await shown('controls'), 'Downward movement while arranging does not open controls');
    await tab.locator('#edit-done').click();
    check(await tab.locator('#dock').textContent() === tilesBefore, 'Navigation gestures preserve existing tiles');
    await tab.locator('#quick-controls-open').click();
    await tab.evaluate(() => window.WinDockPerformance.setPreference('on'));
    check(await tab.locator('#controls').evaluate(el => getComputedStyle(el).animationName === 'none'), 'Performance mode disables curtain animation');
    await tab.evaluate(() => window.WinDockPerformance.setPreference('off'));
    await tab.emulateMedia({ reducedMotion: 'reduce' });
    check(await tab.locator('#controls').evaluate(el => getComputedStyle(el).animationName === 'none'), 'Reduced-motion preference disables curtain animation');
    await close();
    await tab.setViewportSize({ width: 640, height: 320 });
    const shortIsland = await tab.locator('#quick-controls-open').boundingBox();
    check(await tab.locator('#dock .tile').evaluateAll((nodes, bottom) => nodes.every(node => node.getBoundingClientRect().top >= bottom), shortIsland.y + shortIsland.height), 'Island does not overlap tiles on short phones');
    await tab.locator('#quick-controls-open').click();
    const short = await tab.locator('#controls').boundingBox();
    check(short.y >= 0 && short.y + short.height <= 320, 'Curtain fits a short landscape viewport');
    await tab.locator('#quick-power').click();
    check(await tab.getByRole('button', { name: 'Lock', exact: true }).isVisible(), 'Power actions remain reachable on short phones');
    await tab.locator('[data-close="power-controls"]').click();
    await tab.screenshot({ path: 'output/playwright/quick-controls-short-phone.png' });
    await close();
    await tab.locator('#drawer-open').click(); await tab.locator('#drawer-settings').click();
    await tab.locator('#immersive').uncheck(); await tab.locator('[data-close="settings"]').click();
    check(await tab.locator('#quick-controls-open').isHidden(), 'Standard layout keeps its existing footer trigger');
    await tab.locator('#controls-open').click();
    check(await shown('controls'), 'Standard-layout Controls button uses the same panel');
    check(errors.length === 0, 'No JavaScript runtime errors');
    check(hostRequests.length === 0, 'Preview never sends PC API requests');
    return { passed: results.length, checks: results };
  } catch (error) {
    throw new Error(error.message + '\nPassed before failure: ' + results.join('; '));
  } finally { await context.close(); }
}

// Run with playwright-cli run-code --filename=scripts/pc-picker-browser-check.js
// Start scripts/pc-picker-smoke-hosts.mjs first. No real PC providers are involved.
async (page) => {
  const browser = page.context().browser();
  const results = [];
  const contexts = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  async function client(bridge) {
    const context = await browser.newContext({ viewport: { width: 800, height: 360 }, serviceWorkers: 'block' });
    contexts.push(context);
    if (bridge) await context.addInitScript(kind => {
      window.pickerCalls = 0;
      window.WinDockAndroid = { showPhoneSettings() {} };
      if (kind === 'new') window.WinDockAndroid.showPcPicker = () => { window.pickerCalls++; };
    }, bridge);
    return context.newPage();
  }
  async function pair(tab, url, code) {
    await tab.goto(url);
    await tab.locator('#pair:not([hidden])').waitFor();
    await tab.getByRole('textbox', { name: 'PIN', exact: true }).fill(code);
    await tab.locator('#pair-form button').click();
    await tab.locator('#app:not([hidden])').waitFor();
    await tab.waitForFunction(() => document.getElementById('conn').textContent === 'Connected');
  }
  try {
    const desktop = await client();
    await pair(desktop, 'http://127.0.0.1:18625', '864213');
    check(await desktop.locator('#drawer-switch-pc').evaluate(el => el.hidden), 'Browser keeps the native-only picker hidden');
    const legacy = await client('old');
    await pair(legacy, 'http://127.0.0.1:18625', '864213');
    check(await legacy.locator('#drawer-switch-pc').evaluate(el => el.hidden), 'Older Android bridge remains compatible');
    const android = await client('new');
    const errors = [];
    android.on('pageerror', error => errors.push(error.message));
    await pair(android, 'http://127.0.0.1:18625', '864213');
    await android.locator('#drawer-open').click();
    await android.locator('#drawer[open]').waitFor();
    check(await android.locator('#drawer-switch-pc').isVisible(), 'Switch PC is visible inside the Android drawer');
    check(await android.locator('.drawer-actions button').count() === 7, 'Existing drawer icon layout is preserved');
    const bounds = await android.locator('#drawer-switch-pc').boundingBox();
    check(bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= 800, 'Switch PC has a full-size touch target on a landscape phone');
    await android.screenshot({ path: 'output/playwright/pc-picker-phone-drawer.png' });
    await android.locator('#drawer-switch-pc').click();
    check(await android.evaluate(() => window.pickerCalls === 1 && !document.getElementById('drawer').open), 'Selecting Switch PC closes the drawer and invokes the native bridge once');
    await android.setViewportSize({ width: 1280, height: 800 });
    await android.locator('#drawer-open').click();
    await android.screenshot({ path: 'output/playwright/pc-picker-tablet-drawer.png' });
    // Distinct hostnames model independent PCs; pairing cookies must stay scoped to each host.
    await android.goto('http://localhost:18626');
    await android.locator('#pair:not([hidden])').waitFor();
    await android.getByRole('textbox', { name: 'PIN', exact: true }).fill('864213');
    await android.locator('#pair-form button').click();
    await android.waitForFunction(() => document.getElementById('pair-error').textContent.length > 0);
    check(await android.locator('#app').evaluate(el => el.hidden), 'Windows pairing code does not authorize the Linux host');
    await android.getByRole('textbox', { name: 'PIN', exact: true }).fill('975324');
    await android.locator('#pair-form button').click();
    await android.locator('#app:not([hidden])').waitFor();
    check(await android.locator('#host-name').textContent() === 'Studio Linux', 'Linux host opens only after its own pairing');
    await android.goto('http://127.0.0.1:18625');
    await android.locator('#app:not([hidden])').waitFor();
    check(await android.locator('#host-name').textContent() === 'Desk Windows', 'Returning to Windows preserves its existing pairing');
    check(errors.length === 0, 'No uncaught JavaScript errors during switching');
    return { passed: results.length, results };
  } finally { for (const context of contexts) await context.close(); }
}

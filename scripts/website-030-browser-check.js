// Focused release check; reuse prior navigation/clipboard/device feature passes.
async (page) => {
  await page.setViewportSize({width:1440,height:1100});
  const results = [], errors = [], deviceRequests = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/192\.0\.2\.|\/api\/(state|input|auth|tiles|apps|capture|folders|links|transfers)/.test(request.url())) deviceRequests.push(request.url()); });
  await page.goto('http://127.0.0.1:4173');
  const decline = page.getByRole('button', {name:'No thanks',exact:true});
  if (await decline.isVisible()) await decline.click();
  const demo = page.frameLocator('#demo-frame');
  await demo.locator('#app:not([hidden])').waitFor();
  await page.locator('#demo-frame').scrollIntoViewIfNeeded();
  check((await page.locator('#next-release').innerText()).includes('WINDOCK 0.3.0'), '0.3.0 feature section');
  for (const id of ['download-windows','download-android','download-linux-arch','download-linux-deb']) {
    await page.locator(`#${id}:not([aria-disabled="true"])`).waitFor();
    check((await page.locator(`#${id}`).getAttribute('href')).includes('/v0.3.0/'), `${id}: staged stable release URL`);
  }
  await demo.locator('#quick-controls-open').click();
  await page.locator('#demo-frame').scrollIntoViewIfNeeded();
  await demo.locator('#quick-files').click();
  await demo.locator('#demo-files[open]').waitFor();
  check(await demo.locator('#demo-files input[type=file]').count() === 0, 'Files demo never opens personal files');
  await demo.locator('#demo-files-send').click();
  check((await demo.locator('#demo-files-status').innerText()).includes('No files were read, sent or saved'), 'Sample transfer has explicit simulated completion');
  await demo.locator('#demo-files').screenshot({path:'output/playwright/release030-files.png'});
  await demo.locator('#demo-files button').filter({hasText:'Close'}).click();
  await page.locator('#preview-drawer').click();
  await demo.locator('#drawer-apps').click();
  await demo.locator('#tab-folders').click();
  await demo.locator('#folder-pick').click();
  await demo.locator('#folder-status').filter({hasText:'Sample documents'}).waitFor();
  check(true, 'Fictional folder tile can be added');
  await demo.locator('#tab-links').click();
  await demo.locator('#link-url').fill('https://example.com');
  await demo.locator('#link-name').fill('Sample website');
  await page.locator('#demo-frame').scrollIntoViewIfNeeded();
  await demo.locator('#link-add').click();
  await demo.locator('#link-status').filter({hasText:'Sample website added'}).waitFor();
  check(true, 'Website tile can be added without navigation');
  await page.goto('http://127.0.0.1:4173/releases.html');
  check((await page.locator('#candidate-release').innerText()).includes('0.3.0'), 'Release history leads with 0.3.0');
  check(await page.locator('.release-earlier').first().getAttribute('open') === null, 'Earlier releases stay collapsed');
  await page.screenshot({path:'output/playwright/release030-notes.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for (const route of ['/','/setup.html','/releases.html']) {
    await page.goto('http://127.0.0.1:4173'+route);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), `Mobile width: ${route}`);
  }
  await page.screenshot({path:'output/playwright/release030-mobile.png',fullPage:true});
  check(deviceRequests.length === 0, 'Demo sent no device API requests');
  check(errors.length === 0, `No page errors: ${errors.join(', ')}`);
  return {passed:results.length,results};
}

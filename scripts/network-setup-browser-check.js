async (page) => {
  await page.unroute('**/api/pairing/network');
  await page.setViewportSize({width:1280,height:900});
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  let checks=0; const check=(ok,why)=>{if(!ok)throw Error(why);checks++};
  await page.goto('http://127.0.0.1:18624/pair#network');
  check(await page.locator('#network').getAttribute('open') !== null,'network link expands help');
  await page.locator('#check-network').click();
  await page.waitForFunction(()=>document.getElementById('network-result').textContent.includes('Current ports:'));
  check((await page.locator('#network-result').innerText()).includes('18626/tcp'),'actual secure fixture port shown');
  check(!(await page.locator('#network-result').innerText()).includes('windock-pair:'),'diagnostics do not include pairing invitation');
  const scopes=page.locator('#network-result details');
  check(await scopes.count()>0,'local network choices rendered');
  await scopes.first().locator('summary').click();
  const command=await scopes.first().locator('textarea').first().inputValue();
  check(command.includes('-Profile Private') && command.includes('-RemoteAddress') && command.includes('-Program'),'Windows rules scoped to runtime and private subnet');
  check(await scopes.first().locator('textarea').first().getAttribute('readonly')!==null,'commands are reviewable read-only text');
  await page.screenshot({path:'artifacts/network-setup-browser.png',fullPage:true});
  await page.locator('#create').click(); await page.locator('#qr canvas').waitFor();
  check(await page.locator('#qr-dialog').isVisible(),'pairing still opens enlarged QR');
  await page.locator('#close-qr').click();
  await page.route('**/api/pairing/network',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.locator('#check-network').click();
  await page.waitForFunction(()=>document.getElementById('network-result').textContent.includes('unavailable'));
  check(await page.locator('#check-network').isEnabled(),'unavailable diagnostics allow retry');
  check(!errors.length,'no browser errors');
  return {passed:checks};
}

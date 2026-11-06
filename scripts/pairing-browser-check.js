// Real QR generation on the isolated host; never requests a code from the user's PCs.
async (page) => {
  const results=[], errors=[];
  const check=(ok,label)=>{if(!ok)throw new Error(label);results.push(label)};
  const browser=page.context().browser();
  for(const [width,height,ratio] of [[1366,768,1],[1024,600,1.25],[1920,1080,2]]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:ratio,serviceWorkers:'block'});
    try {
      const tab=await context.newPage();tab.on('pageerror',e=>errors.push(e.message));
      await tab.goto('http://127.0.0.1:18624/pair');
      await tab.locator('#create').click();
      await tab.locator('#qr-dialog[open] #qr canvas').waitFor();
      const geometry=await tab.locator('#qr canvas').evaluate(image=>{const r=image.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,n:image.width,scale:devicePixelRatio*r.width/image.width}});
      check(geometry.x>=0 && geometry.y>=0 && geometry.x+geometry.w<=width && geometry.y+geometry.h<=height,`Entire QR visible at ${width}x${height}, scale ${ratio}`);
      check(Math.abs(geometry.scale-Math.round(geometry.scale))<0.01,'QR modules use whole physical pixels');
      check(geometry.n<=185 && geometry.n>21,'QR preserves the bounded native bitmap format');
      await tab.locator('#qr canvas').screenshot({path:`artifacts/pairing-qr-${width}-${ratio}.png`});
      const first=await tab.locator('#invitation').inputValue();
      check(first.startsWith('windock-pair:'),'Camera and text use the same invitation format');
      await tab.locator('#refresh-qr').click();
      await tab.waitForFunction(previous=>document.getElementById('invitation').value && document.getElementById('invitation').value!==previous,first);
      check(await tab.locator('#qr-dialog').isVisible(),'Refreshing keeps the large code visible');
      await tab.locator('#close-qr').click();await tab.locator('#manual summary').click();
      check(await tab.locator('#invitation').isVisible(),'Pairing text remains accessible after closing the QR');
      await context.route('**/api/pairing/invite',async route=>{
        const response=await route.fetch();const data=await response.json();data.expires=Date.now()+700;
        await route.fulfill({response,json:data});
      });
      await tab.locator('#create').click();
      await tab.waitForFunction(()=>document.getElementById('qr-status').textContent.includes('expired'));
      check(await tab.locator('#qr canvas').count()===0 && await tab.locator('#invitation').inputValue()==='','Expiry removes the QR and text');
      check(await tab.locator('#refresh-qr').isEnabled(),'Expired code has a reachable refresh action');
    } finally {await context.close()}
  }
  check(!errors.length,'No browser runtime errors');
  return {passed:results.length,checks:results};
}

async page => {
  const context = await page.context().browser().newContext({viewport:{width:1024,height:600},hasTouch:true,serviceWorkers:'block'});
  const checks=[],errors=[];
  const check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
  try {
    await context.route('**/preview-transport.js',async route=>{
      const response=await route.fetch(), source=await response.text();
      const body=source.replace('const message = JSON.parse(payload);','const message = JSON.parse(payload); (window.__keyTestMessages ??= []).push(message);');
      check(body!==source,'Preview input messages are observable');
      await route.fulfill({response,body});
    });
    const tab=await context.newPage();tab.on('pageerror',error=>errors.push(error.message));
    await tab.goto('http://127.0.0.1:4175/demo/index.html');
    await tab.getByRole('button',{name:'Open quick controls',exact:true}).click();
    await tab.getByRole('button',{name:'Touch & sign',exact:true}).click();
    check(await tab.locator('#pc-keys').isHidden(),'PC keys are hidden by default');
    await tab.getByRole('button',{name:'PC keys',exact:true}).click();
    check(await tab.locator('#pc-keys').isVisible(),'Toggle reveals the two side banks');
    for(const size of [{width:1280,height:800},{width:1024,height:600},{width:844,height:390},{width:568,height:320}]) {
      await tab.setViewportSize(size);
      const geometry=await tab.evaluate(()=>{
        const box=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
        return {keys:[...document.querySelectorAll('[data-pc-key]')].map(box),left:box(document.querySelector('.pc-key-bank--editing')),right:box(document.querySelector('.pc-key-bank--navigation')),mouseLeft:box(document.getElementById('mouse-left')),mouseRight:box(document.getElementById('mouse-right'))};
      });
      check(geometry.keys.every(r=>r.w>=44&&r.h>=44&&r.x>=0&&r.y>=0&&r.x+r.w<=size.width&&r.y+r.h<=size.height),`Keys fit with 44px targets at ${size.width}x${size.height}`);
      check(geometry.left.x+geometry.left.w<size.width/2&&geometry.right.x>size.width/2&&geometry.left.y+geometry.left.h<=geometry.mouseLeft.y&&geometry.right.y+geometry.right.h<=geometry.mouseRight.y,`Side keys leave the centre and thumb zones clear at ${size.width}x${size.height}`);
    }
    for(const key of ['Escape','Tab','Delete','Home','End','ArrowLeft','ArrowUp','ArrowDown','ArrowRight']) await tab.locator(`[data-pc-key="${key}"]`).click();
    check(await tab.evaluate(()=>window.__keyTestMessages.filter(m=>m.type==='key').length===9&&window.__keyTestMessages.filter(m=>m.type==='key').every(m=>m.target==='1')),'All nine keys send a single focused PC action');
    const cdp=await context.newCDPSession(tab);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:280,y:200}]});
    await tab.waitForFunction(()=>document.getElementById('pc-keys-toggle').disabled);
    check(await tab.locator('[data-pc-key]:disabled').count()===9,'Touch disables all keys and the toggle');
    await tab.waitForFunction(()=>Number(getComputedStyle(document.getElementById('pc-keys')).opacity)<.25);
    await tab.evaluate(()=>document.querySelector('[data-pc-key="Delete"]').click());
    check(await tab.evaluate(()=>window.__keyTestMessages.filter(m=>m.type==='key').length===9),'Touch cannot accidentally delete text');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    check(await tab.locator('[data-pc-key]:enabled').count()===9,'Lift restores the PC keys');
    await tab.getByRole('button',{name:'PC keys',exact:true}).click();
    check(await tab.locator('#pc-keys').isHidden(),'Toggle hides the keys again');
    await tab.getByRole('button',{name:'PC keys',exact:true}).click();
    await tab.getByRole('button',{name:'Open phone keyboard',exact:true}).click();
    await tab.setViewportSize({width:568,height:180});
    const compact=await tab.evaluate(()=>{
      const banks=[...document.querySelectorAll('.pc-key-bank')].map(e=>e.getBoundingClientRect());
      const composer=document.getElementById('remote-keyboard').getBoundingClientRect();
      return banks[0].right<banks[1].left && banks.every(r=>r.top>=0&&r.bottom<=composer.top);
    });
    check(compact,'Keys remain separate and above the composer in a short keyboard viewport');
    check(await tab.locator('#remote-keyboard-text').getAttribute('autocapitalize')==='none','Browser composer does not request auto-capitalization');
    await tab.getByRole('button',{name:'Hide keyboard',exact:true}).click();
    await tab.setViewportSize({width:1024,height:600});
    await tab.screenshot({path:'output/playwright/pc-keys-sides-tablet.png'});
    await tab.setViewportSize({width:568,height:320});
    await tab.screenshot({path:'output/playwright/pc-keys-sides-phone.png'});
    check(errors.length===0,'No JavaScript runtime errors');
    return {passed:checks.length,checks};
  } finally {await context.close();}
}

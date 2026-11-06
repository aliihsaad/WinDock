// Browser fixtures only: never change the real companion or open user files.
async (page) => {
  const results=[],check=(value,label)=>{if(!value)throw Error(label);results.push(label);};
  const context=await page.context().browser().newContext({viewport:{width:1100,height:760}});
  try {
    let enabled=true,destination='Downloads/WinDock',calls=[];
    await context.route('**/api/transfers/local**',async route=>{
      const request=route.request();calls.push({url:request.url(),method:request.method(),body:request.postDataJSON()});
      const body=request.postDataJSON();if(request.url().endsWith('/settings')){if(body.enabled!==undefined)enabled=body.enabled;if(body.destination!==undefined){await route.fulfill({status:400,json:{error:'Choose an absolute receive folder.'}});return;}}
      await route.fulfill({json:{enabled,destination,batches:[{id:'a'.repeat(32),files:[{name:'مرحبا photo.jpg',bytes:1048576,size:2097152,status:'sending'},{name:'<img src=x onerror=alert(1)>.pdf',bytes:8192,size:8192,status:'completed',savedName:'document (1).pdf'}]}],events:[]}});
    });
    const tab=await context.newPage(),errors=[];tab.on('pageerror',e=>errors.push(e.message));
    await tab.goto('http://127.0.0.1:18624/files');await tab.getByText('مرحبا photo.jpg',{exact:true}).waitFor();
    check(await tab.getByRole('heading',{name:'Files & Media'}).isVisible(),'Desktop files heading');
    check(await tab.getByRole('checkbox').isChecked(),'Paired receiving is enabled');
    check(await tab.locator('progress').getAttribute('value')==='1048576','Received-byte progress is shown');
    check(await tab.getByText('document (1).pdf',{exact:true}).isVisible(),'Safe duplicate filename shown');
    check(await tab.locator('#batches img').count()===0,'File metadata never becomes HTML');
    await tab.getByRole('checkbox').uncheck();await tab.waitForFunction(()=>document.getElementById('status').textContent.includes('updated'));
    check(calls.some(c=>c.body?.enabled===false),'PC receiving can be disabled');
    await tab.getByRole('checkbox').check();
    await tab.getByRole('textbox',{name:'Receive folder'}).fill('../bad');await tab.getByRole('button',{name:'Save folder'}).click();
    await tab.getByText('Choose an absolute receive folder.').waitFor();check(true,'Useful destination validation error');
    await tab.getByRole('button',{name:'Cancel batch'}).click();check(calls.some(c=>c.url.endsWith('/cancel')&&c.body.id==='a'.repeat(32)),'Desktop batch cancellation');
    await tab.getByRole('button',{name:'Open folder',exact:true}).click();check(calls.some(c=>c.url.endsWith('/open')),'Explicit open-folder action');
    await tab.screenshot({path:'output/playwright/files-desktop.png',fullPage:true});
    await context.route('**/demo/app.js',async route=>{const response=await route.fetch();const body=(await response.text()).replace('window.WinDockAndroid = { showPcPicker: showPreviewPcPicker };','window.WinDockAndroid = { showPcPicker: showPreviewPcPicker, openFiles: () => { window.filesOpened = (window.filesOpened || 0) + 1; } };');await route.fulfill({response,body});});
    await tab.setViewportSize({width:844,height:390});await tab.goto('http://127.0.0.1:4173/demo/index.html');await tab.locator('#app:not([hidden])').waitFor();
    check(await tab.locator('#quick-voice').count()===0,'Dedicated voice control removed');
    await tab.locator('#quick-controls-open').click();check(await tab.locator('#quick-files').isVisible(),'Files action is in the curtain');
    await tab.waitForTimeout(400);await tab.screenshot({path:'output/playwright/files-curtain.png'});await tab.locator('#quick-files').click();
    check(await tab.evaluate(()=>window.filesOpened===1),'Files opens through native bridge once');
    check(await tab.locator('#controls').evaluate(el=>!el.open),'Curtain closes before native file selection');
    check(await tab.locator('#drawer-capture,#drawer-controls,#drawer-input').count()===0,'No duplicate drawer quick actions');
    check(errors.length===0,'No UI runtime errors');
    return {passed:results.length,checks:results};
  }finally{await context.close();}
}

// Run with playwright-cli run-code after starting clipboard-smoke-host.mjs.
async (page) => {
  const browser=page.context().browser(),contexts=[],results=[];
  const check=(ok,name)=>{if(!ok)throw new Error(name);results.push(name);};
  const control=async path=>(await page.request.get("http://127.0.0.1:18628"+path)).json();
  async function client(native=false){
    const context=await browser.newContext({viewport:{width:800,height:360},serviceWorkers:"block"});contexts.push(context);
    if(native)await context.addInitScript(()=>{window.nativeKeyboardOpens=0;window.WinDockAndroid={showKeyboard(){window.nativeKeyboardOpens++;},hideKeyboard(){},showPhoneSettings(){}};});
    const tab=await context.newPage();await tab.goto("http://127.0.0.1:18627");
    await tab.getByRole("textbox",{name:"PIN",exact:true}).fill("864213");await tab.locator("#pair-form button").click();
    await tab.locator("#app:not([hidden])").waitFor();await tab.locator("#drawer-open").click();await tab.locator("#drawer-input").click();
    await tab.locator('#input-pad[data-ready="true"]').waitFor();return tab;
  }
  try{
    const before=await control("/events");
    const tab=await client(true);const errors=[];tab.on("pageerror",e=>errors.push(e.message));
    check(await tab.locator("#pc-clipboard-panel").evaluate(el=>el.hidden),"Clipboard starts collapsed");
    check((await control("/events")).reads===before.reads,"Opening touchpad does not read history");
    await tab.locator("#pc-clipboard-toggle").click();await tab.locator(".pc-clipboard__item").first().waitFor();
    check(await tab.locator(".pc-clipboard__item").count()===4,"Recent history is shown");
    check((await control("/events")).events.length===before.events.length,"Browsing never sends PC input");
    check(await tab.locator("#pc-clipboard-list img").count()===0 && !await tab.evaluate(()=>window.clipboardInjected),"Clipboard markup is rendered as text");
    const opens=await tab.evaluate(()=>window.nativeKeyboardOpens);
    await control("/focus?value=2");await tab.waitForTimeout(100);
    check(await tab.evaluate(()=>window.nativeKeyboardOpens)===opens,"PC focus changes do not open native IME over clipboard panel");
    await tab.locator(".pc-clipboard__item").nth(1).click();
    check(await tab.locator("#pc-clipboard-text").inputValue()==="First line\nمرحبا 🙂\tSecond line","Selecting an item fills the editor with complete Unicode text");
    check((await control("/events")).events.length===before.events.length,"Selecting a history item does not paste yet");
    await tab.setViewportSize({width:800,height:150});
    for (const id of ["pc-clipboard-text","pc-clipboard-paste"]) {
      const r=await tab.locator("#"+id).boundingBox();
      check(r.y>=0 && r.height>=44 && r.y+r.height<=150, id+" fits above a landscape keyboard");
    }
    await tab.setViewportSize({width:800,height:360});
    await tab.locator("#pc-clipboard-text").fill("Edited first line\n🙂 second line");
    await tab.locator("#pc-clipboard-paste").click();await tab.waitForFunction(()=>document.getElementById("pc-clipboard-status").textContent.includes("Paste sent"));
    const sent=(await control("/events")).events.slice(before.events.length);
    check(sent.length===1&&sent[0].type==="paste"&&sent[0].target==="2"&&sent[0].text==="Edited first line\n🙂 second line","Only explicit Paste sends the edited text to the current PC target");
    await tab.locator(".pc-clipboard__item").first().click();await tab.locator("#pc-clipboard-close").click();
    check(await tab.locator("#pc-clipboard-list").evaluate(el=>el.children.length)===0 && await tab.locator("#pc-clipboard-text").inputValue()==="","Collapse clears history and text from the phone");
    await tab.locator("#pc-clipboard-toggle").click();await tab.locator("#pc-clipboard-close").click();await tab.waitForTimeout(250);
    check(await tab.locator("#pc-clipboard-list").evaluate(el=>el.children.length)===0,"Late history response cannot reopen or repopulate a collapsed panel");
    await control("/mode?value=disabled");await tab.locator("#pc-clipboard-toggle").click();
    await tab.waitForFunction(()=>document.getElementById("pc-clipboard-status").textContent.includes("Windows + V"));
    check(await tab.locator(".pc-clipboard__item").count()===0,"Disabled Windows history has clear setup guidance");
    await control("/mode?value=current-only");await tab.locator("#pc-clipboard-refresh").click();
    await tab.waitForFunction(()=>document.getElementById("pc-clipboard-status").textContent.includes("only its current clipboard"));
    check(await tab.locator(".pc-clipboard__item").count()===1,"A Linux PC without a history manager offers its current clipboard alone");
    await control("/mode?value=ready");await tab.locator("#pc-clipboard-refresh").click();await tab.locator(".pc-clipboard__item").first().waitFor();
    await tab.screenshot({path:"output/playwright/clipboard-phone.png"});
    let bounds=await tab.locator("#pc-clipboard-panel").boundingBox();
    check(bounds.x>=0&&bounds.x+bounds.width<=800&&bounds.y+bounds.height<=360,"Expanded panel fits a landscape phone");
    await tab.setViewportSize({width:1280,height:800});await tab.screenshot({path:"output/playwright/clipboard-tablet.png"});
    bounds=await tab.locator("#pc-clipboard-panel").boundingBox();
    check(bounds.width<=360&&bounds.x+bounds.width<=1280,"Tablet keeps the clipboard compact and leaves touchpad space");
    await tab.locator("#pc-clipboard-close").click();await tab.locator('.touchpad-navigation [data-close="input-pad"]').click();
    check(errors.length===0,"No uncaught UI errors");
    await tab.close();await page.waitForTimeout(100);
    const web=await client();await web.locator("#pc-clipboard-toggle").click();await web.locator(".pc-clipboard__item").first().waitFor();
    check(await web.locator("#pc-clipboard-panel").isVisible(),"Browser fallback works without an Android bridge");
    return {passed:results.length,results};
  }finally{for(const context of contexts)await context.close();}
}

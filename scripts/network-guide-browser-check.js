async (page) => {
  let checks=0;
  for (const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto('http://127.0.0.1:4173/setup.html#firewall-help');
    const decline=page.getByRole('button',{name:'No thanks',exact:true});
    if(await decline.isVisible()) await decline.click();
    await page.locator('#firewall-help').scrollIntoViewIfNeeded();
    if (!await page.locator('#firewall-help').isVisible()) throw Error('Firewall help is not reachable');
    if (!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)) throw Error('Horizontal overflow');
    const text=await page.locator('#firewall-help').innerText();
    if (!text.includes('USB tethering') || !text.includes('0.3 PREVIEW')) throw Error('Missing version or USB guidance');
    checks+=3;
    await page.screenshot({path:`artifacts/network-guide-${width}.png`});
  }
  return {passed:checks};
}

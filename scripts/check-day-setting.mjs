import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({root,configFile:false,cacheDir:"node_modules/.vite-keyword-browser",resolve:{alias:{"@":root}},
  optimizeDeps:{noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","class-variance-authority","clsx","lucide-react","next-themes","radix-ui","sonner","tailwind-merge"]},
  plugins:[react(),{name:"day-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url !== "/")return next();
    res.setHeader("Content-Type","text/html");res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/day-setting.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5197,strictPort:true,hmr:false}});
await server.listen();
const browser=await chromium.launch({channel:"chrome",headless:true});
try {
  for(const mobile of [false,true]) {
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
    const page=await context.newPage(); page.setDefaultTimeout(10000);
    let saved="2026-11-07",posts=0,failSave=false,failLoad=false;
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.route("**/api/**",async route=>{
      assert.equal(new URL(route.request().url()).pathname,"/api/settings/day");
      const post=route.request().method()==="POST";
      if(post)posts++;
      if((post&&failSave)||(!post&&failLoad))return route.fulfill({status:500,json:{error:"test error"}});
      if(post)saved=route.request().postDataJSON().targetDate;
      await route.fulfill({json:{targetDate:saved}});
    });
    await page.goto("http://127.0.0.1:5197/");
    const buttons=page.getByRole("button",{name:/D-day 설정/});await buttons.first().waitFor();
    assert.equal(await buttons.count(),2);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no horizontal overflow");
    const order=await page.locator('.daily-summary-controls').first().evaluate(el=>el.children[0].getBoundingClientRect().right<=el.children[1].getBoundingClientRect().left);
    assert.ok(order,"D-day appears left of today's learning");
    if(mobile) {
      for(const width of [320,375,390,430]) {
        await page.setViewportSize({width,height:844});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no overflow at ${width}`);
        for(const selector of ['.app-header','.selected-subject-row']) {
          const aligned=await page.locator(selector).evaluate(el=>{
            const [a,b]=Array.from(el.children).map(child=>child.getBoundingClientRect());
            return a.right<=b.left+1 && a.top<b.bottom && b.top<a.bottom;
          });
          assert.ok(aligned,`${selector} stays on one row at ${width}`);
        }
        assert.equal(await page.locator('.app-header p').innerText(),'카드 98장');
        assert.ok(await page.locator('.app-header').evaluate(el=>el.querySelector('.brand-line span:last-child').getBoundingClientRect().right < el.querySelector('.daily-summary-controls').getBoundingClientRect().left),`title does not overlap statistics at ${width}`);
        if(width===320)await page.screenshot({path:'/private/tmp/day-summary-narrow.png'});
      }
      await page.setViewportSize({width:390,height:844});
    }
    const surfaces=await page.locator('.daily-summary-controls').first().evaluate(el=>({border:getComputedStyle(el).borderTopWidth,children:Array.from(el.children).map(child=>getComputedStyle(child).borderTopWidth)}));
    assert.equal(surfaces.border,'1px');assert.deepEqual(surfaces.children,['0px','0px']);
    await page.screenshot({path:`/private/tmp/day-summary-${mobile?'mobile':'desktop'}.png`});
    await buttons.first().click();const date=page.getByLabel("목표 날짜");await date.waitFor();
    await page.waitForFunction(()=>!document.getElementById('day-target-date').disabled);
    assert.equal(await date.inputValue(),"2026-11-07");
    await date.fill("2027-01-01");await page.getByRole("button",{name:"취소",exact:true}).click();assert.equal(posts,0);
    await buttons.last().click();assert.equal(await date.inputValue(),saved);
    await date.fill("2027-01-01");failSave=true;await page.getByRole("button",{name:"저장",exact:true}).click();await page.getByRole("alert").waitFor();
    assert.equal(await date.inputValue(),"2027-01-01");failSave=false;
    await page.getByRole("button",{name:"저장",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
    assert.equal(await buttons.first().getAttribute("aria-label"),await buttons.last().getAttribute("aria-label"));
    assert.match(await buttons.first().getAttribute("aria-label"),/2027-01-01/);
    await page.reload();await buttons.first().click();await page.waitForFunction(()=>!document.getElementById('day-target-date').disabled);assert.equal(await date.inputValue(),saved);
    await page.getByRole("button",{name:"기본 날짜",exact:true}).click();assert.equal(await date.inputValue(),"2026-11-07");
    await page.keyboard.press("Escape");await page.getByRole("dialog").waitFor({state:"hidden"});assert.equal(saved,"2027-01-01");
    failLoad=true;await page.reload();await buttons.first().click();await page.getByRole("alert").waitFor();assert.ok(await page.getByRole("button",{name:"저장",exact:true}).isDisabled());
    failLoad=false;await page.getByRole("button",{name:"다시 불러오기"}).click();await page.waitForFunction(()=>!document.getElementById('day-target-date').disabled);assert.equal(await date.inputValue(),saved);
    await page.screenshot({path:`/private/tmp/day-setting-${mobile?'mobile':'desktop'}.png`});
    assert.deepEqual(errors,[]);console.log(`PASS ${mobile?'mobile':'desktop'}: default, placement, save, reload, cancel, Escape, reset, failure recovery`);
    await context.close();
  }
} finally {await browser.close();await server.close();}

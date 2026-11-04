import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";

const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||"playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:"node_modules/.vite-table-view-ratios",resolve:{alias:{"@":root}},
  optimizeDeps:{noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","class-variance-authority","clsx","lucide-react","next-themes","radix-ui","sonner","tailwind-merge"]},
  plugins:[react(),{name:"table-view-ratios-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url?.split("?")[0]!=="/")return next();
    res.setHeader("Content-Type","text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5193,strictPort:true,hmr:false}});
await server.listen();
const browser=await chromium.launch({channel:"chrome",headless:true});
const ratios=grid=>grid.evaluate(el=>{const widths=getComputedStyle(el).gridTemplateColumns.split(/\s+/).map(parseFloat),total=widths.reduce((sum,width)=>sum+width,0);return widths.map(width=>width/total);});
const compare=(actual,expected,label)=>actual.forEach((ratio,index)=>assert.ok(Math.abs(ratio-expected[index])<.003,`${label} column ${index}: ${ratio} vs ${expected[index]}`));
try{
  for(const mobile of [false,true])for(const buttonOnly of [false,true]){
    const page=await browser.newPage({viewport:{width:mobile?390:1400,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.route("**/api/**",route=>{errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();});
    await page.goto(`http://127.0.0.1:5193/?kind=viewer-ratio&layout${buttonOnly?"&button-only":""}`);
    const modal=page.locator(".table-editor-dialog"),cells=modal.locator("[data-table-cell-id]"),viewer=page.locator(".table-viewer-dialog");
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const openViewer=()=>page.getByRole("button",{name:buttonOnly?"표 확인하기":"표 크게 보기",exact:true}).click();
    const closeViewer=async()=>{
      const close=viewer.getByRole("button",{name:"Close",exact:true});
      try{await close.click();}catch(error){
        console.error(await close.evaluate(el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el);return{rect:r.toJSON(),z:style.zIndex,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,500),body:getComputedStyle(el.parentElement.querySelector(".table-viewer-body")).zIndex};}));
        await page.screenshot({path:"/private/tmp/table-view-ratios-close-error.png"});throw error;
      }
    };
    await page.getByRole("button",{name:"표 편집",exact:true}).click();await settle();await page.waitForTimeout(150);
    // First verify automatic proportions, then explicit partial and all-column locks.
    let expected=await ratios(modal.locator(".answer-table"));
    await modal.getByRole("button",{name:"표 편집 닫기"}).click();
    const original=await page.getByTestId("table-format").textContent();
    await openViewer();await settle();await page.waitForTimeout(200);
    compare(await ratios(viewer.locator(".answer-table")),expected,"automatic");
    await closeViewer();
    assert.equal(await page.getByTestId("table-format").textContent(),original);
    await page.getByRole("button",{name:"표 편집",exact:true}).click();await cells.nth(0).click();
    if(!mobile){await page.keyboard.press("Shift+ArrowRight");await page.keyboard.press("Shift+ArrowRight");}
    else await modal.getByRole("button",{name:"열 너비 고정",exact:true}).click();
    expected=await ratios(modal.locator(".answer-table"));
    await modal.getByRole("button",{name:"표 편집 닫기"}).click();
    await openViewer();await settle();await page.waitForTimeout(200);
    compare(await ratios(viewer.locator(".answer-table")),expected,"partial locks");
    await closeViewer();
    await page.getByRole("button",{name:"표 편집",exact:true}).click();
    if(mobile){await modal.getByRole("button",{name:"다중 선택",exact:true}).click();for(let i=0;i<3;i++)await cells.nth(i).click();}
    else{await cells.nth(0).click();await page.keyboard.press("Control+a");}
    await modal.getByRole("button",{name:"열 너비 고정",exact:true}).click();
    expected=await ratios(modal.locator(".answer-table"));
    await modal.getByRole("button",{name:"표 편집 닫기"}).click();
    const saved=await page.getByTestId("table-format").textContent(),applies=await page.getByTestId("table-applies").textContent();
    await openViewer();await settle();await page.waitForTimeout(200);
    compare(await ratios(viewer.locator(".answer-table")),expected,"all locks");
    const layout=await viewer.locator(".table-viewer-body").evaluate(body=>({width:body.clientWidth,scrollWidth:body.scrollWidth,font:parseFloat(getComputedStyle(body.querySelector(".answer-table")).fontSize),clipped:[...body.querySelectorAll(".answer-table-cell-content")].some(el=>el.scrollHeight>el.clientHeight+1)}));
    assert.ok(layout.scrollWidth<=layout.width+1,`no unnecessary horizontal scroll: ${JSON.stringify(layout)}`);
    assert.ok(layout.font>=12.5);assert.equal(layout.clipped,false);
    assert.equal(await viewer.getByRole("separator").count(),0,"viewer has no editor resize controls");
    assert.equal(await page.getByTestId("table-format").textContent(),saved);assert.equal(await page.getByTestId("table-applies").textContent(),applies,"viewing has no writes");
    if(mobile){
      assert.equal(await viewer.evaluate(el=>el.classList.contains("is-landscape")),true);
      await page.setViewportSize({width:844,height:390});await settle();await page.waitForTimeout(200);
      compare(await ratios(viewer.locator(".answer-table")),expected,"landscape orientation preserves saved ratios");
    }
    await page.screenshot({path:`/private/tmp/table-view-ratios-${mobile?"mobile":"desktop"}-${buttonOnly?"button":"inline"}.png`});
    await closeViewer();await openViewer();await settle();await page.waitForTimeout(150);
    compare(await ratios(viewer.locator(".answer-table")),expected,"reopen");
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mobile?"mobile":"desktop"} ${buttonOnly?"library button":"inline preview"}: automatic, partial/all locks, text fit, reopen, no writes`);
    await page.close();
  }
}finally{await browser.close();await server.close();}

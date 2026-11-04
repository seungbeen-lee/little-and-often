import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";

const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||"playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:"node_modules/.vite-table-uniform-center",resolve:{alias:{"@":root}},
  optimizeDeps:{noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","class-variance-authority","clsx","lucide-react","next-themes","radix-ui","sonner","tailwind-merge"]},
  plugins:[react(),{name:"table-uniform-center-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url?.split("?")[0]!=="/")return next();
    res.setHeader("Content-Type","text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5190,strictPort:true,hmr:false}});
await server.listen();
const browser=await chromium.launch({channel:"chrome",headless:true});
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1,`${label}: ${a} vs ${b}`);
const centered=async cell=>{
  const box=await cell.evaluate(el=>{
    const cell=el.getBoundingClientRect(),content=el.querySelector(".answer-table-cell-content").getBoundingClientRect(),style=getComputedStyle(el);
    return{cellY:cell.y+cell.height/2,contentY:content.y+content.height/2,textAlign:style.textAlign,shade:el.className,height:cell.height,contentHeight:content.height};
  });
  assert.match(box.shade,/shade-1/);assert.equal(box.textAlign,"center");near(box.cellY,box.contentY,"merged gray content is vertically centered");
};
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:{width:mobile?390:1400,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
    page.setDefaultTimeout(10000);const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/api/**",route=>{errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();});
    await page.goto("http://127.0.0.1:5190/?kind=viewer-ratio&layout&button-only");
    await page.getByRole("button",{name:"표 편집",exact:true}).click();
    const modal=page.locator(".table-editor-dialog"),grid=modal.locator(".answer-table"),cells=modal.locator("[data-table-cell-id]");
    const ids=await cells.evaluateAll(els=>els.map(el=>el.dataset.tableCellId));
    const cell=id=>modal.locator(`[data-table-cell-id="${id}"]`);
    const button=name=>modal.getByRole("button",{name,exact:true});
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const widths=()=>grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(/\s+/).map(parseFloat));
    await settle();await cell(ids[0]).click();await button("열 너비 고정").click();await settle();
    const original=await widths();
    assert.ok(Math.max(...original)-Math.min(...original)>10,"fixture starts with unequal widths");
    const equal=button("열 너비 균등하게");await equal.click();await settle();
    let actual=await widths();actual.forEach(width=>near(width,actual[0],"all columns equal, including previous lock"));
    await equal.click();await button("표 되돌리기").click();await settle();
    actual=await widths();actual.forEach((width,index)=>near(width,original[index],"one undo restores original proportions"));
    await button("표 다시 실행").click();await settle();actual=await widths();actual.forEach(width=>near(width,actual[0],"redo equal widths"));
    // Select a vertical pair, shade it, then merge; the first row has much
    // taller neighbouring content, so top alignment would visibly fail.
    await page.keyboard.press("Escape");
    const selectPair=async(a,b)=>{
      if(mobile){await button("다중 선택").click();await cell(a).click();await cell(b).click();}
      else{await cell(a).click();await cell(b).click({modifiers:["Shift"]});}
    };
    await selectPair(ids[3],ids[6]);await button("칸 색깔 변경").click();await button("병합").click();await settle();
    await centered(cell(ids[3]));
    assert.equal(await cell(ids[4]).evaluate(el=>getComputedStyle(el).textAlign),"left","white cells retain their original alignment");
    if(mobile)await button("다중 선택").click();
    await page.keyboard.press("Escape");
    await selectPair(ids[0],ids[1]);await button("칸 색깔 변경").click();await button("병합").click();await settle();
    await centered(cell(ids[0]));
    const toolbar=await modal.locator(".table-edit-dock").boundingBox();assert.ok(toolbar.width<(mobile?390:1400),"the extra button still fits the toolbar");
    await page.screenshot({path:`/private/tmp/table-uniform-center-${mobile?"mobile":"desktop"}.png`});
    await button("표 편집 닫기").click();
    const saved=await page.getByTestId("table-format").textContent(),applies=await page.getByTestId("table-applies").textContent();
    const doc=JSON.parse(saved.slice("[table:v1]".length));
    Object.values(doc.columnWidthLocks).forEach(width=>near(width*100,100/3,"saved equal ratio"));
    await page.getByRole("button",{name:"표 확인하기",exact:true}).click();await settle();await page.waitForTimeout(200);
    const viewer=page.locator(".table-viewer-dialog");
    await centered(viewer.locator(`[data-table-cell-id="${ids[3]}"]`));
    await centered(viewer.locator(`[data-table-cell-id="${ids[0]}"]`));
    assert.equal(await page.getByTestId("table-format").textContent(),saved);assert.equal(await page.getByTestId("table-applies").textContent(),applies,"viewing does not write test data");
    await viewer.getByRole("button",{name:"Close",exact:true}).click();
    await page.getByRole("button",{name:"표 편집",exact:true}).click();await settle();
    actual=await widths();actual.forEach(width=>near(width,actual[0],"equal widths survive reopen"));await centered(cell(ids[3]));
    assert.deepEqual(errors,[]);console.log(`PASS ${mobile?"mobile":"desktop"}: equal-width button, prior locks, one-step undo/redo, save/reopen, vertical/horizontal gray merge centering, viewer and white-cell regression`);
    await page.close();
  }
}finally{await browser.close();await server.close();}

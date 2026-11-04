import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";
const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||"playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:"node_modules/.vite-table-alignment",resolve:{alias:{"@":root}},
  optimizeDeps:{noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","class-variance-authority","clsx","lucide-react","next-themes","radix-ui","sonner","tailwind-merge"]},
  plugins:[react(),{name:"alignment-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url?.split("?")[0]!=="/")return next();
    res.setHeader("Content-Type","text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5191,strictPort:true,hmr:false}});
await server.listen();
console.log("Alignment preview: http://127.0.0.1:5191/");
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||"msedge",headless:true});
try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/**",route=>{errors.push("Unexpected API");return route.abort();});
  await page.goto("http://127.0.0.1:5191/?kind=viewer-ratio&layout&button-only");
  await page.getByRole("button",{name:"표 편집",exact:true}).click();
  const modal=page.locator(".table-editor-dialog"),cells=modal.locator("[data-table-cell-id]");
  const first=cells.nth(3),second=cells.nth(4);
  await first.click();
  for(const expected of ["center","right","justify","left"]){
    await page.keyboard.press("F8");
    await page.waitForFunction(({id,expected})=>getComputedStyle(document.querySelector(`[data-table-cell-id="${id}"]`)).textAlign===expected,{id:await first.getAttribute("data-table-cell-id"),expected});
  }
  await second.click({modifiers:["Shift"]});await page.keyboard.press("F8");
  assert.equal(await first.evaluate(el=>getComputedStyle(el).textAlign),"center");
  assert.equal(await second.evaluate(el=>getComputedStyle(el).textAlign),"center");
  await page.keyboard.press("Control+z");
  assert.equal(await first.evaluate(el=>getComputedStyle(el).textAlign),"left");
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await first.evaluate(el=>getComputedStyle(el).textAlign),"center");
  await first.dblclick();
  const editor=first.locator('[contenteditable="true"]');await editor.waitFor();
  const before=await editor.textContent();await page.keyboard.press("F8");
  assert.equal(await first.evaluate(el=>getComputedStyle(el).textAlign),"right");
  assert.equal(await editor.textContent(),before);
  await page.keyboard.down("F8");await page.keyboard.down("F8");await page.keyboard.up("F8");
  assert.equal(await first.evaluate(el=>getComputedStyle(el).textAlign),"justify","held key only cycles once");
  await modal.getByRole("button",{name:"표 편집 닫기",exact:true}).click();
  await page.getByRole("button",{name:"표 편집",exact:true}).click();
  assert.equal(await first.evaluate(el=>getComputedStyle(el).textAlign),"justify","saved alignment survives reopening");
  assert.deepEqual(errors,[]);
  console.log("PASS alignment cycle, multi-selection, undo/redo, editing, key repeat, save/reopen");
  for(const width of [1400,390,320]){
    const mobile=width<760;
    const p=await browser.newPage({viewport:{width,height:900},isMobile:mobile,hasTouch:mobile});
    await p.goto("http://127.0.0.1:5191/?kind=viewer-ratio&layout&button-only");
    await p.getByRole("button",{name:"표 편집",exact:true}).click();
    const m=p.locator(".table-editor-dialog"),a=m.locator('[data-table-cell-id]').nth(3),b=m.locator('[data-table-cell-id]').nth(4);
    const button=m.getByRole("button",{name:/글자 정렬 변경/});
    assert.equal(await button.isDisabled(),true);
    await a.click();
    for(const expected of ["center","right","justify","left"]){
      if(mobile)await button.tap();else await button.click();
      assert.equal(await a.evaluate(el=>getComputedStyle(el).textAlign),expected);
      assert.equal(await button.getAttribute("data-alignment"),expected);
    }
    if(mobile){await m.getByRole("button",{name:"다중 선택",exact:true}).tap();await b.tap();}
    else await b.click({modifiers:["Shift"]});
    await button.click();
    for(const c of [a,b])assert.equal(await c.evaluate(el=>getComputedStyle(el).textAlign),"center");
    await m.getByRole("button",{name:"표 되돌리기",exact:true}).click();
    assert.equal(await a.evaluate(el=>getComputedStyle(el).textAlign),"left");
    const boxes=await m.locator('.table-edit-dock>button').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width,height:r.height};}));
    assert.ok(boxes.every(r=>r.x>=0&&r.right<=width&&r.width>=40&&r.height>=44),"all dock tools fit and stay tappable");
    await p.close();console.log(`PASS dock button ${width}px: tap/click cycle, multi-select, undo, layout`);
  }
}finally{await browser.close();await server.close();}

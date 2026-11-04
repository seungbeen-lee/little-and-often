import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";

const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||"playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:"node_modules/.vite-table-column-resize",resolve:{alias:{"@":root}},
  optimizeDeps:{noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","class-variance-authority","clsx","lucide-react","next-themes","radix-ui","sonner","tailwind-merge"]},
  plugins:[react(),{name:"table-column-resize-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url?.split("?")[0]!=="/")return next();
    res.setHeader("Content-Type","text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5195,strictPort:true,hmr:false}});
await server.listen();
const browser=await chromium.launch({channel:"chrome",headless:true});
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1,`${message}: ${a} vs ${b}`);
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:{width:mobile?390:1400,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
    page.setDefaultTimeout(10000);
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/api/**",route=>{errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();});
    await page.goto("http://127.0.0.1:5195/?kind=table&layout");
    const open=()=>page.getByRole("button",{name:"표 편집",exact:true}).click();
    await open();
    const modal=page.locator(".table-editor-dialog"),cells=modal.locator("[data-table-cell-id]"),grid=modal.locator(".answer-table");
    const button=name=>modal.getByRole("button",{name,exact:true});
    const widths=()=>grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(/\s+/).map(parseFloat));
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const format=()=>page.getByTestId("table-format").textContent();
    const undo=async()=>{await button("표 되돌리기").click();await settle();};
    const original=await format();
    await cells.nth(0).click();await settle();
    const initial=await widths();
    if(mobile){
      assert.equal(await modal.getByRole("separator").count(),0,"mobile has no drag handles");
      await page.keyboard.press("Shift+ArrowRight");await settle();
      near((await widths())[0],initial[0],"desktop resize shortcut leaves mobile unchanged");
      assert.equal(await format(),original);
    }else{
      await modal.getByRole("separator").first().waitFor();
      await page.keyboard.press("Shift+ArrowRight");await settle();
      let resized=await widths();near(resized[0],initial[0]+8,"Shift Right grows selected column");near(resized[1],initial[1]-8,"neighbour shrinks");near(resized[2],initial[2],"unrelated column unchanged");
      assert.equal(await cells.nth(0).evaluate(el=>getComputedStyle(el).outlineColor),"rgb(37, 99, 235)");
      await undo();near((await widths())[0],initial[0],"keyboard undo");
      await button("표 다시 실행").click();await settle();near((await widths())[0],resized[0],"keyboard redo");
      await page.keyboard.press("Escape");await cells.nth(2).click();
      const beforeLast=await widths();await page.keyboard.press("Shift+ArrowRight");await settle();
      near((await widths())[2],beforeLast[2]+8,"last column Right grows selected column using left edge");
      await undo();await undo();
      await page.keyboard.press("Escape");await cells.nth(0).click();await settle();
      const handle=modal.getByRole("separator").first(),rect=await handle.boundingBox();
      await page.mouse.move(rect.x+rect.width/2,rect.y+30);await page.mouse.down();
      await page.mouse.move(rect.x+rect.width/2+60,rect.y+30,{steps:8});await settle();
      near((await widths())[0],initial[0]+60,"drag preview");
      await page.waitForTimeout(650);assert.equal(await format(),original,"drag previews do not auto-save intermediate widths");
      await page.mouse.up();await settle();
      resized=await widths();near(resized[0],initial[0]+60,"drag commit");
      await undo();near((await widths())[0],initial[0],"entire drag is a single undo step");
      await button("표 다시 실행").click();await settle();
      const locked=await widths(),rect2=await handle.boundingBox();
      await page.mouse.move(rect2.x+rect2.width/2,rect2.y+30);await page.mouse.down();await page.mouse.move(rect2.x+rect2.width/2-30,rect2.y+30,{steps:4});
      await page.keyboard.press("Escape");await settle();await page.mouse.up();
      near((await widths())[0],locked[0],"Escape cancels drag without closing or clearing cell selection");
      assert.equal(await modal.count(),1);assert.equal(await cells.nth(0).getAttribute("class").then(value=>value.includes("is-selected")),true);
      // Normal text selection (including Korean composition) must not resize.
      await cells.nth(0).dblclick();const editor=modal.locator('[data-table-editor][contenteditable="true"]');
      await page.keyboard.press("Shift+ArrowLeft");await settle();near((await widths())[0],locked[0],"text selection is preserved");
      const cell=await cells.nth(0).getAttribute("data-table-cell-id");
      await page.keyboard.press("Escape");
      await cells.nth(0).evaluate(el=>el.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",shiftKey:true,isComposing:true,bubbles:true})));
      await settle();near((await widths())[0],locked[0],"IME composition does not resize");
      await cells.nth(0).dblclick();await editor.fill("긴 열 내용 ".repeat(30));await settle();near((await widths())[0],locked[0],"added text cannot alter manually adjusted width");
      await button("표 편집 닫기").click();await open();await settle();near((await widths())[0],locked[0],"resized width persists on reopen");
      assert.equal(await cells.nth(0).getAttribute("data-table-cell-id"),cell,"cell identities are stable");
      await page.screenshot({path:"/private/tmp/table-column-resize-desktop.png"});
      // Merge does not remove the underlying column boundaries or resize other rows.
      await cells.nth(0).click();await cells.nth(1).click({modifiers:["Shift"]});await button("병합").click();await settle();
      assert.equal(await modal.getByRole("separator").count(),2);
      await page.keyboard.press("Escape");await cells.nth(0).click();
      const merged=await widths();await page.keyboard.press("Shift+ArrowRight");await settle();near((await widths())[1],merged[1]+8,"merged cell uses its rightmost column boundary");
      const bounds=await grid.boundingBox();assert.ok(bounds.width<1400,"resizing stays within table viewport");
      // Responsive change removes desktop controls rather than hijacking mobile gestures.
      await page.setViewportSize({width:390,height:844});await settle();assert.equal(await modal.getByRole("separator").count(),0);
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mobile?"mobile unchanged":"desktop drag, keyboard, edge/merged columns, undo/redo, cancel, text selection, IME, persistence, responsive controls"}`);
    await page.close();
  }
}finally{await browser.close();await server.close();}

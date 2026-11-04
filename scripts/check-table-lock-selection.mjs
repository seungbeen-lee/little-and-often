import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";

const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||"playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:"node_modules/.vite-table-lock-selection",resolve:{alias:{"@":root}},
  optimizeDeps:{noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","class-variance-authority","clsx","lucide-react","next-themes","radix-ui","sonner","tailwind-merge"]},
  plugins:[react(),{name:"table-lock-selection-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url?.split("?")[0]!=="/")return next();
    res.setHeader("Content-Type","text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5196,strictPort:true,hmr:false}});
await server.listen();
const browser=await chromium.launch({channel:"chrome",headless:true});
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:{width:mobile?390:1400,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.route("**/api/**",route=>{errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();});
    await page.goto("http://127.0.0.1:5196/?kind=table&layout");
    await page.getByRole("button",{name:"표 편집",exact:true}).waitFor().catch(async error=>{console.error({errors,body:(await page.locator("body").innerText()).slice(0,500)});throw error;});
    await page.getByRole("button",{name:"표 편집",exact:true}).click();
    const modal=page.locator(".table-editor-dialog"),cells=modal.locator("[data-table-cell-id]");
    const button=name=>modal.getByRole("button",{name,exact:true});
    const color=cell=>cell.evaluate(el=>getComputedStyle(el).outlineColor);
    await cells.nth(0).click();
    assert.equal(await color(cells.nth(0)),"rgb(42, 146, 114)","unlocked selection remains green");
    await button("열 너비 고정").click();
    assert.equal(await color(cells.nth(0)),"rgb(37, 99, 235)","locked selection becomes blue immediately");
    await cells.nth(3).dblclick();
    const field=modal.locator("[data-table-editor]").nth(3);
    assert.match(await field.evaluate(el=>getComputedStyle(el).boxShadow),/rgb\(37, 99, 235\)/,"locked caret underline is blue too");
    await cells.nth(1).click();
    assert.equal(await color(cells.nth(1)),"rgb(42, 146, 114)","another unlocked column remains green");
    if(mobile){await button("다중 선택").click();await cells.nth(0).click();}
    else await cells.nth(0).click({modifiers:["Meta"]});
    assert.equal(await color(cells.nth(0)),"rgb(37, 99, 235)");
    assert.equal(await color(cells.nth(1)),"rgb(42, 146, 114)","mixed selection keeps each column's lock color");
    await page.screenshot({path:`/private/tmp/table-lock-selection-${mobile?"mobile":"desktop"}.png`});
    if(mobile)await button("다중 선택").click();
    await page.keyboard.press("Escape");await cells.nth(0).click();
    await button("열 너비 고정 해제").click();
    assert.equal(await color(cells.nth(0)),"rgb(42, 146, 114)","unlock restores green immediately");
    await button("열 너비 고정").click();
    await button("표 편집 닫기").click();
    await page.getByRole("button",{name:"표 편집",exact:true}).click();
    await cells.nth(0).click();
    assert.equal(await color(cells.nth(0)),"rgb(37, 99, 235)","reopened locks retain blue selection");
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mobile?"mobile":"desktop"}: green unlocked / blue locked selection, blue caret, mixed selection, unlock and reopen`);
    await page.close();
  }
}finally{await browser.close();await server.close();}

import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";

const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||"playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:"node_modules/.vite-table-view-spacing",resolve:{alias:{"@":root}},
  optimizeDeps:{noDiscovery:true,include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","class-variance-authority","clsx","lucide-react","next-themes","radix-ui","sonner","tailwind-merge"]},
  plugins:[react(),{name:"table-view-spacing-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url?.split("?")[0]!=="/")return next();
    res.setHeader("Content-Type","text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5194,strictPort:true,hmr:false}});
await server.listen();
const browser=await chromium.launch({channel:"chrome",headless:true});
const geometry=cell=>cell.evaluate(el=>{
  const content=el.querySelector(".answer-table-cell-content"),word=content.querySelector("strong");
  const range=document.createRange();range.selectNodeContents(word);range.setEnd(word.firstChild,1);
  const style=getComputedStyle(word);
  return{offset:range.getBoundingClientRect().left-content.getBoundingClientRect().left,paddingLeft:parseFloat(style.paddingLeft),paddingRight:parseFloat(style.paddingRight),text:content.textContent};
});
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:{width:mobile?390:1400,height:mobile?844:1000},isMobile:mobile,hasTouch:mobile});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/api/**",route=>{errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();});
    await page.goto("http://127.0.0.1:5194/?kind=table&spacing");
    await page.getByRole("button",{name:"표 편집",exact:true}).click();
    const modal=page.locator(".table-editor-dialog"),cells=modal.locator("[data-table-cell-id]");
    const before=await page.getByTestId("table-format").textContent();
    const editor=await geometry(cells.nth(0));
    await modal.getByRole("button",{name:"미리보기",exact:true}).click();
    const view=await geometry(cells.nth(0));
    console.log(`${mobile?"mobile":"desktop"}: edit offset ${editor.offset}px / view offset ${view.offset}px; keyword padding ${view.paddingLeft}px, ${view.paddingRight}px`);
    assert.ok(Math.abs(view.offset-editor.offset)<.5,"view must not add leading indentation to a bold first word");
    assert.equal(view.paddingLeft,0);assert.equal(view.paddingRight,0);
    assert.equal(view.text,"첫 글자부터 시작");
    assert.equal(await cells.nth(2).locator(".answer-table-cell-content").textContent(),"  직접 입력한 공백\n다음 줄의 내용","literal spaces and line breaks remain untouched");
    assert.equal(await cells.nth(3).locator(".answer-table-cell-content").textContent(),"자율활동","inline bold does not insert a word separator");
    assert.equal(await cells.nth(4).locator(".answer-table-cell-content").textContent(),"- 목록 : 설명","list punctuation and intentional spaces remain");
    assert.equal(await cells.nth(5).locator(".answer-table-cell-content").textContent(),"첫째, 둘째");
    assert.equal(await page.getByTestId("table-format").textContent(),before,"viewing never changes the saved format or keyword IDs");
    assert.equal(await page.getByTestId("table-applies").textContent(),"0","viewing causes no save");
    await page.screenshot({path:`/private/tmp/table-view-spacing-${mobile?"mobile":"desktop"}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mobile?"mobile":"desktop"}: no keyword indentation, inline spacing preserved, no data writes`);
    await page.close();
  }
}finally{await browser.close();await server.close();}

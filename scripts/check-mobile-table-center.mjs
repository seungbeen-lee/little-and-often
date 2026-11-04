import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";

const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||"playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:"node_modules/.vite-table-center",resolve:{alias:{"@":root}},
  plugins:[react(),{name:"table-center-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url?.split("?")[0]!=="/")return next();
    res.setHeader("Content-Type","text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5199,strictPort:true,hmr:false}});
await server.listen();
const browser=await chromium.launch({channel:"chrome",headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  page.on("pageerror",error=>console.error("page error",error.message));
  await page.route("**/api/**",route=>route.abort());
  await page.goto("http://127.0.0.1:5199/?kind=viewer");
  await page.getByRole("button",{name:"표 확인하기"}).waitFor({timeout:8000}).catch(async error=>{console.error("body",(await page.locator("body").innerText()).slice(0,1000));throw error;});
  await page.getByRole("button",{name:"표 확인하기"}).click();
  const dialog=page.locator(".table-viewer-dialog"),body=dialog.locator(".table-viewer-body"),table=body.locator(".answer-table");
  await table.waitFor();await page.waitForTimeout(300);
  const bounds=await table.boundingBox();
  assert.ok(bounds,"mobile table visible");
  assert.ok(Math.abs(bounds.x+bounds.width/2-195)<8,`portrait viewer centers table horizontally: ${JSON.stringify(bounds)}`);
  assert.ok(Math.abs(bounds.y+bounds.height/2-422)<8,`portrait viewer centers table vertically: ${JSON.stringify(bounds)}`);
  await page.screenshot({path:"/private/tmp/mobile-table-centered.png"});
  await page.getByRole("button",{name:"Close"}).click();
  await page.goto("http://127.0.0.1:5199/?kind=viewer&tall");
  await page.getByRole("button",{name:"표 확인하기"}).click();await page.waitForTimeout(300);
  const overflow=await page.locator(".table-viewer-body").evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}));
  assert.ok(overflow.scrollHeight>overflow.height,"long table remains scrollable");
  assert.equal(overflow.scrollTop,0,"long table initially shows its first rows");
  console.log("PASS mobile rotated table starts centered and long tables remain scrollable");
}finally{await browser.close();await server.close();}

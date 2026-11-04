import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";
const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||"playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:"node_modules/.vite-multi-selection",resolve:{alias:{"@":root}},
  plugins:[react(),{name:"multi-selection-fixture",configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url?.split("?")[0]!=="/")return next();
    res.setHeader("Content-Type","text/html");res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
  });}}],server:{host:"127.0.0.1",port:5197,strictPort:true,hmr:false}});
await server.listen();const browser=await chromium.launch({channel:"chrome",headless:true});
try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[];page.setDefaultTimeout(10000);page.on("pageerror",e=>{errors.push(e.message);console.error(e.message);});
  let saves=[];
  // No requests leave this isolated fixture; production cards/history never load.
  await page.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const payload=route.request().postDataJSON();
    if(path==="/api/cards/organize") {
      saves.push(payload);
      return route.fulfill({json:{cards:payload.cards.map((card,index)=>({...card,id:card.id??100+index,subject:payload.subject,keywords:[],sortOrder:index,updatedAt:"2026-09-27T12:00:00.000Z"}))}});
    }
    if(path==="/api/sets")return route.fulfill({json:{set:{...payload,id:99}}});
    errors.push(`Unexpected request: ${path}`);return route.abort();
  });
  const rows=page.locator("[data-editor-card-row]");
  const selected=()=>rows.evaluateAll(els=>els.flatMap((el,i)=>el.getAttribute("aria-selected")==="true"?[i+1]:[]));
  const clickRow=(index,modifiers=[])=>rows.nth(index-1).locator(".bulk-number-cell span").click({modifiers});
  await page.goto("http://127.0.0.1:5197/");
  const originalOrder=await rows.evaluateAll(els=>els.map(el=>el.dataset.editorCardRow));
  for (const handle of [rows.first().locator(".drag-handle"), page.locator(".bulk-table .drag-handle").first()]) {
    await handle.click();assert.equal(await page.locator(".bulk-drag-ghost").count(),1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".bulk-drag-ghost").count(),0,"Esc cancels card/section handle");
    assert.equal(await handle.getAttribute("aria-pressed"),"false");
    assert.equal(await page.locator(".bulk-dialog[data-state=open]").count(),1,"editor stays open");
    assert.deepEqual(await rows.evaluateAll(els=>els.map(el=>el.dataset.editorCardRow)),originalOrder);
  }
  assert.equal(saves.length,0,"cancelling a move does not save or reorder cards");
  const classification=rows.first().getByRole("listbox");
  assert.deepEqual(await classification.getByRole("option").allTextContents(),["교육과정","교과교육론","각론","수업모형","지도서총론"]);
  for(const contentType of ["교과교육론","지도서총론"]){
    await classification.getByRole("option",{name:contentType,exact:true}).click();
    await page.waitForFunction(type=>document.querySelector('[data-editor-card-row] [role="option"][aria-selected="true"]')?.textContent===type,contentType);
    await page.waitForFunction(()=>document.querySelector('.bulk-footer')?.textContent?.includes("자동 저장됨"));
    assert.equal(saves.at(-1).cards[0].contentType,contentType,"renamed classification persists through normal editing");
  }
  console.log("PASS renamed classification choices and autosave payloads");
  for(const index of [0,4]) {
    const memo=rows.nth(index).locator('[data-bulk-focus-kind="memo"]');
    await memo.click();assert.deepEqual(await selected(),[],"normal/table memo must not select a card");
    assert.equal(await memo.evaluate(el=>el===document.activeElement),true,"memo caret remains editable");
  }
  await rows.first().locator('.bulk-type-listbox [role="option"]').first().click();assert.deepEqual(await selected(),[],"classification control must not select a card");
  await rows.nth(1).locator(".bulk-tools-cell").click({position:{x:2,y:2}});assert.deepEqual(await selected(),[2],"right empty rail selects");
  await rows.first().locator(".bulk-type-cell").click({position:{x:2,y:2},modifiers:["Shift"]});assert.deepEqual(await selected(),[1,2],"left empty rail supports ranges");
  await rows.nth(4).locator('[data-bulk-focus-kind="memo"]').click();assert.deepEqual(await selected(),[1,2],"editing does not alter an existing selection");
  await page.keyboard.press("Escape");
  await clickRow(1);await clickRow(4,["Shift"]);assert.deepEqual(await selected(),[1,2,3,4]);
  await clickRow(2,["Shift"]);assert.deepEqual(await selected(),[1,2],"shift keeps original anchor");
  await clickRow(5,["Meta"]);assert.deepEqual(await selected(),[1,2,5]);
  // macOS consumes physical Ctrl-click as context-menu; dispatch the Windows
  // Ctrl-click event separately while exercising real Cmd-click above.
  await rows.nth(1).locator(".bulk-number-cell span").dispatchEvent("click",{ctrlKey:true});assert.deepEqual(await selected(),[1,5]);
  await clickRow(5);await clickRow(2,["Shift"]);assert.deepEqual(await selected(),[2,3,4,5],"reverse range");
  await rows.nth(2).locator(".bulk-tools-cell button").first().click();assert.deepEqual(await selected(),[2,3,4,5],"right tools do not select");
  await rows.nth(0).locator(".drag-handle").click();assert.deepEqual(await selected(),[2,3,4,5],"drag handle does not select");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".bulk-drag-ghost").count(),0);
  assert.deepEqual(await selected(),[2,3,4,5],"first Esc cancels handle only, preserves card selection");
  await page.keyboard.press("Escape");assert.deepEqual(await selected(),[],"next Esc clears card selection");
  const question=rows.nth(0).locator('[data-bulk-focus-kind="question"]');
  await question.click();assert.deepEqual(await selected(),[]);await question.press("End");await page.keyboard.insertText(" 입력");
  assert.match(await question.textContent(),/입력/);await question.press("Enter");
  await page.waitForFunction(()=>document.activeElement?.getAttribute("data-bulk-focus-kind")==="answer");
  assert.equal(await rows.nth(0).locator('[data-bulk-focus-kind="answer"]').evaluate(el=>el===document.activeElement),true,"Enter still advances after selecting a card");
  await clickRow(1);await clickRow(3,["Shift"]);
  await page.getByRole("button",{name:"선택 삭제 (3)",exact:true}).click();
  await page.getByRole("alertdialog").getByRole("button",{name:"취소",exact:true}).click();assert.equal(await rows.count(),5);
  await page.getByRole("button",{name:"선택 삭제 (3)",exact:true}).click();
  assert.equal(await page.getByRole("button",{name:"선택 카드 삭제",exact:true}).count(),0,"first confirmation cannot delete");
  const savesBeforeConfirmation=saves.length;
  await page.getByRole("alertdialog").getByRole("button",{name:"계속",exact:true}).click();
  assert.equal(await rows.count(),5);assert.equal(saves.length,savesBeforeConfirmation,"first confirmation does not save/delete");
  await page.getByRole("alertdialog").getByRole("button",{name:"취소",exact:true}).click();assert.equal(await rows.count(),5,"second confirmation can cancel");
  await page.getByRole("button",{name:"선택 삭제 (3)",exact:true}).click();
  await page.getByRole("alertdialog").getByRole("button",{name:"계속",exact:true}).click();
  await page.getByRole("button",{name:"선택 카드 삭제",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll("[data-editor-card-row]").length===2);
  await page.waitForFunction(()=>document.querySelector('[data-testid="saved-cards"]').textContent==="[4,5]");
  assert.deepEqual(saves.at(-1).cards.map(c=>c.id),[4,5]);
  await clickRow(1);await clickRow(2,["Shift"]);await page.getByRole("button",{name:"세트",exact:true}).click();
  assert.equal(await page.getByText("2장의 카드를 묶을 이름과 설명을 적어 주세요.").count(),1,"set uses selected cards");
  await page.getByPlaceholder("예: 총론에서 헷갈리는 원리").fill("선택 테스트 세트");await page.getByRole("button",{name:"만들기",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="saved-set"]').textContent!=="null");
  assert.deepEqual(JSON.parse(await page.getByTestId("saved-set").textContent()).cardIds,[4,5]);
  await clickRow(1);await clickRow(2,["Shift"]);await page.getByRole("button",{name:"선택 삭제 (2)",exact:true}).click();await page.getByRole("alertdialog").getByRole("button",{name:"계속",exact:true}).click();await page.getByRole("button",{name:"선택 카드 삭제",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="saved-cards"]').textContent==="[]");
  assert.deepEqual(saves.at(-1).deleteCardIds,[4,5]);assert.deepEqual(saves.at(-1).cards,[]);
  console.log("PASS card ranges, toggles, exclusions, editing/navigation, delete cancellation/subset/all, set creation entry");
  await page.goto("http://127.0.0.1:5197/?kind=table");await page.getByRole("button",{name:"표 편집",exact:true}).click();
  const cells=page.locator("[data-table-cell-id]");
  const chosen=()=>cells.evaluateAll(els=>els.flatMap((el,i)=>el.classList.contains("is-selected")?[i+1]:[]));
  await cells.nth(0).click();await cells.nth(4).click({modifiers:["Shift"]});assert.deepEqual(await chosen(),[1,2,4,5]);
  await cells.nth(8).click({modifiers:["Meta"]});assert.deepEqual(await chosen(),[1,2,4,5,9]);
  await cells.nth(1).dispatchEvent("click",{ctrlKey:true});assert.deepEqual(await chosen(),[1,4,5,9]);
  await cells.nth(8).click();await cells.nth(0).click({modifiers:["Shift"]});assert.equal((await chosen()).length,9);
  await cells.nth(0).click();await page.keyboard.press("Meta+a");assert.equal((await chosen()).length,9);
  await page.getByRole("button",{name:"키워드 지정",exact:true}).click();
  await page.getByRole("button",{name:"표 편집 닫기",exact:true}).click();
  assert.deepEqual(JSON.parse(await page.getByTestId("words").textContent()),Array.from({length:9},(_,i)=>`항목 ${i+1}`),"mixed cells all become bold together");
  await page.getByRole("button",{name:"표 편집",exact:true}).click();
  assert.equal(await page.getByRole("button",{name:"전체 칸 선택",exact:true}).count(),0);
  await cells.nth(0).click();await page.keyboard.press("Meta+a");
  await page.getByRole("button",{name:"키워드 지정",exact:true}).click();await page.getByRole("button",{name:"표 편집 닫기",exact:true}).click();assert.deepEqual(JSON.parse(await page.getByTestId("words").textContent()),[]);
  await page.getByRole("button",{name:"표 편집",exact:true}).click();await cells.nth(0).dblclick();await page.keyboard.press("Meta+a");
  assert.equal((await chosen()).length,1,"text editing Cmd+A selects text, not cells");
  console.log("PASS table rectangular ranges, toggles, select-all, mixed bulk bold/unbold, text selection");
  const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await mobile.route("**/api/**",route=>route.abort());await mobile.goto("http://127.0.0.1:5197/?kind=table");
  await mobile.getByRole("button",{name:"표 편집",exact:true}).click();assert.equal(await mobile.getByRole("button",{name:"전체 칸 선택",exact:true}).count(),0);
  await mobile.getByRole("button",{name:"다중 선택",exact:true}).click();await mobile.locator("[data-table-cell-id]").nth(0).tap();await mobile.locator("[data-table-cell-id]").nth(8).tap();
  assert.equal(await mobile.locator(".answer-table-cell.is-selected").count(),2,"mobile individual toggle remains");
  await mobile.goto("http://127.0.0.1:5197/");assert.equal(await mobile.getByRole("button",{name:/선택 삭제/}).count(),0);
  await mobile.goto("http://127.0.0.1:5197/?kind=card");
  await mobile.getByRole("dialog",{name:"카드 편집",exact:true}).getByRole("combobox").filter({hasText:"교육과정"}).click();
  assert.deepEqual(await mobile.getByRole("listbox").getByRole("option").allTextContents(),["교육과정","교과교육론","각론","수업모형","지도서총론"]);
  console.log("PASS unchanged mobile selection UI");assert.deepEqual(errors,[]);
} finally {await browser.close();await server.close();}

import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, cacheDir: "node_modules/.vite-table-editor-browser", resolve: { alias: { "@": root } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "class-variance-authority", "clsx", "lucide-react", "radix-ui", "tailwind-merge"] },
  plugins: [react(), { name: "table-editor-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/table-keyword-editor.tsx"></script>');
    });
  } }], server: { host: "127.0.0.1", port: 5198, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for(const list of ["dash","numbered","science","brackets"]) for(const kind of ["table","normal"]) for (const command of ["shortcut", "button"]) {
    const expected=list==="brackets"?["반사적 듣기","reactive listening"]:list==="science"?["과학 가치","과학의 심미적 가치","감수성","과학 태도","과학 창의성","유용성","윤리성","개방성","참여와 실천","과학문화 향유","안전·지속가능 사회에 기여"]:list==="numbered"?["자유 탐색","탐색 결과 발표","교사의 안내에 따른 탐색","탐색 결과 정리"]:["문제 인식 및 가설 설정","탐구 설계 및 수행","자료  수집·분석 및 해석","결론 도출 및 일반화","의사소통과 협업"];
    // The ordinary editor exposes its toolbar on touch devices.
    const touch=kind==="normal"&&command==="button";
    const page = await browser.newPage({viewport:{width:touch?700:1280,height:900},hasTouch:touch});
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => { throw error; });
    await page.route("**/api/**", route => { throw new Error(`Unexpected API request: ${route.request().url()}`); });
    await page.goto(`http://127.0.0.1:5198/?kind=${kind}&list=${list}`);
    if(kind==="table") await page.getByRole("button", { name: "표 편집", exact: true }).click();
    const editor = page.locator(kind==="table"?"[data-table-editor]":".formatted-editor-input");
    if(kind==="table") await page.locator("[data-table-cell-id]").dblclick();
    const drag=await editor.evaluate(el => {
      el.focus();
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),texts=[];
      while(walker.nextNode())texts.push(walker.currentNode);
      const range=document.createRange(),last=texts.at(-1);
      range.setStart(last,last.length-1);range.setEnd(last,last.length);
      const end=range.getBoundingClientRect();
      range.setStart(texts[0],0);range.setEnd(texts[0],1);
      const start=range.getBoundingClientRect();
      return {from:{x:end.right,y:(end.top+end.bottom)/2},to:{x:start.left,y:(start.top+start.bottom)/2}};
    });
    await page.mouse.move(drag.from.x,drag.from.y);
    await page.mouse.down();
    await page.mouse.move(drag.to.x,drag.to.y,{steps:20});
    await page.mouse.up();
    assert.equal(await editor.evaluate((el,list)=>{
      const selection=window.getSelection();
      return !selection.isCollapsed && el.contains(selection.anchorNode) && el.contains(selection.focusNode)
        && selection.toString().startsWith(list==="brackets"?"반사적":list==="science"?"- 과학":list==="numbered"?"1. 자유":"- 문제") && selection.toString().endsWith(list==="brackets"?"listening)":list==="science"?"기여":list==="numbered"?"정리":"협업");
    },list),true,"real backward drag selects every line including its marker");
    const tableSelection=()=>editor.evaluate(el=>{
      const s=getSelection(),prefix=document.createRange();
      const offset=(node,at)=>{prefix.selectNodeContents(el);prefix.setEnd(node,at);return prefix.toString().length;};
      return{anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset),text:s.toString(),active:document.activeElement===el};
    });
    const beforeBold=kind==="table"?await tableSelection():null;
    if(command==="shortcut") await page.keyboard.press("Meta+b");
    else await page.getByRole("button", {name:kind==="table"?"키워드 지정":"굵게",exact:true}).click();
    if(kind==="table")assert.deepEqual(await tableSelection(),beforeBold,"table bold normalization preserves selection, direction and focus");
    if(kind==="table"){
      if(command==="shortcut")await page.keyboard.press("Meta+b");
      else await page.getByRole("button",{name:"키워드 지정",exact:true}).click();
      assert.equal(await editor.locator("strong,b").count(),0,"one more command must remove all selected keywords, including lists and separators");
      assert.deepEqual(await tableSelection(),beforeBold);
      if(command==="shortcut")await page.keyboard.press("Meta+b");
      else await page.getByRole("button",{name:"키워드 지정",exact:true}).click();
    }
    if(kind==="table") await page.getByRole("button", {name:"표 편집 닫기",exact:true}).click();
    const words=JSON.parse(await page.getByTestId("keywords").textContent());
    assert.deepEqual(words,expected);
    if(kind==="normal") {
      await editor.press("Meta+b");
      assert.deepEqual(JSON.parse(await page.getByTestId("keywords").textContent()),[],"bold removal still works");
    }
    console.log(`PASS ${list} ${kind}: backward drag + ${command} produces ${expected.length} separate keywords`);
    await page.close();
  }
  for(const mobile of [false,true]) for(const field of ["answer","question"]) {
    const page=await browser.newPage({viewport:{width:mobile?390:1280,height:900},hasTouch:mobile});
    await page.route("**/api/**",route=>{throw new Error(`Unexpected API: ${route.request().url()}`);});
    await page.goto(`http://127.0.0.1:5198/?kind=autosave&list=brackets&field=${field}`);
    const editor=page.locator(".formatted-editor-input");
    const select=()=>editor.evaluate(el=>{el.focus();getSelection().setBaseAndExtent(el,el.childNodes.length,el,0);});
    await editor.waitFor();await select();await page.keyboard.press("Meta+b");
    await page.waitForTimeout(1350);
    assert.equal(await editor.innerText(),"반사적 듣기 (reactive listening)");
    assert.deepEqual(await editor.locator("b,strong").allTextContents(),["반사적 듣기 ","reactive listening"],"saved DOM excludes brackets but preserves all text");
    await select();await page.keyboard.press("Meta+b");
    assert.deepEqual(JSON.parse(await page.getByTestId("keywords").textContent()),[],"one toggle clears bold even after bracket normalization");
    await select();await page.keyboard.press("Meta+b");await editor.press("Tab");
    assert.equal(await page.getByTestId("next-memo").evaluate(el=>document.activeElement===el),true);
    assert.equal(await editor.locator("b,strong").evaluateAll(nodes=>nodes.some(node=>/[()]/.test(node.textContent))),false);
    console.log(`PASS ${mobile?"mobile":"desktop"} ${field}: bracket-only exclusion, saved refresh, one-press unbold and blur`);
    await page.close();
  }
  for(const mobile of [false,true]){
    const page=await browser.newPage({viewport:{width:mobile?390:1280,height:900},hasTouch:mobile});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/api/**",route=>{errors.push(`Unexpected API request: ${route.request().url()}`);return route.abort();});
    await page.goto("http://127.0.0.1:5198/?kind=table&list=science");
    await page.getByRole("button",{name:"표 편집",exact:true}).click();
    await page.locator("[data-table-cell-id]").dblclick();
    const editor=page.locator("[data-table-editor]");
    const snapshot=()=>editor.evaluate(el=>{
      const s=getSelection(),range=document.createRange();
      const offset=(node,at)=>{range.selectNodeContents(el);range.setEnd(node,at);return range.toString().length;};
      return{anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset),text:s.toString(),active:document.activeElement===el};
    });
    const select=(backward,collapsed=false)=>editor.evaluate((el,{backward,collapsed})=>{
      el.focus({preventScroll:true});
      const from=collapsed?4:2,to=collapsed?4:el.textContent.indexOf("감수성")+3;
      const position=offset=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(offset<=node.length)return[node,offset];offset-=node.length;}return[el,el.childNodes.length];};
      const a=position(from),b=position(to);getSelection().setBaseAndExtent(...(backward?b:a),...(backward?a:b));
    },{backward,collapsed});
    for(const backward of [false,true]){
      await select(backward);const before=await snapshot();
      await page.keyboard.press(backward?"Control+b":"Meta+b");
      assert.deepEqual(await snapshot(),before,"partial forward/backward selection survives keyword normalization");
      await page.waitForTimeout(650);
      assert.deepEqual(await snapshot(),before,"automatic table apply does not move selection");
      await page.keyboard.press("Meta+b");assert.deepEqual(await snapshot(),before,"removing keyword emphasis keeps selection");
      await page.keyboard.press("Meta+z");assert.deepEqual(await snapshot(),before,"undo keeps the active table selection");
      await page.keyboard.press("Meta+Shift+z");assert.deepEqual(await snapshot(),before,"redo keeps the active table selection");
    }
    await select(false,true);const caret=await snapshot();
    await page.keyboard.press("Meta+b");assert.deepEqual(await snapshot(),caret,"caret-only toggle stays in the middle");
    await page.keyboard.press("Meta+b");assert.deepEqual(await snapshot(),caret,"caret-only toggle off stays in the middle");
    await editor.evaluate(el=>{
      el.innerHTML="<b><u>밑줄 단어</u></b>, <b>두 번째</b>";
      getSelection().setBaseAndExtent(el,el.childNodes.length,el,0);
      el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"formatBold"}));
    });
    const underlined=await snapshot();
    await page.keyboard.press("Meta+b");
    assert.equal(await editor.locator("strong,b").count(),0,"one command clears mixed keyword/separator selection");
    assert.equal(await editor.locator("u").innerText(),"밑줄 단어","clearing bold does not remove underline");
    assert.deepEqual(await snapshot(),underlined);
    await page.keyboard.press("Meta+z");assert.ok(await editor.locator("strong,b").count()>0,"one undo restores the entire bold removal transaction");
    await page.keyboard.press("Meta+Shift+z");assert.equal(await editor.locator("strong,b").count(),0);
    // Browser-created block lines normalize to BRs. A blank line must still
    // count when restoring a collapsed caret in the third line.
    await editor.evaluate(el=>{
      el.innerHTML="<div><b>첫째, 둘째</b></div><div><br></div><div><b>셋째, 넷째</b></div>";
      const node=el.children[2].firstChild.firstChild;getSelection().setBaseAndExtent(node,2,node,2);
      el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"formatBold"}));
    });
    await page.keyboard.type("X");
    assert.equal(await editor.innerText(),"첫째, 둘째\n\n셋째X, 넷째","caret remains after the blank line, not at the last character");
    const scroll=await editor.evaluate(el=>{
      el.innerHTML=Array.from({length:45},(_,index)=>`<div><b>문구 ${index}, 설명</b></div>`).join("");
      const node=el.children[25].firstChild.firstChild;getSelection().setBaseAndExtent(node,3,node,3);
      const body=el.closest(".table-editor-body");body.scrollTop=200;const top=body.scrollTop;
      el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"formatBold"}));
      return top;
    });
    assert.equal(await page.locator(".table-editor-body").evaluate(el=>el.scrollTop),scroll,"normalization does not scroll the table to its end");
    await page.screenshot({path:`/private/tmp/table-keyword-caret-${mobile?"mobile":"desktop"}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mobile?"mobile":"desktop"} table: partial selection, both directions, auto apply, undo/redo, middle caret, blank/block lines and scroll`);
    await page.close();
  }
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1280, height: 900 }, hasTouch: mobile });
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => { throw error; });
    await page.route("**/api/**", route => { throw new Error(`Unexpected API request: ${route.request().url()}`); });
    const editor = page.locator(".formatted-editor-input");
    const selection = () => editor.evaluate(el => {
      const s = getSelection(), r = document.createRange();
      const offset = (node, at) => { r.selectNodeContents(el); r.setEnd(node, at); return r.toString().length; };
      return { anchor: offset(s.anchorNode, s.anchorOffset), focus: offset(s.focusNode, s.focusOffset), text: s.toString(), active: document.activeElement === el };
    });
    const selectBackward = () => editor.evaluate(el => {
      el.focus({ preventScroll: true });
      getSelection().setBaseAndExtent(el, el.childNodes.length, el, 0);
    });
    const control = name => page.getByRole("button", { name, exact: true }).dispatchEvent("pointerdown");
    await page.goto("http://127.0.0.1:5198/?kind=autosave&list=numbered");
    await editor.waitFor();
    await selectBackward();
    await page.keyboard.press("Meta+b");
    const selected = await selection();
    const rawBold = await editor.innerHTML();
    await page.waitForTimeout(550);
    assert.equal(await editor.innerHTML(), rawBold, "save acknowledgement does not immediately refresh bold DOM");
    await editor.dispatchEvent("keydown", { key: "Shift" });
    await page.waitForTimeout(600);
    assert.equal(await editor.innerHTML(), rawBold, "continued editing resets the post-bold idle delay");
    await page.evaluate(() => { window.scrollTo(0, 400); document.querySelector('[data-testid="editor-scroller"]').scrollTop = 150; });
    const scroll = await page.evaluate(() => [window.scrollY, document.querySelector('[data-testid="editor-scroller"]').scrollTop]);
    await page.waitForFunction(() => document.querySelector(".formatted-editor-input").innerHTML.startsWith("1. <strong>"));
    assert.deepEqual(await editor.locator("strong").allTextContents(), ["자유 탐색", "탐색 결과 발표", "교사의 안내에 따른 탐색", "탐색 결과 정리"]);
    assert.deepEqual(await selection(), selected, "autosave preserves backward selection and focus");
    assert.deepEqual(await page.evaluate(() => [window.scrollY, document.querySelector('[data-testid="editor-scroller"]').scrollTop]), scroll, "autosave preserves scroll");
    await editor.screenshot({ path: `/private/tmp/autosave-editor-${mobile ? "mobile" : "desktop"}.png` });
    await control("되돌리기");
    assert.equal(await editor.locator("strong").count(), 0, "undo restores the pre-bold content after autosave");
    await selectBackward(); await page.keyboard.press("Meta+b");
    await page.waitForFunction(() => document.querySelector(".formatted-editor-input").innerHTML.startsWith("1. <strong>"));
    await page.keyboard.press("Meta+b");
    assert.equal(await editor.locator("strong, b").count(), 0, "numbered list bold can be toggled off after autosave");

    // Leaving the editor refreshes immediately, even before any save response.
    await page.goto("http://127.0.0.1:5198/?kind=autosave&list=numbered&save=manual");
    await editor.waitFor(); await selectBackward(); await page.keyboard.press("Meta+b");
    const beforeLeaving = await editor.innerHTML();
    await editor.press("Tab");
    assert.notEqual(await editor.innerHTML(), beforeLeaving);
    assert.ok((await editor.innerHTML()).startsWith("1. <strong>"), "Tab shows canonical keywords without waiting one second or saving");
    assert.equal(await page.getByTestId("next-memo").evaluate(el => document.activeElement === el), true, "refresh does not steal destination focus");
    assert.equal(await page.getByTestId("saved-format").textContent(), "", "local preview does not pretend to be saved");
    await control("되돌리기");
    assert.equal(await editor.locator("strong, b").count(), 0, "blur refresh adds no undo step");

    // Mouse movement uses the same blur path and splits comma-delimited keywords.
    await editor.evaluate(el => {
      el.focus(); el.innerHTML = "<b>걷기, 달리기</b>";
      getSelection().setBaseAndExtent(el.firstChild.firstChild, 0, el.firstChild.firstChild, 0);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatBold" }));
    });
    await page.getByTestId("next-memo").click();
    assert.equal(await editor.innerHTML(), "<strong>걷기</strong>, <strong>달리기</strong>", "clicking the next field refreshes immediately");
    await editor.evaluate(el => { el.focus(); el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
    const blurComposingHtml = await editor.innerHTML();
    await page.getByTestId("next-memo").focus();
    assert.equal(await editor.innerHTML(), blurComposingHtml, "blur never rewrites active IME composition");
    await editor.dispatchEvent("compositionend", { data: "" });

    // Hold an old save response while the user types a newer edit.
    await page.goto("http://127.0.0.1:5198/?kind=autosave&list=numbered&save=manual");
    await editor.waitFor(); await selectBackward(); await page.keyboard.press("Meta+b");
    await control("저장 요청");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.insertText(" 새 입력");
    const latestHtml = await editor.innerHTML(), latestSelection = await selection();
    await control("저장 응답");
    assert.equal(await editor.innerHTML(), latestHtml, "stale response must not replace newer DOM");
    assert.deepEqual(await selection(), latestSelection);
    await control("저장 요청"); await control("저장 응답");
    await page.waitForFunction(() => document.querySelector(".formatted-editor-input").innerHTML.startsWith("1. <strong>"));
    assert.match(await editor.innerHTML(), /^1\. <strong>/);
    assert.match(await editor.innerText(), /새 입력$/);
    assert.deepEqual(await selection(), latestSelection, "matching response keeps the caret");

    // Save completion during IME composition must defer the DOM replacement.
    await page.goto("http://127.0.0.1:5198/?kind=autosave&list=numbered&save=manual");
    await editor.waitFor(); await selectBackward(); await page.keyboard.press("Meta+b");
    await control("저장 요청");
    await editor.dispatchEvent("compositionstart", { data: "" });
    const composingHtml = await editor.innerHTML();
    await control("저장 응답");
    assert.equal(await editor.innerHTML(), composingHtml, "IME DOM is untouched until composition ends");
    await editor.dispatchEvent("compositionend", { data: "" });
    await page.waitForFunction(() => document.querySelector(".formatted-editor-input").innerHTML.startsWith("1. <strong>"));
    assert.match(await editor.innerHTML(), /^1\. <strong>/);

    // Browser-created block lines and an empty line keep their caret after normalization.
    await editor.evaluate(el => {
      el.focus({ preventScroll: true });
      el.innerHTML = "<div><b>1. 자유 탐색</b></div><div><br></div><div><b>2. 탐색 결과 발표</b></div>";
      getSelection().setBaseAndExtent(el.children[2].firstChild.firstChild, 5, el.children[2].firstChild.firstChild, 5);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatBold" }));
    });
    const blockSelection = await selection();
    await control("저장 요청"); await control("저장 응답");
    await page.waitForFunction(() => document.querySelector(".formatted-editor-input").innerHTML.startsWith("1. <strong>"));
    assert.match(await editor.innerHTML(), /^1\. <strong>자유 탐색<\/strong><br><br>2\. <strong>/);
    assert.deepEqual(await selection(), blockSelection, "block-line caret survives BR normalization");

    // The persisted format can differ from the submitted format (e.g. comma lists).
    await editor.evaluate(el => {
      el.focus({ preventScroll: true }); el.innerHTML = "<b>걷기, 달리기</b>";
      getSelection().setBaseAndExtent(el.firstChild.firstChild, 4, el.firstChild.firstChild, 4);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatBold" }));
    });
    const commaSelection = await selection();
    await control("저장 요청"); await control("저장 응답");
    await control("저장 요청"); await control("저장 응답");
    await page.waitForFunction(() => document.querySelector(".formatted-editor-input").innerHTML.startsWith("<strong>걷기</strong>"));
    assert.equal(await editor.innerHTML(), "<strong>걷기</strong>, <strong>달리기</strong>", "show the normalized server response, not just locally normalized input");
    assert.deepEqual(await selection(), commaSelection);
    await selectBackward(); await page.keyboard.press("Meta+b");
    assert.equal(await editor.locator("strong, b").count(), 0, "bold can still be toggled off after normalized save");

    // Ordinary typing autosaves without replacing the focused editing DOM.
    await page.goto("http://127.0.0.1:5198/?kind=autosave&save=manual");
    await editor.waitFor();
    await editor.evaluate(el => {
      el.focus({ preventScroll: true }); el.innerHTML = "<div>일반 입력</div>";
      getSelection().setBaseAndExtent(el.firstChild.firstChild, 5, el.firstChild.firstChild, 5);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    });
    await control("저장 요청"); await control("저장 응답");
    await page.waitForTimeout(1200);
    assert.equal(await editor.innerHTML(), "<div>일반 입력</div>", "text-only autosave never triggers the post-bold refresh");
    console.log(`PASS ${mobile ? "mobile" : "desktop"}: bold-only idle refresh, selection, caret, scroll, undo, stale response, IME, block lines`);
    await page.close();
  }
  for (const kind of ["normal", "table"]) for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1280, height: 900 }, hasTouch: mobile });
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => { throw error; });
    await page.route("**/api/**", route => { throw new Error(`Unexpected API request: ${route.request().url()}`); });
    await page.goto(`http://127.0.0.1:5198/?kind=${kind}`);
    if (kind === "table") {
      await page.getByRole("button", { name: "표 편집", exact: true }).click();
      await page.locator("[data-table-cell-id]").dblclick();
    }
    const editor = page.locator(kind === "table" ? "[data-table-editor]" : ".formatted-editor-input");
    const bold = editor.locator("strong, b");
    const resetKeyword = async (button = false) => {
      await editor.fill("키워드");
      await editor.evaluate(el => { el.focus(); getSelection().setBaseAndExtent(el, 0, el, el.childNodes.length); });
      if (button) await page.getByRole("button", { name: kind === "table" ? "키워드 지정" : "굵게", exact: true }).click();
      else await page.keyboard.press("Meta+b");
      await page.waitForFunction(selector => document.querySelector(selector)?.querySelector("strong,b")?.textContent === "키워드", kind === "table" ? "[data-table-editor]" : ".formatted-editor-input");
      await editor.evaluate(el => { el.focus(); const word = el.querySelector("strong,b").firstChild; getSelection().setBaseAndExtent(word, word.length, word, word.length); });
    };
    await resetKeyword(mobile);
    await page.keyboard.insertText("추가");
    assert.deepEqual(await bold.allTextContents(), ["키워드추가"], "typing directly after bold continues the keyword");
    await page.keyboard.press("Space");
    await page.keyboard.insertText("기본체");
    assert.deepEqual((await bold.allTextContents()).map(text => text.trim()), ["키워드추가"], "space ends bold typing");

    await resetKeyword();
    await page.keyboard.insertText(" 새 글");
    assert.equal(await editor.innerText(), "키워드 새 글");
    assert.deepEqual(await bold.allTextContents(), ["키워드"], "appended text must be normal, not another keyword");

    await resetKeyword();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.insertText("다음 줄");
    assert.deepEqual((await bold.allTextContents()).map(text => text.trim()), ["키워드"], "a new line starts normal text");

    await resetKeyword();
    const cdp = await page.context().newCDPSession(page);
    for (const text of ["ㅎ", "하", "한"]) await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    await cdp.send("Input.insertText", { text: "한" });
    assert.equal(await editor.innerText(), "키워드한", "IME text is committed once without loss");
    assert.deepEqual(await bold.allTextContents(), ["키워드한"], "IME insertion at the keyword end stays bold");
    await page.keyboard.press("Space");
    for (const text of ["ㄱ", "그", "글"]) await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    await cdp.send("Input.insertText", { text: "글" });
    assert.equal(await editor.innerText(), "키워드한 글", "IME after space is inserted once");
    assert.deepEqual((await bold.allTextContents()).map(text => text.trim()), ["키워드한"], "IME after space is normal text");
    await resetKeyword();
    await editor.evaluate(el => { const word = el.querySelector("strong,b"); getSelection().setBaseAndExtent(word, 0, word, word.childNodes.length); });
    for (const text of ["ㅎ", "하", "한"]) await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    await cdp.send("Input.insertText", { text: "한" });
    assert.equal(await editor.innerText(), "한", "IME replaces the selected keyword once");
    assert.equal(await bold.count(), 0, "IME whole-keyword replacement is plain text");
    await cdp.detach();

    await resetKeyword();
    await editor.evaluate(el => { const word = el.querySelector("strong,b").firstChild; getSelection().setBaseAndExtent(word, 1, word, 1); });
    await page.keyboard.insertText("X");
    assert.deepEqual(await bold.allTextContents(), ["키X워드"], "editing inside a keyword retains its formatting");
    await editor.evaluate(el => { const word = el.querySelector("strong,b"); getSelection().setBaseAndExtent(word, 0, word, word.childNodes.length); });
    await page.keyboard.insertText("교체");
    assert.equal(await editor.innerText(), "교체");
    assert.equal(await bold.count(), 0, "replacing the entire selected keyword starts plain text");

    await editor.fill("");
    await editor.evaluate(el => { el.focus(); getSelection().setBaseAndExtent(el, 0, el, 0); });
    await page.keyboard.press("Meta+b");
    assert.equal(await editor.evaluate(() => document.queryCommandState("bold")), true, "caret-only Cmd+B enables bold in an empty editor");
    await page.keyboard.insertText("굵게");
    assert.deepEqual(await bold.allTextContents(), ["굵게"]);
    await page.keyboard.press("Meta+b");
    assert.equal(await editor.evaluate(() => document.queryCommandState("bold")), false, "caret-only Cmd+B disables bold");
    await page.keyboard.insertText("기본");
    assert.deepEqual(await bold.allTextContents(), ["굵게"], "toggle off only affects following text");
    const unchanged = await editor.innerHTML();
    await editor.dispatchEvent("keydown", { key: "ㅠ", code: "", metaKey: true });
    assert.equal(await editor.evaluate(() => document.queryCommandState("bold")), true, "Korean Cmd+ㅠ fallback enables bold");
    assert.equal(await editor.innerHTML(), unchanged, "a caret toggle does not change existing text");
    const korean = await page.context().newCDPSession(page);
    for (const text of ["ㅎ", "하", "한"]) await korean.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    await korean.send("Input.insertText", { text: "한" });
    assert.deepEqual(await bold.allTextContents(), ["굵게", "한"], "Korean composition respects manually enabled bold");
    await korean.detach();
    await editor.dispatchEvent("keydown", { key: "ㅠ", code: "KeyB", ctrlKey: true });
    assert.equal(await editor.evaluate(() => document.queryCommandState("bold")), false, "physical KeyB with Ctrl toggles off on Korean layout");
    await page.keyboard.insertText("기본");
    assert.equal(await editor.innerText(), "굵게기본한기본");
    assert.deepEqual(await bold.allTextContents(), ["굵게", "한"]);
    await editor.dispatchEvent("keydown", { key: "ㅠ", code: "KeyB", metaKey: true, isComposing: true });
    assert.equal(await editor.evaluate(() => document.queryCommandState("bold")), false, "IME composition does not trigger shortcuts");
    await page.keyboard.press("Meta+b");
    await page.keyboard.insertText("단어");
    await page.keyboard.press("Space");
    await page.keyboard.insertText("이후");
    assert.deepEqual((await bold.allTextContents()).map(text => text.trim()), ["굵게", "한", "단어 이후"], "manual bold survives spaces as one keyword, without a saved-format caret reset");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.insertText("다음줄");
    assert.match((await bold.allTextContents()).join(""), /단어\s*이후\s*다음줄/u, "manual bold survives a newline");
    const manualBoldText = (await bold.allTextContents()).join("").replace(/\s/gu, "");
    await page.keyboard.press("Meta+b");
    await page.keyboard.press("Space");
    await page.keyboard.insertText("보통");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.insertText("계속 보통");
    assert.equal((await bold.allTextContents()).join("").replace(/\s/gu, ""), manualBoldText, "manual off survives spaces and newlines");

    // Switching from explicit typing mode to a block command must restore the
    // inherited-format rule, including a selected range inside the same editor.
    await page.keyboard.press("Meta+b");
    await resetKeyword();
    await page.keyboard.insertText("추가");
    await page.keyboard.press("Space");
    await page.keyboard.insertText("보통");
    assert.deepEqual((await bold.allTextContents()).map(text => text.trim()), ["키워드추가"], "block bold overrides manual mode and ends at the next space");
    await resetKeyword();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.insertText("보통");
    assert.deepEqual((await bold.allTextContents()).map(text => text.trim()), ["키워드"], "block bold ends at a newline");
    await editor.fill("선택");
    await editor.evaluate(el => { el.focus(); getSelection().collapse(el, el.childNodes.length); });
    await page.keyboard.press("Meta+b");
    await page.keyboard.insertText("블록");
    await editor.evaluate(el => { const word = el.querySelector("strong,b"); getSelection().setBaseAndExtent(word, 0, word, word.childNodes.length); });
    await page.keyboard.press("Meta+b");
    await page.keyboard.press("Meta+b");
    await editor.evaluate(el => { const word = el.querySelector("strong,b"); getSelection().collapse(word, word.childNodes.length); });
    await page.keyboard.press("Space");
    await page.keyboard.insertText("보통");
    assert.equal((await bold.allTextContents()).join("").trim(), "블록", "selecting and formatting a block cancels the prior explicit typing mode");
    console.log(`PASS ${kind} ${mobile ? "mobile" : "desktop"}: attached typing stays bold; space/newline starts normal; IME, replacement and interior edits`);
    console.log(`PASS ${kind} ${mobile ? "mobile" : "desktop"}: caret-only Cmd/Ctrl+B and Korean ㅠ, manual on/off across separators, selected-block reset, IME and unchanged existing content`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }

import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||'playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:'node_modules/.vite-editor-lists',resolve:{alias:{'@':root}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','class-variance-authority','clsx','lucide-react','radix-ui','tailwind-merge']},plugins:[react(),{name:'list-fixture',configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/')return next();const bulk=new URL(req.url,'http://localhost').searchParams.has('bulk');res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/${bulk?'editor-multi-selection':'table-keyword-editor'}.tsx"></script>`);});}}],server:{host:'127.0.0.1',port:5196,strictPort:true,hmr:false}});
await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const mobile of [false,true])for(const kind of ['normal','question','table','bulk']){
    const page=await browser.newPage({viewport:{width:mobile?700:1400,height:1000},hasTouch:mobile});
    const errors=[],saves=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
    await page.route('**/api/**',async route=>{if(kind==='bulk'&&new URL(route.request().url()).pathname==='/api/cards/organize'){const payload=route.request().postDataJSON();saves.push(payload);return route.fulfill({json:{cards:payload.cards.map((c,i)=>({...c,id:c.id??100+i,subject:payload.subject,keywords:[],updatedAt:new Date().toISOString()}))}});}errors.push(`Unexpected API ${route.request().url()}`);return route.abort();});
    await page.goto(`http://127.0.0.1:5196/?${kind==='bulk'?'bulk=1':kind==='question'?'kind=normal&field=question':`kind=${kind}`}`);
    if(kind==='bulk'&&mobile){await page.locator('.mobile-position-choice.is-first').click();await page.locator('.mobile-create-kind-grid .is-card').click();}
    if(kind==='table'){await page.getByRole('button',{name:'표 편집',exact:true}).click();await page.locator('[data-table-cell-id]').dblclick();}
    const editor=kind==='bulk'?(mobile?page.getByRole('textbox',{name:'새 카드 답',exact:true}):page.locator('[data-bulk-focus-kind="answer"]').first()):page.locator(kind==='table'?'[data-table-editor]':'.formatted-editor-input');
    const text=()=>editor.innerText();
    const isBold=word=>editor.evaluate((el,word)=>{
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      while(walker.nextNode())if(walker.currentNode.textContent.includes(word))return Number.parseInt(getComputedStyle(walker.currentNode.parentElement).fontWeight,10)>=600;
      throw new Error(`Missing word: ${word}`);
    },word);
    for(const input of ['keyboard','beforeinput']){
      await editor.fill('• 첫 항목');await editor.press('Meta+a');await editor.press('Meta+b');await editor.press('ArrowRight');
      if(input==='keyboard')await editor.press('Shift+Enter');
      else await editor.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true})));
      await page.keyboard.insertText('다음 항목');
      assert.equal(await isBold('첫 항목'),true,`${input}: previous keyword stays bold`);
      assert.equal(await isBold('다음 항목'),false,`${input}: next list item starts plain`);
      for(const letter of '다음 항목')await editor.press('Backspace');
      await editor.press('Backspace');await editor.press('Backspace');
      await page.keyboard.insertText('다시작성');
      assert.equal(await isBold('다시작성'),false,`${input}: deleting the plain item and joining the previous line must not revive bold`);
      for(const letter of '다시작성')await editor.press('Backspace');
      await editor.press('Meta+b');await page.keyboard.insertText('직접재지정');
      assert.equal(await isBold('직접재지정'),true,'one explicit toggle overrides the automatic plain state, even after deletion');
      await editor.press('Meta+b');
    }
    await editor.fill('• ');await editor.press('Meta+b');await page.keyboard.insertText('직접 켠 볼드');await editor.press('Shift+Enter');await page.keyboard.insertText('유지할 항목');
    assert.equal(await isBold('직접 켠 볼드'),true,'manual bold applies to the current item');
    assert.equal(await isBold('유지할 항목'),true,'explicit manual bold stays on across list breaks');
    await editor.press('Tab');await page.keyboard.insertText('키워드');
    await editor.press('Shift+Enter');await editor.press('Shift+Enter');await page.keyboard.insertText('내어쓴 항목');
    assert.equal(await isBold('내어쓴 항목'),true,'manual bold survives empty-item outdent');
    await editor.press('Meta+b');await editor.press('Shift+Enter');await page.keyboard.insertText('직접 해제');
    assert.equal(await isBold('직접 해제'),false,'manual off also survives list breaks');
    await editor.fill('• 보존 단어');await editor.press('Meta+a');await editor.press('Meta+b');
    await editor.evaluate(el=>{
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const node=walker.currentNode,index=node.textContent.indexOf('단어');if(index<0)continue;
        window.getSelection().setBaseAndExtent(node,index,node,index+2);return;
      }
      throw new Error('Missing selected word');
    });
    await editor.press('Meta+b');await editor.press('ArrowRight');
    assert.equal(await isBold('단어'),false,'selected word can be unbolded');
    await editor.press('Backspace');await editor.press('Backspace');await page.keyboard.insertText('새단어');
    assert.equal(await isBold('새단어'),false,'deleting and retyping an unbolded selection keeps it plain');
    assert.equal(await isBold('보존'),true,'unrelated existing keyword stays bold');
    // Deliberate caret movement into an existing keyword uses that keyword's
    // style, rather than keeping the automatic plain state for the whole editor.
    for(const letter of await text())await editor.press('ArrowLeft');
    await editor.press('ArrowRight');await editor.press('ArrowRight');await editor.press('ArrowRight');
    await page.keyboard.insertText('X');
    assert.equal(await isBold('X'),true,'arrow navigation into an existing keyword retains bold interior edits');
    await editor.fill('');await editor.press('-');await editor.press('Space');
    assert.equal(await text(),'• ');
    await page.keyboard.insertText('부모');await editor.press('Shift+Enter');
    assert.equal(await text(),'• 부모\n• ');
    await editor.press('Tab');await page.keyboard.insertText('자식 (내용)');
    assert.equal(await text(),'• 부모\n    • 자식 (내용)');
    assert.equal(await editor.evaluate(el=>document.activeElement===el),true,'list Tab does not navigate to another field');
    await editor.press('Shift+Tab');assert.equal(await text(),'• 부모\n• 자식 (내용)');
    await editor.press('Tab');await editor.press('Shift+Enter');await editor.press('Tab');await page.keyboard.insertText('손자');
    assert.equal(await text(),'• 부모\n    • 자식 (내용)\n        • 손자');
    if(kind==='normal')await page.screenshot({path:`/private/tmp/editor-lists-${mobile?'mobile':'desktop'}.png`});
    await editor.press('Shift+Enter');await editor.press('Shift+Enter');
    assert.ok((await text()).endsWith('\n    • '),'empty nested item outdents one level');
    await editor.press('Shift+Enter');assert.ok((await text()).endsWith('\n• '),'second empty line action returns to the root');
    await editor.press('Shift+Enter');
    assert.equal((await text()).match(/•/g)?.length,3,'empty root item exits list');
    await page.keyboard.insertText('일반 문장');
    assert.ok((await text()).endsWith('\n일반 문장'),await editor.evaluate(el=>({html:el.innerHTML,text:el.innerText,selection:window.getSelection()?.anchorNode?.textContent})).then(JSON.stringify));
    // IME event must not convert a dash or steal navigation during composition.
    await editor.fill('-');await editor.dispatchEvent('keydown',{key:' ',code:'Space',isComposing:true,keyCode:229});assert.equal(await text(),'-');
    await editor.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:' ',isComposing:true,bubbles:true,cancelable:true})));assert.equal(await text(),'-');
    // Mobile beforeinput (no hardware keydown) shares the conversion path.
    await editor.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:' ',bubbles:true,cancelable:true})));assert.equal(await text(),'• ');
    await page.keyboard.insertText('첫째');
    assert.equal(await editor.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertParagraph',bubbles:true,cancelable:true}))),true,'ordinary paragraph input is not consumed by lists');
    assert.equal(await text(),'• 첫째');
    await editor.evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true})));
    assert.equal(await text(),'• 첫째\n• ','line-break input creates the next list item');
    await page.keyboard.insertText('둘째');
    await editor.press('Meta+a');await editor.press('Meta+b');
    if(kind==='table')await page.waitForFunction(()=>document.querySelector('[data-testid="keywords"]')?.textContent==='["첫째","둘째"]');
    const words=kind==='bulk'?null:JSON.parse(await page.getByTestId('keywords').textContent());
    if(words)assert.deepEqual(words,['첫째','둘째'],'bullets never become keywords');
    if(kind==='table'||(kind==='bulk'&&!mobile)){
      const plain='• 부모\n• 자식\n• 둘째',nested='• 부모\n    • 자식\n    • 둘째';
      await editor.fill(plain);
      // Bulk typing coalesces within 800ms; start a separate edit transaction.
      if(kind==='bulk')await page.waitForTimeout(850);
      await editor.evaluate(el=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);const start=nodes.find(n=>n.textContent.includes('• 자식')),end=nodes.at(-1);window.getSelection().setBaseAndExtent(end,end.textContent.length,start,start.textContent.indexOf('• 자식'));});
      await editor.press('Tab');assert.equal(await text(),nested,'selected list items indent together');
      await editor.press('Meta+z');assert.equal(await text(),plain,'one undo restores a multi-item indent');
      await editor.press('Meta+Shift+z');assert.equal(await text(),nested,'redo restores the list');
      if(kind==='table'){
        await page.getByRole('button',{name:'표 편집 닫기',exact:true}).click();
        await page.getByRole('button',{name:'표 편집',exact:true}).click();
        await page.locator('[data-table-cell-id]').dblclick();
        assert.equal(await text(),nested,'saved table keeps nesting when reopened');
      }else{
        await page.locator('[data-bulk-focus-kind="memo"]').first().click();
        await page.waitForFunction(()=>document.querySelector('.bulk-footer')?.textContent?.includes('자동 저장됨'));
        assert.equal(saves.at(-1).cards[0].answer,nested,'autosave keeps bullet indentation');
      }
    }
    // Ordinary Enter keeps field/cell navigation, even inside a list.
    if(kind==='bulk'&&!mobile){
      await editor.fill('• 항목');await editor.press('Enter');
      await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-bulk-focus-kind="memo"]'));
      assert.equal(await text(),'• 항목');
    }
    // Preserve existing navigation outside lists.
    await editor.fill('일반 문장');await editor.press('Tab');
    if(kind==='bulk'&&!mobile)await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-bulk-focus-kind="memo"]'));
    if(kind==='table'){
      assert.equal(await page.locator('[data-table-cell-id]').count(),2,'normal Tab still adds/moves to the next cell');
      const next=page.locator('[data-table-editor]').nth(1);
      await next.fill('• 항목');await next.press('Enter');
      assert.equal(await page.locator('[data-table-cell-id]').count(),4,'Enter in a list still moves down/adds the next row');
      assert.equal(await next.innerText(),'• 항목');
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mobile?'mobile':'desktop'} ${kind}: block/manual bold distinction, deletion/retyping, automatic bullets, nested Tab, outdent, Shift+Enter/exit, IME, keyword exclusion and ordinary navigation`);
    await page.close();
  }
}finally{await browser.close();await server.close();}

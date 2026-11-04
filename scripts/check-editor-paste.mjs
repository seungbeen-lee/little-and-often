import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||'playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:'node_modules/.vite-editor-paste',resolve:{alias:{'@':root}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','class-variance-authority','clsx','lucide-react','radix-ui','tailwind-merge']},plugins:[react(),{name:'paste-fixture',configureServer(vite){vite.middlewares.use((req,res,next)=>{
  if(req.url?.split('?')[0]!=='/')return next();
  const bulk=new URL(req.url,'http://localhost').searchParams.has('bulk');
  res.setHeader('Content-Type','text/html');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/${bulk?'editor-multi-selection':'table-keyword-editor'}.tsx"></script>`);
});}}],server:{host:'127.0.0.1',port:5195,strictPort:true,hmr:false}});
await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const mobile of [false,true])for(const kind of ['normal','question','table','bulk']){
    const page=await browser.newPage({viewport:{width:mobile?390:1280,height:900},hasTouch:mobile});
    const errors=[],saves=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',async route=>{
      if(kind==='bulk'&&new URL(route.request().url()).pathname==='/api/cards/organize'){
        const payload=route.request().postDataJSON();saves.push(payload);
        return route.fulfill({json:{cards:payload.cards.map((card,index)=>({...card,id:card.id??100+index,subject:payload.subject,keywords:[],updatedAt:new Date().toISOString()}))}});
      }
      errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();
    });
    await page.goto(`http://127.0.0.1:5195/?${kind==='bulk'?'bulk=1':kind==='question'?'kind=normal&field=question':`kind=${kind}`}`);
    if(kind==='bulk'&&mobile){await page.locator('.mobile-position-choice.is-first').click();await page.locator('.mobile-create-kind-grid .is-card').click();}
    if(kind==='table'){await page.getByRole('button',{name:'표 편집',exact:true}).click();await page.locator('[data-table-cell-id]').dblclick();}
    const editor=kind==='bulk'?(mobile?page.getByRole('textbox',{name:'새 카드 답',exact:true}):page.locator('[data-bulk-focus-kind="answer"]').first()):page.locator(kind==='table'?'[data-table-editor]':'.formatted-editor-input');
    // ClipboardEvent exercises the production paste handler without touching
    // the user's OS clipboard, account data, or real card API.
    const paste=(plain,html)=>editor.evaluate((el,{plain,html})=>{
      const clipboardData=new DataTransfer();
      if(plain!==null)clipboardData.setData('text/plain',plain);
      if(html)clipboardData.setData('text/html',html);
      return el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
    },{plain,html});
    const noSourceMarkup=async()=>assert.equal(await editor.locator('b,strong,u,i,em,font,a,img,table,[style]').count(),0,`external styling, links and markup never enter the editor: ${await editor.innerHTML()}`);
    const plain='첫 문장\n• 두 번째 항목\n    • 하위 항목\n끝';
    const html='<div style="color:red;font-size:48px"><strong>첫 문장</strong></div><ul><li><u>두 번째 항목</u><ul><li><em>하위 항목</em></li></ul></li></ul><a href="https://example.invalid">끝</a>';
    await editor.fill('');
    // The bulk fixture begins with a bold answer. Test imported styling at a
    // plain destination; explicit destination formatting is covered below.
    if(await editor.evaluate(()=>document.queryCommandState('bold')))await editor.press('Meta+b');
    assert.equal(await paste(plain,html),false,'native rich paste is cancelled');
    assert.equal(await editor.innerText(),plain,'plain clipboard text, newlines and indentation survive');await noSourceMarkup();
    if(kind!=='bulk')assert.deepEqual(JSON.parse(await page.getByTestId('keywords').textContent()),[],'source bold does not create answer keywords');
    if(kind==='normal')await page.screenshot({path:`/private/tmp/editor-plain-paste-${mobile?'mobile':'desktop'}.png`});

    await editor.fill('');await paste(null,'<style>b{color:red}</style><p><b>HTML만 제공</b></p><p>둘째<br><u>셋째</u></p>');
    assert.equal(await editor.innerText(),'HTML만 제공\n둘째\n셋째','HTML-only sources retain text and line breaks');await noSourceMarkup();
    await editor.fill('앞 뒤');await editor.press('Meta+a');
    await paste('교체','<h1 style="color:red">교체</h1>');assert.equal(await editor.innerText(),'교체','paste replaces selected text');await noSourceMarkup();
    await page.keyboard.insertText('후');assert.equal(await editor.innerText(),'교체후','caret remains after the pasted text');

    await editor.fill('• ');await editor.press('Meta+b');await paste('직접 켠 볼드','<em style="font-size:60px">직접 켠 볼드</em>');
    assert.equal(await editor.evaluate(el=>[...el.querySelectorAll('b,strong')].map(x=>x.textContent).join('').includes('직접 켠 볼드')),true,'explicit destination bold is preserved');
    assert.equal(await editor.locator('em,i,[style*="60px"]').count(),0,'clipboard style cannot override manual bold');
    await editor.press('Shift+Enter');await page.keyboard.insertText('유지');
    assert.equal(await editor.evaluate(el=>[...el.querySelectorAll('b,strong')].map(x=>x.textContent).join('').includes('유지')),true,'paste keeps the manual bold switch intact across lists');
    await editor.press('Meta+b');await paste('기본체','<b>기본체</b>');
    assert.equal(await editor.evaluate(el=>[...el.querySelectorAll('b,strong')].some(x=>x.textContent.includes('기본체'))),false,'manual off wins over source bold');

    // A parent capture handler owns image attachment; text handling must not
    // run after another paste flow has already claimed the event.
    const beforeImage=await editor.innerHTML();
    await editor.evaluate(el=>{
      const capture=event=>event.preventDefault();el.addEventListener('paste',capture,{capture:true,once:true});
      const clipboardData=new DataTransfer();clipboardData.setData('text/plain','가로채면 안 됨');
      el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
    });
    assert.equal(await editor.innerHTML(),beforeImage,'previously handled image/attachment paste stays untouched');

    if(kind==='table'||(kind==='bulk'&&!mobile)){
      await editor.fill('원본');
      if(kind==='bulk')await page.waitForTimeout(850); // existing history-coalescing boundary
      await paste(' 붙여넣기','<b> 붙여넣기</b>');
      assert.equal(await editor.innerText(),'원본 붙여넣기');
      await editor.press('Meta+z');assert.equal(await editor.innerText(),'원본','one undo removes the paste');
      await editor.press('Meta+Shift+z');assert.equal(await editor.innerText(),'원본 붙여넣기','redo restores the plain paste');
      if(kind==='table'){
        await page.getByRole('button',{name:'표 편집 닫기',exact:true}).click();await page.getByRole('button',{name:'표 편집',exact:true}).click();await page.locator('[data-table-cell-id]').dblclick();
        assert.equal(await editor.innerText(),'원본 붙여넣기');await noSourceMarkup();
      }else{
        await page.locator('[data-bulk-focus-kind="memo"]').first().click();
        await page.waitForFunction(()=>document.querySelector('.bulk-footer')?.textContent?.includes('자동 저장됨'));
        assert.equal(saves.at(-1).cards[0].answer,'원본 붙여넣기');
        assert.ok(!saves.at(-1).cards[0].answerFormat.includes('[b]'),'autosave stores no imported bold');
      }
    }
    assert.deepEqual(errors,[]);console.log(`PASS ${mobile?'mobile':'desktop'} ${kind}: plain paste, line breaks, HTML fallback, selection/caret, manual bold, attachment precedence and save/undo`);
    await page.close();
  }
}finally{await browser.close();await server.close();}

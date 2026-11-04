import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||'playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:'node_modules/.vite-rich-copy',resolve:{alias:{'@':root}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','class-variance-authority','clsx','lucide-react','radix-ui','tailwind-merge']},plugins:[react(),{name:'rich-copy-fixture',configureServer(vite){vite.middlewares.use((req,res,next)=>{
  if(req.url?.split('?')[0]!=='/')return next();
  const params=new URL(req.url,'http://localhost').searchParams;
  const fixture=params.has('bulk')?'editor-multi-selection':params.has('reader')?'editor-rich-copy':'table-keyword-editor';
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/${fixture}.tsx"></script>`);
});}}],server:{host:'127.0.0.1',port:5194,strictPort:true,hmr:false}});
await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true});
const select=async(el,text)=>el.evaluate((root,text)=>{
  root.focus();const nodes=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode())nodes.push(walker.currentNode);
  const all=nodes.map(x=>x.textContent).join(''),start=text===null?0:all.indexOf(text),end=text===null?all.length:start+text.length;
  if(start<0)throw Error(`Missing selection: ${text} in ${all}`);
  const position=offset=>{for(const node of nodes){if(offset<=node.length)return [node,offset];offset-=node.length;}return [root,root.childNodes.length];};
  const selection=window.getSelection();selection.setBaseAndExtent(...position(start),...position(end));
},text);
const copy=async(el,type='copy')=>{
  await el.evaluate((root,type)=>{
    window.__testCopied=null;
    document.addEventListener(type,event=>{
      window.__testCopied=Object.fromEntries([...event.clipboardData.types].map(type=>[type,event.clipboardData.getData(type)]));
      event.preventDefault(); // Never modify the user's OS clipboard in tests.
    },{once:true});
  },type);
  await el.page().keyboard.press(type==='cut'?'Meta+x':'Meta+c');
  return el.page().evaluate(()=>window.__testCopied);
};
const paste=(el,values)=>el.evaluate((root,values)=>{
  const clipboardData=new DataTransfer();for(const [type,value]of Object.entries(values))clipboardData.setData(type,value);
  root.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
},values);
const styleText=(el,selector)=>el.evaluate((root,selector)=>[...root.querySelectorAll(selector)].map(x=>x.textContent).join(''),selector);
const mime='application/x-little-and-often-card-text';
let copied;
try {
 for(const mobile of [false,true])for(const kind of ['normal','question','table','bulk']){
  const page=await browser.newPage({viewport:{width:mobile?390:1280,height:900},hasTouch:mobile});const errors=[],saves=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   if(kind==='bulk'&&new URL(route.request().url()).pathname==='/api/cards/organize'){
    const payload=route.request().postDataJSON();saves.push(payload);return route.fulfill({json:{cards:payload.cards.map((card,index)=>({...card,id:card.id??100+index,subject:payload.subject,keywords:[],updatedAt:new Date().toISOString()}))}});
   }
   errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();
  });
  await page.goto(`http://127.0.0.1:5194/?${kind==='bulk'?'bulk=1':kind==='question'?'kind=normal&field=question':`kind=${kind}`}`);
  if(kind==='bulk'&&mobile){await page.locator('.mobile-position-choice.is-first').click();await page.locator('.mobile-create-kind-grid .is-card').click();}
  if(kind==='table'){await page.getByRole('button',{name:'표 편집',exact:true}).click();await page.locator('[data-table-cell-id]').dblclick();}
  const editor=kind==='bulk'?(mobile?page.getByRole('textbox',{name:'새 카드 답',exact:true}):page.locator('[data-bulk-focus-kind="answer"]').first()):page.locator(kind==='table'?'[data-table-editor]':'.formatted-editor-input');
  await editor.fill('서식 검증');
  if(await editor.evaluate(()=>document.queryCommandState('bold'))) {await select(editor,null);await editor.press('Meta+b');}
  // Both applying AND removing a style must be independently reversible. This
  // uses native history in standalone/mobile fields and app history in bulk/table.
  for(const [key,selector]of [['b','b,strong'],['u','u,[style*="underline"]'],['i','i,em,[style*="italic"]']]){
    await select(editor,null);await editor.press(`Meta+${key}`);
    assert.equal(await styleText(editor,selector),'서식 검증',`${kind} ${key} apply`);
    await editor.press('Meta+z');assert.equal(await styleText(editor,selector),'',`${kind} ${key} undo apply`);
    await editor.press('Meta+Shift+z');assert.equal(await styleText(editor,selector),'서식 검증',`${kind} ${key} redo apply`);
    await select(editor,null);await editor.press(`Meta+${key}`);assert.equal(await styleText(editor,selector),'',`${kind} ${key} remove`);
    await editor.press('Meta+z');assert.equal(await styleText(editor,selector),'서식 검증',`${kind} ${key} undo remove`);
    await editor.press('Meta+Shift+z');assert.equal(await styleText(editor,selector),'',`${kind} ${key} redo remove`);
  }
  await editor.fill('첫 키워드 설명\n둘째 항목');
  await select(editor,'첫 키워드');await editor.press('Meta+b');
  await select(editor,'설명');await editor.press('Meta+u');
  await select(editor,'둘째');await editor.press('Meta+i');
  await select(editor,null);const payload=await copy(editor);copied=payload;
  assert.equal(payload['text/plain'],'첫 키워드 설명\n둘째 항목');assert.ok(payload[mime]);
  await editor.fill('');await paste(editor,payload);
  assert.equal(await editor.innerText(),'첫 키워드 설명\n둘째 항목');
  assert.equal(await styleText(editor,'b,strong'),'첫 키워드');
  assert.equal(await styleText(editor,'u,[style*="underline"]'),'설명');
  assert.equal(await styleText(editor,'em,i,[style*="italic"]'),'둘째');
  if(kind!=='bulk')await page.waitForFunction(()=>document.querySelector('[data-testid=keywords]')?.textContent===JSON.stringify(['첫 키워드']));
  for(const destinationBold of [true,false]){
    await editor.fill('');
    if(await editor.evaluate(()=>document.queryCommandState('bold'))!==destinationBold)await editor.press('Meta+b');
    await paste(editor,payload);
    assert.equal(await styleText(editor,'b,strong'),'첫 키워드','internal paste preserves keyword boundaries regardless of destination typing style');
  }
  // Copy a substring whose cloneContents has no strong ancestor; retain its style.
  await select(editor,'키워드');const partial=await copy(editor);
  await editor.fill('');await paste(editor,partial);assert.equal(await styleText(editor,'b,strong'),'키워드');
  // Safari-compatible HTML fallback, and clipboard payload from another tab.
  await editor.fill('');await paste(editor,{'text/html':payload['text/html'],'text/plain':payload['text/plain']});
  assert.equal(await styleText(editor,'b,strong'),'첫 키워드');
  await select(editor,'설명');const cut=await copy(editor,'cut');
  assert.equal((await editor.innerText()).includes('설명'),false);assert.ok(cut[mime]);
  await editor.press('Meta+z');assert.equal((await editor.innerText()).includes('설명'),true,'cut is undoable');
  await editor.press('Meta+Shift+z');assert.equal((await editor.innerText()).includes('설명'),false,'cut is redoable');
  // No source formatting survives a foreign marker, and active HTML cannot enter
  // even through a malformed/forged same-site clipboard marker.
  await editor.fill('');await select(editor,null);
  await paste(editor,{'text/plain':'외부','text/html':payload['text/html'].replaceAll('http://127.0.0.1:5194','https://foreign.invalid')});
  assert.equal(await styleText(editor,'b,strong,u,em,i'),'');
  await editor.fill('');await paste(editor,{[mime]:JSON.stringify({version:1,origin:'http://127.0.0.1:5194',html:'<b onclick="alert(1)">안전</b><img src="x" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">문장</a>'})});
  assert.equal(await editor.innerText(),'안전문장');assert.equal(await editor.locator('img,script,a,[onclick],[style]').count(),0);
  await editor.fill('');await paste(editor,payload);
  if(kind==='table'){
    await page.getByRole('button',{name:'표 편집 닫기',exact:true}).click();await page.getByRole('button',{name:'표 편집',exact:true}).click();await page.locator('[data-table-cell-id]').dblclick();
    assert.equal(await styleText(editor,'b,strong'),'첫 키워드');assert.equal(await styleText(editor,'u'),'설명');assert.equal(await styleText(editor,'em,i'),'둘째');
  }else if(kind==='bulk'&&!mobile){
    await page.locator('[data-bulk-focus-kind="memo"]').first().click();await page.waitForFunction(()=>document.querySelector('.bulk-footer')?.textContent?.includes('자동 저장됨'));
    assert.match(saves.at(-1).cards[0].answerFormat,/\[b\]첫 키워드\[\/b\]/);assert.match(saves.at(-1).cards[0].answerFormat,/\[u\]설명\[\/u\]/);assert.match(saves.at(-1).cards[0].answerFormat,/\[i\]둘째\[\/i\]/);
  }
  assert.deepEqual(errors,[]);console.log(`PASS ${mobile?'mobile':'desktop'} ${kind}: B/U/I on/off undo/redo; internal copy/cut/paste, keyword identity, partial selection, HTML fallback, foreign-source stripping, save/reopen`);await page.close();
 }
 // Read-only card and table selections use the same internal-copy boundary.
 for(const mobile of [false,true]){
  const page=await browser.newPage({viewport:{width:mobile?390:1280,height:900},hasTouch:mobile});
  await page.route('**/api/**',route=>route.abort());await page.goto('http://127.0.0.1:5194/?reader=1');
  const editor=page.getByRole('textbox',{name:'붙여넣기'});
  await editor.fill('');await paste(editor,copied);assert.equal(await styleText(editor,'b,strong'),'첫 키워드','copy survives tab change');
  for(const source of [page.getByTestId('reader'),page.getByTestId('reader-table').locator('.answer-table-cell-content')]){
   await select(source,'키워드');const payload=await copy(source);await editor.fill('');await paste(editor,payload);assert.equal(await styleText(editor,'b,strong'),'키워드','read-only keyword copy retains bold');
  }
  await page.screenshot({path:`/private/tmp/editor-rich-copy-${mobile?'mobile':'desktop'}.png`});
  console.log(`PASS ${mobile?'mobile':'desktop'} reader: cross-tab, normal card and table content copy`);await page.close();
 }
}finally{await browser.close();await server.close();}

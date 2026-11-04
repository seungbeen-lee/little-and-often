import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.KEYWORD_BROWSER_MODULE||'playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const server=await createServer({root,configFile:false,cacheDir:'node_modules/.vite-empty-row',resolve:{alias:{'@':root}},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','class-variance-authority','clsx','lucide-react','radix-ui','tailwind-merge']},plugins:[react(),{name:'empty-row-fixture',configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');});}}],server:{host:'127.0.0.1',port:5196,strictPort:true,hmr:false}});
await server.listen();const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
async function fixture(mobile=false,query=''){
  const page=await browser.newPage({viewport:{width:mobile?390:1400,height:1000},hasTouch:mobile});
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  const saves=[];
  // All writes use disposable in-memory data; never load production records.
  await page.route('**/api/**',async route=>{
    if(new URL(route.request().url()).pathname==='/api/cards/organize'){
      const payload=route.request().postDataJSON();saves.push(payload);
      return route.fulfill({json:{cards:payload.cards.map((card,i)=>({...card,id:card.id??100+i,subject:payload.subject,keywords:[],updatedAt:new Date().toISOString()}))}});
    }
    errors.push(`Unexpected API: ${route.request().url()}`);return route.abort();
  });
  await page.goto(`http://127.0.0.1:5196/${query}`);return {page,saves};
}
async function confirm(page){
  await page.getByRole('alertdialog').getByRole('button',{name:'계속',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'삭제',exact:true}).click();
  await page.getByRole('alertdialog').waitFor({state:'hidden'});
}
try{
  const {page,saves}=await fixture();
  const rows=page.locator('[data-editor-card-row]');
  const field=(index,kind)=>rows.nth(index).locator(`[data-bulk-focus-kind="${kind}"]`);
  await field(0,'memo').fill('');await field(0,'memo').press('Backspace');
  await page.waitForFunction(()=>document.activeElement?.dataset.bulkFocusKind==='answer');
  assert.equal(await page.getByRole('alertdialog').count(),0,'empty memo does not delete a nonempty card');
  await field(0,'answer').fill('');await field(0,'answer').press('Backspace');
  await page.waitForFunction(()=>document.activeElement?.dataset.bulkFocusKind==='question');
  assert.equal(await page.getByRole('alertdialog').count(),0,'existing Backspace navigation remains');
  await field(0,'answer').fill('정답 1');await field(0,'memo').fill('메모 1');await field(0,'memo').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('[data-editor-card-row]').length===6);
  const blank=field(1,'question');await blank.click();
  for(const properties of [{isComposing:true,keyCode:229},{repeat:true},{ctrlKey:true},{metaKey:true},{shiftKey:true}]){
    await blank.dispatchEvent('keydown',{key:'Backspace',...properties});
    assert.equal(await page.getByRole('alertdialog').count(),0,'composition, repeats and modifiers never delete rows');
  }
  await blank.fill('x');await blank.press('Backspace');
  assert.equal(await page.getByRole('alertdialog').count(),0,'the keystroke deleting the final character only edits text');
  await blank.press('Backspace');assert.equal(await rows.count(),6);
  assert.equal(await page.getByRole('alertdialog').getByRole('button',{name:'삭제',exact:true}).count(),0);
  await page.getByRole('alertdialog').getByRole('button',{name:'취소',exact:true}).click();
  await blank.press('Backspace');await page.getByRole('alertdialog').getByRole('button',{name:'계속',exact:true}).click();
  assert.equal(await rows.count(),6,'first confirmation keeps the card');
  await page.getByRole('alertdialog').getByRole('button',{name:'취소',exact:true}).click();
  await blank.press('Backspace');await confirm(page);
  assert.equal(await rows.count(),5);
  await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-bulk-focus-kind="memo"]'));
  await page.keyboard.press('Meta+z');assert.equal(await rows.count(),6,'undo restores the blank row');
  await page.keyboard.press('Meta+Shift+z');assert.equal(await rows.count(),5);
  const gap=page.locator('[data-bulk-gap-index="0"]');await gap.hover();await gap.getByRole('button',{name:'섹션',exact:true}).click();
  const divider=page.locator('input[data-bulk-divider]').first();await divider.press('Backspace');await confirm(page);
  assert.equal(await page.locator('input[data-bulk-divider]').count(),1);
  assert.equal(await rows.count(),5,'deleting a section does not delete descendants');
  await field(4,'question').fill('');await field(4,'memo').fill('');await field(4,'question').press('Backspace');
  assert.equal(await page.getByRole('alertdialog').count(),0,'table content prevents whole-card removal');
  assert.ok(saves.every(save=>save.cards.length===5),'only the five original synthetic cards can be saved');
  console.log('PASS desktop: empty-only deletion, both cancellations, two confirmations, focus, undo/redo, section descendants, table guard, IME/repeats and existing navigation');
  await page.close();

  const last=await fixture(false,'?delete-single=1');
  // Skip modal exit animation so undo can run before the 250 ms autosave.
  await last.page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
  for(const kind of ['question','answer','memo'])await last.page.locator(`[data-bulk-focus-kind="${kind}"]`).fill('');
  await last.page.locator('[data-bulk-focus-kind="question"]').press('Backspace');await confirm(last.page);
  await last.page.waitForFunction(()=>document.activeElement?.dataset.bulkFocusKind==='divider');
  await last.page.keyboard.press('Meta+z');
  await last.page.waitForTimeout(1100);
  assert.ok(last.saves.every(save=>save.cards.length>0),'undo before autosave cancels the authorized empty save');
  await last.page.keyboard.press('Meta+Shift+z');
  await last.page.waitForFunction(()=>document.querySelector('[data-testid="saved-cards"]')?.textContent==='[]');
  assert.deepEqual(last.saves.at(-1).deleteCardIds,[1],'only the confirmed last saved card is deleted');
  assert.equal(await last.page.locator('input[data-bulk-divider]').inputValue(),'기본','last-card deletion preserves sections');
  assert.equal(await last.page.locator('[data-editor-card-row]').count(),1,'one blank input row stays available');
  console.log('PASS last saved card: exact deletion ID, retained section and usable blank row');await last.page.close();

  const mobile=await fixture(true);
  for(const kind of ['card','section']){
    await mobile.page.locator('.mobile-position-choice.is-first').click();
    await mobile.page.locator(`.mobile-create-kind-grid .is-${kind}`).click();
    const input=kind==='card'?mobile.page.getByRole('textbox',{name:'새 카드 질문',exact:true}):mobile.page.locator('.mobile-divider-compose-card input');
    await input.press('Backspace');await confirm(mobile.page);
    await mobile.page.locator('.mobile-position-choice.is-first').waitFor({state:'visible'});
    assert.equal(await mobile.page.locator('[data-editor-card-row]').count(),5);
  }
  assert.ok(mobile.saves.every(save=>save.cards.length===5));
  assert.deepEqual(errors,[]);
  console.log('PASS mobile keyboard: empty card/section confirmation returns to position picker without deleting existing cards');
  await mobile.page.close();
}finally{await browser.close();await server.close();}

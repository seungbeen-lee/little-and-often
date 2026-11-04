import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const { chromium, webkit } = await import(process.env.KEYWORD_BROWSER_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: false, cacheDir: 'node_modules/.vite-staged-study', resolve: { alias: { '@': root } }, plugins: [react(), { name: 'staged-fixture', configureServer(vite) {
  vite.middlewares.use((req, res, next) => {
    if (req.url?.split('?')[0] !== '/') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/staged-study.tsx"></script>');
  });
} }], server: { host: '127.0.0.1', port: 5201, strictPort: true, hmr: false } });
await server.listen();
const table = await server.ssrLoadModule('/lib/table-card.ts');
const stages = await server.ssrLoadModule('/lib/learning-stages.ts');
const base = { id: 1, subject: '과학', contentType: '교육과정', section: '분리 검증', subsection: '', detailSection: '', area: '', importance: 1, question: '과일의 예시는?', questionFormat: '', answer: '사과, 배', answerFormat: '[b]사과[/b], [b]배[/b]', keywords: ['사과','배'], memo: '', media: { question: [], answer: [], memo: [] }, sortOrder: 0, correctCount: 0, incorrectCount: 0, correctStreak: 0, masteryStreak: 0, archivedAt: null, archiveReviewStage: 0, archiveReviewDueAt: null, lastReviewedAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const stats = { summaries: [], cardPerformance: {}, keywordPerformance: {}, connectionPerformance: {} };
async function startStudy(page, practice = false) {
  await page.locator('.subject-tile').filter({ has: page.locator('strong', { hasText: /^과학$/ }) }).click();
  if (practice) await page.getByRole('switch', { name: '연습 모드로 바꾸기' }).click();
  await page.getByRole('button', { name: /처음부터/ }).click();
  assert.equal(await page.getByRole('dialog').count(), 0, 'start directly without extra confirmation');
  await page.locator('.study-card').waitFor();
}
async function setup(browser, { width = 390, height = 844, stage = 'keyword', streak = 0, practice = false, isTable = false, long = false, flow = 'study' } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 760, hasTouch: width < 760 });
  page.setDefaultTimeout(10000); const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('UI ERROR', error.message); });
  let card = { ...base, keywordSuccessStreak: stage === 'full' ? 3 : streak, fullWriteSuccessStreak: 0, keywordLastSucceededAt: new Date().toISOString() };
  if (long) card.question = '긴 문제를 읽고 아래에 답을 작성하세요. '.repeat(24);
  if (isTable) {
    let doc = table.createTable(2,2);
    for (let i=0;i<4;i++) doc = table.editCell(doc, doc.cells[i].id, `[b]${['사과','배','포도','귤'][i]}[/b]`);
    card.answerFormat = table.encodeTable(doc); card.answer = table.tableText(doc); card.keywords = table.tableKeywords(card.answerFormat).map(x=>x.keyword);
  }
  const reviews = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), payload = request.method() === 'POST' ? request.postDataJSON() : null;
    let response = {};
    if (url.pathname === '/api/cards') response = { cards: [card] };
    else if (url.pathname === '/api/sets') response = { sets: [] };
    else if (url.pathname === '/api/stats') response = url.searchParams.has('daily') ? { daily: { date: '2026-10-27', learnedCardCount: 0, attempts: 0, correctCount: 0, accuracy: null, subjects: [] } } : { stats };
    else if (url.pathname === '/api/progress') response = { progress: null, saved: true };
    else if (url.pathname === '/api/settings/day') response = { targetDate: '2026-11-07' };
    else if (url.pathname === '/api/reviews') {
      reviews.push(payload);
      card = { ...card, ...stages.nextLearningProgress(card, { kind: payload.learningKind, result: payload.result, hinted: payload.hintUsed, fullCoverage: true, statisticsOnly: !!payload.statisticsOnly, at: new Date().toISOString() }) };
      if (!payload.statisticsOnly) card.correctCount += payload.result === 'correct' ? 1 : 0;
      response = { saved: true, ...card, reviewedAt: new Date().toISOString() };
    } else if (url.pathname === '/api/keyword-stats') response = { saved: true, cardId: 1, keywordPerformance: [] };
    else if (url.pathname === '/api/connections') response = { saved: true, cardId: 1, connection: { attempts: 1, connectedCount: 1, connectivity: 100 } };
    else throw new Error(`Unexpected isolated request: ${url.pathname}`);
    await route.fulfill({ json: response });
  });
  await page.goto('http://127.0.0.1:5201/');
  if (flow === 'quiz') {
    await page.getByRole('tab', { name: '퀴즈', exact: true }).click();
    await page.getByRole('button', { name: '1문제 시작' }).click();
    await page.locator('.quiz-card').waitFor();
    return { page, reviews, errors, card: () => card };
  }
  await startStudy(page, practice);
  return { page, reviews, errors, card: () => card };
}
const browser = process.env.STAGED_BROWSER === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'chrome', headless: true });
try {
  // No practice round is required to progress from keywords to full writing.
  const progression = await setup(browser, { streak: 2 });
  for (let i = 0; i < 2; i++) await progression.page.locator(`.study-keyword-attempt input[data-cloze-index="${i}"]`).fill(base.keywords[i]);
  await progression.page.locator('.result-actions button').click();
  await progression.page.locator('.study-complete').waitFor();
  assert.equal(progression.card().keywordSuccessStreak, 3);
  await progression.page.reload(); await startStudy(progression.page);
  await progression.page.locator('.typed-textarea').fill('사과 배');
  await progression.page.getByRole('button', { name: '정답과 비교하기' }).click();
  await progression.page.getByRole('button', { name: '정답으로 다음' }).click();
  await progression.page.locator('.study-complete').waitFor();
  assert.equal(progression.card().fullWriteSuccessStreak, 1);
  await progression.page.close();

  const optional = await setup(browser, { practice: true });
  await optional.page.locator('.cloze-field-hint').first().waitFor();
  for (let i = 0; i < 2; i++) await optional.page.locator(`.study-keyword-attempt input[data-cloze-index="${i}"]`).fill(base.keywords[i]);
  await optional.page.locator('.result-actions button').click();
  await optional.page.locator('.study-complete').waitFor();
  assert.equal(optional.reviews.at(-1).learningKind, 'practice');
  assert.equal(optional.reviews.at(-1).statisticsOnly, true);
  assert.equal(optional.card().keywordSuccessStreak, 0); assert.equal(optional.card().correctCount, 0);
  await optional.page.close();

  for (const width of [390, 1280]) for (const isTable of [false, true]) {
    const test = await setup(browser, { width, isTable }); const { page, reviews } = test;
    for (let index = 0; index < test.card().keywords.length; index++) {
      // Query from the root because completed blanks become static green text.
      await page.locator(`.study-keyword-attempt input[data-cloze-index="${index}"], .study-keyword-attempt textarea[data-cloze-index="${index}"]`).fill(test.card().keywords[index]);
    }
    await page.locator('.result-actions button').waitFor();
    assert.equal(reviews.length, 0, 'automatic answer checking must not advance/record until next');
    await page.locator('.result-actions button').click();
    await page.waitForFunction(() => !document.querySelector('.study-card'));
    assert.equal(reviews.at(-1).learningKind, 'keyword'); assert.equal(reviews.at(-1).statisticsOnly, false);
    assert.deepEqual(test.errors, []);
    await page.close();
  }
  for (const width of [390, 1280]) for (const isTable of [false, true]) {
    const test = await setup(browser, { width, isTable, stage: 'full' }); const { page, reviews } = test;
    if (isTable) {
      const doc = table.readTable(test.card().answerFormat);
      for (const cell of doc.cells) await page.getByRole('textbox', { name: `${doc.rows.indexOf(cell.row)+1}행 ${doc.columns.indexOf(cell.column)+1}열 전체 답안` }).fill(table.plainCell(cell.format));
    } else await page.locator('.typed-textarea').fill('사과와 배를 적었습니다.');
    await page.getByRole('button', { name: '정답과 비교하기' }).click();
    await page.locator('.full-write-proposal').waitFor();
    assert.equal(reviews.length, 0, 'the automatic keyword proposal is not yet a confirmed result');
    assert.match(await page.locator('.full-write-proposal').innerText(), isTable ? /4\/4/ : /2\/2/);
    await page.getByRole('button', { name: '오답으로 변경' }).click();
    await page.waitForFunction(() => !document.querySelector('.study-card'));
    assert.equal(reviews.at(-1).learningKind, 'full'); assert.equal(reviews.at(-1).result, 'incorrect');
    assert.deepEqual(test.errors, []); await page.close();
  }
  for (const flow of ['study', 'quiz']) for (const isTable of [false, true]) {
    const test = await setup(browser, { isTable, long: true, flow }); const { page } = test;
    await page.locator('.mobile-session-layout').waitFor();
    const input = page.locator('.study-card input[data-cloze-index], .study-card textarea[data-cloze-index], .quiz-card input[data-cloze-index], .quiz-card textarea[data-cloze-index]').first();
    await input.focus();
    await page.evaluate(() => {
      // iOS keyboard + accessory menu: reduced visual viewport, unchanged layout viewport.
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 390 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => document.querySelector('[data-session-keyboard="open"]'));
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('.study-card, .quiz-card'), field = document.activeElement, main = document.querySelector('main');
      const rect = field.getBoundingClientRect(), viewport = card.getBoundingClientRect();
      const nestedScrollers = [...card.querySelectorAll('*')].filter(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2).map(node => node.className);
      const timer = document.querySelector('.study-progress-meta').getBoundingClientRect();
      return { fieldTop: rect.top, fieldBottom: rect.bottom, cardTop: viewport.top, cardBottom: viewport.bottom, mainBottom: main.getBoundingClientRect().bottom, timerTop: timer.top, timerBottom: timer.bottom, nestedScrollers };
    });
    assert.ok(geometry.fieldTop >= geometry.cardTop && geometry.fieldBottom <= 342, JSON.stringify(geometry));
    assert.ok(geometry.timerTop >= 0 && geometry.timerBottom < geometry.cardTop, JSON.stringify(geometry));
    assert.ok(geometry.mainBottom <= 391, JSON.stringify(geometry));
    assert.deepEqual(geometry.nestedScrollers, [], 'question/answer should share one vertical scroller');
    const card = page.locator('.study-card, .quiz-card');
    await card.evaluate(node => { node.scrollTop = 0; });
    assert.ok(await page.locator('.mobile-session-hint').isVisible());
    await page.locator('.mobile-session-hint').click();
    await page.locator('#quiz-hint-1-0').waitFor({ state: 'attached' });
    assert.match(await page.locator('#quiz-hint-1-0').textContent(), /첫 글자 힌트/);
    assert.equal(await input.evaluate(node => node === document.activeElement), true);
    await page.screenshot({ path: `/private/tmp/staged-keyboard-${flow}-${isTable ? 'table' : 'normal'}.png` });
    assert.deepEqual(test.errors, []); await page.close();
  }
  const longWriting = await setup(browser, { stage: 'full', long: true });
  const text = longWriting.page.locator('.typed-textarea');
  await text.fill('긴 답안을 입력하는 중입니다.\n'.repeat(35) + '사과 배');
  await longWriting.page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 390 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await longWriting.page.waitForFunction(() => document.querySelector('[data-session-keyboard="open"]'));
  const writing = await text.evaluate(node => ({ scroll: node.scrollHeight - node.clientHeight, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom }));
  await longWriting.page.screenshot({ path: '/private/tmp/staged-long-writing.png' });
  assert.ok(writing.scroll < 3 && writing.bottom <= 360, JSON.stringify(writing)); // Caret plus the textarea's bottom padding.
  await longWriting.page.close();
  console.log('PASS real StudyApp: desktop/mobile keyword & table, full-write proposal/override, manual next, single-scroll keyboard viewport and persistent controls');
} finally { await browser.close(); await server.close(); }

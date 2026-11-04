// Standalone, in-memory browser fixture. No production API requests or records.
import React from 'react';
import { createRoot } from 'react-dom/client';
import StudyApp from '../../app/study-app';
import { Toaster } from '../../components/ui/sonner';
import { createTable, editCell, encodeTable, tableText, tableKeywords } from '../../lib/table-card';
import { nextLearningProgress } from '../../lib/learning-stages';
import '../../app/globals.css';
const params = new URLSearchParams(location.search);
const full = params.has('full');
const stale = params.has('stale');
let format = '[b]사과[/b], [b]배[/b]';
let answer = '사과, 배';
let keywords = ['사과','배'];
if (params.has('ime')) {
  keywords = ['자율', '매달리기']; answer = keywords.join(', ');
  format = keywords.map(word => `[b]${word}[/b]`).join(', ');
}
if (params.has('table')) {
  let table = createTable(8, 2);
  for (const [i, cell] of table.cells.entries()) table = editCell(table, cell.id, `[b]${params.has('ime') ? ['자율', '매달리기'][i % 2] : ['사과','배','포도','귤'][i % 4]}[/b]`);
  if (params.has('tall')) {
    for (const cell of table.cells) table = editCell(table, cell.id, cell.format + '\n긴 표의 설명을 읽고 질문의 핵심을 떠올립니다.'.repeat(3));
  }
  format = encodeTable(table); answer = tableText(table); keywords = tableKeywords(format).map(x => x.keyword);
}
let card = { id: 1, subject: '과학', contentType: '교육과정', section: '분리 검증', subsection: '', detailSection: '', area: '', importance: 1,
  question: '과일의 예시는?' + (params.has('long') ? ' 긴 문제를 읽고 답을 작성하세요.'.repeat(25) : ''), questionFormat: '', answer, answerFormat: format,
  keywords, memo: '', media: { question: [], answer: [], memo: [] }, sortOrder: 0, correctCount: 12, incorrectCount: 0, correctStreak: 0, masteryStreak: 0,
  keywordSuccessStreak: full || stale ? 3 : 2, fullWriteSuccessStreak: 0, keywordLastSucceededAt: stale ? '2026-01-01T00:00:00Z' : new Date().toISOString(),
  archivedAt: null, archiveReviewStage: 0, archiveReviewDueAt: null, lastReviewedAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
if (params.has('connection')) {
  card.question = '과일의 종류와 특징은?';
  card.questionFormat = '과일의 [b]종류[/b]와 [b]특징[/b]은?';
}
const stats = { summaries: [], cardPerformance: {}, keywordPerformance: {}, connectionPerformance: params.has('connection') ? { '1': { attempts: 3, connectedCount: 0, connectivity: 0 } } : {} };
const output = document.createElement('output'); output.id = 'fixture-results'; output.setAttribute('aria-label','분리 검증 결과'); document.body.append(output);
const results: unknown[] = [];
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href), payload = init?.body ? JSON.parse(String(init.body)) : {};
  let response: unknown = {};
  if (url.pathname === '/api/cards') response = { cards: params.has('many') ? Array.from({length:34}, (_, i) => ({...card, id:i + 1, sortOrder:i})) : [card] };
  else if (url.pathname === '/api/sets') response = { sets: params.has('sets') ? [{ id: 1, subject: '과학', name: '분리 검증 세트', memo: '', cardIds: [1], createdAt: '2026-01-01', updatedAt: '2026-01-01' }] : [] };
  else if (url.pathname === '/api/stats') response = url.searchParams.has('daily') ? { daily: { date: '2026-10-28', learnedCardCount: 0, attempts: 0, correctCount: 0, accuracy: null, subjects: [] } } : { stats };
  else if (url.pathname === '/api/progress') response = { progress: null, saved: true };
  else if (url.pathname === '/api/settings/day') response = { targetDate: '2026-11-07' };
  else if (url.pathname === '/api/reviews') {
    card = { ...card, ...nextLearningProgress(card, { kind: payload.learningKind, result: payload.result, hinted: payload.hintUsed, fullCoverage: true, statisticsOnly: !!payload.statisticsOnly, at: new Date().toISOString() }) } as typeof card;
    if (!payload.statisticsOnly) card.correctCount += payload.result === 'correct' ? 1 : 0;
    response = { saved: true, ...card, reviewedAt: new Date().toISOString() };
    results.push({ kind: payload.learningKind, result: payload.result, statisticsOnly: payload.statisticsOnly, keywordSuccessStreak: card.keywordSuccessStreak, fullWriteSuccessStreak: card.fullWriteSuccessStreak });
    output.textContent = JSON.stringify(results);
  } else if (url.pathname === '/api/keyword-stats') response = { saved: true, cardId: 1, keywordPerformance: [] };
  else if (url.pathname === '/api/connections') response = { saved: true, cardId: 1, connection: { attempts: 1, connectedCount: 1, connectivity: 100 } };
  else throw new Error(`Unexpected isolated request: ${url.pathname}`);
  return Response.json(response);
};
if (params.has('keyboard') && window.visualViewport) {
  // A test-only simulation of the reduced visible area with an iOS accessory bar.
  let keyboardHeight: number | null = null;
  const updateKeyboard = () => {
    keyboardHeight = document.activeElement?.matches('input,textarea') ? 390 : null;
    window.visualViewport?.dispatchEvent(new Event('resize'));
  };
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => keyboardHeight ?? window.innerHeight });
  document.addEventListener('focusin', () => {
    if (params.has('keyboard-late')) window.setTimeout(updateKeyboard, 180);
    else updateKeyboard();
  });
  document.addEventListener('focusout', updateKeyboard);
}
if (params.has('motion')) {
  const motion = document.createElement('output'); motion.id = 'scroll-observation'; motion.hidden = true; document.body.append(motion);
  let measured = false;
  new MutationObserver(() => {
    const scroller = document.querySelector<HTMLElement>('.study-card');
    if (measured || !scroller?.querySelector('.cloze-inline-answer.is-correct')) return;
    measured = true;
    const started = performance.now(), samples: unknown[] = [];
    const sample = () => {
      const ms = Math.round(performance.now() - started);
      samples.push({ ms, top: scroller.scrollTop, focus: document.activeElement?.getAttribute('data-cloze-index') });
      motion.textContent = JSON.stringify(samples);
      if (ms < 1100) requestAnimationFrame(sample);
    };
    sample();
  }).observe(document.getElementById('root')!, { childList: true, subtree: true });
}
if (params.has('ime')) {
  // Test-only UI drives real React input/composition handlers, with mocked APIs.
  output.hidden = true;
  const button = document.createElement('button'); button.textContent = '한글 조합 검증';
  Object.assign(button.style, { position: 'fixed', bottom: '0', left: '0', zIndex: '100' });
  button.onpointerdown = event => event.preventDefault();
  button.onclick = async () => {
    const samples: unknown[] = [];
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-cloze-index="0"]')!;
    const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!;
    input.focus({ preventScroll: true });
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const value of ['', '자', '장', '자유', '자바', '장', '자율']) {
      setter.call(input, value);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, isComposing: true, inputType: 'insertCompositionText' }));
      await frame();
      const box = input.closest('.table-inline-blank, .cloze-field');
      samples.push({ value, width: box?.getBoundingClientRect().width, height: box?.getBoundingClientRect().height,
        guide: box?.querySelector('.table-inline-hint > span:last-child, .cloze-field-hint > span:last-child')?.textContent,
        connected: input.isConnected });
    }
    output.textContent = JSON.stringify(samples);
  };
  document.body.append(button);
}
createRoot(document.getElementById('root')!).render(<><StudyApp /><Toaster /></>);

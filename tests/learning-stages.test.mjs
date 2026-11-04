import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url));
const db = new DatabaseSync(':memory:');
for (const file of readdirSync(new URL('../drizzle', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
const binding = { prepare(query) { return { bind(...values) { const stmt = db.prepare(query); return { async all() { return { results: stmt.all(...values), success: true }; }, async raw() { stmt.setReturnArrays(true); return stmt.all(...values); }, async run() { stmt.run(...values); return { success: true }; } }; } }; }, async batch(statements) { db.exec('BEGIN'); try { const result = []; for (const stmt of statements) result.push(await stmt.all()); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } } };
globalThis.__stagesTestEnv = { DB: binding };
const vite = await createServer({ root, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false }, resolve: { alias: { '@': root } }, plugins: [{ name: 'stages-env', resolveId(id) { if (id === 'cloudflare:workers') return '\0stages-env'; }, load(id) { if (id === '\0stages-env') return 'export const env = globalThis.__stagesTestEnv;'; } }] });
after(async () => { await vite.close(); db.close(); delete globalThis.__stagesTestEnv; });
const api = await vite.ssrLoadModule('/app/api/reviews/route.ts');
const stages = await vite.ssrLoadModule('/lib/learning-stages.ts');
const table = await vite.ssrLoadModule('/lib/table-card.ts');
let sequence = 0;
const owner = 'stages@example.invalid';
const headers = { 'oai-authenticated-user-email': owner, 'Content-Type': 'application/json' };
function card(overrides = {}) {
  const id = Number(db.prepare("INSERT INTO cards(owner_email,subject,section,question,answer,answer_format,keywords) VALUES (?, '검증', '독립 데이터', '질문', '사과 배', '[b]사과[/b] [b]배[/b]', '[\"사과\",\"배\"]')").run(owner).lastInsertRowid);
  for (const [field, value] of Object.entries(overrides)) db.prepare(`UPDATE cards SET ${field}=? WHERE id=?`).run(value, id);
  return id;
}
const stored = id => db.prepare('SELECT * FROM cards WHERE id=?').get(id);
async function review(id, kind, result = 'correct', extra = {}) {
  const payload = { eventId: `stage-attempt-${++sequence}`, cardId: id, mode: kind === 'full' ? 'write' : 'reveal', result, learningKind: kind, ...(kind === 'practice' ? { statisticsOnly: true } : {}), ...extra };
  const response = await api.POST(new Request('https://isolated.invalid/api/reviews', { method: 'POST', headers, body: JSON.stringify(payload) }));
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
}
test('optional practice, three unhinted keyword successes → two confirmed full writes, and replay safety', async () => {
  const id = card({ correct_count: 12, incorrect_count: 4, mastery_streak: 8 });
  await review(id, 'full');
  assert.equal(stored(id).full_write_success_streak, 0, 'cannot skip prerequisite');
  await review(id, 'practice', 'correct', { eventId: 'stage-practice-replay' });
  await review(id, 'practice', 'correct', { eventId: 'stage-practice-replay' });
  assert.equal(stored(id).correct_count, 13); assert.equal(stored(id).incorrect_count, 3, 'practice preserves accumulated mistakes');
  for (let n = 1; n <= 3; n++) {
    const result = await review(id, 'keyword');
    assert.equal(result.keywordSuccessStreak, n); assert.equal(result.archivedAt, null);
  }
  const first = await review(id, 'full', 'correct', { eventId: 'stage-full-replay' });
  assert.equal(first.fullWriteSuccessStreak, 1); assert.equal(first.archivedAt, null);
  const replay = await review(id, 'full', 'correct', { eventId: 'stage-full-replay' });
  assert.equal(replay.fullWriteSuccessStreak, 1); assert.equal(replay.correctCount, first.correctCount);
  const second = await review(id, 'full');
  assert.equal(second.fullWriteSuccessStreak, 2); assert.ok(second.archivedAt); assert.ok(second.archiveReviewDueAt);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE event_id=?').get('stage-full-replay').n, 1);
});
test('hints break consecutive keyword successes, correction/statistics and partial attempts cannot graduate', async () => {
  const id = card(); await review(id, 'practice'); await review(id, 'keyword'); await review(id, 'keyword');
  await review(id, 'keyword', 'correct', { statisticsOnly: true, hintUsed: true });
  assert.equal(stored(id).keyword_success_streak, 0); assert.equal(stored(id).correct_count, 2);
  await review(id, 'keyword', 'correct', { statisticsOnly: true });
  assert.equal(stored(id).keyword_success_streak, 0);
  for (let i = 0; i < 3; i++) await review(id, 'keyword');
  await review(id, 'full'); await review(id, 'full', 'incorrect');
  assert.equal(stored(id).full_write_success_streak, 0); assert.equal(stored(id).keyword_success_streak, 3);
  await review(id, 'full'); assert.equal(stored(id).archived_at, null);
  await review(id, 'full'); assert.ok(stored(id).archived_at);
});
test('table cells have separate scope and full writing is explicitly distinguished from quiz write mode', async () => {
  let doc = table.createTable(1,2); doc = table.editCell(doc, doc.cells[0].id, '[b]사과[/b]'); doc = table.editCell(doc, doc.cells[1].id, '[b]사과[/b]');
  const format = table.encodeTable(doc), ids = table.tableKeywords(format).map(x => x.keywordKey);
  const id = card({ answer: table.tableText(doc), answer_format: format });
  await review(id, 'practice', 'correct', { tableKeywordIds: [ids[0]] }); assert.equal(stored(id).keyword_success_streak, 0);
  await review(id, 'practice', 'correct', { tableKeywordIds: ids });
  await review(id, 'keyword', 'correct', { tableKeywordIds: [ids[0]] }); assert.equal(stored(id).keyword_success_streak, 0);
  for (let i = 0; i < 3; i++) await review(id, 'keyword', 'correct', { mode: 'write', tableKeywordIds: ids });
  assert.equal(stored(id).full_write_success_streak, 0); assert.equal(stored(id).archived_at, null);
  await review(id, 'full', 'correct', { tableKeywordIds: ids }); assert.equal(stored(id).full_write_success_streak, 1);
  const app = await vite.ssrLoadModule('/app/study-app.tsx');
  const matches = app.fullWriteKeywordMatches({ answerFormat: format }, '사과 사과', { [doc.cells[0].id]: '사과 사과' });
  assert.deepEqual(matches.map(x => x.matched), [true, false], 'one cell cannot answer another identical keyword');
});
test('legacy clients cannot archive by keyword count; old archived cards keep spaced-review behavior', async () => {
  const id = card({ mastery_streak: 9, correct_count: 20 });
  await review(id, undefined); assert.equal(stored(id).archived_at, null); assert.equal(stored(id).correct_count, 21);
  const archived = card({ archived_at: '2026-01-01T00:00:00Z', archive_review_stage: 1, archive_review_due_at: '2026-01-04T00:00:00Z' });
  await review(archived, 'keyword'); assert.equal(stored(archived).archived_at, '2026-01-01T00:00:00Z'); assert.equal(stored(archived).archive_review_stage, 2);
  await review(archived, 'keyword', 'incorrect'); assert.equal(stored(archived).archived_at, null); assert.equal(stored(archived).keyword_success_streak, 0);
});
test('stages start at keyword writing; practice is optional and legacy stats stay separate', () => {
  assert.equal(stages.learningStage({ masteryStreak: 99 }), 'keyword');
  assert.equal(stages.learningStage({ keywordSuccessStreak: 2 }), 'keyword');
  assert.equal(stages.learningStage({ keywordSuccessStreak: 3, keywordLastSucceededAt: new Date().toISOString() }), 'full');
  assert.equal(stages.learningStage({ archivedAt: 'now' }), 'archive');
});

test('Korea-time expiry switches from 3 days to 7 days on November 7; unknown/old evidence cannot skip keywords', () => {
  const before = Date.parse('2026-11-06T23:59:59+09:00'), after = Date.parse('2026-11-07T00:00:00+09:00');
  assert.equal(stages.learningRetentionDays(before), 3);
  assert.equal(stages.learningRetentionDays(after), 7);
  const at = days => new Date(after - days * 86400000).toISOString();
  const progress = { keywordSuccessStreak: 3, fullWriteSuccessStreak: 1, keywordLastSucceededAt: at(4) };
  assert.equal(stages.learningStage(progress, before), 'keyword');
  assert.equal(stages.learningStage(progress, after), 'full');
  assert.equal(stages.learningStage({ ...progress, keywordLastSucceededAt: at(8) }, after), 'keyword');
  assert.equal(stages.learningStage({ keywordSuccessStreak: 3 }, after), 'keyword');
  assert.equal(stages.learningStage({ ...progress, archivedAt: at(10) }, after), 'archive');
  assert.equal(stages.learningStageLabel(progress, before), '키워드 0/3');
  const resumed = stages.nextLearningProgress(progress, { kind: 'keyword', result: 'correct', fullCoverage: true, statisticsOnly: false, at: new Date(before).toISOString() });
  assert.equal(resumed.keywordSuccessStreak, 1);
  assert.equal(resumed.fullWriteSuccessStreak, 0);
});

test('expired attempts are persisted without erasing lifetime statistics; practice/hints cannot refresh success time', async () => {
  const old = '2026-01-01T00:00:00.000Z';
  const id = card({ keyword_success_streak: 3, full_write_success_streak: 1, keyword_last_succeeded_at: old, correct_count: 12 });
  await review(id, 'full');
  assert.equal(stored(id).keyword_success_streak, 0);
  assert.equal(stored(id).full_write_success_streak, 0);
  assert.equal(stored(id).archived_at, null);
  assert.equal(stored(id).correct_count, 13);
  await review(id, 'keyword');
  const date = stored(id).keyword_last_succeeded_at;
  assert.ok(date); assert.equal(stored(id).keyword_success_streak, 1);
  await review(id, 'practice'); assert.equal(stored(id).keyword_last_succeeded_at, date);
  await review(id, 'keyword', 'correct', { statisticsOnly: true, hintUsed: true });
  assert.equal(stored(id).keyword_last_succeeded_at, null);
  assert.equal(stored(id).keyword_success_streak, 0);
});

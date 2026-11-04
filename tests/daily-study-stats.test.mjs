import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "daily-study-test-"));
const database = path.join(temporary, "test.sqlite");
const sql = (query) => JSON.parse(execFileSync("sqlite3", ["-json", database, query], { encoding: "utf8" }) || "[]");
sql(readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => readFileSync(path.join(root, "drizzle", name), "utf8")).join("\n"));
const quote = (value) => value == null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const binding = {
  prepare(query) {
    return {
      bind(...values) {
        let index = 0;
        const bound = query.replace(/\?/g, () => quote(values[index++]));
        return {
          bound,
          async all() { return { results: sql(bound), success: true }; },
          async raw() { return sql(bound).map((row) => Object.values(row)); },
          async run() { sql(bound); return { success: true }; },
        };
      },
    };
  },
  async batch(statements) { sql("BEGIN;" + statements.map(statement => statement.bound + ";").join("\n") + "COMMIT;"); return statements.map(() => ({ results: [], success: true })); },
};
globalThis.__dailyStudyTestEnv = { DB: binding };
const vite = await createServer({
  configFile: false, appType: "custom", root,
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { "@": root } },
  plugins: [{
    name: "daily-test-worker-binding",
    resolveId(id) { if (id === "cloudflare:workers") return "\0daily-test-worker-binding"; },
    load(id) { if (id === "\0daily-test-worker-binding") return "export const env = globalThis.__dailyStudyTestEnv;"; },
  }],
});
after(async () => { await vite.close(); delete globalThis.__dailyStudyTestEnv; rmSync(temporary, { recursive: true, force: true }); });

test("Korean day boundaries and weighted accuracy distinguish zero from no attempts", async () => {
  const { koreanStudyDay, dailyStudyStats, dailyAccuracyLabel } = await vite.ssrLoadModule("/lib/daily-study-stats.ts");
  assert.deepEqual(koreanStudyDay(new Date("2026-09-08T14:59:59Z")), { date: "2026-09-08", start: "2026-09-07T15:00:00.000Z", end: "2026-09-08T15:00:00.000Z" });
  assert.equal(koreanStudyDay(new Date("2026-09-08T15:00:00Z")).date, "2026-09-09");
  const combined = dailyStudyStats([
    { subject: "국어", learnedCardCount: 1, attempts: 3, correctCount: 1 },
    { subject: "수학", learnedCardCount: 1, attempts: 1, correctCount: 1 },
  ]);
  assert.equal(combined.learnedCardCount, 2);
  assert.equal(combined.accuracy, 50);
  assert.equal(combined.subjects[0].accuracy, 33);
  assert.equal(dailyAccuracyLabel(dailyStudyStats([]).accuracy), "—");
  assert.equal(dailyAccuracyLabel(0), "0%");
});

test("daily API includes all reviews, deduplicates cards, and keeps statistics-only attempts off mastery", async () => {
  const { POST } = await vite.ssrLoadModule("/app/api/reviews/route.ts");
  const { GET } = await vite.ssrLoadModule("/app/api/stats/route.ts");
  const { koreanStudyDay } = await vite.ssrLoadModule("/lib/daily-study-stats.ts");
  sql(`INSERT INTO cards (id, owner_email, subject, section, question, answer) VALUES
    (1, 'owner@test', '국어', '', '질문1', '답1'),
    (2, 'owner@test', '수학', '', '질문2', '답2'),
    (3, 'other@test', '국어', '', '다른 사용자', '답3');`);
  const headers = { "oai-authenticated-user-email": "owner@test", "Content-Type": "application/json" };
  const submit = (payload, requestHeaders = headers) => POST(new Request("https://test/api/reviews", { method: "POST", headers: requestHeaders, body: JSON.stringify({ mode: "write", ...payload }) }));
  const daily = async (requestHeaders = headers) => {
    const response = await GET(new Request("https://test/api/stats?daily=1", { headers: requestHeaders }));
    return { response, body: await response.json() };
  };
  assert.equal((await daily({})).response.status, 401);
  assert.equal((await submit({ cardId: 1, result: "correct" }, {})).status, 401);
  assert.equal((await submit({ cardId: 3, result: "incorrect", statisticsOnly: true, eventId: "foreign-card" })).status, 404);
  const before = sql("SELECT * FROM cards WHERE id = 1")[0];
  const practice = { cardId: 1, result: "incorrect", statisticsOnly: true, eventId: "practice-mistake" };
  assert.equal((await submit(practice)).status, 200);
  assert.equal((await submit(practice)).status, 200);
  assert.deepEqual(sql("SELECT * FROM cards WHERE id = 1")[0], before);
  let stats = (await daily()).body.daily;
  assert.equal(stats.learnedCardCount, 1);
  assert.equal(stats.attempts, 1);
  assert.equal(stats.accuracy, 0);
  assert.equal((await submit({ cardId: 1, result: "correct", eventId: "normal-correct" })).status, 200);
  assert.equal((await submit({ cardId: 1, result: "correct", eventId: "normal-correct" })).status, 200);
  assert.equal(sql("SELECT correct_count FROM cards WHERE id = 1")[0].correct_count, 1);
  assert.equal((await submit({ cardId: 1, result: "incorrect", statisticsOnly: true, eventId: "quiz-retry-missed" })).status, 200);
  assert.equal((await submit({ cardId: 2, result: "correct", statisticsOnly: true, eventId: "quiz-hinted-correct" })).status, 200);
  const day = koreanStudyDay();
  assert.equal((await submit({ cardId: 2, result: "incorrect", statisticsOnly: true, eventId: "offline-yesterday", attemptedAt: new Date(Date.parse(day.start) - 1).toISOString() })).status, 200);
  sql(`INSERT INTO reviews (card_id, owner_email, mode, result, reviewed_at) VALUES (3, 'other@test', 'write', 'incorrect', ${quote(new Date().toISOString())});`);
  stats = (await daily()).body.daily;
  assert.equal(stats.learnedCardCount, 2);
  assert.equal(stats.attempts, 4);
  assert.equal(stats.correctCount, 2);
  assert.equal(stats.accuracy, 50);
  assert.deepEqual(stats.subjects.map((row) => [row.subject, row.learnedCardCount, row.attempts, row.accuracy]), [["국어", 1, 3, 33], ["수학", 1, 1, 100]]);
  assert.equal(sql("SELECT COUNT(*) AS count FROM reviews WHERE event_id = 'practice-mistake'")[0].count, 1);
  assert.equal(sql("SELECT statistics_only FROM reviews WHERE event_id = 'practice-mistake'")[0].statistics_only, 1);
  assert.equal(sql("SELECT statistics_only FROM reviews WHERE event_id = 'normal-correct'")[0].statistics_only, 0);
  const { DAILY_STUDY_QUERY } = await vite.ssrLoadModule("/lib/daily-study-query.ts");
  const parameters = ["owner@test", day.start, day.end]; let index = 0;
  const plan = execFileSync("sqlite3", [database, "EXPLAIN QUERY PLAN " + DAILY_STUDY_QUERY.replace(/\?/g, () => quote(parameters[index++]))], { encoding: "utf8" });
  assert.match(plan, /reviews_owner_reviewed_at_idx/);
});

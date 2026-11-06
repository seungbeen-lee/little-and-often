import assert from "node:assert/strict";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  configFile: false, appType: "custom", root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});
after(() => vite.close());
const { dailyStudyStats, koreanStudyDay, subjectStudiedToday } = await vite.ssrLoadModule("/lib/daily-study-stats.ts");

test("today review includes unresolved owned mistakes and only a clean whole-card answer clears one", async () => {
  const { DAILY_REVIEW_QUERY } = await vite.ssrLoadModule("/lib/daily-study-query.ts");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, owner_email TEXT, archived_at TEXT);
      CREATE TABLE reviews (id INTEGER PRIMARY KEY, card_id INTEGER, owner_email TEXT, result TEXT, reviewed_at TEXT, statistics_only INTEGER, hint_used INTEGER, coverage TEXT);
      INSERT INTO cards VALUES (1,'me',NULL),(2,'me',NULL),(3,'me',NULL),(4,'me',NULL),(5,'me','archived'),(6,'other',NULL);`);
    const day = koreanStudyDay(new Date("2026-11-06T12:00:00+09:00"));
    const later = "2026-11-06T10:30:00.000Z";
    const insert = db.prepare("INSERT INTO reviews (card_id,owner_email,result,reviewed_at,statistics_only,hint_used,coverage) VALUES (?,?,?,?,?,?,?)");
    for (const id of [1,2,3,5]) insert.run(id,"me","incorrect",day.start,0,0,"full");
    insert.run(4,"me","incorrect",new Date(Date.parse(day.start)-1).toISOString(),0,0,"full");
    insert.run(4,"me","incorrect",day.end,0,0,"full");
    insert.run(6,"other","incorrect",later,0,0,"full");
    insert.run(1,"me","correct",later,0,0,"full");
    insert.run(2,"me","correct",later,1,0,"full");
    insert.run(2,"me","correct",later,0,1,"full");
    insert.run(2,"me","correct",later,0,0,"partial");
    insert.run(3,"me","correct",later,0,0,"full");
    insert.run(3,"me","incorrect",later,1,0,"full");
    const pending = db.prepare(DAILY_REVIEW_QUERY);
    assert.deepEqual(pending.all("me",day.start,day.end).map(row=>row.cardId).sort(),[2,3]);
    insert.run(2,"me","correct",later,0,0,"full");
    assert.deepEqual(pending.all("me",day.start,day.end).map(row=>row.cardId),[3]);
  } finally { db.close(); }
});

test("daily query returns unique owned card IDs for the Korean day, including practice mistakes", async () => {
  const { DAILY_STUDY_QUERY } = await vite.ssrLoadModule("/lib/daily-study-query.ts");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, owner_email TEXT, subject TEXT, archived_at TEXT);
      CREATE TABLE reviews (card_id INTEGER, owner_email TEXT, result TEXT, reviewed_at TEXT, statistics_only INTEGER);
      INSERT INTO cards VALUES (1, 'owner', '총론', NULL), (2, 'owner', '총론', 'archived'),
        (3, 'owner', '도덕', NULL), (4, 'other', '총론', NULL), (5, 'owner', '총론', NULL);`);
    const insert = db.prepare("INSERT INTO reviews VALUES (?, ?, ?, ?, ?)");
    insert.run(1, "owner", "incorrect", "2026-09-13T15:00:00.000Z", 1);
    insert.run(1, "owner", "correct", "2026-09-14T02:00:00.000Z", 0);
    insert.run(2, "owner", "correct", "2026-09-14T03:00:00.000Z", 0);
    insert.run(3, "owner", "incorrect", "2026-09-13T14:59:59.999Z", 1);
    insert.run(4, "other", "correct", "2026-09-14T01:00:00.000Z", 0);
    insert.run(4, "owner", "correct", "2026-09-14T01:00:00.000Z", 0);
    insert.run(5, "owner", "correct", "2026-09-14T15:00:00.000Z", 0);
    const now = new Date("2026-09-14T04:00:00Z");
    const day = koreanStudyDay(now);
    const daily = dailyStudyStats(db.prepare(DAILY_STUDY_QUERY).all("owner", day.start, day.end), now);
    assert.deepEqual(daily.subjects[0].learnedCardIds, [1, 2]);
    assert.equal(daily.subjects.length, 1);
    assert.equal(daily.learnedCardCount, 2);
    assert.equal(daily.attempts, 3);
    assert.equal(daily.correctCount, 2);
  } finally {
    db.close();
  }
});

test("completion checks every active card, never archived totals, empty subjects or stale days", () => {
  const now = new Date("2026-09-14T04:00:00Z");
  const card = (id, archivedAt = null) => ({ id, subject: "총론", archivedAt });
  const daily = dailyStudyStats([{ subject: "총론", learnedCardCount: 2, learnedCardIds: "[1,2]", attempts: 5, correctCount: 0 }], now);
  assert.equal(subjectStudiedToday("총론", [card(1), card(2)], daily, now), true);
  assert.equal(subjectStudiedToday("총론", [card(1), card(2, "archived"), card(3)], daily, now), false);
  assert.equal(subjectStudiedToday("총론", [card(1), card(2), card(3)], daily, now), false);
  assert.equal(subjectStudiedToday("총론", [card(1), card(3, "archived")], daily, now), true);
  assert.equal(subjectStudiedToday("총론", [card(1, "archived")], daily, now), false);
  assert.equal(subjectStudiedToday("총론", [], daily, now), false);
  assert.equal(subjectStudiedToday("도덕", [card(1)], daily, now), false);
  assert.equal(subjectStudiedToday("도덕", [{ ...card(1), subject: "도덕" }], daily, now), true);
  assert.equal(subjectStudiedToday("총론", [card(1)], null, now), false);
  assert.equal(subjectStudiedToday("총론", [card(1)], { ...daily, date: "2026-09-13" }, now), false);
  assert.equal(subjectStudiedToday("총론", [card(1)], daily, new Date("2026-09-14T15:00:00Z")), false);
  const legacy = dailyStudyStats([{ subject: "총론", learnedCardCount: 2, attempts: 2, correctCount: 2 }], now);
  assert.equal(subjectStudiedToday("총론", [card(1)], legacy, now), false);
});

test("subject tile combines completion color with a readable check label and preserves subject stripes", async () => {
  const { SubjectChooser } = await vite.ssrLoadModule("/app/study-app.tsx");
  const daily = dailyStudyStats([{ subject: "총론", learnedCardCount: 1, learnedCardIds: "[1]", attempts: 1, correctCount: 0 }]);
  const props = {
    subjects: ["총론", "도덕"], sets: [],
    cards: [{ id: 1, subject: "총론", archivedAt: null, importance: 0, incorrectCount: 0 },
      { id: 2, subject: "도덕", archivedAt: null, importance: 0, incorrectCount: 0 }],
    onSelect() {}, onSelectSets() {}, dailyStats: daily,
  };
  const html = renderToStaticMarkup(React.createElement(SubjectChooser, props));
  assert.equal((html.match(/is-learned-today/g) ?? []).length, 1);
  assert.match(html, /aria-label="총론 1장, 오늘 학습 완료"/);
  assert.match(html, /subject-dot subject-dot-1/);
  assert.match(html, /subject-today-complete/);
  assert.match(html, /subject-today-prefix">오늘 /);
  const pending = renderToStaticMarkup(React.createElement(SubjectChooser, { ...props, dailyStats: null }));
  assert.doesNotMatch(pending, /is-learned-today|subject-today-complete/);
});

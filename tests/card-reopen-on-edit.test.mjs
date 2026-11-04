import assert from "node:assert/strict";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const db = new DatabaseSync(":memory:");
for (const file of readdirSync(new URL("../drizzle", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
  db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
}
const binding = {
  prepare(query) {
    return {
      bind(...values) {
        const statement = db.prepare(query);
        return {
          async all() { return { results: statement.all(...values), success: true }; },
          async raw() { statement.setReturnArrays(true); return statement.all(...values); },
          async run() { statement.run(...values); return { success: true }; },
        };
      },
    };
  },
  async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); },
};
globalThis.__cardEditTestEnv = { DB: binding };
const vite = await createServer({
  root,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { "@": root } },
  plugins: [{
    name: "card-edit-test-env",
    resolveId(id) { if (id === "cloudflare:workers") return "\0card-edit-test-env"; },
    load(id) { if (id === "\0card-edit-test-env") return "export const env=globalThis.__cardEditTestEnv;"; },
  }],
});
after(async () => { await vite.close(); db.close(); delete globalThis.__cardEditTestEnv; });

const cardsRoute = await vite.ssrLoadModule("/app/api/cards/route.ts");
const editRoute = await vite.ssrLoadModule("/app/api/cards/[id]/route.ts");
const organizeRoute = await vite.ssrLoadModule("/app/api/cards/organize/route.ts");
const table = await vite.ssrLoadModule("/lib/table-card.ts");
const headers = { "oai-authenticated-user-email": "card-edit@example.invalid", "Content-Type": "application/json" };
const request = (payload, method = "POST") => new Request("https://test.invalid/api/cards", { method, headers, body: JSON.stringify(payload) });
const state = (id) => db.prepare("SELECT archived_at, archive_review_stage, archive_review_due_at, mastery_streak, correct_count FROM cards WHERE id = ?").get(id);

test("editing card content reopens a mastered card while retaining its review history", async () => {
  const payload = { subject: "총론", section: "기본", question: "질문", answer: "정답", answerFormat: "[b]정답[/b]", keywordsFromBold: true, importance: 1 };
  const created = await cardsRoute.POST(request(payload));
  assert.equal(created.status, 201);
  const { card } = await created.json();
  db.prepare("UPDATE cards SET archived_at = ?, archive_review_stage = 2, archive_review_due_at = ?, mastery_streak = 3, correct_count = 3 WHERE id = ?")
    .run("2026-09-20T00:00:00.000Z", "2026-09-27T00:00:00.000Z", card.id);
  db.prepare("INSERT INTO reviews (card_id, owner_email, mode, result) VALUES (?, ?, 'reveal', 'correct')").run(card.id, headers["oai-authenticated-user-email"]);

  const importanceOnly = await editRoute.PATCH(request({ ...payload, importance: 2 }, "PATCH"), { params: Promise.resolve({ id: String(card.id) }) });
  assert.equal(importanceOnly.status, 200);
  assert.ok(state(card.id).archived_at);
  assert.equal(state(card.id).mastery_streak, 3);

  const changed = await editRoute.PATCH(request({ ...payload, importance: 2, question: "수정된 질문" }, "PATCH"), { params: Promise.resolve({ id: String(card.id) }) });
  assert.equal(changed.status, 200);
  assert.equal(state(card.id).archived_at, null);
  assert.equal(state(card.id).archive_review_stage, 0);
  assert.equal(state(card.id).archive_review_due_at, null);
  assert.equal(state(card.id).mastery_streak, 0);
  assert.equal(state(card.id).correct_count, 3);
  assert.equal(db.prepare("SELECT count(*) AS n FROM reviews WHERE card_id = ?").get(card.id).n, 1);
});

test("bulk reorder keeps archive status; changing a table cell reopens the one table card", async () => {
  let document = table.createTable(1, 1);
  document = table.editCell(document, document.cells[0].id, "[b]달리기[/b]");
  const payload = { subject: "체육", section: "기본", question: "활동 표", answer: table.tableText(document), answerFormat: table.encodeTable(document), keywordsFromBold: true, importance: 1 };
  const created = await cardsRoute.POST(request(payload));
  assert.equal(created.status, 201);
  const { card } = await created.json();
  db.prepare("UPDATE cards SET archived_at = ?, archive_review_stage = 1, archive_review_due_at = ?, mastery_streak = 3, correct_count = 3, sort_order = 5 WHERE id = ?")
    .run("2026-09-20T00:00:00.000Z", "2026-09-23T00:00:00.000Z", card.id);
  const row = { id: card.id, contentType: card.contentType, section: card.section, subsection: card.subsection, detailSection: card.detailSection, area: card.area, importance: card.importance, question: card.question, questionFormat: card.questionFormat, answer: card.answer, answerFormat: card.answerFormat, memo: card.memo, media: card.media };

  const reorder = await organizeRoute.POST(request({ subject: "체육", cards: [row] }));
  assert.equal(reorder.status, 200, await reorder.text());
  assert.equal(db.prepare("SELECT sort_order FROM cards WHERE id = ?").get(card.id).sort_order, 0);
  assert.ok(state(card.id).archived_at);
  assert.equal(state(card.id).mastery_streak, 3);

  const edited = table.editCell(document, document.cells[0].id, "[b]오래달리기[/b]");
  const response = await organizeRoute.POST(request({ subject: "체육", cards: [{ ...row, answer: table.tableText(edited), answerFormat: table.encodeTable(edited) }] }));
  assert.equal(response.status, 200, await response.text());
  assert.equal(state(card.id).archived_at, null);
  assert.equal(state(card.id).mastery_streak, 0);
  assert.equal(state(card.id).correct_count, 3);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const source = readFileSync(new URL("../app/api/progress/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

test("progress API round-trips session mode, preserves legacy rows, and validates input", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE study_progress (owner_email TEXT NOT NULL, context_key TEXT NOT NULL, next_card_id INTEGER NOT NULL, sequence_ids TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_email, context_key))");
  db.prepare("INSERT INTO study_progress VALUES (?, ?, ?, ?, ?)").run("owner", "legacy", 1, "[1,2]", "2026-09-14T00:00:00Z");
  db.exec(readFileSync(new URL("../drizzle/0016_harsh_paladin.sql", import.meta.url), "utf8"));
  assert.equal(db.prepare("SELECT session_mode FROM study_progress WHERE context_key = 'legacy'").get().session_mode, null);
  let values;
  const getDb = () => ({
    insert: () => ({ values: value => {
      values = value;
      return { onConflictDoUpdate: ({ set }) => {
        db.prepare(`INSERT INTO study_progress (owner_email, context_key, next_card_id, sequence_ids, session_mode, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_email, context_key) DO UPDATE SET next_card_id=excluded.next_card_id, sequence_ids=excluded.sequence_ids, session_mode=${set.sessionMode ? "excluded.session_mode" : "study_progress.session_mode"}, updated_at=excluded.updated_at`)
          .run(values.ownerEmail, values.contextKey, values.nextCardId, values.sequenceIds, values.sessionMode ?? null, values.updatedAt);
      } };
    } }),
    select: () => ({ from: () => ({ where: conditions => ({ limit: () => {
      const row = db.prepare("SELECT next_card_id AS nextCardId, sequence_ids AS sequenceIds, session_mode AS sessionMode, updated_at AS updatedAt FROM study_progress WHERE owner_email=? AND context_key=?").get(...conditions);
      return row ? [row] : [];
    } }) }) }),
    delete: () => ({ where: conditions => db.prepare("DELETE FROM study_progress WHERE owner_email=? AND context_key=?").run(...conditions) }),
  });
  const mocks = {
    "drizzle-orm": { and: (...values) => values, eq: (_, value) => value },
    "../../../db": { getDb },
    "../../../db/schema": { studyProgress: {} },
    "../../../lib/api-errors": { toApiError: String },
    "../../../lib/auth": { getOwnerEmail: request => request.headers.get("x-owner"), unauthorized: () => new Response(null, { status: 401 }) },
  };
  const api = {};
  new Function("require", "exports", compiled)(name => mocks[name], api);
  const post = (contextKey, progress) => api.POST(new Request("http://test/api/progress", { method: "POST", headers: { "x-owner": "owner" }, body: JSON.stringify({ contextKey, progress }) }));
  const get = async contextKey => (await api.GET(new Request(`http://test/api/progress?contextKey=${contextKey}`, { headers: { "x-owner": "owner" } }))).json();
  const progress = { nextCardId: 2, sequenceIds: [1,2,3], updatedAt: "2026-09-14T01:00:00Z" };
  try {
    assert.equal((await api.GET(new Request("http://test/api/progress?contextKey=legacy"))).status, 401);
    for (const sessionMode of ["practice", "real"]) {
      assert.equal((await post("subject", { ...progress, sessionMode })).status, 200);
      assert.deepEqual((await get("subject")).progress, { ...progress, sessionMode });
    }
    assert.equal((await post("other", { ...progress, sessionMode: "practice" })).status, 200);
    assert.equal((await get("subject")).progress.sessionMode, "real");
    assert.equal((await post("other", progress)).status, 200);
    assert.equal((await get("other")).progress.sessionMode, "practice", "old clients must not erase the saved mode");
    assert.equal((await post("other", { ...progress, sessionMode: "invalid" })).status, 400);
    assert.equal((await get("other")).progress.sessionMode, "practice");
    assert.equal((await get("legacy")).progress.sessionMode, null);
    assert.equal((await post("other", null)).status, 200);
    assert.equal((await get("other")).progress, null);
  } finally { db.close(); }
});

test("resume prefers saved mode and first progress save uses the newly selected mode", () => {
  const ui = readFileSync(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const body = ui.match(/function startStudyAt\([^\n]*\) \{([\s\S]*?)\n  \}/)[1];
  const savedStudySessionMode = value => value === "real" || value === "practice" ? value : null;
  const start = new Function("startCardId", "savedSequence", "savedMode", "filtered", "studyStarted", "studyFinished", "studySessionMode", "savedStudySessionMode", "beginStudy", body);
  for (const [currentMode, savedMode, expected] of [["real","practice","practice"],["practice","real","real"],["practice",null,"practice"],["real",undefined,"real"]]) {
    let chosen;
    start(2, [1,2,3], savedMode, [1,2,3], false, false, currentMode, savedStudySessionMode, (id, sequence, mode) => { assert.equal(id, 2); assert.deepEqual(sequence, [1,2,3]); chosen=mode; });
    assert.equal(chosen, expected);
  }
  assert.match(ui, /rememberStudyPosition\(nextSequence\[0\] \?\? null, nextSequence, selectedMode\)/);
  assert.match(ui, /sessionMode: savedStudySessionMode\(parsed.sessionMode\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const compile = (path, dependencies = {}) => {
  const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  new Function("require", "exports", js)(name => dependencies[name], exports);
  return exports;
};
const dates = compile("../lib/exam-dday.ts");

test("D-day defaults to the existing exam date and changes at Korean midnight", () => {
  assert.equal(dates.DEFAULT_EXAM_DATE, "2026-11-07");
  assert.equal(dates.dayCountdown(undefined, new Date("2026-09-24T03:00:00Z")), "D-44");
  assert.equal(dates.dayCountdown("2026-11-07", new Date("2026-11-06T14:59:59Z")), "D-01");
  assert.equal(dates.dayCountdown("2026-11-07", new Date("2026-11-06T15:00:00Z")), "D-day");
  assert.equal(dates.dayCountdown("2026-11-07", new Date("2026-11-07T15:00:00Z")), "D+01");
  for (const value of [null, "", "2026-02-29", "2026-11-31", "2026-13-01", "26-01-01", "2026-1-1"]) assert.equal(dates.isValidDayDate(value), false);
  assert.equal(dates.isValidDayDate("2028-02-29"), true);
});

test("D-day settings persist per signed-in owner without modifying cards or reviews", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cards(id INTEGER PRIMARY KEY, question TEXT); INSERT INTO cards VALUES(1, 'preserve'); CREATE TABLE reviews(id INTEGER PRIMARY KEY, result TEXT); INSERT INTO reviews VALUES(1, 'correct');");
  db.exec(readFileSync(new URL("../drizzle/0019_spicy_madrox.sql", import.meta.url), "utf8"));
  const api = compile("../app/api/settings/day/route.ts", {
    "../../../../db": {getRawDb: () => ({prepare: query => ({bind: (...values) => ({all: async () => ({results:db.prepare(query).all(...values)}), run: async () => db.prepare(query).run(...values)})})})},
    "../../../../lib/auth": {unauthorized: () => new Response(null, {status:401})},
    "../../../../lib/api-errors": {toApiError: String},
    "../../../../lib/exam-dday": dates,
  });
  const request = (owner, body) => new Request("https://test/api/settings/day", {method: body === undefined ? "GET" : "POST", headers:owner ? {"oai-authenticated-user-id":owner,"Content-Type":"application/json"} : {}, ...(body !== undefined ? {body:JSON.stringify(body)} : {})});
  const get = async owner => (await api.GET(request(owner))).json();
  try {
    assert.equal((await api.GET(request(null))).status, 401);
    assert.equal((await api.POST(request(null, {targetDate:"2027-01-01"}))).status, 401);
    assert.deepEqual(await get("owner"), {targetDate:"2026-11-07"});
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM day_settings").get().n, 0, "reading default does not write");
    assert.equal((await api.POST(request("owner", {targetDate:"2027-01-01",ownerId:"another"}))).status, 200);
    assert.deepEqual(await get("owner"), {targetDate:"2027-01-01"});
    assert.deepEqual(await get("another"), {targetDate:"2026-11-07"});
    for (const body of [null, {}, {targetDate:"2026-02-29"}]) assert.equal((await api.POST(request("owner", body))).status, 400);
    assert.deepEqual(await get("owner"), {targetDate:"2027-01-01"});
    assert.equal((await api.POST(request("owner", {targetDate:dates.DEFAULT_EXAM_DATE}))).status, 200);
    assert.deepEqual(await get("owner"), {targetDate:"2026-11-07"});
    assert.equal(db.prepare("SELECT question FROM cards WHERE id=1").get().question, "preserve");
    assert.equal(db.prepare("SELECT result FROM reviews WHERE id=1").get().result, "correct");
  } finally { db.close(); }
});

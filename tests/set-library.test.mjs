import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ root, configFile: false, appType: "custom", server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { filterLibrarySets } = await vite.ssrLoadModule("/lib/set-library.ts");

const sets = [
  { id: 1, subject: "체육", name: "신체활동", memo: "예시 비교", cardIds: [10, 11] },
  { id: 2, subject: "교육학", name: "학습 이론", memo: "", cardIds: [12] },
  { id: 3, subject: "체육", name: "표현", memo: "", cardIds: [99] },
];
const cards = [
  { id: 10, section: "건강", subsection: "", detailSection: "", question: "기본 체력운동", answer: "걷기와 달리기", memo: "" },
  { id: 11, section: "표현", subsection: "무용", detailSection: "", question: "현대 표현", answer: "라인댄스", memo: "" },
  { id: 12, section: "학습", subsection: "", detailSection: "", question: "인지주의", answer: "", memo: "" },
];

test("set library filters by the set's subject without changing membership", () => {
  assert.deepEqual(filterLibrarySets(sets, cards, "all", "").map((set) => set.id), [1, 2, 3]);
  assert.deepEqual(filterLibrarySets(sets, cards, "체육", "").map((set) => set.id), [1, 3]);
  assert.deepEqual(sets[0].cardIds, [10, 11]);
});

test("set search includes title, memo and contained card content", () => {
  for (const term of ["신체활동", "예시", "기본 체력운동", "달리기", "무용", "라인댄스"]) {
    assert.deepEqual(filterLibrarySets(sets, cards, "all", term).map((set) => set.id), [1], term);
  }
  assert.deepEqual(filterLibrarySets(sets, cards, "체육", "학습 이론"), []);
  assert.deepEqual(filterLibrarySets(sets, cards, "all", "신체활동 라인댄스").map((set) => set.id), [1]);
  assert.deepEqual(filterLibrarySets(sets, cards, "all", "없는 말"), []);
});

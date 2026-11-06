import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, cacheDir: "node_modules/.vite-today-review", resolve: { alias: { "@": root } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "class-variance-authority", "clsx", "lucide-react", "next-themes", "radix-ui", "sonner", "tailwind-merge"] },
  plugins: [react(), { name: "today-review-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/staged-study.tsx"></script>');
    });
  } }], server: { host: "127.0.0.1", port: 5204, strictPort: true, hmr: false } });

await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome" });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 760, hasTouch: width < 760 });
    page.setDefaultTimeout(10000);
    const errors = [], reviews = [], bookmarks = [], pending = new Set([1,2]);
    page.on("pageerror", error => errors.push(error.message));
    const cards = [[1,"과학","오늘 과학 문제","사과",2],[2,"수학","오늘 수학 문제","연필",0],[3,"수학","이전 수학 문제","배",4],[4,"국어","이전 국어 문제","책",3]].map(([id,subject,question,answer,incorrectCount]) => ({
      id,subject,question,answer,incorrectCount, answerFormat:`[b]${answer}[/b]`, keywords:[answer], contentType:"교육과정", section:"같은 섹션", subsection:"",detailSection:"",questionFormat:"",area:"",importance:1,sortOrder:id,memo:"",media:{question:[],answer:[],memo:[]},correctCount:0,correctStreak:0,masteryStreak:0,archivedAt:null,archiveReviewStage:0,archiveReviewDueAt:null,lastReviewedAt:null,createdAt:"",updatedAt:"",
    }));
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      const payload = request.method() === "POST" ? request.postDataJSON() : null;
      let response = {};
      if (url.pathname === "/api/cards") response = { cards };
      if (url.pathname === "/api/sets") response = { sets: [] };
      if (url.pathname === "/api/settings/day") response = { targetDate: "2026-11-07" };
      if (url.pathname === "/api/stats") response = url.searchParams.has("daily") ? { daily: { date: new Date(Date.now() + 32400000).toISOString().slice(0,10), reviewCardIds: [...pending], subjects: [], learnedCardCount: 0, attempts: 0, correctCount: 0, accuracy: null } } : { stats: { summaries: [], cardPerformance: {}, keywordPerformance: {}, connectionPerformance: {} } };
      if (url.pathname === "/api/progress") { if (payload) bookmarks.push(payload); response = { progress: null }; }
      if (url.pathname === "/api/keyword-stats") response = { saved: true, cardId: payload.cardId, keywordPerformance: [] };
      if (url.pathname === "/api/reviews") {
        reviews.push(payload);
        if (payload.result === "correct" && !payload.statisticsOnly) pending.delete(payload.cardId);
        response = { ...cards.find(card => card.id === payload.cardId), reviewedAt: new Date().toISOString() };
      }
      await route.fulfill({ json: response });
    });
    await page.goto("http://127.0.0.1:5204/");
    await page.locator(".subject-tile-incorrect").click();
    assert.deepEqual((await page.locator(".study-start-buttons button").allTextContents()).map(text => text.trim()), ["오늘 복습","이어하기","처음부터"]);
    await page.getByRole("button", { name: "학습 범위 정하기" }).click();
    const dialog = page.getByRole("dialog", { name: "학습 범위 정하기" });
    await dialog.getByLabel("과목", { exact: true }).selectOption("과학");
    assert.equal(await dialog.locator(".start-order-card-row").count(), 1);
    await dialog.getByRole("button", { name: "전체 선택" }).click();
    await dialog.getByLabel("과목", { exact: true }).selectOption("수학");
    await dialog.getByRole("button", { name: "전체 선택" }).click();
    await dialog.getByLabel("과목", { exact: true }).selectOption("all");
    assert.equal(await dialog.locator(".start-order-card-row.is-selected").count(), 2);
    assert.match(await dialog.locator(".start-order-card-row:not(.is-selected)").textContent(), /이전 국어 문제/);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "오늘 복습", exact: true }).click();
    const blank = page.locator(".study-keyword-attempt [data-cloze-index]");
    const confirm = () => page.locator(".result-actions button").click();
    for (const [question, answer, wrong] of [["오늘 과학 문제","사과",true],["오늘 수학 문제","연필",false],["오늘 과학 문제","사과",true],["오늘 과학 문제","사과",false]]) {
      await page.locator(".study-card").getByText(question, { exact: true }).waitFor();
      assert.equal(await blank.inputValue(), "");
      if (wrong) {
        await blank.fill("오답");
        await page.getByRole("button", { name: "채점하기", exact: true }).click();
      }
      await blank.fill(answer);
      await confirm();
    }
    await page.getByRole("heading", { name: "오늘 복습을 마쳤어요" }).waitFor();
    await page.getByRole("button", { name: "오답 카드로 돌아가기" }).click();
    await page.waitForFunction(() => document.querySelector('.study-start-buttons button')?.disabled === true);
    assert.deepEqual(reviews.map(r => [r.cardId,r.result,r.statisticsOnly]), [[1,"incorrect",true],[2,"correct",false],[1,"incorrect",true],[1,"correct",false]]);
    assert.deepEqual(bookmarks, []);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS today review + subject range: ${width}px`);
  }
} finally { await browser?.close(); await server.close(); }

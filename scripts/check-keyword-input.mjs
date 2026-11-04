import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Use an installed Playwright without adding a production dependency.
const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, cacheDir: "node_modules/.vite-keyword-browser", resolve: { alias: { "@": root } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "class-variance-authority", "clsx", "lucide-react", "next-themes", "radix-ui", "sonner", "tailwind-merge"] },
  plugins: [react(), { name: "keyword-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/keyword-input.tsx"></script>');
    });
  } }], server: { host: "127.0.0.1", port: 5197, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const words = ["기본 체력운동", "현대 표현 활동"];

async function inputIme(locator, value, start = false) {
  await locator.evaluate((el, { value, start }) => {
    if (start) el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true, data: value.at(-1) }));
  }, { value, start });
}
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    await page.route("**/api/**", route => { errors.push("Unexpected API request"); return route.abort(); });
    for (const kind of ["linked", "linked-table", "guided-keyword-linked", "guided-keyword-linked-table"]) {
      console.log(`CHECK ${mobile ? "mobile" : "desktop"} ${kind}`);
      await page.goto(`http://127.0.0.1:5197/?kind=${kind}`);
      const fields = page.locator("input[data-cloze-index], textarea[data-cloze-index]");
      await fields.first().waitFor();
      const linked = page.locator(".answer-keyword-blank");
      assert.equal(await linked.count(), 2);
      assert.equal(await linked.first().textContent(), kind.startsWith("guided-") ? "통합" : "");
      assert.equal(await fields.count(), 2, "linked copies never add answer slots");
      await fields.first().focus();
      await inputIme(fields.first(), "통하", true);
      assert.equal(await page.locator(".answer-keyword-blank.is-correct").count(), 0);
      await inputIme(fields.first(), "통합적");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "1");
      assert.equal(await page.locator(".answer-keyword-blank.is-correct").textContent(), "통합");
      assert.equal(await page.getByTestId("submissions").textContent(), "0");
      await page.screenshot({ path: `/private/tmp/little-and-often-${kind}-${mobile ? "mobile" : "desktop"}.png` });
      if (!kind.startsWith("guided-")) {
        await fields.first().fill("오답");
        await page.getByRole("button", { name: "채점하기" }).click();
        await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "0");
        assert.equal(await page.locator(".answer-keyword-blank.is-correct").textContent(), "통합");
        assert.equal(await page.locator(".answer-keyword-blank.has-guide").textContent(), "도구");
      }
      await inputIme(fields.first(), "도구적", true);
      await page.waitForFunction(() => document.querySelectorAll(".answer-keyword-blank.is-correct").length === 2);
      assert.equal(await page.getByTestId("submissions").textContent(), "1", "correction doesn't submit again");
      assert.equal(await page.getByTestId("continued").textContent(), "0", "manual next only");
      assert.equal(await fields.count(), 0);
      await page.getByRole("button", { name: "다음으로" }).click();
      assert.equal(await page.getByTestId("continued").textContent(), "1");
    }
    for (const kind of ["normal", "table", "connection"]) {
      console.log(`CHECK ${mobile ? "mobile" : "desktop"} ${kind}`);
      await page.goto(`http://127.0.0.1:5197/?kind=${kind}`);
      let fields = page.locator("input[data-cloze-index], textarea[data-cloze-index]");
      await fields.first().waitFor();
      await fields.first().focus();
      await inputIme(fields.first(), "기본 체력우", true);
      assert.equal(await fields.count(), 2, "partial syllable must stay editable");
      const composingField = await fields.first().elementHandle();
      await inputIme(fields.first(), words[0]);
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "1");
      assert.equal(await fields.count(), 1, "exact composing word recognized without another key");
      await composingField.evaluate(el => {
        el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "동" }));
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "동" }));
      });
      assert.equal(await fields.count(), 1, "late IME events must not reopen the accepted field");
      await inputIme(fields.first(), words[1], true);
      await page.waitForFunction(() => document.querySelector('[data-testid="submissions"]')?.textContent === "1");
      assert.equal(await fields.count(), 0);
      assert.equal(await page.getByTestId("continued").textContent(), "0", "never auto-continue");
      assert.equal(await page.locator(".keyword-review-materials").count(), 0);
      assert.equal(await page.locator(".cloze-inline-answer.is-correct").first().evaluate(el => getComputedStyle(el).backgroundColor), "rgb(220, 239, 226)");

      await page.goto(`http://127.0.0.1:5197/?kind=${kind}`);
      fields = page.locator("input[data-cloze-index], textarea[data-cloze-index]");
      await fields.first().waitFor();
      await fields.nth(0).fill("오답");
      await fields.nth(1).fill("다른 오답");
      await page.getByRole("button", { name: kind === "connection" ? "연결 확인하기" : "채점하기" }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "0");
      assert.equal(await fields.first().inputValue(), "", "correction clears the whole answer");
      const field = fields.first();
      const ghost = field.locator('..').locator('.cloze-field-hint, .table-inline-hint');
      assert.equal(await ghost.locator('span').last().textContent(), words[0]);
      const geometry = await field.evaluate(el => {
        const hint = el.parentElement.querySelector('.cloze-field-hint, .table-inline-hint');
        const inputRect=el.getBoundingClientRect(), hintRect=hint.getBoundingClientRect();
        return { input: {top:inputRect.top,bottom:inputRect.bottom}, hint: {top:hintRect.top,bottom:hintRect.bottom}, font:getComputedStyle(el).fontSize, guideFont:getComputedStyle(hint).fontSize };
      });
      assert.ok(geometry.hint.top >= geometry.input.top - 1 && geometry.hint.bottom <= geometry.input.bottom + 1, `guide stays inside input: ${JSON.stringify(geometry)}`);
      if (!mobile || kind !== 'table') {
        assert.equal(geometry.font, geometry.guideFont);
        assert.ok(Math.abs((geometry.input.top+geometry.input.bottom)-(geometry.hint.top+geometry.hint.bottom)) <= 2, 'guide vertically centered with input');
      }
      await field.fill('엉뚱한 답');
      assert.equal(await ghost.locator('span').last().textContent(), '', 'mismatch hides guide');
      assert.equal(await page.locator('.cloze-field-correction-guide, .table-inline-correction-guide').count(), 0, 'no second answer row');
      await field.fill('기본 ');
      assert.equal(await ghost.locator('span').last().textContent(), '체력운동', 'matching prefix restores inline guide');
      if (kind === 'table') {
        if (!mobile) {
          const widths=await ghost.evaluate(el => ({width:el.clientWidth,content:el.scrollWidth}));
          assert.ok(widths.content <= widths.width + 1, `full guide fits a roomy cell: ${JSON.stringify(widths)}`);
        }
        const gap = await page.locator('.study-keyword-mode').evaluate(el => el.querySelector('.answer-table').getBoundingClientRect().top - el.querySelector('.quiz-answer-heading').getBoundingClientRect().bottom);
        assert.ok(gap >= 0 && gap <= 12, `compact readable heading gap: ${gap}`);
        await page.screenshot({path:`/private/tmp/teacher-table-guide-${mobile ? 'mobile' : 'desktop'}.png`});
      }
      await inputIme(fields.first(), words[0], true);
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "1");
      await inputIme(fields.first(), words[1], true);
      await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(b => b.textContent.includes("다음으로"))?.disabled);
      assert.equal(await fields.count(), 0);
      assert.equal(await page.getByTestId("submissions").textContent(), "1", "correction must not regrade");
      assert.equal(await page.getByTestId("continued").textContent(), "0");
      assert.equal(await page.locator(".answer-label").textContent(), "오답", "keep initial judgment");
      console.log(`PASS ${mobile ? "mobile" : "desktop"} ${kind}: IME, focus, grading, correction, green feedback`);
    }
    await page.goto("http://127.0.0.1:5197/?kind=table-navigation");
    const blanks = page.locator("input[data-cloze-index], textarea[data-cloze-index]");
    await blanks.first().waitFor();
    assert.deepEqual(await blanks.evaluateAll(nodes => nodes.map(node => node.getAttribute("placeholder"))),
      [1,2,5,3,6,4,7].map(number => `빈칸 ${number}`));
    const activeBlank = () => page.evaluate(() => Number(document.activeElement?.getAttribute("data-cloze-index")));
    await blanks.nth(0).focus();
    await page.keyboard.press("Tab");assert.equal(await activeBlank(),1,"Tab stays in the same cell first");
    await page.keyboard.press("Tab");assert.equal(await activeBlank(),3,"then Tab moves down the column");
    await page.keyboard.press("Shift+Tab");assert.equal(await activeBlank(),1,"Shift+Tab reverses that order");
    await page.keyboard.press("ArrowRight");assert.equal(await activeBlank(),2,"Right moves to the cell on the right");
    await page.keyboard.press("ArrowDown");assert.equal(await activeBlank(),4,"Down follows the physical column");
    await page.keyboard.press("ArrowLeft");assert.equal(await activeBlank(),3,"Left moves to the cell on the left");
    await page.keyboard.press("F1");
    const tableHelp=page.getByRole("dialog",{name:"단축키 · 표 학습"});
    await tableHelp.waitFor();
    await tableHelp.getByRole("radio",{name:/가로/}).check();
    await page.keyboard.press("Escape");
    await tableHelp.waitFor({state:"hidden"});
    assert.deepEqual(await blanks.evaluateAll(nodes=>nodes.map(node=>node.getAttribute("placeholder"))),
      [1,2,3,4,5,6,7].map(number=>`빈칸 ${number}`),"horizontal numbers follow row order");
    await blanks.nth(1).focus();
    await page.keyboard.press("Tab");assert.equal(await activeBlank(),2,"horizontal Tab moves to the right cell");
    await page.keyboard.press("Tab");assert.equal(await activeBlank(),3,"horizontal Tab continues on the next row");
    await page.keyboard.press("Shift+Tab");assert.equal(await activeBlank(),2,"horizontal Shift+Tab reverses row order");
    await page.keyboard.press("ArrowDown");assert.equal(await activeBlank(),4,"arrows remain physical after changing Tab order");
    await page.goto("http://127.0.0.1:5197/?kind=table-navigation");
    await blanks.first().waitFor();
    await blanks.first().focus();
    await inputIme(blanks.first(),"하나",true);
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "1");
    await inputIme(blanks.first(),"둘",true);
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "3");
    assert.equal(await page.getByTestId("submissions").textContent(),"0","matching two blanks only changes focus");
    console.log(`PASS ${mobile ? "mobile" : "desktop"} table navigation: numbers, Tab, Shift+Tab, arrows`);
    await page.goto("http://127.0.0.1:5197/?kind=help");
    await page.keyboard.press("F1");
    const help=page.getByRole("dialog",{name:"단축키 · 표 학습"});
    await help.waitFor();
    assert.match(await help.textContent(),/Shift를 누른 채 Tab/);
    await page.keyboard.press("Escape");
    await help.waitFor({state:"hidden"});
    await page.keyboard.press("F1");
    await help.waitFor();
    console.log(`PASS ${mobile ? "mobile" : "desktop"} F1 help: contextual content and Escape`);
    await page.goto("http://127.0.0.1:5197/?kind=help-layer");
    await page.getByRole("dialog",{name:"카드 편집"}).waitFor();
    await page.keyboard.press("F1");
    const layeredHelp=page.getByRole("dialog",{name:"단축키 · 카드 편집"});
    await layeredHelp.waitFor();
    await page.keyboard.press("Escape");
    await layeredHelp.waitFor({state:"hidden"});
    assert.equal(await page.getByRole("dialog",{name:"카드 편집"}).count(),1,"F1 help must not close the editor behind it");
    console.log(`PASS ${mobile ? "mobile" : "desktop"} F1 over editor: foreground help without closing work`);
    for (const kind of ["guided-keyword-normal", "guided-keyword-table"]) {
      await page.goto(`http://127.0.0.1:5197/?kind=${kind}`);
      let fields = page.locator("input[data-cloze-index], textarea[data-cloze-index]");
      await fields.first().waitFor();
      const guide = page.locator(".cloze-field-hint, .table-inline-hint").first();
      assert.match(await guide.textContent(), /기본 체력운동/);
      await fields.first().fill("기본");
      assert.equal(await guide.locator("span").last().textContent(), " 체력운동", "next word keeps its gap until typed");
      await fields.first().fill("기본체");
      assert.equal(await guide.locator("span").last().textContent(), "력운동", "typing without a space joins the guide then");
      await fields.first().fill("오타");
      assert.equal(await guide.locator("span").last().textContent(), "", "mistyped text hides the rest of the guide");
      await fields.first().fill("기본 ");
      assert.equal(await guide.locator("span").last().textContent(), "체력운동", "matching prefix restores the guide");
      await fields.first().fill("기본체력");
      assert.equal(await guide.locator("span").last().textContent(), "운동", "omitted space keeps the remaining guide");
      const firstComposingField = await fields.first().elementHandle();
      await inputIme(fields.first(), "기본체력운", true);
      assert.equal(await fields.count(), 2, "incomplete composing keyword remains editable");
      await inputIme(fields.first(), "기본체력운동");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "1");
      assert.equal(await fields.count(), 1, "exact guided keyword advances before composition end");
      await firstComposingField.evaluate(el => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: el.value.at(-1) })));
      assert.equal(await page.getByTestId("submissions").textContent(), "0");
      const secondComposingField = await fields.first().elementHandle();
      await inputIme(fields.first(), words[1], true);
      await page.waitForFunction(() => document.querySelector('[data-testid="submissions"]')?.textContent === "1");
      await secondComposingField.evaluate(el => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: el.value.at(-1) })));
      assert.equal(await page.getByTestId("submissions").textContent(), "1", "late IME event must not regrade guided practice");
      assert.equal(await page.getByTestId("continued").textContent(), "0", "completion never advances the card");
      console.log(`PASS ${mobile ? "mobile" : "desktop"} ${kind}: guide, typo, IME, auto-complete`);
    }
    await page.goto("http://127.0.0.1:5197/?kind=guided-keyword-ime");
    const composingGuide = page.locator(".cloze-field-hint").first().locator("span").last();
    const composingBlank = page.locator("input[data-cloze-index]").first();
    await composingBlank.waitFor();
    await inputIme(composingBlank, "방향 전호", true);
    assert.equal(await composingGuide.textContent(), " 달리기", "temporary Korean syllable keeps guide visible");
    await inputIme(composingBlank, "방향 전화");
    assert.equal(await composingGuide.textContent(), " 달리기", "IME syllable replacement does not flash the guide");
    await inputIme(composingBlank, "방향 전환");
    assert.equal(await composingGuide.textContent(), " 달리기");
    await inputIme(composingBlank, "방향 전환 달리기");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-cloze-index") === "1");
    await inputIme(page.locator("input[data-cloze-index]").first(), "버티기나굽히기", true);
    await page.waitForFunction(() => document.querySelector('[data-testid="submissions"]')?.textContent === "1");
    console.log(`PASS ${mobile ? "mobile" : "desktop"} Korean IME transient syllables and optional spaces`);
    await page.goto("http://127.0.0.1:5197/?kind=hint-ime");
    const hintedBlank = page.locator("input[data-cloze-index]").first();
    const hintTail = page.locator(".cloze-field-hint").first().locator("span").last();
    await hintedBlank.waitFor();
    await inputIme(hintedBlank, "방향 전호", true);
    assert.equal(await hintTail.textContent(), " ㄷㄹㄱ", "hint stays visible through a transient composing syllable");
    await inputIme(hintedBlank, "방향 전환");
    assert.equal(await hintTail.textContent(), " ㄷㄹㄱ");
    await inputIme(hintedBlank, "방향전환");
    assert.equal(await hintTail.textContent(), " ㄷㄹㄱ", "omitted space keeps the hint visible");
    console.log(`PASS ${mobile ? "mobile" : "desktop"} progressive hint during IME and omitted spaces`);
    for (const [kind, expectedTail] of [["guided-keyword-wrong-initial", "리기"], ["hint-wrong-initial", "ㄹㄱ"]]) {
      await page.goto(`http://127.0.0.1:5197/?kind=${kind}`);
      const field = page.locator("input[data-cloze-index]").first();
      const tail = page.locator(".cloze-field-hint").first().locator("span").last();
      await field.waitFor();
      await inputIme(field, "매다", true);
      assert.equal(await tail.textContent(), expectedTail, "same initial can still complete into the answer");
      await inputIme(field, "매바");
      assert.equal(await tail.textContent(), "", "different initial hides the hint even during composition");
      await inputIme(field, "매달");
      assert.equal(await tail.textContent(), expectedTail, "correcting the syllable restores the hint");
    }
    console.log(`PASS ${mobile ? "mobile" : "desktop"} wrong Korean initial hides guide and hint`);
    for (const kind of ["guided-full-normal", "guided-full-table"]) {
      await page.goto(`http://127.0.0.1:5197/?kind=${kind}`);
      const fields = page.locator(".guided-copy-field textarea");
      await fields.first().waitFor();
      if (kind.endsWith("table")) await page.screenshot({path:`/private/tmp/guided-full-table-${mobile ? "mobile" : "desktop"}.png`});
      const expected = kind.endsWith("table") ? words : ["첫 줄\n둘째 줄"];
      const guideWithoutSpacing = async () => (await page.locator(".guided-copy-guide").first().textContent()).replace(/\s/gu, "");
      const firstLineWithoutSpacing = expected[0].split("\n")[0].replace(/\s/gu, "");
      assert.match(await guideWithoutSpacing(), new RegExp(firstLineWithoutSpacing));
      await fields.first().fill("오타");
      assert.equal(await page.locator(".guided-copy-guide").first().textContent(), "오타", "wrong prefix leaves no remaining guide");
      await fields.first().fill(expected[0].slice(0, 1));
      assert.match(await guideWithoutSpacing(), new RegExp(firstLineWithoutSpacing));
      const composingField = await fields.first().elementHandle();
      await inputIme(fields.first(), expected[0].slice(0, -1), true);
      assert.equal(await fields.count(), expected.length, "incomplete composing copy remains editable");
      await inputIme(fields.first(), kind.endsWith("table") ? expected[0].replace(/\s/gu, "") : expected[0]);
      if (expected.length > 1) {
        await page.waitForFunction(() => document.querySelectorAll(".guided-copy-field textarea").length === 1);
        await page.waitForFunction(() => document.activeElement?.matches(".guided-copy-field textarea"));
        await fields.first().fill(expected[1]);
      }
      await page.getByText("정답", { exact: true }).waitFor();
      await composingField.evaluate(el => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: el.value.at(-1) })));
      assert.equal(await page.getByTestId("continued").textContent(), "0", "full copying stops at completion");
      assert.equal(await fields.count(), 0);
      console.log(`PASS ${mobile ? "mobile" : "desktop"} ${kind}: newline/table cells and manual next`);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}

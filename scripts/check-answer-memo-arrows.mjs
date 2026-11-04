import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root, configFile: false, resolve: { alias: { "@": root } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "class-variance-authority", "clsx", "lucide-react", "radix-ui", "tailwind-merge"] },
  plugins: [react(), { name: "answer-memo-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><main></main><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;const m=await import("/app/study-app.tsx");window.arrowTools={target:m.bulkAnswerMemoArrowTarget,caret:m.placeBulkCaret,reverse:m.bulkReverseTabTarget,backspace:m.bulkBackspaceTarget};</script>');
    });
  } }],
  server: { host: "127.0.0.1", port: 5198, strictPort: true, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.on("pageerror", error => { throw error; });
    await page.route("**/api/**", route => { throw new Error(`Unexpected API: ${route.request().url()}`); });
    await page.goto("http://127.0.0.1:5198/");
    await page.waitForFunction(() => window.arrowTools);
    const result = await page.evaluate(() => {
      const { target, caret } = window.arrowTools;
      const main = document.querySelector("main");
      // Only synthetic DOM/data: never mount the app or call its persistence API.
      main.innerHTML = '<div contenteditable="true" data-bulk-focus-kind="answer" data-bulk-row-id="a">첫 줄<br><strong>마지막 답</strong></div><textarea data-bulk-focus-kind="memo" data-bulk-row-id="a">첫 메모\n마지막 메모</textarea><div contenteditable="true" data-bulk-focus-kind="answer" data-bulk-row-id="b">다른 카드</div><textarea data-bulk-focus-kind="memo" data-bulk-row-id="b"></textarea>';
      const [answer, memo, otherAnswer, otherMemo] = main.children;
      const original = [answer.innerHTML, memo.value];
      const checks = [];
      const at = (field, edge) => { field.focus(); caret(field, edge); };
      at(answer, "end");
      checks.push(target(main, answer, "arrowdown") === memo);
      at(memo, "start");
      checks.push(target(main, memo, "arrowup") === answer);
      at(answer, "start");
      checks.push(target(main, answer, "arrowdown") === null);
      at(memo, "end");
      checks.push(target(main, memo, "arrowup") === null);
      memo.setSelectionRange(0, 2);
      checks.push(target(main, memo, "arrowup") === null);
      at(answer, "end");
      getSelection().extend(answer.firstChild, 0);
      checks.push(target(main, answer, "arrowdown") === null);
      at(otherMemo, "start");
      checks.push(target(main, otherMemo, "arrowup") === otherAnswer);
      otherAnswer.innerHTML = "";
      at(otherAnswer, "end");
      checks.push(target(main, otherAnswer, "arrowdown") === otherMemo);
      otherMemo.style.display = "none";
      checks.push(target(main, otherAnswer, "arrowdown") === null);
      otherMemo.style.display = "";
      // Table previews are focusable, non-editable answer wrappers.
      otherAnswer.contentEditable = "false"; otherAnswer.tabIndex = 0;
      checks.push(target(main, otherAnswer, "arrowdown") === otherMemo);
      at(otherMemo, "start");
      checks.push(target(main, otherMemo, "arrowup") === otherAnswer);
      checks.push(target(main, memo, "arrowleft") === null);
      at(answer, "end");
      checks.push(getSelection().anchorNode === answer.querySelector("strong").firstChild);
      checks.push(answer.innerHTML === original[0] && memo.value === original[1]);
      return checks;
    });
    assert.equal(result.length, 14);
    assert.ok(result.every(Boolean), `navigation checks at width ${width}: ${JSON.stringify(result)}`);
    console.log(`PASS ${width}px: answer/memo edges, empty fields, nested formatting, selection, same-card targeting, table previews, unchanged content`);
    await page.evaluate(() => {
      const main = document.querySelector("main");
      main.innerHTML = ["a", "hidden", "b"].map(id => `<section ${id === "hidden" ? 'style="display:none"' : ''}>
        <button>이동 손잡이</button>
        <div tabindex="0" id="${id}-content-type" data-bulk-row-id="${id}" data-bulk-focus-kind="content-type">분류</div>
        <button>서식</button>
        <div contenteditable="true" id="${id}-question" data-bulk-row-id="${id}" data-bulk-focus-kind="question">질문</div>
        <button>첨부</button>
        <div ${id === "b" ? 'tabindex="0"' : 'contenteditable="true"'} id="${id}-answer" data-bulk-row-id="${id}" data-bulk-focus-kind="answer">답</div>
        <button>사진</button>
        <textarea id="${id}-memo" data-bulk-row-id="${id}" data-bulk-focus-kind="memo">메모</textarea>
        <button>추가</button><input data-bulk-row-id="divider-${id}" data-bulk-focus-kind="divider" value="섹션">
      </section>`).join("");
      main.addEventListener("keydown", event => {
        const navigationEvent = { key: event.key, shiftKey: event.shiftKey, repeat: event.repeat,
          ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, defaultPrevented: event.defaultPrevented,
          nativeEvent: event, keyCode: event.keyCode, target: event.target, currentTarget: main };
        const previous = window.arrowTools.reverse(navigationEvent) ?? window.arrowTools.backspace(navigationEvent);
        if (previous) { event.preventDefault(); event.stopPropagation(); previous.focus(); window.arrowTools.caret(previous, "end"); }
      }, true);
      document.getElementById("b-memo").focus();
    });
    for (const expected of ["b-answer", "b-question", "b-content-type", "a-memo", "a-answer", "a-question", "a-content-type", "a-content-type"]) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), expected);
    }
    await page.locator("#b-memo").focus();
    await page.locator("#b-memo").dispatchEvent("keydown", { key: "Tab", shiftKey: true, isComposing: true });
    assert.equal(await page.evaluate(() => document.activeElement.id), "b-memo", "IME must not move focus");
    await page.keyboard.press("Shift+Enter");
    assert.equal(await page.evaluate(() => document.activeElement.id), "b-memo", "Shift+Enter stays in the field");
    console.log(`PASS ${width}px: real Shift+Tab reverses only card inputs, skips tools/sections/hidden rows, preserves IME and Shift+Enter`);
    const focusStart = id => page.evaluate(id => {
      const field = document.getElementById(id); field.focus(); window.arrowTools.caret(field, "start");
    }, id);
    await focusStart("a-memo");
    await page.keyboard.press("Backspace");
    assert.equal(await page.evaluate(() => document.activeElement.id), "a-answer");
    assert.equal(await page.locator("#a-memo").inputValue(), "메모");
    assert.equal(await page.locator("#a-answer").textContent(), "답");
    await page.locator("#a-answer").evaluate(el => { el.innerHTML = "<strong>정답</strong>"; window.arrowTools.caret(el, "start"); });
    await page.keyboard.press("Backspace");
    assert.equal(await page.evaluate(() => document.activeElement.id), "a-question");
    assert.equal(await page.locator("#a-answer").textContent(), "정답");
    assert.equal(await page.evaluate(() => getSelection().anchorOffset), 2, "destination caret is at the question's end");
    await page.locator("#a-answer").evaluate(el => { el.focus(); getSelection().setBaseAndExtent(el.firstChild.firstChild, 1, el.firstChild.firstChild, 1); });
    await page.keyboard.press("Backspace");
    assert.equal(await page.evaluate(() => document.activeElement.id), "a-answer");
    assert.equal(await page.locator("#a-answer").textContent(), "답", "normal deletion is preserved");
    await page.locator("#a-memo").evaluate(el => { el.focus(); el.setSelectionRange(0, 1); });
    await page.keyboard.press("Backspace");
    assert.equal(await page.locator("#a-memo").inputValue(), "모", "selected text is deleted without navigation");
    await focusStart("a-memo");
    await page.locator("#a-memo").dispatchEvent("keydown", { key: "Backspace", isComposing: true });
    assert.equal(await page.evaluate(() => document.activeElement.id), "a-memo");
    await page.locator("#a-answer").evaluate(el => { el.innerHTML = "<br>답"; el.focus(); getSelection().setBaseAndExtent(el.lastChild, 0, el.lastChild, 0); });
    await page.keyboard.press("Backspace");
    assert.equal(await page.evaluate(() => document.activeElement.id), "a-answer", "leading blank line is edited, not skipped");
    await page.locator("#a-answer").evaluate(el => { el.innerHTML = ""; window.arrowTools.caret(el, "start"); });
    await page.keyboard.press("Backspace");
    assert.equal(await page.evaluate(() => document.activeElement.id), "a-question", "empty answer also navigates");
    await focusStart("a-question");
    await page.keyboard.press("Backspace");
    assert.equal(await page.evaluate(() => document.activeElement.id), "a-question", "question never jumps to classification");
    console.log(`PASS ${width}px: Backspace at start, nested bold, empty answer, normal/selection deletion, leading newline, IME, unchanged navigation content`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

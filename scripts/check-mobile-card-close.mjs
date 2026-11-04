import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root, configFile: false, cacheDir: "node_modules/.vite-card-close",
  resolve: { alias: { "@": root } },
  plugins: [react(), { name: "card-close-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/editor-multi-selection.tsx"></script>');
    });
  } }],
  server: { host: "127.0.0.1", port: 5199, strictPort: true, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
let saves = 0;
let failNextSave = false;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route("**/api/cards/1", async route => {
    saves++;
    if (failNextSave) {
      failNextSave = false;
      return route.fulfill({ status: 503, json: { error: "저장 실패" } });
    }
    const draft = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: { card: { ...draft, id: 1, keywords: ["정답 1"] } } });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto("http://127.0.0.1:5199/?kind=card");
  await page.locator(".card-editor-dialog").waitFor();
  const editor = page.getByRole("dialog", { name: "카드 편집" });
  const confirm = page.getByRole("alertdialog", { name: "수정한 카드를 닫을까요?" });
  const open = () => page.getByRole("button", { name: "카드 편집 열기" }).click();
  const close = () => editor.getByRole("button", { name: "취소" }).click();
  const memo = () => editor.locator("textarea");

  await close();
  await editor.waitFor({ state: "hidden" });
  assert.equal(await confirm.count(), 0, "unchanged card closes without a prompt");
  await open();
  await memo().fill("모바일에서 작성한 메모");
  await close();
  await confirm.waitFor();
  assert.ok(Number(await confirm.evaluate(el => getComputedStyle(el).zIndex)) > Number(await page.locator(".card-editor-dialog").evaluate(el => getComputedStyle(el).zIndex)), "confirmation stays above the mobile editor");
  await page.keyboard.press("Escape");
  await confirm.waitFor({ state: "hidden" });
  assert.equal(await memo().inputValue(), "모바일에서 작성한 메모", "Escape returns to the unsaved edit");
  await close();
  await confirm.getByRole("button", { name: "계속 편집" }).click();
  assert.equal(await memo().inputValue(), "모바일에서 작성한 메모");
  await editor.getByRole("button", { name: "Close" }).click();
  await confirm.getByRole("button", { name: "저장하지 않고 닫기" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("saved-card-memo").textContent(), "메모 1");
  assert.equal(saves, 0, "discard never writes");

  await open();
  await memo().fill("저장할 메모");
  await close();
  failNextSave = true;
  await confirm.getByRole("button", { name: "저장하고 닫기" }).click();
  await editor.waitFor();
  assert.equal(await memo().inputValue(), "저장할 메모", "failed save retains edits");
  assert.equal(await page.getByTestId("saved-card-memo").textContent(), "메모 1");
  await close();
  await confirm.getByRole("button", { name: "저장하고 닫기" }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("saved-card-memo").textContent(), "저장할 메모");
  assert.equal(saves, 2);

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  desktop.on("pageerror", error => errors.push(error.message));
  await desktop.goto("http://127.0.0.1:5199/?kind=card");
  await desktop.getByRole("dialog", { name: "카드 편집" }).locator("textarea").fill("PC 변경");
  await desktop.getByRole("dialog", { name: "카드 편집" }).getByRole("button", { name: "취소" }).click();
  assert.equal(await desktop.getByRole("alertdialog", { name: "수정한 카드를 닫을까요?" }).count(), 0, "desktop behavior unchanged");
  assert.deepEqual(errors, []);
  console.log("PASS mobile card close: unchanged, continue, discard, failed save, successful save; desktop unchanged");
} finally {
  await browser.close();
  await server.close();
}

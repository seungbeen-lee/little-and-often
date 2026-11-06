import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, cacheDir: "node_modules/.vite-first-answer", resolve: { alias: { "@": root } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "class-variance-authority", "clsx", "lucide-react", "next-themes", "radix-ui", "sonner", "tailwind-merge"] },
  plugins: [react(), { name: "first-answer-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/keyword-input.tsx"></script>');
    });
  } }], server: { host: "127.0.0.1", port: 5197, strictPort: true, hmr: false } });

await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome" });
  for (const [kind, mobile, tag] of [["normal", false, "INPUT"], ["table", true, "TEXTAREA"], ["full-table", false, "TEXTAREA"], ["guided", false, "TEXTAREA"]]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => console.error(error.message));
    page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
    await page.goto(`http://127.0.0.1:5197/?kind=first-input-${kind}`);
    await page.getByRole("button", { name: "입력 시작" }).waitFor();
    await page.evaluate(() => {
      // Exercise the interval before the next paint, even on a fast machine.
      window.requestAnimationFrame = () => 0;
      window.answerFocusTags = [];
      document.addEventListener("focusin", event => {
        if (event.target.matches("input, textarea")) window.answerFocusTags.push(event.target.tagName);
      });
      document.querySelector("button").click();
    });
    await page.keyboard.insertText("기");
    assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement.tagName, value: document.activeElement.value, focused: window.answerFocusTags })),
      { tag, value: "기", focused: [tag] }, `${kind}: first Korean text goes into the final field before any animation frame`);

    if (kind === "normal" || kind === "table") {
      await page.keyboard.insertText("본 체력운동");
      await page.keyboard.insertText("현");
      assert.deepEqual(await page.evaluate(() => ({ index: document.activeElement.dataset.clozeIndex, value: document.activeElement.value })),
        { index: "1", value: "현" }, `${kind}: the first character after an exact match reaches the next field`);
    }
    await page.close();
    console.log(`PASS first answer input: ${kind}`);
  }
} finally {
  await browser?.close();
  await server.close();
}

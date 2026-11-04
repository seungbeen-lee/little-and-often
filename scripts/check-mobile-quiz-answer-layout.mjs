import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root, configFile: false, cacheDir: "node_modules/.vite-quiz-layout",
  resolve: { alias: { "@": root } },
  plugins: [react(), { name: "quiz-layout-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/quiz-answer-layout.tsx"></script>');
    });
  } }],
  server: { host: "127.0.0.1", port: 5200, strictPort: true, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [width, height] of [[390, 844], [430, 932]]) {
    for (const variant of ["", "?long", "?long&memo"]) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
      await page.goto(`http://127.0.0.1:5200/${variant}`);
      await page.locator(".quiz-feedback button").waitFor();
      const geometry = await page.evaluate(() => {
        const card = document.querySelector(".quiz-card").getBoundingClientRect();
        const panel = document.querySelector(".quiz-answer-panel").getBoundingClientRect();
        const copy = document.querySelector(".quiz-cloze-copy").getBoundingClientRect();
        const button = document.querySelector(".quiz-feedback button").getBoundingClientRect();
        const feedback = document.querySelector(".quiz-feedback").getBoundingClientRect();
        const copyStyle = getComputedStyle(document.querySelector(".quiz-cloze-copy"));
        return { innerWidth: innerWidth, mediaMobile: matchMedia("(max-width: 759px)").matches, cardBottom: card.bottom, panelHeight: panel.height, copyHeight: copy.height,
          buttonBottom: button.bottom, buttonTop: button.top, feedbackTop: feedback.top,
          gridRows: getComputedStyle(document.querySelector(".quiz-answer-panel")).gridTemplateRows,
          copyComputedHeight: copyStyle.height, copyMaxHeight: copyStyle.maxHeight, copyAlignSelf: copyStyle.alignSelf };
      });
      assert.ok(geometry.cardBottom - geometry.buttonBottom < 28, `${width}px ${variant}: next button must sit at card bottom: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.copyHeight > 80, `${width}px ${variant}: answer region must remain usable: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.buttonTop > geometry.feedbackTop - 1, `${width}px ${variant}: button stays after materials`);
      if (width === 390 && !variant) await page.screenshot({ path: "/private/tmp/mobile-quiz-answer-layout.png" });
      await page.close();
    }
  }
  console.log("PASS mobile quiz review: next button at bottom, expanded answer area, long answer and memo fit");
} finally {
  await browser.close();
  await server.close();
}

import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.KEYWORD_BROWSER_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, cacheDir: "node_modules/.vite-image-move", resolve: { alias: { "@": root } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "class-variance-authority", "clsx", "lucide-react", "radix-ui", "sonner", "tailwind-merge"] },
  plugins: [react(), { name: "image-move-fixture", configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== "/") return next();
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/fixtures/image-move.tsx"></script>');
  }); } }], server: { host: "127.0.0.1", port: 5199, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [], writes = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    if (route.request().method() !== "GET") { writes.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6peEAAAAASUVORK5CYII=", "base64") });
  });
  await page.goto("http://127.0.0.1:5199/");
  const media = () => page.getByTestId("media").textContent().then(JSON.parse);
  const original = await media();
  const field = name => page.locator(`[data-media-field="${name}"]`);
  // Synthetic HTML drag events exercise the handlers without relying on OS drag
  // cancellation; all data and image responses belong to this local fixture.
  async function begin(from, to) {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await field(from).locator(".image-open-button").dispatchEvent("dragstart", { dataTransfer: transfer });
    await field(to).dispatchEvent("dragover", { dataTransfer: transfer });
    return transfer;
  }
  const canceled = await begin("question", "answer");
  await field("answer").getByText("답 글 아래로 이동", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".image-drop-target").waitFor({ state: "detached" });
  assert.deepEqual(await media(), original, "Escape cancels without changing attachment data");
  await canceled.dispose();

  for (const [from, to, label] of [["question", "answer", "답"], ["answer", "memo", "메모"]]) {
    const transfer = await begin(from, to);
    await field(to).getByText(`${label} 글 아래로 이동`, { exact: true }).waitFor();
    await field(to).dispatchEvent("drop", { dataTransfer: transfer });
    await field(to).locator(".image-open-button").waitFor();
    const moved = await media();
    assert.deepEqual(moved[from], []);
    assert.deepEqual(moved[to], original.question, "move preserves the id, caption and crop");
    assert.equal(await page.locator(".image-drop-target").count(), 0);
    await transfer.dispose();
  }
  const same = await begin("memo", "memo");
  assert.equal(await page.locator(".image-drop-target").count(), 0, "same-field drag is not accepted");
  await page.keyboard.press("Escape");
  await same.dispose();

  const file = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.items.add(new File(["test"], "test.png", { type: "image/png" })); return transfer; });
  await field("answer").dispatchEvent("dragover", { dataTransfer: file });
  await field("answer").getByText("답에 사진 놓기", { exact: true }).waitFor();
  await field("answer").dispatchEvent("dragleave", { dataTransfer: file });
  await page.locator(".image-drop-target").waitFor({ state: "detached" });
  await file.dispose();
  assert.deepEqual(writes, [], "moving/canceling does not upload images");
  assert.deepEqual(errors, []);
  console.log("PASS photo move labels, Escape cancellation, question → answer → memo, same-field rejection, crop preservation, file drop label");
} finally { await browser.close(); await server.close(); }

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const serverDirectory = fileURLToPath(new URL("../dist/server/", import.meta.url));

test("built Cloudflare worker renders the app and serves its client assets", async (context) => {
  // The built worker imports cloudflare:workers. Run it in workerd with isolated,
  // non-persistent bindings, rather than importing it into Node's ESM loader.
  const worker = new Miniflare({
    modules: true,
    modulesRoot: serverDirectory,
    scriptPath: fileURLToPath(new URL("../dist/server/index.js", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-04-07",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      directory: fileURLToPath(new URL("../dist/client/", import.meta.url)),
      binding: "ASSETS",
      routerConfig: { has_user_worker: true },
    },
    d1Databases: ["DB"],
    r2Buckets: ["UPLOADS"],
    d1Persist: false,
    r2Persist: false,
  });
  context.after(() => worker.dispose());

  const response = await worker.dispatchFetch("http://localhost/", {
    headers: { accept: "text/html" },
  });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ko"/);
  assert.match(html, /<meta(?=[^>]*name="application-name")(?=[^>]*content="little and often")/);
  assert.match(html, /<title>little and often<\/title>/);
  assert.doesNotMatch(html, /name="codex-preview"/);
  const scripts = [
    ...html.matchAll(/<script[^>]*\bsrc="([^"?]+\.js)(?:\?[^" ]*)?"/g),
    ...html.matchAll(/\bimport\("([^"?]+\.js)"\)/g),
    ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"?]+\.js)"/g),
  ].map((match) => match[1]);
  assert.ok(scripts.length > 0, "the app must include client scripts for interactive study");
  for (const src of new Set(scripts)) {
    const asset = await worker.dispatchFetch(new URL(src, "http://localhost/"));
    assert.equal(asset.status, 200, src);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    assert.ok((await asset.text()).length > 0, src);
  }
});

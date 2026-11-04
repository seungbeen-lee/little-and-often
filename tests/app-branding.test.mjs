import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function pngSize(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("uses the clover home-screen identity on iPhone and installed apps", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../app/manifest.ts", import.meta.url), "utf8");
  const studyApp = await readFile(new URL("../app/study-app.tsx", import.meta.url), "utf8");
  const stylesheet = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const favicon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
  const appleIcon = await readFile(new URL("../public/apple-touch-icon.png", import.meta.url));
  const icon192 = await readFile(new URL("../public/icon-192.png", import.meta.url));
  const icon512 = await readFile(new URL("../public/icon-512.png", import.meta.url));
  const socialPreview = await readFile(new URL("../public/og.png", import.meta.url));

  const branding = await readFile(new URL("../lib/site-branding.ts", import.meta.url), "utf8");
  assert.match(branding, /SITE_NAME = "little and often"/);
  assert.match(layout, /title: SITE_NAME/);
  assert.match(layout, /applicationName: SITE_NAME/);
  assert.match(studyApp, /<span>\{SITE_NAME\}<\/span>/);
  assert.doesNotMatch(studyApp, /document\.title = nextTitle/);
  assert.match(studyApp, /<span className="brand-mark" aria-hidden="true" \/>/);
  assert.doesNotMatch(studyApp, /<span className="brand-mark">S<\/span>/);
  assert.match(stylesheet, /\.brand-mark\s*\{[^}]*url\("\/favicon\.svg"\)/);
  assert.match(layout, /appleWebApp:\s*\{[\s\S]*?title: SITE_NAME/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(layout, /images: \[\{ url: "\/og\.png", width: 1200, height: 630/);
  assert.match(manifest, /name: SITE_NAME/);
  assert.match(manifest, /short_name: SITE_NAME/);
  assert.match(manifest, /display: "standalone"/);
  assert.match(favicon, /#185B47/);
  assert.deepEqual(pngSize(appleIcon), { width: 180, height: 180 });
  assert.deepEqual(pngSize(icon192), { width: 192, height: 192 });
  assert.deepEqual(pngSize(icon512), { width: 512, height: 512 });
  assert.deepEqual(pngSize(socialPreview), { width: 1200, height: 630 });
});

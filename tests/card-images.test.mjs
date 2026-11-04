import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "card-image-test-"));
const database = path.join(temporary, "test.sqlite");
const sql = (query) => JSON.parse(execFileSync("sqlite3", ["-json", database, query], { encoding: "utf8" }) || "[]");
sql(readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql")).sort().map((name) => readFileSync(path.join(root, "drizzle", name), "utf8")).join("\n"));
const quote = (value) => value == null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const binding = {
  prepare(query) { return { bind(...values) {
    let index = 0;
    const bound = query.replace(/\?/g, () => quote(values[index++]));
    return { async all() { return { results: sql(bound), success: true }; }, async raw() { return sql(bound).map((row) => Object.values(row)); }, async run() { sql(bound); return { success: true }; } };
  } }; },
  async batch(statements) { return Promise.all(statements.map((statement) => statement.all())); },
};
const objects = new Map();
globalThis.__cardImageTestEnv = { DB: binding, UPLOADS: {
  async put(key, bytes) { objects.set(key, bytes); },
  async get(key) { return objects.has(key) ? { body: new Response(objects.get(key)).body } : null; },
  async delete(key) { objects.delete(key); },
} };
const vite = await createServer({ configFile: false, appType: "custom", root, cacheDir: path.join(temporary, "vite-cache"), server: { middlewareMode: true, hmr: false }, resolve: { alias: { "@": root } }, plugins: [{
  name: "image-test-binding",
  resolveId(id) { if (id === "cloudflare:workers") return "\0image-test-binding"; },
  load(id) { if (id === "\0image-test-binding") return "export const env = globalThis.__cardImageTestEnv;"; },
}] });
after(async () => { await vite.close(); delete globalThis.__cardImageTestEnv; rmSync(temporary, { recursive: true, force: true }); });
const owner = { "oai-authenticated-user-email": "images@example.test" };
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const request = (url, body, headers = owner, method = "POST") => new Request(`https://test${url}`, { method, headers, body: typeof body === "object" && !(body instanceof Uint8Array) ? JSON.stringify(body) : body });

test("normalization bounds layouts and ignores URLs, invalid IDs and legacy data", async () => {
  const { normalizeMedia, imageMime, readImageBody, MAX_IMAGE_BYTES } = await vite.ssrLoadModule("/lib/card-media.ts");
  assert.deepEqual(normalizeMedia(null), { question: [], answer: [], memo: [] });
  const id = "00000000-0000-4000-8000-000000000001";
  const result = normalizeMedia({ question: [{ id, width: 999, align: "evil", position: "before", alt: "x" }, { id }, { id: "https://evil.test/x" }] });
  assert.deepEqual(result.question, [{ id, width: 100, align: "center", position: "after", alt: "x" }]);
  assert.equal(imageMime(new TextEncoder().encode('<svg onload="alert(1)">')), null);
  assert.equal(imageMime(png), "image/png");
  await assert.rejects(readImageBody(request("/", png, { "content-length": String(MAX_IMAGE_BYTES + 1) })), /8MB/);
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 1)); controller.close(); } });
  await assert.rejects(readImageBody(new Request("https://test", { method: "POST", body, duplex: "half" })), /8MB/);
});

test("uploads remain owner-private and old edits / organizing preserve attachments", async () => {
  const upload = await vite.ssrLoadModule("/app/api/images/route.ts");
  const read = await vite.ssrLoadModule("/app/api/images/[id]/route.ts");
  const cards = await vite.ssrLoadModule("/app/api/cards/route.ts");
  const edit = await vite.ssrLoadModule("/app/api/cards/[id]/route.ts");
  const organize = await vite.ssrLoadModule("/app/api/cards/organize/route.ts");
  assert.equal((await upload.POST(request("/api/images", png, {}))).status, 401);
  assert.equal((await upload.POST(request("/api/images", '<svg onload="alert(1)">'))).status, 400);
  const response = await upload.POST(request("/api/images", png));
  assert.equal(response.status, 201);
  const { image } = await response.json();
  const params = { params: Promise.resolve({ id: image.id }) };
  assert.equal((await read.GET(new Request("https://test"), params)).status, 401);
  assert.equal((await read.GET(new Request("https://test", { headers: { "oai-authenticated-user-email": "other@example.test" } }), params)).status, 404);
  const photo = await read.GET(new Request("https://test", { headers: owner }), params);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("Cache-Control"), "private, no-store");
  assert.equal(photo.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), png);
  assert.ok([...objects.keys()].every((key) => !key.includes("@")));
  const payload = { subject: "이미지 시험", section: "기본", question: "질문", answer: "답", media: { question: [image], answer: [{ ...image, width: 50, align: "right" }], memo: [image] } };
  const made = await cards.POST(request("/api/cards", payload));
  assert.equal(made.status, 201);
  let { card } = await made.json();
  assert.equal(card.media.memo[0].id, image.id);
  const noMedia = { subject: card.subject, section: card.section, question: "수정", answer: "답", importance: 2 };
  const patched = await edit.PATCH(request("/api/cards/1", noMedia, owner, "PATCH"), { params: Promise.resolve({ id: String(card.id) }) });
  assert.equal(patched.status, 200);
  card = (await patched.json()).card;
  assert.equal(card.media.question[0].id, image.id);
  assert.equal(card.media.answer[0].width, 100);
  const organized = await organize.POST(request("/api/cards/organize", { subject: card.subject, cards: [{ ...noMedia, id: card.id }] }));
  assert.equal(organized.status, 200);
  const organizedCard = (await organized.json()).cards[0];
  assert.equal(organizedCard.media.memo[0].id, image.id);
  assert.equal(organizedCard.correctCount, 0);
  const crop = { x: .1, y: .2, width: .6, height: .5 };
  const cropped = await edit.PATCH(request("/api/cards/1", { ...noMedia, media: { question: [{ ...image, crop }] } }, owner, "PATCH"), { params: Promise.resolve({ id: String(card.id) }) });
  assert.deepEqual((await cropped.json()).card.media.question[0].crop, crop);
  assert.equal(objects.size, 1, "cropping preserves the private original, without another upload");
  assert.equal((await cards.POST(request("/api/cards", payload, { "oai-authenticated-user-email": "other@example.test" }))).status, 400);
  const detached = await edit.PATCH(request("/api/cards/1", { ...noMedia, media: {} }, owner, "PATCH"), { params: Promise.resolve({ id: String(card.id) }) });
  assert.deepEqual((await detached.json()).card.media, { question: [], answer: [], memo: [] });
  assert.equal(objects.size, 1, "detaching preserves blobs for undo / drafts");
});

test("rendered photos use safe image IDs and no nested interactive controls", async () => {
  const { CardImages } = await vite.ssrLoadModule("/components/card-images.tsx");
  const images = [{ id: "00000000-0000-4000-8000-000000000001", width: 50, align: "right", position: "before", alt: "캡처 <학생>" }];
  const html = renderToStaticMarkup(React.createElement(CardImages, { images, position: "after" }));
  assert.doesNotMatch(html, /width:50%|align-right/);
  assert.match(html, /data-card-photo/);
  assert.match(html, /&lt;학생&gt;/);
  assert.doesNotMatch(html, /<button|<div/);
  assert.equal(renderToStaticMarkup(React.createElement(CardImages, { images, position: "before" })), "");
});

test("photo helpers stay out of the text editor Tab order without hiding the editor", async () => {
  const { ImageField } = await vite.ssrLoadModule("/components/card-images.tsx");
  const html = renderToStaticMarkup(React.createElement(ImageField, { label: "질문", onChange() {}, images: [{ id: "00000000-0000-4000-8000-000000000001", width: 100, align: "center", position: "after", alt: "" }] }, React.createElement("textarea", { "data-test-editor": true })));
  assert.match(html, /<textarea data-test-editor="true">/);
  assert.doesNotMatch(html, /<div[^>]*hidden/);
  for (const button of html.matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /tabindex="-1"/);
  assert.doesNotMatch(html, /사진 편집|사진 크기|왼쪽 정렬|image-field-tools/);
  assert.ok(html.indexOf("<textarea") < html.indexOf("image-edit-frame"), "photos follow the text editor");
});

test("crop metadata stays bounded, optional, and leaves the original image ID intact", async () => {
  const { normalizeCrop, normalizeMedia } = await vite.ssrLoadModule("/lib/card-media.ts");
  assert.equal(normalizeCrop({ x: 0, y: 0, width: 1, height: 1 }), undefined);
  assert.equal(normalizeCrop({ x: NaN, y: 0, width: 1, height: 1 }), undefined);
  const crop = normalizeCrop({ x: -1, y: .5, width: 9, height: 9 });
  assert.deepEqual(crop, { x: 0, y: .5, width: 1, height: .5 });
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(normalizeMedia({ answer: [{ id, crop, width: 30, position: "before" }] }).answer[0], { id, crop, width: 100, align: "center", position: "after", alt: "" });
});

test("moving a photo is atomic, keeps its original metadata, and guards invalid destinations", async () => {
  const { moveCardImage, emptyMedia, MAX_FIELD_IMAGES } = await vite.ssrLoadModule("/lib/card-media.ts");
  const image = { id: "00000000-0000-4000-8000-000000000001", width: 100, align: "center", position: "after", alt: "원본 캡처", crop: { x: .1, y: .2, width: .6, height: .5 } };
  const original = { ...emptyMedia(), memo: [image] };
  const moved = moveCardImage(original, "memo", "question", image.id);
  assert.deepEqual(moved.memo, []);
  assert.deepEqual(moved.question, [image]);
  assert.equal(moved.question[0], image);
  assert.deepEqual(original.memo, [image], "undo snapshot is never mutated");
  assert.equal(moveCardImage(original, "memo", "memo", image.id), original);
  assert.equal(moveCardImage(original, "question", "answer", image.id), original);
  const full = { ...original, answer: Array.from({length: MAX_FIELD_IMAGES}, (_, i) => ({ ...image, id: String(i) })) };
  assert.equal(moveCardImage(full, "memo", "answer", image.id), full);
  const duplicate = { ...original, answer: [{...image, alt: "기존 사진"}] };
  assert.equal(moveCardImage(duplicate, "memo", "answer", image.id), duplicate);
  assert.deepEqual(moveCardImage(moved, "question", "memo", image.id), original);
});

import { getOwnerEmail, unauthorized } from "../../../lib/auth";
import { getRawDb } from "../../../db";
import { readImageBody } from "../../../lib/card-media";
import { imageBucket, imageKey } from "../../../lib/card-image-storage";

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();
  let image: Awaited<ReturnType<typeof readImageBody>>;
  try { image = await readImageBody(request); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "사진을 확인해 주세요." }, { status: 400 }); }
  const id = crypto.randomUUID();
  try {
    const key = await imageKey(ownerEmail, id);
    const bucket = imageBucket();
    await bucket.put(key, image.bytes, { httpMetadata: { contentType: image.mime } });
    try {
      await getRawDb().prepare("INSERT INTO card_images (id, owner_email, mime_type, byte_size) VALUES (?, ?, ?, ?)").bind(id, ownerEmail, image.mime, image.bytes.byteLength).run();
    } catch (error) { await bucket.delete(key); throw error; }
    return Response.json({ image: { id, width: 100, align: "center", position: "after", alt: "" } }, { status: 201 });
  } catch {
    return Response.json({ error: "사진을 저장하지 못했어요. 다시 첨부해 주세요." }, { status: 500 });
  }
}

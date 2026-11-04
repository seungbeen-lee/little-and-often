import { getOwnerEmail, unauthorized } from "../../../../lib/auth";
import { getRawDb } from "../../../../db";
import { IMAGE_ID } from "../../../../lib/card-media";
import { imageBucket, imageKey } from "../../../../lib/card-image-storage";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();
  const { id } = await params;
  if (!IMAGE_ID.test(id)) return new Response(null, { status: 404 });
  try {
  const { results } = await getRawDb().prepare("SELECT mime_type AS mimeType, byte_size AS byteSize FROM card_images WHERE id = ? AND owner_email = ? LIMIT 1").bind(id, ownerEmail).all<{ mimeType: string; byteSize: number }>();
  const image = results[0];
  if (!image) return new Response(null, { status: 404 });
  const object = await imageBucket().get(await imageKey(ownerEmail, id));
  if (!object) return new Response(null, { status: 404 });
  // R2 supplies a standard byte stream. Worker and DOM declarations differ on
  // the optional value of a completed read; keep the original streaming body.
  return new Response(object.body as unknown as ReadableStream<Uint8Array>, { headers: {
    "Content-Type": image.mimeType, "Content-Length": String(image.byteSize),
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
  } catch {
    return new Response("사진을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

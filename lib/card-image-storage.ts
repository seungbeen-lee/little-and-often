import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { MEDIA_FIELDS, type CardMedia } from "./card-media";

export function imageBucket() {
  if (!env.UPLOADS) throw new Error("사진 저장소를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");
  return env.UPLOADS;
}

// Keys never contain user-supplied paths, filenames, or email addresses.
export async function imageKey(ownerEmail: string, id: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerEmail));
  const ownerKey = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
  return `card-images/${ownerKey}/${id}`;
}

export async function ownsMedia(ownerEmail: string, media: CardMedia) {
  const ids = [...new Set(MEDIA_FIELDS.flatMap((field) => media[field].map((item) => item.id)))];
  if (!ids.length) return true;
  // Stay below D1's bound-parameter limit even for a full subject.
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    const rows = await getRawDb().prepare(`SELECT id FROM card_images WHERE owner_email = ? AND id IN (${batch.map(() => "?").join(",")})`).bind(ownerEmail, ...batch).all();
    if (rows.results.length !== batch.length) return false;
  }
  return true;
}

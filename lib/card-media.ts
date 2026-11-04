export type ImageCrop = { x: number; y: number; width: number; height: number };
export type CardImage = { id: string; width: number; align: "left" | "center" | "right"; position: "before" | "after"; alt: string; crop?: ImageCrop };
export type MediaField = "question" | "answer" | "memo";
export type CardMedia = Record<MediaField, CardImage[]>;
export const MEDIA_FIELDS = ["question", "answer", "memo"] as const;
export const MAX_FIELD_IMAGES = 6;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const emptyMedia = (): CardMedia => ({ question: [], answer: [], memo: [] });

// Change both fields together: no intermediate state can lose an attachment,
// and the editor can save / undo the move as one operation.
export function moveCardImage(media: CardMedia, from: MediaField, to: MediaField, imageId: string): CardMedia {
  const image = media[from].find((item) => item.id === imageId);
  if (!image || from === to || media[to].length >= MAX_FIELD_IMAGES || media[to].some((item) => item.id === imageId)) return media;
  return { ...media, [from]: media[from].filter((item) => item.id !== imageId), [to]: [...media[to], image] };
}

export function normalizeCrop(value: unknown): ImageCrop | undefined {
  if (!value || typeof value !== "object") return;
  const crop = value as ImageCrop;
  if (![crop.x, crop.y, crop.width, crop.height].every((n) => typeof n === "number" && Number.isFinite(n))) return;
  const x = Math.min(.98, Math.max(0, crop.x)), y = Math.min(.98, Math.max(0, crop.y));
  const width = Math.min(1 - x, Math.max(.02, crop.width)), height = Math.min(1 - y, Math.max(.02, crop.height));
  if (x === 0 && y === 0 && width === 1 && height === 1) return;
  return { x, y, width, height };
}

export function normalizeMedia(value: unknown): CardMedia {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return emptyMedia(); } }
  const result = emptyMedia();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const field of MEDIA_FIELDS) {
    const items = (value as Record<string, unknown>)[field];
    if (!Array.isArray(items)) continue;
    const seen = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !IMAGE_ID.test(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      const crop = normalizeCrop(item.crop);
      result[field].push({ id: item.id,
        width: 100,
        align: "center",
        position: "after",
        alt: typeof item.alt === "string" ? item.alt.slice(0, 300) : "",
        ...(crop ? { crop } : {}),
      });
      if (result[field].length === MAX_FIELD_IMAGES) break;
    }
  }
  return result;
}

export function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if ([137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  const signature = String.fromCharCode(...bytes.slice(0, 12));
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a")) return "image/gif";
  if (signature.startsWith("RIFF") && signature.slice(8) === "WEBP") return "image/webp";
  return null;
}

export async function readImageBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES) throw new Error("사진은 한 장당 8MB까지 첨부할 수 있어요.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("사진 파일을 선택해 주세요.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("사진은 한 장당 8MB까지 첨부할 수 있어요."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const mime = imageMime(bytes);
  if (!mime) throw new Error("PNG, JPG, WEBP, GIF 사진을 첨부해 주세요.");
  return { bytes, mime };
}

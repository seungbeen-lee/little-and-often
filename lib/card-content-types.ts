export const CARD_CONTENT_TYPES = ["교육과정", "교과교육론", "각론", "수업모형", "지도서총론"] as const;

export type CardContentType = (typeof CARD_CONTENT_TYPES)[number];

export const DEFAULT_CARD_CONTENT_TYPE: CardContentType = "교육과정";

export function normalizeCardContentType(value: unknown): CardContentType {
  // Keep saved cards, drafts and device preferences using the old names readable.
  if (value === "교육론") return "교과교육론";
  if (value === "기타") return "지도서총론";
  return typeof value === "string" && CARD_CONTENT_TYPES.includes(value as CardContentType)
    ? value as CardContentType
    : "지도서총론";
}

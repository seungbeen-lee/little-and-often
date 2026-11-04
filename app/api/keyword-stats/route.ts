import { and, eq } from "drizzle-orm";
import { getDb, getRawDb } from "../../../db";
import { cards, keywordAttemptEvents, keywordStats } from "../../../db/schema";
import { parseStoredKeywords } from "../../../lib/card-data";
import { toApiError } from "../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../lib/auth";
import { normalizeKeywordKey } from "../../../lib/keyword-stats";
import { isTableFormat, tableKeywords, MAX_KEYWORDS } from "../../../lib/table-card";

type KeywordResult = {
  keywordKey?: string;
  keyword?: string;
  matched?: boolean;
};

type KeywordAttemptPayload = {
  eventId?: string;
  cardId?: number;
  results?: KeywordResult[];
};

async function getCardPerformance(ownerEmail: string, cardId: number) {
  const rows = await getDb()
    .select()
    .from(keywordStats)
    .where(and(eq(keywordStats.ownerEmail, ownerEmail), eq(keywordStats.cardId, cardId)));

  return rows.map((item) => ({
    keywordKey: item.keywordKey,
    keyword: item.keyword,
    attempts: item.attempts,
    correct: item.correctCount,
    incorrect: Math.max(0, item.attempts - item.correctCount),
    accuracy: item.attempts ? Math.round((item.correctCount / item.attempts) * 100) : 0,
    lastAttemptedAt: item.lastAttemptedAt,
  }));
}

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const payload = (await request.json()) as KeywordAttemptPayload;
    const eventId = payload.eventId?.trim() ?? "";
    const cardId = Number(payload.cardId);
    const results = payload.results;
    if (
      eventId.length < 8
      || eventId.length > 100
      || !Number.isInteger(cardId)
      || cardId <= 0
      || !Array.isArray(results)
      || results.length < 1
      || results.length > MAX_KEYWORDS
      || results.some((item) => typeof item.keyword !== "string" || typeof item.matched !== "boolean")
    ) {
      return Response.json({ error: "키워드 학습 기록이 올바르지 않습니다." }, { status: 400 });
    }

    const db = getDb();
    const [ownedCard] = await db
      .select({ id: cards.id, keywords: cards.keywords, answerFormat: cards.answerFormat })
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.ownerEmail, ownerEmail)))
      .limit(1);
    if (!ownedCard) return Response.json({ error: "카드를 찾지 못했습니다." }, { status: 404 });

    const table = isTableFormat(ownedCard.answerFormat);
    const activeKeywords = new Map(table
      ? tableKeywords(ownedCard.answerFormat).map((item) => [item.keywordKey, item.keyword] as const)
      : parseStoredKeywords(ownedCard.keywords)
        .map((keyword) => [normalizeKeywordKey(keyword), keyword] as const)
        .filter(([key]) => Boolean(key))
    );
    const normalizedResults = results.map((item) => {
      const key = table ? item.keywordKey ?? "" : normalizeKeywordKey(item.keyword ?? "");
      return { keywordKey: key, keyword: activeKeywords.get(key) ?? "", matched: item.matched === true };
    });
    if (
      normalizedResults.some((item) => !item.keywordKey || !item.keyword)
      || new Set(normalizedResults.map((item) => item.keywordKey)).size !== normalizedResults.length
    ) {
      return Response.json({ error: "현재 카드에 있는 키워드만 기록할 수 있습니다." }, { status: 400 });
    }

    const [existingEvent] = await db
      .select({ cardId: keywordAttemptEvents.cardId })
      .from(keywordAttemptEvents)
      .where(and(eq(keywordAttemptEvents.ownerEmail, ownerEmail), eq(keywordAttemptEvents.eventId, eventId)))
      .limit(1);
    if (existingEvent) {
      if (existingEvent.cardId !== cardId) {
        return Response.json({ error: "키워드 기록 식별자가 다른 카드에 사용됐습니다." }, { status: 409 });
      }
      return Response.json({ saved: true, cardId, keywordPerformance: await getCardPerformance(ownerEmail, cardId) });
    }

    const attemptedAt = new Date().toISOString();
    const rawDb = getRawDb();
    const statements = [
      rawDb.prepare(
        "INSERT INTO keyword_attempt_events (owner_email, event_id, card_id, attempted_at) VALUES (?, ?, ?, ?)"
      ).bind(ownerEmail, eventId, cardId, attemptedAt),
      rawDb.prepare(
        `INSERT INTO keyword_stats (card_id, owner_email, keyword_key, keyword, attempts, correct_count, last_attempted_at, updated_at)
         SELECT ?, ?, json_extract(value, '$.keywordKey'), json_extract(value, '$.keyword'), 1,
           json_extract(value, '$.matched'), ?, ? FROM json_each(?) WHERE 1
         ON CONFLICT(card_id, keyword_key) DO UPDATE SET
           keyword = excluded.keyword,
           attempts = keyword_stats.attempts + 1,
           correct_count = keyword_stats.correct_count + excluded.correct_count,
           last_attempted_at = excluded.last_attempted_at,
           updated_at = excluded.updated_at`
      ).bind(cardId, ownerEmail, attemptedAt, attemptedAt, JSON.stringify(normalizedResults)),
    ];
    await rawDb.batch(statements);

    return Response.json({ saved: true, cardId, keywordPerformance: await getCardPerformance(ownerEmail, cardId) });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

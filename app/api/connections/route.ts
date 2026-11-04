import { and, eq } from "drizzle-orm";
import { getDb, getRawDb } from "../../../db";
import { cards, connectionAttemptEvents, connectionStats } from "../../../db/schema";
import { extractBoldKeywords } from "../../../lib/card-data";
import { toApiError } from "../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../lib/auth";

type ConnectionAttemptPayload = {
  eventId?: string;
  cardId?: number;
  connected?: boolean;
};

async function getCardConnection(ownerEmail: string, cardId: number) {
  const [item] = await getDb()
    .select()
    .from(connectionStats)
    .where(and(eq(connectionStats.ownerEmail, ownerEmail), eq(connectionStats.cardId, cardId)))
    .limit(1);

  if (!item) return { attempts: 0, connected: 0, connectivity: 0, lastAttemptedAt: null };
  return {
    attempts: item.attempts,
    connected: item.connectedCount,
    connectivity: item.attempts ? Math.round((item.connectedCount / item.attempts) * 100) : 0,
    lastAttemptedAt: item.lastAttemptedAt,
  };
}

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const payload = (await request.json()) as ConnectionAttemptPayload;
    const eventId = payload.eventId?.trim() ?? "";
    const cardId = Number(payload.cardId);
    if (
      eventId.length < 8
      || eventId.length > 100
      || !Number.isInteger(cardId)
      || cardId <= 0
      || typeof payload.connected !== "boolean"
    ) {
      return Response.json({ error: "질문 연결 기록이 올바르지 않습니다." }, { status: 400 });
    }

    const db = getDb();
    const [ownedCard] = await db
      .select({ id: cards.id, questionFormat: cards.questionFormat })
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.ownerEmail, ownerEmail)))
      .limit(1);
    if (!ownedCard) return Response.json({ error: "카드를 찾지 못했습니다." }, { status: 404 });
    if (!extractBoldKeywords(ownedCard.questionFormat).length) {
      return Response.json({ error: "질문에 연결 키워드가 없습니다." }, { status: 400 });
    }

    const [existingEvent] = await db
      .select({ cardId: connectionAttemptEvents.cardId })
      .from(connectionAttemptEvents)
      .where(and(eq(connectionAttemptEvents.ownerEmail, ownerEmail), eq(connectionAttemptEvents.eventId, eventId)))
      .limit(1);
    if (existingEvent) {
      if (existingEvent.cardId !== cardId) {
        return Response.json({ error: "연결 기록 식별자가 다른 카드에 사용됐습니다." }, { status: 409 });
      }
      return Response.json({ saved: true, cardId, connection: await getCardConnection(ownerEmail, cardId) });
    }

    const attemptedAt = new Date().toISOString();
    const rawDb = getRawDb();
    await rawDb.batch([
      rawDb.prepare(
        "INSERT INTO connection_attempt_events (owner_email, event_id, card_id, connected, attempted_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(ownerEmail, eventId, cardId, payload.connected ? 1 : 0, attemptedAt),
      rawDb.prepare(
        `INSERT INTO connection_stats (card_id, owner_email, attempts, connected_count, last_attempted_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(card_id) DO UPDATE SET
           owner_email = excluded.owner_email,
           attempts = connection_stats.attempts + 1,
           connected_count = connection_stats.connected_count + excluded.connected_count,
           last_attempted_at = excluded.last_attempted_at,
           updated_at = excluded.updated_at`
      ).bind(cardId, ownerEmail, payload.connected ? 1 : 0, attemptedAt, attemptedAt),
    ]);

    return Response.json({ saved: true, cardId, connection: await getCardConnection(ownerEmail, cardId) });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

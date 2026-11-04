import { and, eq, inArray } from "drizzle-orm";
import { getDb, getRawDb } from "../../../../db";
import { cards, studySets } from "../../../../db/schema";
import { toApiError } from "../../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../../lib/auth";

type SetPayload = {
  subject?: string;
  name?: string;
  memo?: string;
  cardIds?: unknown;
};

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeCardIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is number => Number.isInteger(id) && id > 0))].slice(0, 100);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();
  const id = parseId((await params).id);
  if (!id) return Response.json({ error: "잘못된 세트입니다." }, { status: 400 });

  try {
    const [existing] = await getDb()
      .select()
      .from(studySets)
      .where(and(eq(studySets.id, id), eq(studySets.ownerEmail, ownerEmail)));
    if (!existing) return Response.json({ error: "세트를 찾지 못했습니다." }, { status: 404 });

    const payload = (await request.json()) as SetPayload;
    const subject = payload.subject?.trim() ?? "";
    const name = payload.name?.trim().slice(0, 100) ?? "";
    const memo = payload.memo?.trim().slice(0, 20000) ?? "";
    const cardIds = normalizeCardIds(payload.cardIds);

    if (!subject || !name) {
      return Response.json({ error: "과목과 세트 이름을 입력해 주세요." }, { status: 400 });
    }
    if (cardIds.length < 2) {
      return Response.json({ error: "비교할 카드를 두 장 이상 골라 주세요." }, { status: 400 });
    }

    const ownedCards = await getDb()
      .select({ id: cards.id, subject: cards.subject })
      .from(cards)
      .where(and(eq(cards.ownerEmail, ownerEmail), inArray(cards.id, cardIds)));
    const ownedById = new Map(ownedCards.map((card) => [card.id, card]));
    if (cardIds.some((cardId) => ownedById.get(cardId)?.subject !== subject)) {
      return Response.json({ error: "선택한 과목의 카드만 세트에 넣을 수 있어요." }, { status: 400 });
    }

    const rawDb = getRawDb();
    const updatedAt = new Date().toISOString();
    await rawDb.batch([
      rawDb.prepare(
        "UPDATE study_sets SET subject = ?, name = ?, memo = ?, updated_at = ? WHERE id = ? AND owner_email = ?"
      ).bind(subject, name, memo, updatedAt, id, ownerEmail),
      rawDb.prepare("DELETE FROM study_set_cards WHERE set_id = ?").bind(id),
      ...cardIds.map((cardId, sortOrder) => rawDb.prepare(
        "INSERT INTO study_set_cards (set_id, card_id, sort_order) VALUES (?, ?, ?)"
      ).bind(id, cardId, sortOrder)),
    ]);

    return Response.json({
      set: { ...existing, subject, name, memo, cardIds, updatedAt },
    });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();
  const id = parseId((await params).id);
  if (!id) return Response.json({ error: "잘못된 세트입니다." }, { status: 400 });

  try {
    const [deleted] = await getDb()
      .delete(studySets)
      .where(and(eq(studySets.id, id), eq(studySets.ownerEmail, ownerEmail)))
      .returning({ id: studySets.id });
    if (!deleted) return Response.json({ error: "세트를 찾지 못했습니다." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

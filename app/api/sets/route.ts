import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { cards, studySetCards, studySets } from "../../../db/schema";
import { toApiError } from "../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../lib/auth";

type SetPayload = {
  subject?: string;
  name?: string;
  memo?: string;
  cardIds?: unknown;
};

function normalizeCardIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is number => Number.isInteger(id) && id > 0))].slice(0, 100);
}

export async function GET(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const [setRows, memberRows] = await Promise.all([
      getDb()
        .select()
        .from(studySets)
        .where(eq(studySets.ownerEmail, ownerEmail))
        .orderBy(asc(studySets.subject), asc(studySets.name), asc(studySets.id)),
      getDb()
        .select({ setId: studySetCards.setId, cardId: studySetCards.cardId })
        .from(studySetCards)
        .innerJoin(studySets, eq(studySetCards.setId, studySets.id))
        .where(eq(studySets.ownerEmail, ownerEmail))
        .orderBy(asc(studySetCards.setId), asc(studySetCards.sortOrder)),
    ]);

    const cardIdsBySet = new Map<number, number[]>();
    for (const member of memberRows) {
      const ids = cardIdsBySet.get(member.setId) ?? [];
      ids.push(member.cardId);
      cardIdsBySet.set(member.setId, ids);
    }

    return Response.json({
      sets: setRows.map((set) => ({ ...set, cardIds: cardIdsBySet.get(set.id) ?? [] })),
    });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
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
    if (cardIds.some((id) => ownedById.get(id)?.subject !== subject)) {
      return Response.json({ error: "선택한 과목의 카드만 세트에 넣을 수 있어요." }, { status: 400 });
    }

    const [created] = await getDb()
      .insert(studySets)
      .values({ ownerEmail, subject, name, memo })
      .returning();

    try {
      await getDb().insert(studySetCards).values(
        cardIds.map((cardId, sortOrder) => ({ setId: created.id, cardId, sortOrder }))
      );
    } catch (error) {
      await getDb().delete(studySets).where(and(eq(studySets.id, created.id), eq(studySets.ownerEmail, ownerEmail)));
      throw error;
    }

    return Response.json({ set: { ...created, cardIds } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { cards } from "../../../../../db/schema";
import { toApiError } from "../../../../../lib/api-errors";
import { archiveReviewDueAt } from "../../../../../lib/archive-schedule";
import { getOwnerEmail, unauthorized } from "../../../../../lib/auth";
import { cardForResponse } from "../../../../../lib/card-data";

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();
  const id = parseId((await params).id);
  if (!id) return Response.json({ error: "잘못된 카드입니다." }, { status: 400 });

  try {
    const payload = (await request.json()) as { archived?: boolean };
    if (typeof payload.archived !== "boolean") {
      return Response.json({ error: "보관 상태가 올바르지 않습니다." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const [card] = await getDb()
      .update(cards)
      .set(payload.archived
        ? {
          archivedAt: now,
          archiveReviewStage: 0,
          archiveReviewDueAt: archiveReviewDueAt(now, 0),
          updatedAt: now,
        }
        : {
          archivedAt: null,
          archiveReviewStage: 0,
          archiveReviewDueAt: null,
          masteryStreak: 0,
          updatedAt: now,
        })
      .where(and(eq(cards.id, id), eq(cards.ownerEmail, ownerEmail)))
      .returning();

    if (!card) return Response.json({ error: "카드를 찾지 못했습니다." }, { status: 404 });
    return Response.json({ card: cardForResponse(card) });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

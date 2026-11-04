import { asc, eq } from "drizzle-orm";
import { getDb, getRawDb } from "../../../../db";
import { cards } from "../../../../db/schema";
import { getOwnerEmail, unauthorized } from "../../../../lib/auth";
import { toApiError } from "../../../../lib/api-errors";
import { bulletContentFields, bulletFingerprint, planLegacyListBullets } from "../../../../lib/list-bullet-migration";

async function ownCards(owner: string) {
  return getDb().select().from(cards).where(eq(cards.ownerEmail, owner)).orderBy(asc(cards.id));
}

export async function GET(request: Request) {
  const owner = getOwnerEmail(request);
  if (!owner) return unauthorized();
  try {
    const rows = await ownCards(owner), changes = [], skipped = [];
    for (const card of rows) {
      const plan = planLegacyListBullets(card);
      if (!plan) continue;
      if (!plan.next) { skipped.push({ id: card.id, question: card.question, reason: plan.reason }); continue; }
      changes.push({ id: card.id, subject: card.subject, question: card.question, fingerprint: await bulletFingerprint(card), before: { ...card, ownerEmail: undefined }, after: plan.next });
    }
    return Response.json({ total: rows.length, changes, skipped }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: toApiError(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  const owner = getOwnerEmail(request);
  if (!owner) return unauthorized();
  try {
    const payload = await request.json() as { items?: Array<{ id: number; fingerprint: string }> };
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 50
      || payload.items.some(item => !Number.isSafeInteger(item.id) || typeof item.fingerprint !== "string")
      || new Set(payload.items.map(item => item.id)).size !== payload.items.length) return Response.json({ error: "변환 대상을 다시 확인해 주세요." }, { status: 400 });
    const rows = new Map((await ownCards(owner)).map(card => [card.id, card]));
    const statements = [], ids = [], conflicts = [];
    for (const item of payload.items) {
      const card = rows.get(item.id);
      if (!card || await bulletFingerprint(card) !== item.fingerprint) { conflicts.push(item.id); continue; }
      const plan = planLegacyListBullets(card);
      if (!plan?.next) { conflicts.push(item.id); continue; }
      const next = plan.next;
      // Only these five content columns change. Counts, keyword IDs, archive
      // state, photos and relations are never rewritten by this operation.
      statements.push(getRawDb().prepare(`UPDATE cards SET question=?, question_format=?, answer=?, answer_format=?, memo=?, updated_at=?
        WHERE id=? AND owner_email=? AND question=? AND question_format=? AND answer=? AND answer_format=? AND memo=? AND keywords=? AND updated_at=? RETURNING id`)
        .bind(...bulletContentFields.map(field => next[field]), new Date().toISOString(), card.id, owner,
          ...bulletContentFields.map(field => card[field]), card.keywords, card.updatedAt));
      ids.push(item.id);
    }
    const results = statements.length ? await getRawDb().batch(statements) : [];
    const changed = ids.filter((id, index) => {
      if (results[index].results?.length) return true;
      conflicts.push(id); return false;
    });
    return Response.json({ changed, conflicts });
  } catch (error) { return Response.json({ error: toApiError(error) }, { status: 500 }); }
}

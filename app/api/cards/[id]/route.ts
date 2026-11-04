import { and, eq } from "drizzle-orm";
import { getDb, getRawDb } from "../../../../db";
import { cards, keywordStats } from "../../../../db/schema";
import { toApiError } from "../../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../../lib/auth";
import { cardForResponse, extractBoldKeywords, normalizeCardEditorContent, normalizeImportance, parseStoredKeywords, serializeKeywords } from "../../../../lib/card-data";
import { normalizeCardContentType } from "../../../../lib/card-content-types";
import { normalizeMedia } from "../../../../lib/card-media";
import { ownsMedia } from "../../../../lib/card-image-storage";
import { inheritKeywordStats, type KeywordInheritanceChoice } from "../../../../lib/keyword-stats";
import { isTableFormat } from "../../../../lib/table-card";
import { learningContentChanged } from "../../../../lib/card-edit-policy";
import { preserveMigratedListBullets } from "../../../../lib/list-bullet-migration";

type CardPayload = {
  subject?: string;
  contentType?: string;
  section?: string;
  subsection?: string;
  detailSection?: string;
  area?: string;
  importance?: number;
  question?: string;
  questionFormat?: string;
  answer?: string;
  answerFormat?: string;
  memo?: string;
  media?: unknown;
  keywords?: unknown;
  keywordsFromBold?: boolean;
  keywordInheritance?: KeywordInheritanceChoice[];
};

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();
  const id = parseId((await params).id);
  if (!id) return Response.json({ error: "잘못된 카드입니다." }, { status: 400 });

  try {
    const payload = (await request.json()) as CardPayload;
    const subject = payload.subject?.trim() ?? "";
    const contentType = normalizeCardContentType(payload.contentType);
    const section = payload.section?.trim() ?? "";
    const subsection = payload.subsection?.trim() ?? "";
    const detailSection = payload.detailSection?.trim() ?? "";
    const area = payload.area?.trim() ?? "";
    const { question, questionFormat, answer, answerFormat, memo } = normalizeCardEditorContent(payload);
    const keywords = serializeKeywords(payload.keywordsFromBold ? extractBoldKeywords(answerFormat) : payload.keywords);
    const importance = normalizeImportance(payload.importance);

    if (!subject || !section || !question || !answer) {
      return Response.json(
        { error: "과목, 섹션, 질문, 답을 모두 입력해 주세요." },
        { status: 400 }
      );
    }
    if (detailSection && !subsection) {
      return Response.json({ error: "세부 섹션을 쓰려면 하위 섹션이 먼저 필요해요." }, { status: 400 });
    }

    const db = getDb();
    const [previousCard] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.id, id), eq(cards.ownerEmail, ownerEmail)))
      .limit(1);
    if (!previousCard) return Response.json({ error: "카드를 찾지 못했습니다." }, { status: 404 });
    const media = normalizeMedia(payload.media === undefined ? previousCard.media : payload.media);
    if (!await ownsMedia(ownerEmail, media)) return Response.json({ error: "첨부 사진을 확인할 수 없어요. 다시 첨부해 주세요." }, { status: 400 });
    const nextContent = {
      subject, contentType, section, subsection, detailSection, area,
      ...preserveMigratedListBullets(previousCard, { question, questionFormat, answer, answerFormat, memo }),
      media: JSON.stringify(media), keywords,
    };
    const learningChanged = learningContentChanged(
      { ...previousCard, media: JSON.stringify(normalizeMedia(previousCard.media)) },
      nextContent
    );
    const reopen = Boolean(previousCard.archivedAt && learningChanged);

    const previousKeywordStats = previousCard.keywords === keywords
      ? []
      : await db
        .select({
          keywordKey: keywordStats.keywordKey,
          keyword: keywordStats.keyword,
          attempts: keywordStats.attempts,
          correctCount: keywordStats.correctCount,
          lastAttemptedAt: keywordStats.lastAttemptedAt,
        })
        .from(keywordStats)
        .where(and(eq(keywordStats.cardId, id), eq(keywordStats.ownerEmail, ownerEmail)));

    const [card] = await db
      .update(cards)
      .set({
        ...nextContent,
        importance,
        ...(learningChanged ? { keywordSuccessStreak: 0, fullWriteSuccessStreak: 0, keywordLastSucceededAt: null } : {}),
        ...(reopen ? {
          archivedAt: null,
          archiveReviewStage: 0,
          archiveReviewDueAt: null,
          masteryStreak: 0,
        } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(cards.id, id), eq(cards.ownerEmail, ownerEmail)))
      .returning();

    if (previousCard.keywords !== keywords && !isTableFormat(answerFormat)) {
      const inherited = inheritKeywordStats(
        parseStoredKeywords(keywords),
        previousKeywordStats,
        Array.isArray(payload.keywordInheritance) ? payload.keywordInheritance : []
      );
      const rawDb = getRawDb();
      await rawDb.batch([
        rawDb.prepare("DELETE FROM keyword_stats WHERE card_id = ? AND owner_email = ?").bind(id, ownerEmail),
        ...inherited.map((item) => rawDb.prepare(
          "INSERT INTO keyword_stats (card_id, owner_email, keyword_key, keyword, attempts, correct_count, last_attempted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(id, ownerEmail, item.keywordKey, item.keyword, item.attempts, item.correctCount, item.lastAttemptedAt, new Date().toISOString())),
      ]);
    }
    return Response.json({ card: cardForResponse(card) });
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
  if (!id) return Response.json({ error: "잘못된 카드입니다." }, { status: 400 });

  try {
    const [deleted] = await getDb()
      .delete(cards)
      .where(and(eq(cards.id, id), eq(cards.ownerEmail, ownerEmail)))
      .returning({ id: cards.id });

    if (!deleted) return Response.json({ error: "카드를 찾지 못했습니다." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

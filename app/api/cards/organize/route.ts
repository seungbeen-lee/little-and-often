import { and, asc, eq } from "drizzle-orm";
import { getDb, getRawDb } from "../../../../db";
import { cards, keywordStats } from "../../../../db/schema";
import { toApiError } from "../../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../../lib/auth";
import {
  cardForResponse,
  extractBoldKeywords,
  normalizeCardEditorContent,
  normalizeImportance,
  parseStoredKeywords,
  serializeKeywords,
} from "../../../../lib/card-data";
import { inheritKeywordStats, type KeywordInheritanceChoice } from "../../../../lib/keyword-stats";
import { normalizeCardContentType } from "../../../../lib/card-content-types";
import { normalizeMedia, MEDIA_FIELDS, emptyMedia } from "../../../../lib/card-media";
import { ownsMedia } from "../../../../lib/card-image-storage";
import { isTableFormat } from "../../../../lib/table-card";
import { learningContentChanged } from "../../../../lib/card-edit-policy";
import { preserveMigratedListBullets } from "../../../../lib/list-bullet-migration";

type OrganizePayload = {
  subject?: string;
  deleteCardIds?: number[];
  cards?: Array<{
    id?: number | null;
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
    keywordInheritance?: KeywordInheritanceChoice[];
  }>;
};

const MAX_CARDS = 100;

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const payload = (await request.json()) as OrganizePayload;
    const subject = payload.subject?.trim() ?? "";
    const incoming = payload.cards ?? [];

    if (!subject) {
      return Response.json({ error: "과목을 선택해 주세요." }, { status: 400 });
    }
    const confirmedEmpty = incoming.length === 0 && Array.isArray(payload.deleteCardIds)
      && payload.deleteCardIds.every(id => Number.isInteger(id) && id > 0);
    if ((!incoming.length && !confirmedEmpty) || incoming.length > MAX_CARDS) {
      return Response.json(
        { error: `한 과목에는 1장부터 ${MAX_CARDS}장까지 정리할 수 있어요.` },
        { status: 400 }
      );
    }

    const normalized = incoming.map((card, sortOrder) => {
      if (card.id != null && (!Number.isInteger(card.id) || card.id <= 0)) {
        throw new Error("잘못된 카드가 포함되어 있어요.");
      }
      const content = normalizeCardEditorContent(card);
      return {
        id: card.id ?? null,
        contentType: normalizeCardContentType(card.contentType),
        section: card.section?.trim() || "기본",
        subsection: card.subsection?.trim() ?? "",
        detailSection: card.detailSection?.trim() ?? "",
        area: card.area?.trim() ?? "",
        importance: normalizeImportance(card.importance),
        ...content,
        media: card.media === undefined ? undefined : JSON.stringify(normalizeMedia(card.media)),
        keywords: serializeKeywords(extractBoldKeywords(content.answerFormat)),
        keywordInheritance: Array.isArray(card.keywordInheritance) ? card.keywordInheritance : [],
        sortOrder,
      };
    });

    if (normalized.some((card) => !card.question || !card.answer || !card.section)) {
      return Response.json(
        { error: "모든 질문에는 답과 섹션이 함께 있어야 해요." },
        { status: 400 }
      );
    }
    if (normalized.some((card) => card.detailSection && !card.subsection)) {
      return Response.json({ error: "세부 섹션을 쓰려면 하위 섹션이 먼저 필요해요." }, { status: 400 });
    }

    const suppliedIds = normalized
      .map((card) => card.id)
      .filter((id): id is number => id !== null);
    if (new Set(suppliedIds).size !== suppliedIds.length) {
      return Response.json({ error: "같은 카드가 중복되어 있어요." }, { status: 400 });
    }

    const db = getDb();
    const existing = await db
      .select()
      .from(cards)
      .where(and(eq(cards.ownerEmail, ownerEmail), eq(cards.subject, subject)));
    const existingIds = new Set(existing.map((card) => card.id));
    if (confirmedEmpty && (payload.deleteCardIds!.length !== existing.length
      || new Set(payload.deleteCardIds).size !== existing.length
      || payload.deleteCardIds!.some(id => !existingIds.has(id)))) {
      return Response.json({ error: "다른 곳에서 카드가 변경되었어요. 최신 목록을 확인한 뒤 다시 선택해 주세요." }, { status: 409 });
    }
    if (suppliedIds.some((id) => !existingIds.has(id))) {
      return Response.json(
        { error: "이 과목에 속하지 않은 카드가 포함되어 있어요." },
        { status: 400 }
      );
    }

    for (const card of normalized) {
      const stored = existing.find(row => row.id === card.id);
      if (stored) Object.assign(card, preserveMigratedListBullets(stored, card));
    }

    const changedKeywordCardIds = normalized
      .filter((card) => card.id && existing.find((stored) => stored.id === card.id)?.keywords !== card.keywords)
      .map((card) => card.id as number);
    const allMedia = emptyMedia();
    for (const card of normalized) {
      card.media ??= existing.find((stored) => stored.id === card.id)?.media ?? "{}";
      const media = normalizeMedia(card.media);
      for (const field of MEDIA_FIELDS) allMedia[field].push(...media[field]);
    }
    if (!await ownsMedia(ownerEmail, allMedia)) return Response.json({ error: "첨부 사진을 확인할 수 없어요. 다시 첨부해 주세요." }, { status: 400 });
    const previousKeywordStats = changedKeywordCardIds.length
      ? await db
        .select({
          cardId: keywordStats.cardId,
          keywordKey: keywordStats.keywordKey,
          keyword: keywordStats.keyword,
          attempts: keywordStats.attempts,
          correctCount: keywordStats.correctCount,
          lastAttemptedAt: keywordStats.lastAttemptedAt,
        })
        .from(keywordStats)
        .where(eq(keywordStats.ownerEmail, ownerEmail))
      : [];

    const rawDb = getRawDb();
    const statements: Array<ReturnType<typeof rawDb.prepare>> = [];
    const suppliedIdSet = new Set(suppliedIds);
    const hasDeletedCards = existing.some((card) => !suppliedIdSet.has(card.id));
    if (hasDeletedCards) {
      const deleteIds = confirmedEmpty ? payload.deleteCardIds! : suppliedIds;
      const keepPlaceholders = deleteIds.map(() => "?").join(", ");
      const deleteSql = confirmedEmpty
        ? `DELETE FROM cards WHERE owner_email = ? AND subject = ? AND id IN (${keepPlaceholders})`
        : suppliedIds.length
        ? `DELETE FROM cards WHERE owner_email = ? AND subject = ? AND id NOT IN (${keepPlaceholders})`
        : "DELETE FROM cards WHERE owner_email = ? AND subject = ?";
      statements.push(rawDb.prepare(deleteSql).bind(ownerEmail, subject, ...deleteIds));
    }

    const updatedAt = new Date().toISOString();
    const existingById = new Map(existing.map((card) => [card.id, card]));
    for (const card of normalized) {
      if (card.id) {
        const stored = existingById.get(card.id)!;
        const keywordsChanged = stored.keywords !== card.keywords;
        const learningChanged = learningContentChanged(
          { ...stored, media: JSON.stringify(normalizeMedia(stored.media)) },
          { ...stored, ...card, subject, media: JSON.stringify(normalizeMedia(card.media)) }
        );
        const reopen = Boolean(stored.archivedAt && learningChanged);
        const unchanged = stored.contentType === card.contentType
          && stored.section === card.section
          && stored.subsection === card.subsection
          && stored.detailSection === card.detailSection
          && stored.area === card.area
          && stored.importance === card.importance
          && stored.question === card.question
          && stored.questionFormat === card.questionFormat
          && stored.answer === card.answer
          && stored.answerFormat === card.answerFormat
          && stored.memo === card.memo
          && stored.media === card.media
          && stored.keywords === card.keywords
          && stored.sortOrder === card.sortOrder;
        if (unchanged) continue;
        statements.push(
          rawDb.prepare(
            "UPDATE cards SET content_type = ?, section = ?, subsection = ?, detail_section = ?, area = ?, importance = ?, question = ?, question_format = ?, answer = ?, answer_format = ?, memo = ?, media = ?, keywords = ?, sort_order = ?, archived_at = ?, archive_review_stage = ?, archive_review_due_at = ?, mastery_streak = ?, keyword_success_streak = ?, full_write_success_streak = ?, keyword_last_succeeded_at = ?, updated_at = ? WHERE id = ? AND owner_email = ? AND subject = ?"
          ).bind(
            card.contentType,
            card.section,
            card.subsection,
            card.detailSection,
            card.area,
            card.importance,
            card.question,
            card.questionFormat,
            card.answer,
            card.answerFormat,
            card.memo,
            card.media,
            card.keywords,
            card.sortOrder,
            reopen ? null : stored.archivedAt,
            reopen ? 0 : stored.archiveReviewStage,
            reopen ? null : stored.archiveReviewDueAt,
            reopen ? 0 : stored.masteryStreak,
            learningChanged ? 0 : stored.keywordSuccessStreak,
            learningChanged ? 0 : stored.fullWriteSuccessStreak,
            learningChanged ? null : stored.keywordLastSucceededAt,
            updatedAt,
            card.id,
            ownerEmail,
            subject
          )
        );
        if (keywordsChanged && !isTableFormat(card.answerFormat)) {
          const inherited = inheritKeywordStats(
            parseStoredKeywords(card.keywords),
            previousKeywordStats.filter((item) => item.cardId === card.id),
            card.keywordInheritance
          );
          statements.push(rawDb.prepare("DELETE FROM keyword_stats WHERE card_id = ? AND owner_email = ?").bind(card.id, ownerEmail));
          inherited.forEach((item) => {
            statements.push(rawDb.prepare(
              "INSERT INTO keyword_stats (card_id, owner_email, keyword_key, keyword, attempts, correct_count, last_attempted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).bind(card.id, ownerEmail, item.keywordKey, item.keyword, item.attempts, item.correctCount, item.lastAttemptedAt, updatedAt));
          });
        }
      } else {
        statements.push(
          rawDb.prepare(
            "INSERT INTO cards (owner_email, subject, content_type, section, subsection, detail_section, area, importance, question, question_format, answer, answer_format, memo, media, keywords, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(
            ownerEmail,
            subject,
            card.contentType,
            card.section,
            card.subsection,
            card.detailSection,
            card.area,
            card.importance,
            card.question,
            card.questionFormat,
            card.answer,
            card.answerFormat,
            card.memo,
            card.media,
            card.keywords,
            card.sortOrder,
            updatedAt
          )
        );
      }
    }

    if (statements.length) await rawDb.batch(statements);

    const organized = await db
      .select()
      .from(cards)
      .where(and(eq(cards.ownerEmail, ownerEmail), eq(cards.subject, subject)))
      .orderBy(asc(cards.sortOrder), asc(cards.id));

    return Response.json({ cards: organized.map(cardForResponse) });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

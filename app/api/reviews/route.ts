import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { cards, reviews } from "../../../db/schema";
import { toApiError } from "../../../lib/api-errors";
import { archiveReviewDueAt, nextArchiveReviewStage, nextReviewProgress } from "../../../lib/archive-schedule";
import { getOwnerEmail, unauthorized } from "../../../lib/auth";
import { isTableFormat, tableKeywords } from "../../../lib/table-card";

import { completedLearningStages, nextLearningProgress, type LearningKind } from "../../../lib/learning-stages";

type ReviewPayload = {
  learningKind?: LearningKind;
  hintUsed?: boolean;
  eventId?: string;
  cardId?: number;
  mode?: "reveal" | "write";
  result?: "correct" | "incorrect";
  typedAnswer?: string;
  statisticsOnly?: boolean;
  attemptedAt?: string;
  tableKeywordIds?: string[];
};

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const payload = (await request.json()) as ReviewPayload;
    const cardId = Number(payload.cardId);
    const eventId = payload.eventId?.trim() || null;
    const mode = payload.mode;
    const result = payload.result;

    if (
      (payload.learningKind !== undefined && !["practice", "keyword", "full"].includes(payload.learningKind)) ||
      (payload.hintUsed !== undefined && typeof payload.hintUsed !== "boolean") ||
      (payload.learningKind === "practice" && payload.statisticsOnly !== true) ||
      !Number.isInteger(cardId) ||
      cardId <= 0 ||
      !mode ||
      !["reveal", "write"].includes(mode) ||
      !result ||
      !["correct", "incorrect"].includes(result) ||
      (payload.statisticsOnly !== undefined && typeof payload.statisticsOnly !== "boolean") ||
      (payload.statisticsOnly === true && !eventId) ||
      (payload.attemptedAt !== undefined && (typeof payload.attemptedAt !== "string" || !Number.isFinite(Date.parse(payload.attemptedAt)) || Date.parse(payload.attemptedAt) > Date.now() + 60_000)) ||
      (eventId !== null && (eventId.length < 8 || eventId.length > 100))
    ) {
      return Response.json({ error: "복습 결과가 올바르지 않습니다." }, { status: 400 });
    }

    const db = getDb();
    if (eventId) {
      const [savedReview] = await db
        .select({ cardId: reviews.cardId, reviewedAt: reviews.reviewedAt })
        .from(reviews)
        .where(and(eq(reviews.ownerEmail, ownerEmail), eq(reviews.eventId, eventId)))
        .limit(1);
      if (savedReview) {
        if (savedReview.cardId !== cardId) {
          return Response.json({ error: "복습 기록 식별자가 다른 카드에 사용됐습니다." }, { status: 409 });
        }
        const [savedCard] = await db
          .select({
            correctCount: cards.correctCount,
            incorrectCount: cards.incorrectCount,
            correctStreak: cards.correctStreak,
            masteryStreak: cards.masteryStreak,
        keywordSuccessStreak: cards.keywordSuccessStreak,
        fullWriteSuccessStreak: cards.fullWriteSuccessStreak,
        keywordLastSucceededAt: cards.keywordLastSucceededAt,
            lastReviewedAt: cards.lastReviewedAt,
            archivedAt: cards.archivedAt,
            archiveReviewStage: cards.archiveReviewStage,
            archiveReviewDueAt: cards.archiveReviewDueAt,
          })
          .from(cards)
          .where(and(eq(cards.id, cardId), eq(cards.ownerEmail, ownerEmail)))
          .limit(1);
        if (!savedCard) return Response.json({ error: "카드를 찾지 못했습니다." }, { status: 404 });
        return Response.json({
          saved: true,
          reviewedAt: savedCard.lastReviewedAt ?? savedReview.reviewedAt,
          lastReviewedAt: savedCard.lastReviewedAt,
          correctCount: savedCard.correctCount,
          incorrectCount: savedCard.incorrectCount,
          correctStreak: savedCard.correctStreak,
          masteryStreak: savedCard.masteryStreak,
      keywordSuccessStreak: savedCard.keywordSuccessStreak,
      fullWriteSuccessStreak: savedCard.fullWriteSuccessStreak,
      keywordLastSucceededAt: savedCard.keywordLastSucceededAt,
          archivedAt: savedCard.archivedAt,
          archiveReviewStage: savedCard.archiveReviewStage,
          archiveReviewDueAt: savedCard.archiveReviewDueAt,
        });
      }
    }
    const [ownedCard] = await db
      .select({
        id: cards.id,
        answerFormat: cards.answerFormat,
        incorrectCount: cards.incorrectCount,
        correctStreak: cards.correctStreak,
        masteryStreak: cards.masteryStreak,
        keywordSuccessStreak: cards.keywordSuccessStreak,
        fullWriteSuccessStreak: cards.fullWriteSuccessStreak,
        keywordLastSucceededAt: cards.keywordLastSucceededAt,
        archivedAt: cards.archivedAt,
        archiveReviewStage: cards.archiveReviewStage,
      })
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.ownerEmail, ownerEmail)))
      .limit(1);

    if (!ownedCard) return Response.json({ error: "카드를 찾지 못했습니다." }, { status: 404 });
    const table = isTableFormat(ownedCard.answerFormat);
    const activeIds = tableKeywords(ownedCard.answerFormat).map((item) => item.keywordKey);
    const testedIds = Array.isArray(payload.tableKeywordIds) ? [...new Set(payload.tableKeywordIds)] : [];
    if (table && testedIds.some((id) => typeof id !== "string" || !activeIds.includes(id))) return Response.json({ error: "표 풀이 범위가 현재 키워드와 다릅니다." }, { status: 400 });
    const writesWholeTable = payload.learningKind === "full" || (payload.learningKind === "practice" && mode === "write");
    const coverage = table && !writesWholeTable && (!activeIds.length || testedIds.length !== activeIds.length) ? "partial" : "full";
    const keywordIds = JSON.stringify(testedIds);

    const reviewedAt = payload.attemptedAt ? new Date(payload.attemptedAt).toISOString() : new Date().toISOString();
    const statisticsOnly = payload.statisticsOnly === true || coverage === "partial";
    const nextProgress = nextReviewProgress(ownedCard, result);
    const learningProgress = nextLearningProgress(ownedCard, { kind: payload.learningKind, result, hinted: payload.hintUsed, fullCoverage: coverage === "full", statisticsOnly, at: reviewedAt });
    const shouldAutoArchive = payload.learningKind === "full" && result === "correct" && !ownedCard.archivedAt && !statisticsOnly && completedLearningStages(learningProgress);
    const nextReviewStage = ownedCard.archivedAt && result === "correct"
      ? nextArchiveReviewStage(ownedCard.archiveReviewStage)
      : 0;
    const archiveUpdate = result === "incorrect" && ownedCard.archivedAt
      ? { archivedAt: null, archiveReviewStage: 0, archiveReviewDueAt: null }
      : ownedCard.archivedAt && result === "correct"
        ? {
          archivedAt: ownedCard.archivedAt,
          archiveReviewStage: nextReviewStage,
          archiveReviewDueAt: archiveReviewDueAt(reviewedAt, nextReviewStage),
        }
        : shouldAutoArchive
          ? {
            archivedAt: reviewedAt,
            archiveReviewStage: 0,
            archiveReviewDueAt: archiveReviewDueAt(reviewedAt, 0),
          }
          : {};
    const countUpdate = result === "correct"
      ? {
        correctCount: sql<number>`${cards.correctCount} + 1`,
        ...nextProgress,
      }
      : {
        ...nextProgress,
      };

    await db.batch([
      db.insert(reviews).values({
        cardId, ownerEmail, mode, result,
        typedAnswer: payload.typedAnswer?.trim() || null,
        eventId, reviewedAt, coverage, keywordIds, statisticsOnly,
        learningKind: payload.learningKind ?? null, hintUsed: payload.hintUsed ?? false,
      }).onConflictDoNothing(),
      db.update(cards).set(statisticsOnly
        ? { ...learningProgress }
        : { ...countUpdate, ...archiveUpdate, ...learningProgress, lastReviewedAt: reviewedAt, updatedAt: reviewedAt })
        // In the same transaction, a replayed event must not advance any count.
        .where(and(eq(cards.id, cardId), eq(cards.ownerEmail, ownerEmail), sql`changes() > 0`)),
    ]);

    const [savedCard] = await db
      .select({
        correctCount: cards.correctCount,
        incorrectCount: cards.incorrectCount,
        correctStreak: cards.correctStreak,
        masteryStreak: cards.masteryStreak,
        keywordSuccessStreak: cards.keywordSuccessStreak,
        fullWriteSuccessStreak: cards.fullWriteSuccessStreak,
        keywordLastSucceededAt: cards.keywordLastSucceededAt,
        lastReviewedAt: cards.lastReviewedAt,
        archivedAt: cards.archivedAt,
        archiveReviewStage: cards.archiveReviewStage,
        archiveReviewDueAt: cards.archiveReviewDueAt,
      })
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.ownerEmail, ownerEmail)))
      .limit(1);
    if (!savedCard) return Response.json({ error: "카드를 찾지 못했습니다." }, { status: 404 });

    return Response.json({
      saved: true,
      reviewedAt: savedCard.lastReviewedAt ?? reviewedAt,
      lastReviewedAt: savedCard.lastReviewedAt,
      correctCount: savedCard.correctCount,
      incorrectCount: savedCard.incorrectCount,
      correctStreak: savedCard.correctStreak,
      masteryStreak: savedCard.masteryStreak,
      keywordSuccessStreak: savedCard.keywordSuccessStreak,
      fullWriteSuccessStreak: savedCard.fullWriteSuccessStreak,
      keywordLastSucceededAt: savedCard.keywordLastSucceededAt,
      archivedAt: savedCard.archivedAt,
      archiveReviewStage: savedCard.archiveReviewStage,
      archiveReviewDueAt: savedCard.archiveReviewDueAt,
    });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

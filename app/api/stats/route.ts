import { and, desc, eq } from "drizzle-orm";
import { getDb, getRawDb } from "../../../db";
import { dailyStudyStats, koreanStudyDay, type DailySubjectStatsRow } from "../../../lib/daily-study-stats";
import { DAILY_STUDY_QUERY } from "../../../lib/daily-study-query";
import { cards, connectionStats, keywordStats, studyRuns } from "../../../db/schema";
import { toApiError } from "../../../lib/api-errors";
import { getOwnerEmail, unauthorized } from "../../../lib/auth";

type StudyRunAttempt = {
  cardId: number;
  question: string;
  result: "correct" | "incorrect";
  durationMs: number;
};

type StudyRunPayload = {
  eventId?: string;
  subject?: string;
  attempts?: Array<Partial<StudyRunAttempt>>;
};

function parseAttempts(value: string): StudyRunAttempt[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StudyRunAttempt => {
      if (!item || typeof item !== "object") return false;
      const attempt = item as Partial<StudyRunAttempt>;
      return Number.isInteger(attempt.cardId)
        && typeof attempt.question === "string"
        && (attempt.result === "correct" || attempt.result === "incorrect")
        && typeof attempt.durationMs === "number"
        && Number.isFinite(attempt.durationMs);
    });
  } catch {
    return [];
  }
}

async function getStats(ownerEmail: string) {
  const db = getDb();
  const [runs, storedKeywordStats, storedConnectionStats] = await Promise.all([
    db
      .select()
      .from(studyRuns)
      .where(eq(studyRuns.ownerEmail, ownerEmail))
      .orderBy(desc(studyRuns.completedAt), desc(studyRuns.id)),
    db
      .select()
      .from(keywordStats)
      .where(eq(keywordStats.ownerEmail, ownerEmail)),
    db
      .select()
      .from(connectionStats)
      .where(eq(connectionStats.ownerEmail, ownerEmail)),
  ]);

  const summaries = new Map<string, {
    subject: string;
    completionCount: number;
    latestAccuracy: number;
    averageAccuracy: number;
    averageDurationMs: number;
    latestCompletedAt: string;
    latestAttempts: StudyRunAttempt[];
    totalCount: number;
    correctCount: number;
    totalDurationMs: number;
  }>();
  const cardPerformance = new Map<number, {
    attempts: number;
    incorrect: number;
    totalDurationMs: number;
    lastAttemptedAt: string;
  }>();
  for (const run of runs) {
    const attempts = parseAttempts(run.attempts);
    const existing = summaries.get(run.subject);
    if (!existing) {
      summaries.set(run.subject, {
        subject: run.subject,
        completionCount: 1,
        latestAccuracy: run.totalCount ? Math.round((run.correctCount / run.totalCount) * 100) : 0,
        averageAccuracy: 0,
        averageDurationMs: 0,
        latestCompletedAt: run.completedAt,
        latestAttempts: attempts,
        totalCount: run.totalCount,
        correctCount: run.correctCount,
        totalDurationMs: run.totalDurationMs,
      });
    } else {
      existing.completionCount += 1;
      existing.totalCount += run.totalCount;
      existing.correctCount += run.correctCount;
      existing.totalDurationMs += run.totalDurationMs;
    }

    for (const attempt of attempts) {
      const performance = cardPerformance.get(attempt.cardId);
      if (!performance) {
        cardPerformance.set(attempt.cardId, {
          attempts: 1,
          incorrect: attempt.result === "incorrect" ? 1 : 0,
          totalDurationMs: attempt.durationMs,
          lastAttemptedAt: run.completedAt,
        });
      } else {
        performance.attempts += 1;
        performance.incorrect += attempt.result === "incorrect" ? 1 : 0;
        performance.totalDurationMs += attempt.durationMs;
      }
    }
  }

  const normalizedSummaries = [...summaries.values()].map((summary) => ({
    subject: summary.subject,
    completionCount: summary.completionCount,
    latestAccuracy: summary.latestAccuracy,
    averageAccuracy: summary.totalCount ? Math.round((summary.correctCount / summary.totalCount) * 100) : 0,
    averageDurationMs: summary.totalCount ? Math.round(summary.totalDurationMs / summary.totalCount) : 0,
    latestCompletedAt: summary.latestCompletedAt,
    latestAttempts: summary.latestAttempts,
  }));

  return {
    summaries: normalizedSummaries,
    cardPerformance: Object.fromEntries([...cardPerformance.entries()].map(([cardId, performance]) => [cardId, {
      attempts: performance.attempts,
      incorrect: performance.incorrect,
      averageDurationMs: Math.round(performance.totalDurationMs / performance.attempts),
      lastAttemptedAt: performance.lastAttemptedAt,
    }])),
    keywordPerformance: storedKeywordStats.reduce<Record<string, Array<{
      keywordKey: string;
      keyword: string;
      attempts: number;
      correct: number;
      incorrect: number;
      accuracy: number;
      lastAttemptedAt: string | null;
    }>>>((result, item) => {
      const cardId = String(item.cardId);
      const current = result[cardId] ?? [];
      current.push({
        keywordKey: item.keywordKey,
        keyword: item.keyword,
        attempts: item.attempts,
        correct: item.correctCount,
        incorrect: Math.max(0, item.attempts - item.correctCount),
        accuracy: item.attempts ? Math.round((item.correctCount / item.attempts) * 100) : 0,
        lastAttemptedAt: item.lastAttemptedAt,
      });
      result[cardId] = current;
      return result;
    }, {}),
    connectionPerformance: Object.fromEntries(storedConnectionStats.map((item) => [String(item.cardId), {
      attempts: item.attempts,
      connected: item.connectedCount,
      connectivity: item.attempts ? Math.round((item.connectedCount / item.attempts) * 100) : 0,
      lastAttemptedAt: item.lastAttemptedAt,
    }])),
  };
}

export async function GET(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    if (new URL(request.url).searchParams.get("daily") === "1") {
      const now = new Date();
      const day = koreanStudyDay(now);
      const rows = await getRawDb().prepare(DAILY_STUDY_QUERY)
        .bind(ownerEmail, day.start, day.end).all<DailySubjectStatsRow>();
      return Response.json({ daily: dailyStudyStats(rows.results ?? [], now) }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ stats: await getStats(ownerEmail) });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return unauthorized();

  try {
    const payload = (await request.json()) as StudyRunPayload;
    const eventId = payload.eventId?.trim() ?? "";
    const subject = payload.subject?.trim() ?? "";
    const attempts = payload.attempts;
    if (
      eventId.length < 8
      || eventId.length > 100
      || !subject
      || subject.length > 80
      || !Array.isArray(attempts)
      || attempts.length < 1
      || attempts.length > 1000
      || attempts.some((attempt) =>
        !Number.isInteger(attempt.cardId)
        || Number(attempt.cardId) <= 0
        || (attempt.result !== "correct" && attempt.result !== "incorrect")
        || typeof attempt.durationMs !== "number"
        || !Number.isFinite(attempt.durationMs)
        || attempt.durationMs < 0
        || attempt.durationMs > 600_000
      )
    ) {
      return Response.json({ error: "실전 완주 기록이 올바르지 않습니다." }, { status: 400 });
    }

    const db = getDb();
    const ownedCards = await db
      .select({ id: cards.id, question: cards.question })
      .from(cards)
      .where(and(eq(cards.ownerEmail, ownerEmail), eq(cards.subject, subject)));
    const ownedById = new Map(ownedCards.map((card) => [card.id, card]));
    const cardIds = attempts.map((attempt) => Number(attempt.cardId));
    if (new Set(cardIds).size !== cardIds.length || cardIds.some((cardId) => !ownedById.has(cardId))) {
      return Response.json({ error: "해당 과목의 카드만 완주 기록에 넣을 수 있습니다." }, { status: 400 });
    }

    const normalizedAttempts: StudyRunAttempt[] = attempts.map((attempt) => ({
      cardId: Number(attempt.cardId),
      question: ownedById.get(Number(attempt.cardId))?.question ?? "",
      result: attempt.result as "correct" | "incorrect",
      durationMs: Math.round(Number(attempt.durationMs)),
    }));
    const completedAt = new Date().toISOString();
    const correctCount = normalizedAttempts.filter((attempt) => attempt.result === "correct").length;
    const totalDurationMs = normalizedAttempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);

    await db.insert(studyRuns).values({
      ownerEmail,
      eventId,
      subject,
      totalCount: normalizedAttempts.length,
      correctCount,
      totalDurationMs,
      attempts: JSON.stringify(normalizedAttempts),
      completedAt,
    }).onConflictDoNothing({ target: [studyRuns.ownerEmail, studyRuns.eventId] });

    return Response.json({ saved: true, stats: await getStats(ownerEmail) });
  } catch (error) {
    return Response.json({ error: toApiError(error) }, { status: 500 });
  }
}

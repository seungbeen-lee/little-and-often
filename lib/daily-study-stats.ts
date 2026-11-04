export type DailySubjectStats = {
  subject: string;
  learnedCardCount: number;
  learnedCardIds: number[];
  attempts: number;
  correctCount: number;
  accuracy: number | null;
};

export type DailyStudyStats = Omit<DailySubjectStats, "subject" | "learnedCardIds"> & {
  date: string;
  subjects: DailySubjectStats[];
};

export type DailySubjectStatsRow = Omit<DailySubjectStats, "accuracy" | "learnedCardIds"> & {
  learnedCardIds?: string;
};

export function koreanStudyDay(now = new Date()) {
  const offsetMs = 9 * 60 * 60 * 1000;
  const date = new Date(now.getTime() + offsetMs).toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00+09:00`);
  return { date, start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

export function dailyStudyStats(rows: DailySubjectStatsRow[], now = new Date()): DailyStudyStats {
  const subjects = rows.map((row) => ({
    ...row,
    learnedCardIds: JSON.parse(row.learnedCardIds ?? "[]") as number[],
    accuracy: row.attempts ? Math.round(row.correctCount / row.attempts * 100) : null,
  }));
  const totals = subjects.reduce((sum, row) => ({
    learnedCardCount: sum.learnedCardCount + row.learnedCardCount,
    attempts: sum.attempts + row.attempts,
    correctCount: sum.correctCount + row.correctCount,
  }), { learnedCardCount: 0, attempts: 0, correctCount: 0 });
  return { date: koreanStudyDay(now).date, ...totals, accuracy: totals.attempts ? Math.round(totals.correctCount / totals.attempts * 100) : null, subjects };
}

export function subjectStudiedToday(
  subject: string,
  cards: ReadonlyArray<{ id: number; subject: string; archivedAt: string | null }>,
  daily: DailyStudyStats | null | undefined,
  now = new Date(),
) {
  if (!daily || daily.date !== koreanStudyDay(now).date) return false;
  const activeCards = cards.filter((card) => card.subject === subject && !card.archivedAt);
  const learnedIds = new Set(daily.subjects.flatMap((row) => row.learnedCardIds ?? []));
  return activeCards.length > 0 && activeCards.every((card) => learnedIds.has(card.id));
}

export function dailyAccuracyLabel(accuracy: number | null | undefined) {
  return accuracy == null ? "—" : `${accuracy}%`;
}

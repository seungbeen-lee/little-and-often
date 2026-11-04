export const AUTO_ARCHIVE_MASTERY_STREAK = 3;
export const ARCHIVE_REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;

type ReviewProgress = {
  incorrectCount: number;
  correctStreak: number;
  masteryStreak: number;
};

export function nextReviewProgress(current: ReviewProgress, result: "correct" | "incorrect"): ReviewProgress {
  if (result === "incorrect") {
    return {
      incorrectCount: current.incorrectCount + 1,
      correctStreak: 0,
      masteryStreak: 0,
    };
  }

  if (current.incorrectCount > 1) {
    return {
      incorrectCount: current.incorrectCount - 1,
      correctStreak: 0,
      masteryStreak: 0,
    };
  }

  if (current.incorrectCount === 1) {
    return current.correctStreak >= 1
      ? { incorrectCount: 0, correctStreak: 0, masteryStreak: 0 }
      : { incorrectCount: 1, correctStreak: 1, masteryStreak: 0 };
  }

  return {
    incorrectCount: 0,
    correctStreak: 0,
    masteryStreak: current.masteryStreak + 1,
  };
}

export function isAutoArchiveReady(progress: ReviewProgress) {
  return progress.incorrectCount === 0
    && progress.masteryStreak >= AUTO_ARCHIVE_MASTERY_STREAK;
}

export function nextArchiveReviewStage(currentStage: number) {
  const normalized = Number.isFinite(currentStage) ? Math.max(0, Math.floor(currentStage)) : 0;
  return Math.min(normalized + 1, ARCHIVE_REVIEW_INTERVAL_DAYS.length - 1);
}

export function archiveReviewDueAt(from: string | Date, stage: number) {
  const base = from instanceof Date ? new Date(from) : new Date(from);
  const normalizedStage = Math.min(
    Math.max(0, Number.isFinite(stage) ? Math.floor(stage) : 0),
    ARCHIVE_REVIEW_INTERVAL_DAYS.length - 1
  );
  base.setUTCDate(base.getUTCDate() + ARCHIVE_REVIEW_INTERVAL_DAYS[normalizedStage]);
  return base.toISOString();
}

export function isArchiveReviewDue(archivedAt: string | null, dueAt: string | null, now = Date.now()) {
  if (!archivedAt || !dueAt) return false;
  const due = Date.parse(dueAt);
  return Number.isFinite(due) && due <= now;
}

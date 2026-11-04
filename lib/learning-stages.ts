export const KEYWORD_STAGE_TARGET = 3;
export const FULL_WRITE_STAGE_TARGET = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
// Exam preparation uses a shorter window through November 6 (Korea time).
export const LEARNING_WINDOW_CHANGE_AT = Date.parse("2026-11-07T00:00:00+09:00");
export function learningRetentionDays(now = Date.now()) {
  return now < LEARNING_WINDOW_CHANGE_AT ? 3 : 7;
}
export type LearningKind = "practice" | "keyword" | "full";
export type LearningStage = "keyword" | "full" | "archive";
export type LearningProgress = {
  keywordSuccessStreak?: number;
  fullWriteSuccessStreak?: number;
  keywordLastSucceededAt?: string | null;
};

export function currentLearningProgress(progress: LearningProgress & { archivedAt?: string | null }, now = Date.now()): Required<LearningProgress> {
  const last = Date.parse(progress.keywordLastSucceededAt ?? "");
  const expired = !progress.archivedAt && (progress.keywordSuccessStreak ?? 0) > 0
    && (!Number.isFinite(last) || now - last > learningRetentionDays(now) * DAY_MS);
  return {
    keywordSuccessStreak: expired ? 0 : progress.keywordSuccessStreak ?? 0,
    fullWriteSuccessStreak: expired ? 0 : progress.fullWriteSuccessStreak ?? 0,
    keywordLastSucceededAt: expired ? null : progress.keywordLastSucceededAt ?? null,
  };
}

export function learningStage(progress: LearningProgress & { archivedAt?: string | null }, now = Date.now()): LearningStage {
  if (progress.archivedAt) return "archive";
  return currentLearningProgress(progress, now).keywordSuccessStreak >= KEYWORD_STAGE_TARGET ? "full" : "keyword";
}

export function nextLearningProgress(current: LearningProgress & { archivedAt?: string | null }, attempt: {
  kind?: LearningKind; result: "correct" | "incorrect"; hinted?: boolean;
  fullCoverage: boolean; statisticsOnly: boolean; at: string;
}): Required<LearningProgress> {
  const next = currentLearningProgress(current, Date.parse(attempt.at));
  if (!attempt.kind || !attempt.fullCoverage) return next;
  if (current.archivedAt) {
    if (attempt.result === "incorrect" && !attempt.statisticsOnly) {
      next.keywordSuccessStreak = 0;
      next.fullWriteSuccessStreak = 0;
      next.keywordLastSucceededAt = null;
    }
    return next;
  }
  if (attempt.kind === "practice") return next;
  if (attempt.kind === "keyword") {
    if (attempt.hinted || attempt.result === "incorrect") {
      next.keywordSuccessStreak = 0;
      next.fullWriteSuccessStreak = 0;
      next.keywordLastSucceededAt = null;
    } else if (!attempt.statisticsOnly) {
      next.keywordSuccessStreak = Math.min(KEYWORD_STAGE_TARGET, next.keywordSuccessStreak + 1);
      next.keywordLastSucceededAt = attempt.at;
    }
  } else if (next.keywordSuccessStreak >= KEYWORD_STAGE_TARGET) {
    if (attempt.result === "incorrect" || attempt.hinted) next.fullWriteSuccessStreak = 0;
    else if (!attempt.statisticsOnly) next.fullWriteSuccessStreak = Math.min(FULL_WRITE_STAGE_TARGET, next.fullWriteSuccessStreak + 1);
  }
  return next;
}

export function completedLearningStages(progress: LearningProgress) {
  return (progress.keywordSuccessStreak ?? 0) >= KEYWORD_STAGE_TARGET
    && (progress.fullWriteSuccessStreak ?? 0) >= FULL_WRITE_STAGE_TARGET;
}

export function learningStageLabel(progress: LearningProgress & { archivedAt?: string | null }, now = Date.now()) {
  const stage = learningStage(progress, now), current = currentLearningProgress(progress, now);
  if (stage === "archive") return "보관 복습";
  if (stage === "keyword") return `키워드 ${current.keywordSuccessStreak}/${KEYWORD_STAGE_TARGET}`;
  return `전체 쓰기 ${current.fullWriteSuccessStreak}/${FULL_WRITE_STAGE_TARGET}`;
}

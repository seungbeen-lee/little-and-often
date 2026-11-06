"use client";

import { FormEvent, Fragment, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMobileTableLayout, useVisibleViewport } from "@/components/use-visible-viewport";
import { clearManualEditorBold, toggleCaretBold, usePlainEditorTyping } from "@/components/use-plain-editor-typing";
import { copyCardSelection } from "@/lib/editor-clipboard";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  BarChart3,
  Bold,
  Italic,
  BrainCircuit,
  BookOpen,
  LibraryBig,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Cloud,
  CornerDownRight,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  FolderHeart,
  GripVertical,
  KeyRound,
  Layers3,
  Lightbulb,
  Pencil,
  Play,
  Pause,
  Plus,
  Redo2,
  RotateCcw,
  Rows3,
  Search,
  Star,
  Trash2,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { extractBoldKeywords, normalizeAnswerFormat, normalizeImportance, normalizeQuestionFormat } from "@/lib/card-data";
import { dailyAccuracyLabel, koreanStudyDay, subjectStudiedToday, type DailyStudyStats } from "@/lib/daily-study-stats";
import { advanceTodayReview } from "@/lib/today-review";
import { CARD_CONTENT_TYPES, DEFAULT_CARD_CONTENT_TYPE, normalizeCardContentType, type CardContentType } from "@/lib/card-content-types";
import { archiveReviewDueAt, isArchiveReviewDue, nextArchiveReviewStage, nextReviewProgress } from "@/lib/archive-schedule";
import { SITE_NAME } from "@/lib/site-branding";
import { filterLibrarySets } from "@/lib/set-library";
import { DaySettingButton, DaySettingProvider } from "@/components/day-setting";
import { ShortcutHelp, type ShortcutScreen } from "@/components/shortcut-help";
import { normalizeKeywordKey, type KeywordInheritanceChoice } from "@/lib/keyword-stats";
import { questionKeywordRanges } from "@/lib/question-mask";
import { answerKeywordRanges } from "@/lib/answer-mask";
import { isTableFormat, readTable, tableText, tableParts, tableKeywords, tableBlankOrder, tableBlankNavigation, tableNavigation, sortedCells, plainCell, normalizeBoldBrackets, normalizeBoldBullets, normalizeTableListKeywords, type TablePart, type TableTabOrder } from "@/lib/table-card";
import { TableAnswer, TableGrid, TableRegistration } from "@/components/table-card";
import { useEditorLists } from "@/components/use-editor-lists";
import { handleEditorListKey } from "@/lib/editor-lists";
import { CardImages, ImageField, ImageMoveProvider, PhotoAttachButton, PhotoViewerProvider, isPhotoInteraction, dismissPhotoLayer, useImageUploadGuard } from "@/components/card-images";
import { emptyMedia, normalizeMedia, moveCardImage, type CardMedia, type CardImage, type MediaField } from "@/lib/card-media";
import { captureTextFocus, restoreTextFocus, type TextFocus } from "@/lib/editor-focus";
import { desktopEditorSelection, selectEditorItems } from "@/lib/editor-selection";

import { completedLearningStages, learningStage, learningStageLabel, nextLearningProgress, type LearningKind, type LearningProgress, type LearningStage } from "@/lib/learning-stages";
import { deferMobileAnswerScroll, revealMobileStudyInput, useMobileStudyViewport } from "@/components/use-mobile-study-viewport";

type StudyCard = LearningProgress & {
  id: number;
  subject: string;
  contentType: CardContentType;
  section: string;
  subsection: string;
  detailSection: string;
  area: string;
  importance: number;
  question: string;
  questionFormat: string;
  answer: string;
  answerFormat: string;
  memo: string;
  media: CardMedia;
  keywords: string[];
  sortOrder: number;
  correctCount: number;
  incorrectCount: number;
  correctStreak: number;
  masteryStreak: number;
  lastReviewedAt: string | null;
  archivedAt: string | null;
  archiveReviewStage: number;
  archiveReviewDueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CardDraft = Pick<StudyCard, "subject" | "contentType" | "section" | "subsection" | "detailSection" | "area" | "importance" | "question" | "questionFormat" | "answer" | "answerFormat" | "memo" | "media">;

export function cardWithReviewContent(card: StudyCard | null, reviewed: StudyCard | null): StudyCard | null {
  if (!card || !reviewed || card.id !== reviewed.id) return card;
  // Keep the graded question stable, but let stars and learning counts stay live.
  return { ...card, question: reviewed.question, questionFormat: reviewed.questionFormat,
    answer: reviewed.answer, answerFormat: reviewed.answerFormat, keywords: reviewed.keywords, memo: reviewed.memo, media: normalizeMedia(reviewed.media) };
}

export function remainingStudySequence(orderedIds: number[], startCardId: number, savedSequence?: number[]) {
  const savedIds = savedSequence?.length ? new Set(savedSequence) : null;
  // Restore the displayed order, including saves rotated by older versions.
  const sequence = orderedIds.filter((id) => !savedIds || savedIds.has(id));
  const startIndex = sequence.indexOf(startCardId);
  return startIndex < 0 ? [] : sequence.slice(startIndex);
}
type StudySet = {
  id: number;
  subject: string;
  name: string;
  memo: string;
  cardIds: number[];
  createdAt: string;
  updatedAt: string;
};
type StudyMode = "reveal" | "write";
type FlowSetStep = "idle" | "select" | "details";
type StudySessionMode = "real" | "practice";
type StudyRound = "main" | "mistake-review" | "today-review";
type StudyRecordReason = "manual" | "question-timeout";
type SectionPath = Pick<StudyCard, "section" | "subsection" | "detailSection">;
type MobileFlowLevel = "section" | "subsection" | "detail";
type MobileFlowItem =
  | { type: "section"; id: string; subject: string; section: string; subsection: string; detailSection: string; cardCount: number; changeLevel: MobileFlowLevel }
  | { type: "card"; id: string; card: StudyCard; cardNumber: number };
type MobileFlowJumpItem = { id: string; level: MobileFlowLevel; label: string; itemIndex: number };
type LearningRangeLevel = keyof SectionPath;
type LearningContentType = "all" | Extract<CardContentType, "교육과정" | "수업모형" | "각론">;
type SectionAnnouncement = SectionPath & { changed: Record<keyof SectionPath, boolean>; setInfo?: { name: string; memo: string } };
const SELECTED_SETS_VIEW = "선택한 비교 세트";
type QuizReason = "recommended" | "archive-review" | "keyword-review";
type QuizItem = { cardId: number; reason: QuizReason; keyword?: string; keywordKey?: string };
type QuizRound = "main" | "retry";
type QuizAnswerOrder = boolean | readonly number[];
type TodayReviewRetry = { source: string; parts: ClozePart[]; order: QuizAnswerOrder };
type QuizHintStage = 1 | 2;
type QuizBlankHint = { stage: QuizHintStage; keyword: string; text: string; keywordKey?: string; revision?: number };
type QuizCardHints = Partial<Record<number, QuizBlankHint>>;
type ClozePart = TablePart;
type StudyRunAttempt = {
  cardId: number;
  question: string;
  result: "correct" | "incorrect";
  durationMs: number;
};
type PendingStudyRun = {
  eventId: string;
  subject: string;
  attempts: StudyRunAttempt[];
};
type SubjectStudyStats = {
  subject: string;
  completionCount: number;
  latestAccuracy: number;
  averageAccuracy: number;
  averageDurationMs: number;
  latestCompletedAt: string;
  latestAttempts: StudyRunAttempt[];
};
type CardStudyPerformance = {
  attempts: number;
  incorrect: number;
  averageDurationMs: number;
  lastAttemptedAt: string;
};
type KeywordStudyPerformance = {
  keywordKey?: string;
  keyword: string;
  attempts: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  lastAttemptedAt: string | null;
};
type ConnectionPerformance = {
  attempts: number;
  connected: number;
  connectivity: number;
  lastAttemptedAt: string | null;
};

type PendingKeywordInheritance = {
  cardId: number;
  question: string;
  signature: string;
  choices: KeywordInheritanceChoice[];
};
type StudyStats = {
  summaries: SubjectStudyStats[];
  cardPerformance: Record<string, CardStudyPerformance>;
  keywordPerformance: Record<string, KeywordStudyPerformance[]>;
  connectionPerformance: Record<string, ConnectionPerformance>;
};

function emptyStudyStats(): StudyStats {
  return { summaries: [], cardPerformance: {}, keywordPerformance: {}, connectionPerformance: {} };
}
type BulkRow =
  | { id: string; type: "card"; cardId: number | null; contentType: CardContentType; area: string; question: string; questionFormat: string; answer: string; answerFormat: string; memo: string; media: CardMedia; important: boolean }
  | { id: string; type: "divider"; level: 1 | 2 | 3; title: string };
type BulkCardRow = Extract<BulkRow, { type: "card" }>;
type BulkFocusKind = "answer" | "content-type" | "divider" | "memo" | "question";
type BulkDragMetrics = { width: number; grabOffsetX: number };

const IMPORTANT_VIEW = "__important__";
const INCORRECT_VIEW = "__incorrect__";
const ARCHIVED_VIEW = "__archived__";
const SET_VIEW_PREFIX = "__set__:";
const STUDY_PROGRESS_PREFIX = "teacher-study-progress:";
const PENDING_REVIEWS_KEY = "teacher-study-pending-reviews";
const PENDING_STUDY_RUNS_KEY = "teacher-study-pending-runs";
const PENDING_KEYWORD_ATTEMPTS_KEY = "teacher-study-pending-keyword-attempts";
const PENDING_CONNECTION_ATTEMPTS_KEY = "teacher-study-pending-connection-attempts";
const BULK_DRAFT_PREFIX = "teacher-study-card-draft:";
const STUDY_SESSION_MODE_KEY = "teacher-study-session-mode";
const TABLE_TAB_ORDER_KEY = "teacher-study-table-tab-order";
const LAST_CARD_CONTENT_TYPE_KEY = "teacher-study-last-card-content-type";
const QUIZ_THINKING_TIME_SECONDS = 20;
const WEAK_KEYWORD_MIN_ATTEMPTS = 3;
const WEAK_KEYWORD_MIN_INCORRECT = 2;
const WEAK_KEYWORD_MIN_ERROR_RATE = .6;
const LEARNING_CONTENT_TYPE_OPTIONS: Array<{ value: LearningContentType; label: string }> = [
  { value: "all", label: "전체" },
  { value: "교육과정", label: "교육과정" },
  { value: "수업모형", label: "학습모형" },
  { value: "각론", label: "각론" },
];

type SavedStudyProgress = { nextCardId: number | null; sequenceIds: number[]; sessionMode?: StudySessionMode | null; updatedAt: string };

export function savedStudySessionMode(value: unknown): StudySessionMode | null {
  return value === "real" || value === "practice" ? value : null;
}
type PendingReview = {
  learningKind?: LearningKind;
  hintUsed?: boolean;
  tableKeywordIds?: string[];
  eventId: string;
  cardId: number;
  mode: StudyMode;
  result: "correct" | "incorrect";
  typedAnswer: string;
  statisticsOnly?: boolean;
  attemptedAt?: string;
};
type PendingKeywordAttempt = {
  eventId: string;
  cardId: number;
  results: Array<{ keyword: string; matched: boolean; keywordKey?: string }>;
};
type PendingConnectionAttempt = {
  eventId: string;
  cardId: number;
  connected: boolean;
};
type ReviewResponse = LearningProgress & {
  saved: true;
  lastReviewedAt?: string | null;
  reviewedAt: string;
  correctCount: number;
  incorrectCount: number;
  correctStreak: number;
  masteryStreak: number;
  archivedAt: string | null;
  archiveReviewStage: number;
  archiveReviewDueAt: string | null;
};

type QueuedReviewResult = {
  request: Promise<boolean>;
};

export function learningCardIdsForSection(cards: StudyCard[], cardId: number, level: LearningRangeLevel) {
  const anchor = cards.find((card) => card.id === cardId);
  if (!anchor) return [];

  const matches = (card: StudyCard) => {
    if (card.subject !== anchor.subject || card.section !== anchor.section) return false;
    if (level === "section") return true;
    if (card.subsection !== anchor.subsection) return false;
    if (level === "subsection") return true;
    return card.detailSection === anchor.detailSection;
  };

  return cards.filter(matches).map((card) => card.id);
}

export function learningCardsForContentType<T extends Pick<StudyCard, "contentType">>(cards: T[], contentType: LearningContentType) {
  return contentType === "all" ? cards : cards.filter((card) => card.contentType === contentType);
}

function reviewEventId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readPendingReviews(): PendingReview[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_REVIEWS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingReview => {
      if (!item || typeof item !== "object") return false;
      const value = item as Partial<PendingReview>;
      return typeof value.eventId === "string"
        && typeof value.cardId === "number"
        && Number.isInteger(value.cardId)
        && value.cardId > 0
        && (value.mode === "reveal" || value.mode === "write")
        && (value.result === "correct" || value.result === "incorrect")
        && typeof value.typedAnswer === "string";
    }).slice(-100);
  } catch {
    return [];
  }
}

function rememberPendingReview(review: PendingReview) {
  try {
    const pending = readPendingReviews().filter((item) => item.eventId !== review.eventId);
    window.localStorage.setItem(PENDING_REVIEWS_KEY, JSON.stringify([...pending, review].slice(-100)));
  } catch {
    // 서버 전송은 계속 시도해요.
  }
}

function forgetPendingReview(eventId: string) {
  try {
    const pending = readPendingReviews().filter((item) => item.eventId !== eventId);
    if (pending.length) window.localStorage.setItem(PENDING_REVIEWS_KEY, JSON.stringify(pending));
    else window.localStorage.removeItem(PENDING_REVIEWS_KEY);
  } catch {
    // 다음 실행 때 서버의 중복 방지가 같은 기록을 다시 세는 일을 막아요.
  }
}

function sendReviewResult(review: PendingReview) {
  return api<ReviewResponse>("/api/reviews", {
    method: "POST",
    keepalive: true,
    body: JSON.stringify(review),
  });
}

function readPendingKeywordAttempts(): PendingKeywordAttempt[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_KEYWORD_ATTEMPTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingKeywordAttempt => {
      if (!item || typeof item !== "object") return false;
      const attempt = item as Partial<PendingKeywordAttempt>;
      return typeof attempt.eventId === "string"
        && Number.isInteger(attempt.cardId)
        && Number(attempt.cardId) > 0
        && Array.isArray(attempt.results)
        && attempt.results.length > 0
        && attempt.results.every((result) => typeof result.keyword === "string" && typeof result.matched === "boolean");
    }).slice(-100);
  } catch {
    return [];
  }
}

function rememberPendingKeywordAttempt(attempt: PendingKeywordAttempt) {
  try {
    const pending = readPendingKeywordAttempts().filter((item) => item.eventId !== attempt.eventId);
    window.localStorage.setItem(PENDING_KEYWORD_ATTEMPTS_KEY, JSON.stringify([...pending, attempt].slice(-100)));
  } catch {
    // 서버 전송은 계속 시도해요.
  }
}

function forgetPendingKeywordAttempt(eventId: string) {
  try {
    const pending = readPendingKeywordAttempts().filter((item) => item.eventId !== eventId);
    if (pending.length) window.localStorage.setItem(PENDING_KEYWORD_ATTEMPTS_KEY, JSON.stringify(pending));
    else window.localStorage.removeItem(PENDING_KEYWORD_ATTEMPTS_KEY);
  } catch {
    // 서버의 중복 방지가 같은 기록이 두 번 쌓이는 일을 막아요.
  }
}

function sendKeywordAttempt(attempt: PendingKeywordAttempt) {
  return api<{ saved: true; cardId: number; keywordPerformance: KeywordStudyPerformance[] }>("/api/keyword-stats", {
    method: "POST",
    keepalive: true,
    body: JSON.stringify(attempt),
  });
}

function readPendingConnectionAttempts(): PendingConnectionAttempt[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_CONNECTION_ATTEMPTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingConnectionAttempt => {
      if (!item || typeof item !== "object") return false;
      const attempt = item as Partial<PendingConnectionAttempt>;
      return typeof attempt.eventId === "string"
        && Number.isInteger(attempt.cardId)
        && Number(attempt.cardId) > 0
        && typeof attempt.connected === "boolean";
    }).slice(-100);
  } catch {
    return [];
  }
}

function rememberPendingConnectionAttempt(attempt: PendingConnectionAttempt) {
  try {
    const pending = readPendingConnectionAttempts().filter((item) => item.eventId !== attempt.eventId);
    window.localStorage.setItem(PENDING_CONNECTION_ATTEMPTS_KEY, JSON.stringify([...pending, attempt].slice(-100)));
  } catch {
    // 서버 전송은 계속 시도해요.
  }
}

function forgetPendingConnectionAttempt(eventId: string) {
  try {
    const pending = readPendingConnectionAttempts().filter((item) => item.eventId !== eventId);
    if (pending.length) window.localStorage.setItem(PENDING_CONNECTION_ATTEMPTS_KEY, JSON.stringify(pending));
    else window.localStorage.removeItem(PENDING_CONNECTION_ATTEMPTS_KEY);
  } catch {
    // 서버의 중복 방지가 같은 기록이 두 번 쌓이는 일을 막아요.
  }
}

function sendConnectionAttempt(attempt: PendingConnectionAttempt) {
  return api<{ saved: true; cardId: number; connection: ConnectionPerformance }>("/api/connections", {
    method: "POST",
    keepalive: true,
    body: JSON.stringify(attempt),
  });
}

function readPendingStudyRuns(): PendingStudyRun[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_STUDY_RUNS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingStudyRun => {
      if (!item || typeof item !== "object") return false;
      const run = item as Partial<PendingStudyRun>;
      return typeof run.eventId === "string"
        && typeof run.subject === "string"
        && Array.isArray(run.attempts)
        && run.attempts.length > 0;
    }).slice(-20);
  } catch {
    return [];
  }
}

function rememberPendingStudyRun(run: PendingStudyRun) {
  try {
    const pending = readPendingStudyRuns().filter((item) => item.eventId !== run.eventId);
    window.localStorage.setItem(PENDING_STUDY_RUNS_KEY, JSON.stringify([...pending, run].slice(-20)));
  } catch {
    // 서버 저장은 계속 시도해요.
  }
}

function forgetPendingStudyRun(eventId: string) {
  try {
    const pending = readPendingStudyRuns().filter((item) => item.eventId !== eventId);
    if (pending.length) window.localStorage.setItem(PENDING_STUDY_RUNS_KEY, JSON.stringify(pending));
    else window.localStorage.removeItem(PENDING_STUDY_RUNS_KEY);
  } catch {
    // 중복 방지 식별자가 같은 완주 기록을 다시 세는 일을 막아요.
  }
}

function sendStudyRun(run: PendingStudyRun) {
  return api<{ saved: true; stats: StudyStats }>("/api/stats", {
    method: "POST",
    keepalive: true,
    body: JSON.stringify(run),
  });
}

function mergeReviewResponse(source: StudyCard[], cardId: number, response: ReviewResponse) {
  return source.map((card) => card.id === cardId ? {
    ...card,
    correctCount: response.correctCount,
    incorrectCount: response.incorrectCount,
    correctStreak: response.correctStreak,
    masteryStreak: response.masteryStreak,
    keywordSuccessStreak: response.keywordSuccessStreak,
    fullWriteSuccessStreak: response.fullWriteSuccessStreak,
    keywordLastSucceededAt: response.keywordLastSucceededAt,
    lastReviewedAt: response.lastReviewedAt !== undefined ? response.lastReviewedAt : response.reviewedAt,
    archivedAt: response.archivedAt,
    archiveReviewStage: response.archiveReviewStage,
    archiveReviewDueAt: response.archiveReviewDueAt,
  } : card);
}

function studyProgressKey(subject: string, section: string, area: string, importance: string, reviewOrder: string) {
  return `${STUDY_PROGRESS_PREFIX}${JSON.stringify([subject, section, area, importance, reviewOrder])}`;
}

function readLocalStudyProgress(key: string): SavedStudyProgress | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<SavedStudyProgress> | null;
    if (!parsed || (parsed.nextCardId !== null && (typeof parsed.nextCardId !== "number" || !Number.isInteger(parsed.nextCardId) || parsed.nextCardId <= 0))) return null;
    if (!Array.isArray(parsed.sequenceIds) || !parsed.sequenceIds.every((id) => Number.isInteger(id) && id > 0)) return null;
    if (!parsed.updatedAt || Number.isNaN(Date.parse(parsed.updatedAt))) return null;
    return { nextCardId: parsed.nextCardId ?? null, sequenceIds: parsed.sequenceIds, sessionMode: savedStudySessionMode(parsed.sessionMode), updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

function writeLocalStudyProgress(key: string, progress: SavedStudyProgress) {
  try {
    window.localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // 서버 동기화는 계속 시도해요.
  }
}

function syncStudyProgress(key: string, progress: SavedStudyProgress) {
  return api<{ saved: true }>("/api/progress", {
    method: "POST",
    keepalive: true,
    body: JSON.stringify({
      contextKey: key,
      progress: progress.nextCardId === null ? null : progress,
    }),
  });
}

function setStudyValue(setId: number) {
  return `${SET_VIEW_PREFIX}${setId}`;
}

function setIdFromStudyValue(value: string) {
  if (!value.startsWith(SET_VIEW_PREFIX)) return null;
  const id = Number(value.slice(SET_VIEW_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function groupCardsBySets(source: StudyCard[], sets: StudySet[], universe = source) {
  const cardsById = new Map(universe.map((card) => [card.id, card]));
  const sourceOrder = new Map(universe.map((card, index) => [card.id, index]));
  const setsByCardId = new Map<number, StudySet[]>();

  for (const set of sets) {
    for (const cardId of set.cardIds) {
      if (!cardsById.has(cardId)) continue;
      const memberships = setsByCardId.get(cardId) ?? [];
      memberships.push(set);
      setsByCardId.set(cardId, memberships);
    }
  }

  const grouped: StudyCard[] = [];
  const included = new Set<number>();
  for (const seed of source) {
    if (included.has(seed.id)) continue;
    const queue = [seed.id];
    for (let index = 0; index < queue.length; index += 1) {
      const cardId = queue[index];
      const card = cardsById.get(cardId);
      if (!card || included.has(cardId)) continue;
      included.add(cardId);
      grouped.push(card);
      for (const set of setsByCardId.get(cardId) ?? []) {
        const orderedMemberIds = set.cardIds
          .filter((memberId) => cardsById.has(memberId))
          .sort((a, b) => (sourceOrder.get(a) ?? 0) - (sourceOrder.get(b) ?? 0));
        for (const memberId of orderedMemberIds) {
          if (cardsById.has(memberId) && !included.has(memberId) && !queue.includes(memberId)) queue.push(memberId);
        }
      }
    }
  }
  return grouped;
}

export function mobileFlowItemsForCards(cards: StudyCard[]): MobileFlowItem[] {
  const items: MobileFlowItem[] = [];
  let previousCard: StudyCard | null = null;
  cards.forEach((card, cardIndex) => {
    const context = `${card.subject}|${card.section}|${card.subsection}|${card.detailSection}`;
    const previousContext = previousCard
      ? `${previousCard.subject}|${previousCard.section}|${previousCard.subsection}|${previousCard.detailSection}`
      : "";
    if (context !== previousContext) {
      const changeLevel: MobileFlowLevel = !previousCard || card.subject !== previousCard.subject || card.section !== previousCard.section
        ? "section"
        : card.subsection !== previousCard.subsection
          ? "subsection"
          : "detail";
      let cardCount = 0;
      for (let index = cardIndex; index < cards.length; index += 1) {
        const next = cards[index];
        const nextContext = `${next.subject}|${next.section}|${next.subsection}|${next.detailSection}`;
        if (nextContext !== context) break;
        cardCount += 1;
      }
      items.push({
        type: "section",
        id: `section-${card.id}-${cardIndex}`,
        subject: card.subject,
        section: card.section,
        subsection: card.subsection,
        detailSection: card.detailSection,
        cardCount,
        changeLevel,
      });
    }
    items.push({ type: "card", id: `card-${card.id}`, card, cardNumber: cardIndex + 1 });
    previousCard = card;
  });
  return items;
}

export function mobileFlowJumpItemsFor(items: MobileFlowItem[]): MobileFlowJumpItem[] {
  const jumpItems: MobileFlowJumpItem[] = [];
  const seen = new Set<string>();
  items.forEach((item, itemIndex) => {
    if (item.type !== "section") return;
    const paths: Array<{ level: MobileFlowLevel; label: string; key: string }> = [
      { level: "section", label: item.section || "미분류", key: `${item.subject}|${item.section}` },
      ...(item.subsection ? [{ level: "subsection" as const, label: item.subsection, key: `${item.subject}|${item.section}|${item.subsection}` }] : []),
      ...(item.detailSection ? [{ level: "detail" as const, label: item.detailSection, key: `${item.subject}|${item.section}|${item.subsection}|${item.detailSection}` }] : []),
    ];
    paths.forEach((path) => {
      const id = `${path.level}-${path.key}`;
      if (seen.has(id)) return;
      seen.add(id);
      jumpItems.push({ id, level: path.level, label: path.label, itemIndex });
    });
  });
  return jumpItems;
}

const mobileFlowTitleScale: Record<MobileFlowLevel, { scale: number; minSize: number }> = {
  section: { scale: 1, minSize: 10 },
  subsection: { scale: 0.84, minSize: 9 },
  detail: { scale: 0.7, minSize: 8 },
};

export function mobileFlowTitleFontSize(value: string, level: MobileFlowLevel = "section", maxSize = 34, availableWidth = 218) {
  const visualUnits = Array.from(value.trim()).reduce((total, character) => {
    if (character === " ") return total + 0.45;
    return total + (/[ᄀ-ᇿ㄰-㆏가-힯]/i.test(character) ? 1 : 0.62);
  }, 0);
  const { scale, minSize } = mobileFlowTitleScale[level];
  const hierarchyMaxSize = Math.round(maxSize * scale);
  const oneLineSize = Math.floor((availableWidth * scale) / Math.max(visualUnits, 1));
  return Math.max(minSize, Math.min(hierarchyMaxSize, oneLineSize));
}

function mobileFlowLevelLabel(level: MobileFlowLevel) {
  if (level === "section") return "섹션";
  if (level === "subsection") return "하부";
  return "세부";
}

const subjectGroups: Array<{ label: string; subjects: Array<string | null> }> = [
  { label: "교육과정 A", subjects: ["총론", "국어", "사회", "실과", "창체", "영어", "도덕", null] },
  { label: "교육과정 B", subjects: ["통합교과", "수학", "미술", "체육", null, "과학", "음악", null] },
];
const elementarySubjects = subjectGroups
  .flatMap((group) => group.subjects)
  .filter((subject): subject is string => Boolean(subject));

export function subjectColorIndex(subject: string, subjects: readonly string[] = elementarySubjects) {
  for (const [groupIndex, group] of subjectGroups.entries()) {
    const index = group.subjects.indexOf(subject);
    if (index >= 0) return groupIndex * 8 + index + 1;
  }
  const index = subjects.filter((item) => !elementarySubjects.includes(item)).indexOf(subject);
  return Math.max(0, index) % 4 + 1;
}

let bulkRowSequence = 0;

function bulkRowId() {
  bulkRowSequence += 1;
  return `bulk-${Date.now()}-${bulkRowSequence}`;
}

function readLastCardContentType(): CardContentType {
  if (typeof window === "undefined") return DEFAULT_CARD_CONTENT_TYPE;
  try {
    return normalizeCardContentType(window.localStorage.getItem(LAST_CARD_CONTENT_TYPE_KEY) ?? DEFAULT_CARD_CONTENT_TYPE);
  } catch {
    return DEFAULT_CARD_CONTENT_TYPE;
  }
}

function rememberLastCardContentType(contentType: CardContentType) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CARD_CONTENT_TYPE_KEY, contentType);
  } catch {
    // 최근 분류를 기억하지 못해도 카드 입력과 저장은 계속 작동해요.
  }
}

function newCardRow(area = "", contentType: CardContentType = DEFAULT_CARD_CONTENT_TYPE): BulkCardRow {
  return { id: bulkRowId(), type: "card", cardId: null, contentType, area, question: "", questionFormat: "", answer: "", answerFormat: "", memo: "", media: emptyMedia(), important: false };
}

export function duplicateBulkCardRow(source: BulkCardRow): BulkCardRow {
  return { ...source, id: bulkRowId(), cardId: null, media: normalizeMedia(source.media) };
}

export function bulkSectionPathAtIndex(rows: BulkRow[], index: number): SectionPath {
  let section = "기본";
  let subsection = "";
  let detailSection = "";
  for (const row of rows.slice(0, Math.max(0, index))) {
    if (row.type !== "divider") continue;
    if (row.level === 1) {
      section = row.title || "기본";
      subsection = "";
      detailSection = "";
    } else if (row.level === 2) {
      subsection = row.title;
      detailSection = "";
    } else {
      detailSection = row.title;
    }
  }
  return { section, subsection, detailSection };
}

function bulkRowGroupEnd(rows: BulkRow[], startIndex: number) {
  const source = rows[startIndex];
  if (!source || source.type === "card") return startIndex + 1;

  let endIndex = startIndex + 1;
  while (endIndex < rows.length) {
    const row = rows[endIndex];
    if (row.type === "divider" && row.level <= source.level) break;
    endIndex += 1;
  }
  return endIndex;
}

function bulkRowMovePlan(rows: BulkRow[], sourceId: string, targetId: string) {
  const sourceIndex = rows.findIndex((row) => row.id === sourceId);
  const rawTargetIndex = rows.findIndex((row) => row.id === targetId);
  if (sourceIndex < 0 || rawTargetIndex < 0 || sourceId === targetId) return null;

  const source = rows[sourceIndex];
  const sourceEnd = bulkRowGroupEnd(rows, sourceIndex);
  if (rawTargetIndex >= sourceIndex && rawTargetIndex < sourceEnd) return null;

  let targetStart = rawTargetIndex;
  if (source.type === "divider") {
    targetStart = -1;
    for (let index = rawTargetIndex; index >= 0; index -= 1) {
      const candidate = rows[index];
      if (candidate.type !== "divider") continue;
      if (candidate.level < source.level) break;
      if (candidate.level === source.level) {
        targetStart = index;
        break;
      }
    }
    if (targetStart < 0 || (targetStart >= sourceIndex && targetStart < sourceEnd)) return null;
  }

  const targetEnd = source.type === "divider" ? bulkRowGroupEnd(rows, targetStart) : targetStart + 1;
  const insertionIndex = sourceIndex < targetStart ? targetEnd : targetStart;
  return { sourceIndex, sourceEnd, insertionIndex };
}

export function bulkDropPreviewIndex(rows: BulkRow[], sourceId: string, targetId: string) {
  return bulkRowMovePlan(rows, sourceId, targetId)?.insertionIndex ?? null;
}

export function bulkDropTargetForGap(rows: BulkRow[], sourceId: string, gapIndex: number) {
  const sourceIndex = rows.findIndex((row) => row.id === sourceId);
  if (sourceIndex < 0 || gapIndex < 0 || gapIndex > rows.length) return null;
  const sourceEnd = bulkRowGroupEnd(rows, sourceIndex);
  if (gapIndex >= sourceIndex && gapIndex <= sourceEnd) return null;
  const targetIndex = gapIndex < sourceIndex ? gapIndex : gapIndex - 1;
  const target = rows[targetIndex];
  if (!target) return null;
  return bulkDropPreviewIndex(rows, sourceId, target.id) === gapIndex ? target.id : null;
}

export function isBulkDropLineHit(lineY: number, pointerY: number, hitRange = 18) {
  return Math.abs(pointerY - lineY) <= hitRange;
}

export function isBulkDropCenterHit(lineLeft: number, lineWidth: number, pointerX: number, activeRatio = .2) {
  const activeWidth = lineWidth * activeRatio;
  const activeLeft = lineLeft + (lineWidth - activeWidth) / 2;
  return pointerX >= activeLeft && pointerX <= activeLeft + activeWidth;
}

export function bulkDragGhostLeft(pointerX: number, tableWidth: number, grabOffsetX: number, viewportWidth: number, padding = 12) {
  return Math.max(padding, Math.min(pointerX - grabOffsetX, viewportWidth - tableWidth - padding));
}

function bulkDragMetrics(handle: HTMLElement, pointerX: number): BulkDragMetrics {
  const tableBounds = handle.closest<HTMLElement>(".bulk-table")?.getBoundingClientRect();
  if (!tableBounds) return { width: 360, grabOffsetX: 28 };
  return {
    width: tableBounds.width,
    grabOffsetX: Math.max(0, Math.min(pointerX - tableBounds.left, tableBounds.width)),
  };
}

function isBulkInsertionTargetHit(element: HTMLElement, pointerX: number, pointerY: number, activeRatio = .2) {
  const bounds = element.getBoundingClientRect();
  return isBulkDropCenterHit(bounds.left, bounds.width, pointerX, activeRatio)
    && isBulkDropLineHit(bounds.top, pointerY);
}

export function moveBulkRowGroup(rows: BulkRow[], sourceId: string, targetId: string) {
  const plan = bulkRowMovePlan(rows, sourceId, targetId);
  if (!plan) return rows;

  const { sourceIndex, sourceEnd, insertionIndex } = plan;
  const movedRows = rows.slice(sourceIndex, sourceEnd);
  const remaining = [...rows.slice(0, sourceIndex), ...rows.slice(sourceEnd)];
  const adjustedInsertionIndex = insertionIndex - (sourceIndex < insertionIndex ? movedRows.length : 0);
  remaining.splice(adjustedInsertionIndex, 0, ...movedRows);
  return remaining;
}

export function collapsedBulkRowIds(rows: BulkRow[], collapsedDividerIds: ReadonlySet<string>) {
  const hiddenRowIds = new Set<string>();
  rows.forEach((row, rowIndex) => {
    if (row.type !== "divider" || !collapsedDividerIds.has(row.id)) return;
    const groupEnd = bulkRowGroupEnd(rows, rowIndex);
    rows.slice(rowIndex + 1, groupEnd).forEach((child) => hiddenRowIds.add(child.id));
  });
  return hiddenRowIds;
}

export function visibleBulkRowIds(rows: BulkRow[], collapsedDividerIds: ReadonlySet<string>) {
  const hiddenRowIds = collapsedBulkRowIds(rows, collapsedDividerIds);
  return rows.filter((row) => !hiddenRowIds.has(row.id)).map((row) => row.id);
}

export function adjacentBulkDividerId(rows: BulkRow[], sourceId: string, direction: "up" | "down") {
  const sourceIndex = rows.findIndex((row) => row.id === sourceId);
  const source = rows[sourceIndex];
  if (!source || source.type !== "divider") return null;

  if (direction === "up") {
    for (let index = sourceIndex - 1; index >= 0; index -= 1) {
      const candidate = rows[index];
      if (candidate.type !== "divider") continue;
      if (candidate.level < source.level) return null;
      if (candidate.level === source.level) return candidate.id;
    }
    return null;
  }

  for (let index = bulkRowGroupEnd(rows, sourceIndex); index < rows.length; index += 1) {
    const candidate = rows[index];
    if (candidate.type !== "divider") continue;
    if (candidate.level < source.level) return null;
    if (candidate.level === source.level) return candidate.id;
  }
  return null;
}

export function contentTypeStripeClass(contentType: CardContentType) {
  return ({
    교육과정: "content-type-curriculum",
    교과교육론: "content-type-theory",
    각론: "content-type-subject",
    수업모형: "content-type-model",
    지도서총론: "content-type-other",
  } as const)[contentType];
}

function rowsFromCards(cards: StudyCard[], defaultContentType: CardContentType = DEFAULT_CARD_CONTENT_TYPE): BulkRow[] {
  const sorted = [...cards].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  if (!sorted.length) return [newCardRow("", defaultContentType)];

  const rows: BulkRow[] = [];
  let currentSection = "";
  let currentSubsection = "";
  let currentDetailSection = "";
  for (const card of sorted) {
    if (card.section !== currentSection) {
      currentSection = card.section;
      currentSubsection = "";
      currentDetailSection = "";
      rows.push({ id: bulkRowId(), type: "divider", level: 1, title: currentSection });
    }
    if (!card.subsection && currentSubsection) {
      currentSubsection = "";
      currentDetailSection = "";
      rows.push({ id: bulkRowId(), type: "divider", level: 1, title: currentSection });
    }
    if (card.subsection && card.subsection !== currentSubsection) {
      currentSubsection = card.subsection;
      currentDetailSection = "";
      rows.push({ id: bulkRowId(), type: "divider", level: 2, title: currentSubsection });
    }
    if (!card.detailSection && currentDetailSection) {
      currentDetailSection = "";
      rows.push({ id: bulkRowId(), type: "divider", level: 2, title: currentSubsection });
    }
    if (card.detailSection && card.detailSection !== currentDetailSection) {
      currentDetailSection = card.detailSection;
      rows.push({ id: bulkRowId(), type: "divider", level: 3, title: currentDetailSection });
    }
    rows.push({
      id: bulkRowId(),
      type: "card",
      cardId: card.id,
      contentType: normalizeCardContentType(card.contentType),
      area: card.area,
      question: card.question,
      questionFormat: card.questionFormat,
      answer: card.answer,
      answerFormat: formatAnswerFromKeywords(card.answer, card.answerFormat, card.keywords),
      memo: card.memo,
      media: normalizeMedia(card.media),
      important: card.importance >= 2,
    });
  }
  return rows;
}

function bulkSnapshot(subject: string, rows: BulkRow[]) {
  return JSON.stringify({
    subject,
    rows: rows.map((row) => row.type === "divider"
      ? { type: row.type, level: row.level, title: row.title }
      : {
          type: row.type,
          cardId: row.cardId,
          contentType: row.contentType,
          area: row.area,
          question: row.question,
          questionFormat: row.questionFormat,
          answer: row.answer,
          answerFormat: row.answerFormat,
          memo: row.memo,
          media: normalizeMedia(row.media),
          important: row.important,
        }),
  });
}

type StoredBulkDraft = { subject: string; rows: BulkRow[]; updatedAt: string };

function bulkDraftKey(subject: string) {
  return `${BULK_DRAFT_PREFIX}${subject}`;
}

function readBulkDraft(subject: string): StoredBulkDraft | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(bulkDraftKey(subject)) ?? "null") as Partial<StoredBulkDraft> | null;
    if (!parsed || parsed.subject !== subject || !Array.isArray(parsed.rows) || parsed.rows.length > 100 || !parsed.updatedAt || Number.isNaN(Date.parse(parsed.updatedAt))) {
      return null;
    }
    const validRows = parsed.rows.filter((row) => {
      if (!row || typeof row !== "object" || typeof row.id !== "string") return false;
      if (row.type === "divider") return (row.level === 1 || row.level === 2 || row.level === 3) && typeof row.title === "string";
      return row.type === "card"
        && (row.cardId === null || (typeof row.cardId === "number" && Number.isInteger(row.cardId) && row.cardId > 0))
        && typeof row.area === "string"
        && typeof row.question === "string"
        && typeof row.questionFormat === "string"
        && typeof row.answer === "string"
        && typeof row.answerFormat === "string"
        && typeof row.memo === "string"
        && typeof row.important === "boolean";
    });
    if (validRows.length !== parsed.rows.length || !validRows.some((row) => row.type === "card")) return null;
    const rows = validRows.map((row): BulkRow => row.type === "divider"
      ? row
      : { ...row, contentType: normalizeCardContentType(row.contentType), media: normalizeMedia(row.media) });
    return { subject, rows, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

function writeBulkDraft(subject: string, rows: BulkRow[]) {
  try {
    const draft: StoredBulkDraft = { subject, rows, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(bulkDraftKey(subject), JSON.stringify(draft));
  } catch {
    // 임시 복구 저장이 막혀도 서버 자동 저장은 계속 작동해요.
  }
}

function clearBulkDraft(subject: string) {
  try {
    window.localStorage.removeItem(bulkDraftKey(subject));
  } catch {
    // 이미 서버에 저장된 뒤라 닫기를 막지 않아요.
  }
}

const emptyDraft: CardDraft = {
  media: emptyMedia(),
  subject: "",
  contentType: DEFAULT_CARD_CONTENT_TYPE,
  section: "교육과정",
  subsection: "",
  detailSection: "",
  area: "",
  importance: 1,
  question: "",
  questionFormat: "",
  answer: "",
  answerFormat: "",
  memo: "",
};

function draftFromCard(card: StudyCard | null, defaultContentType: CardContentType = DEFAULT_CARD_CONTENT_TYPE): CardDraft {
  return card
    ? {
        subject: card.subject,
        contentType: normalizeCardContentType(card.contentType),
        section: card.section,
        subsection: card.subsection,
        detailSection: card.detailSection,
        area: card.area,
        importance: normalizeImportance(card.importance),
        question: card.question,
        questionFormat: card.questionFormat,
        answer: card.answer,
        answerFormat: formatAnswerFromKeywords(card.answer, card.answerFormat, card.keywords),
        memo: card.memo,
        media: normalizeMedia(card.media),
      }
    : { ...emptyDraft, contentType: defaultContentType };
}

function keywordSplitChoices(previousKeywords: string[], nextKeywords: string[]): KeywordInheritanceChoice[] {
  const next = nextKeywords.map((keyword) => ({ keyword, key: normalizeKeywordKey(keyword) })).filter((item) => item.key);
  return previousKeywords.flatMap((sourceKeyword) => {
    const sourceKey = normalizeKeywordKey(sourceKeyword);
    const targets = next.filter((item) =>
      item.key !== sourceKey && item.key.length >= 2 && sourceKey.includes(item.key)
    );
    if (targets.length < 2) return [];
    const targetKeywords = targets.map((item) => item.keyword);
    return [{ sourceKeyword, targetKeywords, selectedTargetKeywords: targetKeywords }];
  });
}

function keywordInheritanceSignature(cardId: number, choices: KeywordInheritanceChoice[]) {
  return JSON.stringify({
    cardId,
    choices: choices.map((choice) => ({
      source: normalizeKeywordKey(choice.sourceKeyword),
      targets: choice.targetKeywords.map(normalizeKeywordKey).sort(),
    })),
  });
}

function toggleKeywordInheritanceTarget(
  choices: KeywordInheritanceChoice[],
  sourceKeyword: string,
  targetKeyword: string,
  checked: boolean
) {
  return choices.map((choice) => {
    if (choice.sourceKeyword !== sourceKeyword) return choice;
    const selected = new Set(choice.selectedTargetKeywords);
    if (checked) selected.add(targetKeyword);
    else selected.delete(targetKeyword);
    return { ...choice, selectedTargetKeywords: choice.targetKeywords.filter((keyword) => selected.has(keyword)) };
  });
}

const importanceLabel: Record<1 | 2, string> = { 1: "일반", 2: "중요" };

function plainFormattedText(format: string) {
  const table = readTable(format);
  if (table) return tableText(table);
  return format.replace(/\[\/?(?:u|i|b|accent)\]/g, "");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatToHtml(format: string, fallback: string) {
  return escapeHtml(format || fallback)
    .replaceAll("[u]", "<u>")
    .replaceAll("[/u]", "</u>")
    .replaceAll("[i]", "<em>")
    .replaceAll("[/i]", "</em>")
    .replaceAll("[b]", "<strong>")
    .replaceAll("[/b]", "</strong>")
    .replaceAll("[accent]", "<strong>")
    .replaceAll("[/accent]", "</strong>")
    .replaceAll("\n", "<br>");
}

function childNodesToFormat(parent: Node): string {
  let result = "";

  for (const child of parent.childNodes) {
    const isLineBlock = child instanceof HTMLElement
      && (child.tagName === "DIV" || child.tagName === "P");

    if (isLineBlock && result && !result.endsWith("\n")) result += "\n";
    result += nodeToFormat(child);
    if (isLineBlock && result && !result.endsWith("\n")) result += "\n";
  }

  return result;
}

function nodeToFormat(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";

  if (node.tagName === "BR") return "\n";
  const inner = childNodesToFormat(node);
  const fontWeight = Number.parseInt(node.style.fontWeight, 10);
  const isBold = node.tagName === "B" || node.tagName === "STRONG" || node.style.fontWeight === "bold" || fontWeight >= 600;
  const isUnderlined = node.tagName === "U" || node.style.textDecoration.includes("underline");
  let formatted = inner;
  if (isBold) formatted = `[b]${formatted}[/b]`;
  if (isUnderlined) formatted = `[u]${formatted}[/u]`;
  if (node.tagName === "I" || node.tagName === "EM" || node.style.fontStyle === "italic") formatted = `[i]${formatted}[/i]`;
  return formatted;
}

function renderFormattedText(format: string, fallback: string, answer = false, renderText?: (text: string, offset: number) => React.ReactNode) {
  const table = readTable(format);
  if (table) return <TableAnswer doc={table} />;
  const source = format || fallback;
  const tokens = source.split(/(\[\/?(?:u|i|b|accent)\])/g).filter(Boolean);
  type Frame = { kind: "root" | "u" | "i" | "b"; children: React.ReactNode[] };
  const stack: Frame[] = [{ kind: "root", children: [] }];
  let key = 0;
  let textOffset = 0;

  for (const token of tokens) {
    const opening = token.match(/^\[(u|i|b|accent)\]$/);
    const closing = token.match(/^\[\/(u|i|b|accent)\]$/);
    if (opening) {
      stack.push({ kind: opening[1] === "u" ? "u" : opening[1] === "i" ? "i" : "b", children: [] });
      continue;
    }
    const closingKind = closing?.[1] === "u" ? "u" : closing?.[1] === "i" ? "i" : "b";
    if (closing && stack.length > 1 && stack.at(-1)?.kind === closingKind) {
      const frame = stack.pop()!;
      key += 1;
      stack.at(-1)!.children.push(
        frame.kind === "u"
          ? <u key={`text-format-${key}`}>{frame.children}</u>
          : frame.kind === "i" ? <em key={`text-format-${key}`}>{frame.children}</em>
          : <strong className={answer ? "answer-keyword" : undefined} key={`text-format-${key}`}>{frame.children}</strong>
      );
      continue;
    }
    stack.at(-1)!.children.push(renderText ? renderText(token, textOffset) : token);
    textOffset += token.length;
  }

  while (stack.length > 1) {
    const frame = stack.pop()!;
    stack.at(-1)!.children.push(...frame.children);
  }
  return <span onCopy={event => copyCardSelection(event, event.currentTarget)}>{stack[0].children}</span>;
}

function renderQuestionText(format: string, text: string, hiddenKeywords: readonly string[] = [], revealedKeywords: readonly string[] = [], guidedPractice = false): React.ReactNode {
  if (!hiddenKeywords.length) return renderFormattedText(format, text);
  const table = readTable(format);
  if (table) return <TableGrid doc={table} renderCell={(cell) => renderQuestionText(cell.format, plainCell(cell.format), hiddenKeywords, revealedKeywords, guidedPractice)} />;
  const plain = plainFormattedText(format || text);
  const ranges = questionKeywordRanges(plain, hiddenKeywords);
  const revealed = new Set(revealedKeywords.map(normalizeKeywordKey));
  if (!ranges.length) return renderFormattedText(format, text);
  return renderFormattedText(format, text, false, (value, start) => {
    const end = start + value.length;
    let cursor = start;
    const result: React.ReactNode[] = [];
    for (const range of ranges) {
      if (range.end <= start || range.start >= end) continue;
      if (range.start > cursor) result.push(value.slice(cursor - start, range.start - start));
      if (range.start >= start) {
        const keyword = plain.slice(range.start, range.end);
        const matched = revealed.has(normalizeKeywordKey(keyword));
        result.push(<span key={`question-mask-${range.start}`} className={`question-keyword-blank ${matched ? "is-correct" : "is-missed"}${guidedPractice && !matched ? " has-guide" : ""}`} aria-label={matched || guidedPractice ? undefined : "정답 키워드 빈칸"}>{matched || guidedPractice ? keyword : null}</span>);
      }
      cursor = Math.min(end, range.end);
    }
    if (cursor < end) result.push(value.slice(cursor - start));
    return result;
  });
}

export function StudyQuestionText({ text, format, images, hiddenKeywords, revealedKeywords, guidedPractice = false }: { text: string; format: string; images?: CardImage[]; hiddenKeywords?: readonly string[]; revealedKeywords?: readonly string[]; guidedPractice?: boolean }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const maskKey = `${hiddenKeywords?.join("\0") ?? ""}|${revealedKeywords?.join("\0") ?? ""}`;

  useLayoutEffect(() => {
    const element = textRef.current;
    const panel = element?.closest<HTMLElement>(".question-panel");
    if (!element || !panel) return;

    let animationFrame = 0;
    const fitText = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        element.style.removeProperty("font-size");
        if (images?.length || !window.matchMedia("(max-width: 759px)").matches) return;

        let fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
        while (panel.scrollHeight > panel.clientHeight && fontSize > 13) {
          fontSize -= 0.5;
          element.style.fontSize = `${fontSize}px`;
        }
      });
    };

    fitText();
    const observer = new ResizeObserver(fitText);
    observer.observe(panel);
    window.visualViewport?.addEventListener("resize", fitText);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", fitText);
    };
  }, [format, text, images, maskKey, guidedPractice]);

  return (
    <p ref={textRef} className={text.length > 125 ? "is-extra-long" : text.length > 75 ? "is-long" : undefined}>
      <CardImages images={images} position="before" />
      {renderQuestionText(format, text, hiddenKeywords, revealedKeywords, guidedPractice)}
      <CardImages images={images} position="after" />
    </p>
  );
}

function formatAnswerFromKeywords(answer: string, answerFormat: string, keywords: string[]) {
  if (answerFormat || !keywords.length) return answerFormat;
  const escaped = [...keywords]
    .sort((a, b) => b.length - a.length)
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return "";
  return answer.replace(new RegExp(`(${escaped.join("|")})`, "gi"), "[b]$1[/b]");
}

type SavedEditorContent = { text: string; format: string; sourceFormat: string };

function editorFormat(editor: HTMLElement, answer: boolean) {
  const format = childNodesToFormat(editor).replace(/\n{3,}/g, "\n\n").replace(/\n$/, "");
  return answer ? normalizeTableListKeywords(format) : normalizeBoldBullets(normalizeBoldBrackets(format));
}

// Count logical line breaks as well as text, including browser-created DIV/P lines.
// Work on a clone so recording the caret never touches the live editing/IME DOM.
function formattedCaretOffset(editor: HTMLElement, node: Node, offset: number) {
  const path: number[] = [];
  for (let current = node; current !== editor; current = current.parentNode!) {
    path.unshift(Array.prototype.indexOf.call(current.parentNode!.childNodes, current));
  }
  const clone = editor.cloneNode(true);
  let target = clone;
  for (const index of path) target = target.childNodes[index];
  const marker = "\uFDD0";
  const range = document.createRange();
  range.setStart(target, offset);
  range.collapse(true);
  range.insertNode(document.createTextNode(marker));
  return plainFormattedText(childNodesToFormat(clone)).indexOf(marker);
}

function formattedCaretPosition(editor: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let remaining = Math.max(0, offset);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) {
      if (remaining <= (node.textContent?.length ?? 0)) return [node, remaining];
      remaining -= node.textContent?.length ?? 0;
    } else if (node.nodeName === "BR") {
      const index = Array.prototype.indexOf.call(node.parentNode!.childNodes, node);
      if (remaining <= 1) return [node.parentNode!, index + remaining];
      remaining -= 1;
    }
  }
  return [editor, editor.childNodes.length];
}

export function FormattedTextEditor({
  text,
  format,
  onChange,
  label,
  placeholder,
  allowUnderline = true,
  answer = false,
  compact = false,
  dataBulkQuestion,
  dataBulkAnswer,
  onTabAtEnd,
  onBlur,
  images,
  onImagesChange,
  onImageBusyChange,
  imagesDisabled,
  showTableButton = true,
  historyRevision = 0,
  savedContent,
  autoSave = false,
}: {
  text: string;
  format: string;
  onChange: (text: string, format: string) => void;
  label: string;
  placeholder: string;
  allowUnderline?: boolean;
  answer?: boolean;
  compact?: boolean;
  dataBulkQuestion?: string;
  dataBulkAnswer?: string;
  onTabAtEnd?: () => void;
  onBlur?: () => void;
  images?: CardImage[];
  onImagesChange?: (images: CardImage[]) => void;
  onImageBusyChange?: (busy: boolean) => void;
  imagesDisabled?: boolean;
  showTableButton?: boolean;
  historyRevision?: number;
  savedContent?: SavedEditorContent;
  autoSave?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  usePlainEditorTyping(editorRef, !isTableFormat(format));
  useEditorLists(editorRef, !isTableFormat(format));
  const lastHistoryRevisionRef = useRef(historyRevision);
  const composingRef = useRef(false);
  const [compositionRevision, setCompositionRevision] = useState(0);
  const boldRefreshPendingRef = useRef(false);
  const [boldRefreshAt, setBoldRefreshAt] = useState(0);

  function deferBoldRefresh() {
    if (boldRefreshPendingRef.current) setBoldRefreshAt(Date.now() + 1000);
  }

  function flushBoldRefreshOnBlur() {
    const editor = editorRef.current;
    if (!editor || composingRef.current || !boldRefreshPendingRef.current) return;
    // Show the current edit immediately without waiting for a save response or
    // adding another history entry. The existing save still owns persistence.
    const currentFormat = editorFormat(editor, answer);
    const currentText = plainFormattedText(currentFormat);
    const normalize = answer ? normalizeAnswerFormat : normalizeQuestionFormat;
    const html = formatToHtml(normalize(currentFormat, currentText) || currentFormat, currentText);
    if (editor.innerHTML !== html) {
      const restoreScroll = rememberHintScroll(editor);
      editor.innerHTML = html;
      restoreScroll();
    }
    setBoldRefreshAt(0);
  }

  useEffect(() => {
    const selectionChanged = () => {
      if (document.activeElement === editorRef.current && boldRefreshPendingRef.current) {
        setBoldRefreshAt(Date.now() + 1000);
      }
    };
    document.addEventListener("selectionchange", selectionChanged);
    return () => document.removeEventListener("selectionchange", selectionChanged);
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const restoringHistory = lastHistoryRevisionRef.current !== historyRevision;
    lastHistoryRevisionRef.current = historyRevision;
    if (!editor || composingRef.current) return;
    if (restoringHistory) { boldRefreshPendingRef.current = false; clearManualEditorBold(editor); }
    // A late save may acknowledge an older edit. Only refresh matching saved content;
    // also check the DOM, which can be ahead of React during input/composition events.
    const pendingBold = boldRefreshPendingRef.current;
    const refreshingSaved = pendingBold && savedContent?.text === text && savedContent?.format === format
      && (() => {
        const currentFormat = editorFormat(editor, answer);
        if (currentFormat === savedContent.sourceFormat) return true;
        // Another row can save again during the idle delay. Its acknowledgement
        // may already contain canonical formatting; compare with that same policy.
        const normalize = answer ? normalizeAnswerFormat : normalizeQuestionFormat;
        return normalize(currentFormat, plainFormattedText(currentFormat)) === format;
      })();
    if (!restoringHistory && pendingBold && !refreshingSaved) return;
    if (document.activeElement === editor && !restoringHistory && !(pendingBold && refreshingSaved)) return;
    const html = formatToHtml(format, text);
    const refresh = () => {
      boldRefreshPendingRef.current = false;
      if (editor.innerHTML === html) return;
      const selection = document.activeElement === editor ? window.getSelection() : null;
      const selectionOffsets = selection?.anchorNode && selection.focusNode
        && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)
        ? [formattedCaretOffset(editor, selection.anchorNode, selection.anchorOffset),
            formattedCaretOffset(editor, selection.focusNode, selection.focusOffset)] as const
        : null;
      const restoreScroll = rememberHintScroll(editor);
      editor.innerHTML = html;
      if (selectionOffsets && selection) {
        const [anchor, anchorOffset] = formattedCaretPosition(editor, selectionOffsets[0]);
        const [focus, focusOffset] = formattedCaretPosition(editor, selectionOffsets[1]);
        selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
      }
      restoreScroll();
    };
    if (!pendingBold || restoringHistory || document.activeElement !== editor) { refresh(); return; }
    // Saving still happens promptly; only the post-bold visual normalization waits.
    // Input, selection changes and another bold command restart this one timer.
    const timer = window.setTimeout(refresh, Math.max(0, boldRefreshAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [format, text, answer, historyRevision, savedContent, compositionRevision, boldRefreshAt]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) return;
    deferBoldRefresh();
    // The card/bulk answer editor must use the same keyword boundaries as table cells.
    // Normalize edits only; reading existing cards must not change learning identities.
    const keywordFormat = editorFormat(editor, answer);
    onChange(plainFormattedText(keywordFormat), keywordFormat);
  }

  function applyFormat(kind: "u" | "b" | "i") {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) || composingRef.current) return;
    if (range.collapsed) {
      if (kind === "b") toggleCaretBold(editor);
      else document.execCommand(kind === "u" ? "underline" : "italic");
      return;
    }
    if (kind === "b") clearManualEditorBold(editor);
    if (kind === "b" && autoSave) boldRefreshPendingRef.current = true;
    const before = kind === "b" ? editorFormat(editor, answer) : null;
    document.execCommand(kind === "b" ? "bold" : kind === "u" ? "underline" : "italic");
    // After a saved list is refreshed its markers are plain. Native bold treats
    // that as a mixed selection and can merely re-bold the excluded markers.
    // If no keyword formatting changed, the intended toggle is removal.
    if (before !== null && before === editorFormat(editor, answer)) document.execCommand("bold");
    emitChange();
  }

  function clearFormat() {
    const editor = editorRef.current;
    if (!editor) return;
    clearManualEditorBold(editor);
    const text = editor.innerText;
    editor.textContent = text;
    emitChange();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    deferBoldRefresh();
    if (handleEditorListKey(event)) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const shortcut = (event.metaKey || event.ctrlKey) && !event.altKey;
    const key = event.code === "KeyB" || event.key === "ㅠ" ? "b" : event.code === "KeyU" ? "u" : event.code === "KeyI" ? "i" : event.key.toLowerCase();
    if (shortcut && (key === "b" || key === "i" || (key === "u" && allowUnderline))) {
      event.preventDefault();
      event.stopPropagation();
      applyFormat(key as "b" | "u" | "i");
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && onTabAtEnd) {
      event.preventDefault();
      onTabAtEnd();
    }
  }

  const table = answer ? readTable(format) : null;
  const editor = table ? <div className="table-answer-editor" data-bulk-answer={dataBulkAnswer} data-bulk-row-id={dataBulkAnswer} data-bulk-focus-kind={dataBulkAnswer ? "answer" : undefined} tabIndex={0}>{showTableButton&&<TableRegistration key="table-registration" format={format} onChange={onChange} disabled={imagesDisabled}/>}<TableAnswer doc={table}/></div> : (
    <div className={`${answer ? "formatted-editor is-answer" : "formatted-editor is-question"}${compact ? " is-compact" : ""}`}>
      <div className="format-toolbar" aria-label={`${label} 서식 도구`}>
        <span>문구 선택 또는 커서에서</span>
        <Button type="button" variant="ghost" size="sm" tabIndex={-1} onPointerDown={(event) => { event.preventDefault(); applyFormat("b"); }}><Bold /> 굵게</Button>
        {allowUnderline && <Button type="button" variant="ghost" size="sm" tabIndex={-1} onPointerDown={(event) => { event.preventDefault(); applyFormat("u"); }}><Underline /> 밑줄</Button>}
        <Button type="button" variant="ghost" size="sm" tabIndex={-1} onPointerDown={(event) => { event.preventDefault(); applyFormat("i"); }}><Italic /> 기울임</Button>
        <Button type="button" variant="ghost" size="icon-sm" tabIndex={-1} aria-label={`${label} 서식 모두 지우기`} onPointerDown={(event) => { event.preventDefault(); clearFormat(); }}><Eraser /></Button>
      </div>
      {answer && showTableButton && <TableRegistration key="table-registration" format={format} onChange={onChange} disabled={imagesDisabled}/>}
      <div
        ref={editorRef}
        className="formatted-editor-input"
        data-editor-lists="true"
        contentEditable
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        data-placeholder={placeholder}
        data-bulk-question={dataBulkQuestion}
        data-bulk-answer={dataBulkAnswer}
        data-bulk-row-id={dataBulkQuestion ?? dataBulkAnswer}
        data-bulk-focus-kind={dataBulkQuestion ? "question" : dataBulkAnswer ? "answer" : undefined}
        suppressContentEditableWarning
        onInput={(event) => {
          if (autoSave && (event.nativeEvent as InputEvent).inputType === "formatBold") boldRefreshPendingRef.current = true;
          emitChange();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
          deferBoldRefresh();
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          emitChange();
          setCompositionRevision((revision) => revision + 1);
          if (document.activeElement !== editorRef.current) flushBoldRefreshOnBlur();
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => { flushBoldRefreshOnBlur(); onBlur?.(); }}
      />
    </div>
  );
  return onImagesChange ? <ImageField label={label} mediaField={answer ? "answer" : "question"} images={images} onChange={onImagesChange} compact={compact} onBusyChange={onImageBusyChange} disabled={imagesDisabled}>{editor}</ImageField> : editor;
}

function normalizeForMatch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

const HANGUL_INITIAL_SOUNDS = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
  "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

export function initialSoundHint(value: string) {
  const maskedLatinAndNumbers = value.normalize("NFC").replace(
    /[\p{Script=Latin}\p{N}]+/gu,
    (token) => [...token].map((character, index) => index === 0 ? character : "·").join("")
  );

  return [...maskedLatinAndNumbers].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0xac00 || codePoint > 0xd7a3) return character;
    return HANGUL_INITIAL_SOUNDS[Math.floor((codePoint - 0xac00) / 588)];
  }).join("");
}

export function firstCharacterHint(value: string) {
  return [...value.normalize("NFC")].find((character) => /[\p{L}\p{N}]/u.test(character)) ?? "";
}

function sameHangulInitial(actual: string, expected: string) {
  return /^[ㄱ-ㅎ가-힣]$/u.test(actual)
    && /^[가-힣]$/u.test(expected)
    && initialSoundHint(actual) === initialSoundHint(expected);
}

// A final consonant can still become the next syllable's initial (장 → 자유).
// Compare the actual Korean keystroke sequence, not only completed syllables.
function hangulTypingKeys(value: string) {
  const vowels = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅗㅏ", "ㅗㅐ", "ㅗㅣ", "ㅛ", "ㅜ", "ㅜㅓ", "ㅜㅔ", "ㅜㅣ", "ㅠ", "ㅡ", "ㅡㅣ", "ㅣ"];
  const finals = ["", "ㄱ", "ㄲ", "ㄱㅅ", "ㄴ", "ㄴㅈ", "ㄴㅎ", "ㄷ", "ㄹ", "ㄹㄱ", "ㄹㅁ", "ㄹㅂ", "ㄹㅅ", "ㄹㅌ", "ㄹㅍ", "ㄹㅎ", "ㅁ", "ㅂ", "ㅂㅅ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  return [...value].map(character => {
    const syllable = character.charCodeAt(0) - 0xac00;
    if (syllable < 0 || syllable > 11171) return character;
    return HANGUL_INITIAL_SOUNDS[Math.floor(syllable / 588)] + vowels[Math.floor(syllable % 588 / 28)] + finals[syllable % 28];
  }).join("");
}

function isPendingHangulPrefix(actual: string, remaining: string, composing: boolean) {
  const target = [...remaining][0] ?? "";
  if (!sameHangulInitial(actual, target)) return false;
  const typed = hangulTypingKeys(actual), expected = hangulTypingKeys(remaining);
  if (!expected.startsWith(typed)) return false;
  // Some mobile IMEs commit a temporary final consonant between composition
  // events. Keep its guide if it can migrate to the next expected syllable.
  return composing || typed.length > hangulTypingKeys(target).length
    || target.normalize("NFKD").startsWith(actual.normalize("NFKD"));
}

export function progressiveQuizHint(value: string, stage: QuizHintStage) {
  const normalized = [...value.normalize("NFC")];
  const firstIndex = normalized.findIndex((character) => /[\p{L}\p{N}]/u.test(character));
  if (firstIndex < 0) return "";
  if (stage === 1) return normalized[firstIndex];

  const initials = [...initialSoundHint(value)];
  initials[firstIndex] = normalized[firstIndex];
  return initials.join("");
}

export function planQuizHint(keyword: string, answer: string): { stage: QuizHintStage; answer: string } {
  const expected = [...keyword.normalize("NFC")].filter((character) => /[\p{L}\p{M}\p{N}]/u.test(character));
  const entered = answer.normalize("NFC").trimStart();
  let expectedIndex = 0;
  let enteredOffset = 0;
  let prefixEnd = 0;
  for (const character of entered) {
    enteredOffset += character.length;
    if (!/[\p{L}\p{M}\p{N}]/u.test(character)) continue;
    if (!expected[expectedIndex] || normalizeForMatch(character) !== normalizeForMatch(expected[expectedIndex])) break;
    expectedIndex += 1;
    prefixEnd = enteredOffset;
  }
  return expectedIndex > 0
    ? { stage: 2, answer: entered.slice(0, prefixEnd) }
    : { stage: 1, answer: "" };
}

export function remainingQuizHint(keyword: string, stage: QuizHintStage, answer: string, composing = false) {
  const hint = progressiveQuizHint(keyword, stage);
  const entered = [...answer.normalize("NFC")];
  if (stage === 1) return entered.some((character) => /[\p{L}\p{N}]/u.test(character)) ? "" : hint;

  const expected = [...keyword.normalize("NFC")];
  let expectedIndex = 0;
  for (let index = 0; index < entered.length; index += 1) {
    const character = entered[index];
    if (!/[\p{L}\p{N}]/u.test(character)) {
      if (expected[expectedIndex] === character) expectedIndex += 1;
      continue;
    }
    while (expectedIndex < expected.length && !/[\p{L}\p{N}]/u.test(expected[expectedIndex])) expectedIndex += 1;
    const expectedCharacter = expected[expectedIndex];
    if (!expectedCharacter) return "";
    const matches = normalizeForMatch(character) === normalizeForMatch(expectedCharacter);
    const composingLastSyllable = index === entered.length - 1
      && isPendingHangulPrefix(character, expected.slice(expectedIndex).filter(char => /[\p{L}\p{N}]/u.test(char)).join(""), composing);
    if (!matches && !composingLastSyllable) return "";
    expectedIndex += 1;
  }
  return [...hint].slice(expectedIndex).join("");
}

export function remainingCorrectionGuide(keyword: string, answer: string, composing = false) {
  const expected = [...keyword.normalize("NFC")];
  const entered = [...answer.normalize("NFC")];
  if (!entered.length) return keyword.normalize("NFC");
  let expectedIndex = 0;
  for (let index = 0; index < entered.length; index += 1) {
    const actual = entered[index];
    if (/[\s·]/u.test(actual)) {
      // Spaces and middle dots are optional; keep them until typed or skipped.
      while (/[\s·]/u.test(expected[expectedIndex] ?? "")) expectedIndex += 1;
      continue;
    }
    while (/[\s·]/u.test(expected[expectedIndex] ?? "")) expectedIndex += 1;
    const target = expected[expectedIndex];
    if (!target) return "";
    const composingLastSyllable = index === entered.length - 1
      && isPendingHangulPrefix(actual, expected.slice(expectedIndex).join("").replace(/[\s·]/gu, ""), composing)
      && (composing || hangulTypingKeys(actual).length > hangulTypingKeys(target).length);
    if (actual !== target && !composingLastSyllable) return "";
    expectedIndex += 1;
  }
  // Keep the next separator visible until typed or the next word is started.
  return expected.slice(expectedIndex).join("");
}

export function matchesGuidedCopy(expected: string, answer: string) {
  const withoutOptionalSeparators = (value: string) => value.normalize("NFC").replace(/[\s·]+/gu, "");
  return withoutOptionalSeparators(answer) === withoutOptionalSeparators(expected);
}

export function quizAttemptOutcome(round: QuizRound, correct: boolean, usedHint: boolean) {
  const reviewResult: "correct" | "incorrect" | null = round === "retry"
    ? correct ? "correct" : null
    : !correct ? "incorrect" : usedHint ? null : "correct";
  return { reviewResult, retry: round === "main" && (usedHint || !correct) };
}

export function studyRecordedKeywords<T extends { matched: boolean }>(results: T[], sessionMode: StudySessionMode) {
  return sessionMode === "practice" ? [] : results;
}

export function shouldRecordStudyCard(sessionMode: StudySessionMode, round: StudyRound, result: "correct" | "incorrect") {
  return sessionMode === "real" && (result === "correct" || round === "main");
}

export function studyAttemptOutcome(sessionMode: StudySessionMode, round: StudyRound, result: "correct" | "incorrect", usedHint: boolean) {
  if (sessionMode === "real") return quizAttemptOutcome(round === "main" ? "main" : "retry", result === "correct", usedHint);
  return { reviewResult: null, retry: false };
}

export function studyHintAllowed(sessionMode: StudySessionMode, round: StudyRound) {
  return sessionMode === "real" && round === "main";
}

export function remainingStudyTime(deadline: number | null, remaining: number, now: number) {
  return deadline === null ? remaining : Math.max(0, deadline - now);
}

export function StudyModeSwitch({ mode, disabled = false, onCheckedChange }: {
  mode: StudySessionMode; disabled?: boolean; onCheckedChange: (practice: boolean) => void;
}) {
  return <div className={`study-session-toggle is-${mode}`} title={disabled ? "학습 중에는 모드를 바꿀 수 없어요." : "실전·연습 모드 선택"}>
    <span className={mode === "real" ? "is-active" : ""}>실전</span>
    <Switch disabled={disabled} checked={mode === "practice"} onCheckedChange={onCheckedChange} aria-label={mode === "real" ? "연습 모드로 바꾸기" : "실전 모드로 바꾸기"} />
    <span className={mode === "practice" ? "is-active" : ""}>연습</span>
  </div>;
}

export function studyClockShortcut(event: {
  key: string; repeat?: boolean; isComposing?: boolean; keyCode?: number;
  altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; defaultPrevented?: boolean;
}, paused: boolean, blocked = false) {
  if (blocked || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (paused && (event.key === "Enter" || event.key === "Escape")) return "resume";
  if (!paused && event.key === "Escape") return "pause";
  return null;
}

export function studyClockOriginTransform(origin: { left: number; top: number; width: number; height: number }, panel: { width: number; height: number }, viewport: { left?: number; top?: number; width: number; height: number }) {
  const x = origin.left + origin.width / 2 - ((viewport.left ?? 0) + viewport.width / 2);
  const y = origin.top + origin.height / 2 - ((viewport.top ?? 0) + viewport.height / 2);
  return `translate(${x}px, ${y}px) scale(${origin.width / Math.max(1, panel.width)}, ${origin.height / Math.max(1, panel.height)})`;
}

export function StudyModeStartChoices({ mode, onStart }: { mode: StudySessionMode; onStart: (mode: StudySessionMode) => void }) {
  return <div className="study-mode-start-choices">
    {(["real", "practice"] as const).map((choice) => <Button key={choice} type="button" variant="ghost"
      className={`study-mode-start is-${choice}${mode === choice ? " is-current" : ""}`} onClick={() => onStart(choice)}>
      <span className="study-mode-current">{mode === choice ? "현재 설정" : "\u00a0"}</span>
      {choice === "real" ? <Clock3 aria-hidden="true" /> : <BookOpen aria-hidden="true" />}
      <strong>{choice === "real" ? "실전" : "연습"}</strong>
      <span className="study-mode-description">{choice === "real" ? <>제한시간 있음<br />정답·오답 기록</> : <>정답 보며 따라 쓰기<br />정답·오답 기록 안 함</>}</span>
      <span className="study-mode-start-label">바로 시작 <ChevronRight aria-hidden="true" /></span>
    </Button>)}
  </div>;
}

export function QuizRestartButton({ onRestart, disabled = false }: { onRestart: () => void; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function cancelConfirmation() {
    confirmingRef.current = false;
    setConfirming(false);
  }

  useEffect(() => {
    const cancelOutside = (event: Event) => {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target)) cancelConfirmation();
    };
    // Capture also catches clicks on blank space and controls that stop propagation.
    document.addEventListener("pointerdown", cancelOutside, true);
    document.addEventListener("click", cancelOutside, true);
    document.addEventListener("focusin", cancelOutside, true);
    return () => {
      document.removeEventListener("pointerdown", cancelOutside, true);
      document.removeEventListener("click", cancelOutside, true);
      document.removeEventListener("focusin", cancelOutside, true);
    };
  }, []);

  function activate() {
    if (disabled) return;
    if (!confirmingRef.current) {
      confirmingRef.current = true;
      setConfirming(true);
      return;
    }
    cancelConfirmation();
    onRestart();
  }

  return <Button ref={buttonRef} type="button" size="sm" variant={confirming ? "destructive" : "outline"}
    className={`quiz-restart-button${confirming ? " is-confirming" : ""}`} disabled={disabled}
    aria-label={confirming ? "한 번 더 누르면 새 5퀴즈 시작" : "새 5퀴즈"}
    onClick={activate} onKeyDown={(event) => {
      if (event.key === "Escape" && confirmingRef.current) { event.preventDefault(); cancelConfirmation(); }
      if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    }}>
    <RotateCcw aria-hidden="true" /><span aria-live="polite">{confirming ? "한 번 더" : "새 5퀴즈"}</span>
  </Button>;
}

export function StudyClockControl({ seconds, phase, paused, blocked, untimed = false, activity = "학습", onPause, onResume }: {
  seconds: number; phase: string; paused: boolean; blocked: boolean; untimed?: boolean; activity?: "학습" | "퀴즈"; onPause: () => void; onResume: () => void;
}) {
  const timerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const originRef = useRef<DOMRect | null>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const centered = "translate(0px, 0px) scale(1, 1)";

  function originTransform(panel: HTMLElement) {
    const origin = originRef.current ?? timerRef.current?.getBoundingClientRect();
    const stage = modalRef.current?.getBoundingClientRect();
    return origin && stage ? studyClockOriginTransform(origin, { width: panel.offsetWidth, height: panel.offsetHeight }, stage) : centered;
  }

  const attachPanel = useCallback((panel: HTMLDivElement | null) => {
    animationRef.current?.cancel();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    panelRef.current = panel;
    if (!panel) return;
    // Radix mounts the portal separately; wait until its stage ref and scroll lock are ready.
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      syncStage();
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && panel.animate) {
        animationRef.current = panel.animate([
          { transform: originTransform(panel), offset: 0 },
          { transform: "translate(0px, 0px) scale(1.025, 1.025)", offset: .8 },
          { transform: centered, offset: 1 },
        ], { duration: 460, easing: "cubic-bezier(.22, 1, .36, 1)" });
      }
      panel.style.visibility = "visible";
    });
  }, []);

  function pause() {
    if (paused || blocked || closingRef.current) return;
    originRef.current = timerRef.current?.getBoundingClientRect() ?? null;
    setAnchor(originRef.current);
    focusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onPause();
  }

  function resume() {
    if (!paused || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const panel = panelRef.current;
    originRef.current = timerRef.current?.getBoundingClientRect() ?? originRef.current;
    syncStage();
    const finish = () => {
      closingRef.current = false;
      setClosing(false);
      onResume();
    };
    if (!panel?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    // Begin the return from the current frame, even if the opening motion is unfinished.
    const from = getComputedStyle(panel).transform;
    animationRef.current?.cancel();
    const animation = panel.animate([{ transform: from }, { transform: originTransform(panel) }], { duration: 340, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" });
    animationRef.current = animation;
    animation.onfinish = finish;
  }

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    const otherDialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')].some((element) => element !== modalRef.current && !modalRef.current?.contains(element));
    const action = studyClockShortcut(event, paused, blocked || otherDialog || closingRef.current);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "pause") pause(); else resume();
  });
  useEffect(() => {
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, []);

  function syncStage() {
    const stage = modalRef.current;
    if (!stage) return;
    const viewport = window.visualViewport;
    Object.assign(stage.style, {
      left: `${viewport?.offsetLeft ?? 0}px`, top: `${viewport?.offsetTop ?? 0}px`,
      width: `${viewport?.width ?? window.innerWidth}px`, height: `${viewport?.height ?? window.innerHeight}px`,
    });
    originRef.current = timerRef.current?.getBoundingClientRect() ?? null;
    const origin = originRef.current;
    const bounds = stage.getBoundingClientRect();
    const next = origin ? { left: origin.left - bounds.left, top: origin.top - bounds.top, width: origin.width, height: origin.height } : null;
    setAnchor(previous => previous && next && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
  }

  useLayoutEffect(() => {
    if (!paused) return;
    // Safari's keyboard dismissal and the session layout settle separately.
    // Observe the layout too, then measure after its frame has been applied.
    let layoutFrame = 0;
    const followLayout = () => {
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(syncStage);
    };
    const observer = new ResizeObserver(followLayout);
    for (const element of [timerRef.current, timerRef.current?.closest(".study-progress-row"), timerRef.current?.closest(".app-page")]) {
      if (element) observer.observe(element);
    }
    syncStage();
    followLayout();
    window.addEventListener("resize", followLayout);
    window.visualViewport?.addEventListener("resize", followLayout);
    window.visualViewport?.addEventListener("scroll", followLayout);
    return () => {
      cancelAnimationFrame(layoutFrame);
      observer.disconnect();
      window.removeEventListener("resize", followLayout);
      window.visualViewport?.removeEventListener("resize", followLayout);
      window.visualViewport?.removeEventListener("scroll", followLayout);
      animationRef.current?.cancel();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [paused]);

  return <>
    <button ref={timerRef} type="button" className={`study-timer study-clock-control${!untimed && seconds <= 10 ? " is-urgent" : ""}`}
      onPointerDown={event => event.preventDefault()} onClick={paused ? resume : pause} disabled={blocked} aria-label={`${phase} ${untimed ? "시간 제한 없음" : `남은 시간 ${seconds}초`} · ${paused ? `${activity} 재개` : "일시정지"}`} title={paused ? `${activity} 재개 (Enter / Esc)` : "일시정지 (Esc)"}>
      <em>{phase}</em>{paused && !closing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{!untimed && <><strong>{seconds}</strong><small>초</small></>}
    </button>
    <Dialog open={paused} onOpenChange={() => {}}>
      <DialogContent ref={modalRef} className="study-clock-stage" showCloseButton={false} edgeToEdge
        onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => { event.preventDefault(); if (focusRef.current?.isConnected) focusRef.current.focus({ preventScroll: true }); }}>
        <DialogTitle className="sr-only">{activity} 일시정지</DialogTitle>
        <DialogDescription className="sr-only">남은 시간과 입력한 답을 유지해요. 시계를 누르거나 Enter 또는 Esc를 눌러 재개하세요. 재개하기 전에는 입력하거나 채점할 수 없어요.</DialogDescription>
        {anchor && <button type="button" className="study-timer study-clock-anchor" style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }} onClick={resume} disabled={closing} aria-label={`시간 버튼으로 ${activity} 재개`}>
          <em>{phase}</em>{closing ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{!untimed && <><strong>{seconds}</strong><small>초</small></>}
        </button>}
        <div className="study-clock-center">
        <div ref={attachPanel} className="study-clock-dialog">
        <button type="button" className="study-clock-resume" onClick={resume} disabled={closing} aria-label={`${activity} 재개`}>
          <span className="study-clock-status">{activity}{activity === "학습" ? "을" : "를"}{closing ? " 재개해요" : " 잠시 멈췄어요"}</span>
          <span className="study-clock-readout">{closing ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{untimed ? <span>{phase === "연결" ? "질문 연결" : phase}</span> : <><strong>{seconds}</strong><small>초</small></>}</span>
          <span className="study-clock-help">시계를 눌러 재개<span> · Enter / Esc</span></span>
        </button>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

export function questionReadingTime(question = "") {
  const characters = [...plainFormattedText(question).normalize("NFC").replace(/\s/gu, "")].length;
  // Short prompts fit in the existing thinking allowance; longer prompts add reading time.
  return Math.ceil(Math.max(0, characters - 50) / 5);
}

export function quizQuestionTimeLimit(keywords: string[], initialAnswers: string[] = [], orderIndependent: QuizAnswerOrder = false, mobile = false, question = "") {
  const pending = evaluateQuizAnswers(keywords, initialAnswers, orderIndependent)
    .filter((evaluation) => !evaluation.matched);
  return QUIZ_THINKING_TIME_SECONDS + (mobile ? 20 : 0) + questionReadingTime(question) + pending.reduce((seconds, evaluation) => (
    seconds + [...evaluation.expectedKeyword.normalize("NFC").replace(/\s/gu, "")].length
  ), 0);
}

export function studyQuestionTimeLimit(card: StudyCard | null, initialAnswers: string[] = [], mobile = false) {
  const parts = card ? clozeParts(card) : [];
  const keywords = parts.flatMap((part) => part.type === "blank" ? [part.keyword] : []);
  // Cards without marked keywords still need time to recall their answer.
  if (!keywords.length && card) keywords.push(plainFormattedText(card.answerFormat || card.answer));
  return quizQuestionTimeLimit(keywords, initialAnswers, quizAnswerOrder(parts), mobile, card?.questionFormat || card?.question || "");
}

export function quizCorrectionKeywords(evaluations: Array<{ matched: boolean; expectedKeyword: string }>) {
  return evaluations.filter((evaluation) => !evaluation.matched).map((evaluation) => evaluation.expectedKeyword);
}

export function areQuizCorrectionsComplete(keywords: string[], answers: string[], orderIndependent: QuizAnswerOrder = true) {
  return evaluateQuizAnswers(keywords, answers, orderIndependent).every((evaluation) => evaluation.matched);
}

export function quizInlineCorrections(
  parts: ClozePart[],
  evaluations: Array<{ matched: boolean; expectedKeyword: string }>,
  originalAnswers: string[],
  order = quizAnswerOrder(parts)
) {
  let answerIndex = 0;
  const answers: string[] = [];
  const mappedResults = tableAttemptResults(parts, evaluations, order);
  const correctionParts: ClozePart[] = parts.map((part) => {
    if (part.type === "text") return part;
    const index = answerIndex++;
    const evaluation = evaluations[index];
    const originalAnswer = originalAnswers[index] ?? "";
    if (evaluation?.matched) {
      return { type: "text", value: originalAnswer.trim(), isCorrectAnswer: true, ...(part.cellId ? {cellId:part.cellId} : {}) };
    }
    answers.push("");
    const mapped = mappedResults[index];
    return { ...part, type: "blank", keyword: evaluation?.expectedKeyword || part.keyword, ...(part.keywordId && mapped?.keywordKey ? {keywordId:mapped.keywordKey} : {}) };
  });
  return { parts: correctionParts, answers };
}

export function isMobileBackSwipeGesture({
  startX,
  startY,
  endX,
  endY,
  viewportWidth,
  durationMs,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  viewportWidth: number;
  durationMs: number;
}) {
  const horizontalDistance = endX - startX;
  const verticalDistance = Math.abs(endY - startY);
  const edgeWidth = Math.min(24, viewportWidth * .08);
  return startX <= edgeWidth
    && horizontalDistance >= 72
    && verticalDistance <= 36
    && horizontalDistance > verticalDistance * 1.75
    && durationMs <= 650;
}

export function unresolvedQuizHintIndex(
  evaluations: Array<{ matched: boolean }>,
  focusedIndex: number | null
) {
  if (
    focusedIndex !== null
    && evaluations[focusedIndex]
    && !evaluations[focusedIndex].matched
  ) {
    return focusedIndex;
  }
  const startIndex = focusedIndex === null ? 0 : focusedIndex + 1;
  for (let offset = 0; offset < evaluations.length; offset += 1) {
    const index = (startIndex + offset) % evaluations.length;
    if (!evaluations[index].matched) return index;
  }
  return -1;
}

function keywordMatches(keywords: string[], typedAnswer: string) {
  const normalizedAnswer = normalizeForMatch(typedAnswer);
  return keywords.map((keyword) => ({
    keyword,
    matched: normalizedAnswer.includes(normalizeForMatch(keyword)),
  }));
}

export function fullWriteKeywordMatches(card: StudyCard, answer: string, cells: Record<string, string> = {}) {
  const table = readTable(card.answerFormat);
  return table ? tableKeywords(card.answerFormat).map(item => ({
    keyword: item.keyword, keywordKey: item.keywordKey,
    matched: normalizeForMatch(cells[item.cellId] ?? "").includes(normalizeForMatch(item.keyword)),
  })) : keywordMatches(card.keywords, answer);
}

export function FullTableWriting({ card, values, onChange, disabled, autoFocus = true, tableTabOrder = "vertical" }: {
  card: StudyCard; values: Record<string, string>; onChange: (values: Record<string, string>, answer: string) => void; disabled: boolean; autoFocus?: boolean; tableTabOrder?: TableTabOrder;
}) {
  const table = readTable(card.answerFormat)!;
  const entries = sortedCells(table, tableTabOrder === "vertical").filter(cell => plainCell(cell.format).trim());
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const focus = (id: string) => {
    const input = refs.current[id];
    if (input) { input.focus({ preventScroll: true }); revealMobileStudyInput(input); }
  };
  useLayoutEffect(() => {
    if (autoFocus && !disabled && entries[0]) focus(entries[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, disabled, autoFocus]);
  return <div className="full-table-writing">
    <CardImages images={card.media?.answer} position="before" />
    <TableGrid doc={table} renderCell={cell => !plainCell(cell.format).trim() ? null : <textarea
      ref={node => { refs.current[cell.id] = node; if (node) { node.style.height = "auto"; node.style.height = `${Math.max(52, node.scrollHeight)}px`; } }}
      aria-label={`${table.rows.indexOf(cell.row) + 1}행 ${table.columns.indexOf(cell.column) + 1}열 전체 답안`}
      placeholder="답 작성" value={values[cell.id] ?? ""} disabled={disabled}
      onChange={event => {
        const next = { ...values, [cell.id]: event.target.value };
        onChange(next, sortedCells(table).map(item => next[item.id] ?? "").join("\n"));
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.key !== "Tab") return;
        const next = entries[entries.findIndex(item => item.id === cell.id) + (event.shiftKey ? -1 : 1)];
        if (next) { event.preventDefault(); focus(next.id); }
      }}
    />} />
    <CardImages images={card.media?.answer} position="after" />
  </div>;
}

function HighlightedAnswer({ answer, keywords }: { answer: string; keywords: string[] }) {
  if (!keywords.length) return <>{answer}</>;
  const escaped = [...keywords]
    .sort((a, b) => b.length - a.length)
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const keywordSet = new Set(keywords.map((keyword) => keyword.toLocaleLowerCase("ko-KR")));

  return <span onCopy={event => copyCardSelection(event, event.currentTarget)}>{answer.split(pattern).map((part, index) =>
    keywordSet.has(part.toLocaleLowerCase("ko-KR"))
      ? <mark className="answer-keyword" key={`${part}-${index}`}>{part}</mark>
      : part
  )}</span>;
}

export function QuestionContent({ card, hiddenKeywords, revealedKeywords, guidedPractice = false }: { card: Pick<StudyCard, "question" | "questionFormat" | "media">; hiddenKeywords?: readonly string[]; revealedKeywords?: readonly string[]; guidedPractice?: boolean }) {
  return <><CardImages images={card.media?.question} position="before" />{renderQuestionText(card.questionFormat, card.question, hiddenKeywords, revealedKeywords, guidedPractice)}<CardImages images={card.media?.question} position="after" /></>;
}

function MemoContent({ card }: { card: Pick<StudyCard, "memo" | "media"> }) {
  return <><CardImages images={card.media?.memo} position="before" />{card.memo}<CardImages images={card.media?.memo} position="after" /></>;
}

function CardPreviewButton({ card }: { card: Pick<StudyCard, "question" | "questionFormat" | "answer" | "answerFormat" | "memo" | "media"> }) {
  const [open, setOpen] = useState(false);
  const textFocus = useRef<TextFocus | null>(null);
  const [mobile, setMobile] = useState(false);
  const preview = (field: MediaField) => <><CardImages images={card.media?.[field]} position="before" />{field === "memo" ? card.memo : renderFormattedText(field === "question" ? card.questionFormat : card.answerFormat, card[field], field === "answer")}<CardImages images={card.media?.[field]} position="after" /></>;
  return <>
    <Button type="button" tabIndex={-1} className="card-preview-trigger" variant="ghost" size="icon-sm" aria-label="미리보기" title="미리보기" onMouseDown={(event) => event.preventDefault()} onClick={(event) => {
      textFocus.current = captureTextFocus(event.currentTarget.closest<HTMLElement>(".bulk-card-row, .mobile-card-compose-card, .card-editor-dialog"));
      setMobile(window.matchMedia("(max-width: 759px)").matches); setOpen(true);
    }}><Eye /></Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="media-card-preview-dialog" overlayClassName="media-card-preview-overlay" onCloseAutoFocus={(event) => { event.preventDefault(); restoreTextFocus(textFocus.current); }}>
        <button type="button" hidden tabIndex={-1} data-photo-back="81" onClick={() => setOpen(false)} />
        <DialogHeader className="text-left pr-7"><DialogTitle>카드 미리보기</DialogTitle><DialogDescription>사진의 크기와 배치가 표·카드에 어떻게 보일지 확인해요.</DialogDescription></DialogHeader>
        <Tabs value={mobile ? "mobile" : "desktop"} onValueChange={(value) => setMobile(value === "mobile")}><TabsList><TabsTrigger value="desktop">PC 표</TabsTrigger><TabsTrigger value="mobile">모바일 카드</TabsTrigger></TabsList></Tabs>
        <div className="media-card-preview-scroll">
          <div className={`media-card-preview${mobile ? " is-mobile" : ""}${readTable(card.answerFormat) ? " is-table-card" : ""}`}>
            <section><small>질문</small><div>{preview("question")}</div></section>
            <section><small>답</small><div>{preview("answer")}</div>{(card.memo || !!card.media?.memo.length) && <aside><small>메모</small><div>{preview("memo")}</div></aside>}</section>
          </div>
        </div>
        <DialogFooter><Button type="button" onClick={() => setOpen(false)}>편집으로 돌아가기</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function AnswerContent({ card, hideImages = false }: { card: StudyCard; hideImages?: boolean }) {
  return <>{!hideImages && <CardImages images={card.media?.answer} position="before" />}{card.answerFormat
    ? <>{renderFormattedText(card.answerFormat, card.answer, true)}</>
    : <HighlightedAnswer answer={card.answer} keywords={card.keywords} />}{!hideImages && <CardImages images={card.media?.answer} position="after" />}</>;
}

export function ConnectionAnswerContent({ card, parts, checked, revealedKeywords }: {
  card: StudyCard;
  parts: ClozePart[];
  checked: boolean;
  revealedKeywords: string[];
}) {
  const revealed = new Set(revealedKeywords.map(normalizeForMatch));
  let offset = 0;
  const hidden: Array<{ start: number; end: number }> = [];
  for (const part of parts) {
    const text = part.type === "text" ? part.value : part.keyword;
    if (!checked && part.type === "text" && part.keywordReference && !revealed.has(normalizeForMatch(part.keywordReference))) {
      hidden.push({ start: offset, end: offset + text.length });
    }
    offset += text.length;
  }
  if (!hidden.length) return <AnswerContent card={card} hideImages={!checked} />;
  const format = formatAnswerFromKeywords(card.answer, card.answerFormat, card.keywords);
  return <>{renderFormattedText(format, card.answer, true, (text, start) => {
    const end = start + text.length;
    let cursor = start;
    const result: React.ReactNode[] = [];
    for (const range of hidden) {
      if (range.end <= start || range.start >= end) continue;
      if (range.start > cursor) result.push(text.slice(cursor - start, range.start - start));
      // Emit one mask even when the keyword crosses bold or underline boundaries.
      if (range.start >= start) result.push(<span key={`connection-mask-${range.start}`} className="connection-keyword-mask" aria-label="질문 키워드와 함께 열리는 빈칸">　…　</span>);
      cursor = Math.min(end, range.end);
    }
    if (cursor < end) result.push(text.slice(cursor - start));
    return result;
  })}</>;
}

export function connectionPaneFractions(answer: string, question: string, keywordCount: number) {
  const visualUnits = (text: string) => text.replace(/\s+/g, "").length + (text.match(/\n/g)?.length ?? 0) * 20;
  const answerUnits = Math.max(56, visualUnits(answer));
  const questionUnits = Math.max(64, visualUnits(question) + keywordCount * 16);
  const answerShare = Math.max(0.38, Math.min(0.74, answerUnits / (answerUnits + questionUnits)));
  return { answer: answerShare, question: 1 - answerShare };
}

function answerDensityClass(answer: string) {
  const length = answer.replace(/\s+/g, "").length;
  if (length > 160) return " answer-density-long";
  if (length > 80) return " answer-density-medium";
  return "";
}

function answerPaneFractions(userAnswer: string, correctAnswer: string, memo: string) {
  const visualUnits = (value: string) => {
    const lineBreaks = value.match(/\n/g)?.length ?? 0;
    return value.replace(/\s+/g, "").length + lineBreaks * 18;
  };
  const userUnits = Math.max(42, visualUnits(userAnswer) + 30);
  const judgmentUnits = Math.max(54, visualUnits(correctAnswer) + visualUnits(memo) * 0.65 + 46);
  const rawUserShare = userUnits / (userUnits + judgmentUnits);
  const userShare = Math.min(0.7, Math.max(0.28, rawUserShare));
  return { user: userShare, judgment: 1 - userShare };
}

function AnswerMemo({ memo, images }: { memo: string; images?: CardImage[] }) {
  if (!memo && !images?.length) return null;
  return <aside className="answer-memo"><span>메모</span><p><CardImages images={images} position="before" />{memo}<CardImages images={images} position="after" /></p></aside>;
}

export function KeywordAnswerLabel({ result, label = "핵심 키워드 채우기" }: { result?: "correct" | "incorrect" | null; label?: string }) {
  return <span className={`answer-label${result ? ` is-${result}` : ""}`} role={result ? "status" : undefined}>{result === "correct" ? "정답" : result === "incorrect" ? "오답" : label}</span>;
}

export function KeywordReviewMaterials({ card }: { card: Pick<StudyCard, "memo" | "media"> }) {
  if (!card.memo && !card.media?.memo?.length && !card.media?.answer?.length) return null;
  return <div className="keyword-review-materials"><CardImages images={card.media?.answer} position="before" /><CardImages images={card.media?.answer} position="after" /><AnswerMemo memo={card.memo} images={card.media?.memo} /></div>;
}

function GuidedCopyField({ expected, value, label, onChange, onKeyDown, onFocus, inputRef }: {
  expected: string;
  value: string;
  label: string;
  onChange: (value: string, composing: boolean) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: (node: HTMLTextAreaElement) => void;
  inputRef?: (node: HTMLTextAreaElement | null) => void;
}) {
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const tail = remainingCorrectionGuide(expected, value, composing);
  return <span className="guided-copy-field">
    <span className="guided-copy-measure" aria-hidden="true">{value + tail || "\u200b"}{"\u200b"}</span>
    <span className="guided-copy-guide" aria-hidden="true"><span className="guided-copy-entered">{value}</span>{tail}</span>
    <textarea
      ref={inputRef}
      aria-label={label}
      title="회색 정답을 처음부터 따라 쓰세요."
      value={value}
      rows={1}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onCompositionStart={() => { composingRef.current = true; setComposing(true); }}
      onCompositionEnd={(event) => { composingRef.current = false; setComposing(false); onChange(event.currentTarget.value, false); }}
      onChange={(event) => onChange(event.currentTarget.value, composingRef.current || (event.nativeEvent as InputEvent).isComposing)}
      onFocus={(event) => onFocus?.(event.currentTarget)}
      onKeyDown={onKeyDown}
    />
  </span>;
}

export function GuidedFullPractice({ card, completed, onComplete, autoFocus = true, tableTabOrder = "vertical" }: { card: StudyCard; completed: boolean; onComplete: () => void; autoFocus?: boolean; tableTabOrder?: TableTabOrder }) {
  const table = readTable(card.answerFormat);
  const entries = table
    ? sortedCells(table, tableTabOrder === "vertical").map((cell) => ({ id: cell.id, expected: plainCell(cell.format) })).filter((entry) => entry.expected.length > 0)
    : [{ id: "answer", expected: card.answer }];
  const [values, setValues] = useState<Record<string, string>>({});
  const [composingIds, setComposingIds] = useState<Set<string>>(() => new Set());
  const inputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const expectedById = new Map(entries.map((entry) => [entry.id, entry.expected]));
  const unfinishedIds = entries.filter((entry) => composingIds.has(entry.id) || !matchesGuidedCopy(entry.expected, values[entry.id] ?? "")).map((entry) => entry.id);

  const revealFocused = (node: HTMLTextAreaElement) => {
    if (revealMobileStudyInput(node)) return;
    if (!window.matchMedia("(max-width: 759px)").matches) return;
    const align = () => {
      if (!node.isConnected || document.activeElement !== node) return;
      const viewport = window.visualViewport;
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const rect = node.getBoundingClientRect();
      if (rect.bottom > visibleBottom - 12) node.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    window.requestAnimationFrame(align);
    window.setTimeout(align, 280);
  };
  const focusEntry = (id: string | null) => {
    if (!id) return;
    const node = inputRefs.current[id];
    if (!node) return;
    node.focus({ preventScroll: true });
    const end = node.value.length;
    node.setSelectionRange(end, end);
    revealFocused(node);
  };
  useLayoutEffect(() => {
    if (autoFocus && !completed) focusEntry(unfinishedIds[0] ?? null);
    // Only focus when this card/rewrite opens, not after every character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, completed, autoFocus]);
  const update = (id: string, value: string, composing: boolean) => {
    const next = { ...values, [id]: value };
    // Some Korean IMEs keep the final syllable composing until the next key.
    // An exact whole-answer match is safe to accept without waiting for that key.
    const matched = matchesGuidedCopy(expectedById.get(id) ?? "", value);
    setValues(next);
    setComposingIds((previous) => {
      const pendingComposition = composing && !matched;
      if (previous.has(id) === pendingComposition) return previous;
      const updated = new Set(previous);
      if (pendingComposition) updated.add(id); else updated.delete(id);
      return updated;
    });
    if (!matched) return;
    const nextId = entries.find((entry) => !matchesGuidedCopy(entry.expected, next[entry.id] ?? ""))?.id;
    if (!nextId) onComplete();
    else if (nextId !== id) {
      deferMobileAnswerScroll(inputRefs.current[id]);
      requestAnimationFrame(() => focusEntry(nextId));
    }
  };
  const handleTableKey = (id: string, event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!table || event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && event.shiftKey) return;
    const key = event.key === "Enter" ? "ArrowDown" : event.key;
    if (!["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
    if (key.startsWith("Arrow")) {
      const node = event.currentTarget;
      if ((key === "ArrowLeft" && node.selectionStart > 0)
        || (key === "ArrowRight" && node.selectionEnd < node.value.length)
        || (key === "ArrowUp" && node.value.slice(0, node.selectionStart).includes("\n"))
        || (key === "ArrowDown" && node.value.slice(node.selectionEnd).includes("\n"))) return;
    }
    const target = key === "Tab"
      ? unfinishedIds[unfinishedIds.indexOf(id) + (event.shiftKey ? -1 : 1)] ?? null
      : tableNavigation(table, unfinishedIds, id, key, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    focusEntry(target);
  };
  return <div className={`guided-full-practice${table ? " is-table" : ""}`}>
    <div className="quiz-answer-heading"><KeywordAnswerLabel result={completed ? "correct" : null} label="정답 따라 쓰기" /></div>
    <div className="guided-full-scroll">
      <CardImages images={card.media?.answer} position="before" />
      {completed ? <div className="guided-full-completed"><AnswerContent card={card} hideImages /></div>
        : table ? <TableGrid doc={table} renderCell={(cell) => {
          const expected = expectedById.get(cell.id);
          if (!expected) return plainCell(cell.format);
          const value = values[cell.id] ?? "";
          return !composingIds.has(cell.id) && matchesGuidedCopy(expected, value)
            ? <span className="cloze-inline-answer is-correct is-review-text">{value}</span>
            : <GuidedCopyField expected={expected} value={value} label={`${table.rows.indexOf(cell.row) + 1}행 ${table.columns.indexOf(cell.column) + 1}열 정답 따라 쓰기`}
                inputRef={(node) => { inputRefs.current[cell.id] = node; }} onChange={(next, composing) => update(cell.id, next, composing)} onFocus={revealFocused} onKeyDown={(event) => handleTableKey(cell.id, event)} />;
        }} /> : <GuidedCopyField expected={card.answer} value={values.answer ?? ""} label="정답 전체 따라 쓰기"
          inputRef={(node) => { inputRefs.current.answer = node; }} onChange={(next, composing) => update("answer", next, composing)} onFocus={revealFocused} />}
      <CardImages images={card.media?.answer} position="after" />
      {completed && <AnswerMemo memo={card.memo} images={card.media?.memo} />}
      {!completed && !entries.some((entry) => entry.expected.length) && <Button onClick={onComplete}>확인하기 <ChevronRight /></Button>}
    </div>
  </div>;
}

function AnswerJudgment({ result, correctLabel = "정답으로 판단했어요" }: { result: "correct" | "incorrect" | null; correctLabel?: string }) {
  const state = result ?? "manual";
  const label = result === "correct"
    ? correctLabel
    : result === "incorrect"
      ? "오답으로 판단했어요"
      : "직접 판단해 주세요";

  return (
    <span className={`answer-judgment-label is-${state}`}>
      <span aria-hidden="true">{result === "correct" ? <Check /> : result === "incorrect" ? <X /> : <KeyRound />}</span>
      <strong>{label}</strong>
    </span>
  );
}

function wrongLevelClass(incorrectCount: number) {
  return incorrectCount > 0 ? ` wrong-level-${Math.min(5, incorrectCount)}` : "";
}

function clozeParts(card: StudyCard): ClozePart[] {
  const table = readTable(card.answerFormat);
  if (table) return tableParts(table);
  const formatted = formatAnswerFromKeywords(card.answer, card.answerFormat, card.keywords)
    .replaceAll("[accent]", "[b]")
    .replaceAll("[/accent]", "[/b]");
  const parts: ClozePart[] = [];
  const boldPattern = /\[b\]([\s\S]*?)\[\/b\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(formatted))) {
    const before = plainFormattedText(formatted.slice(cursor, match.index));
    const keyword = plainFormattedText(match[1]).trim();
    if (before) parts.push({ type: "text", value: before });
    if (keyword) parts.push({ type: "blank", keyword });
    cursor = match.index + match[0].length;
  }
  const after = plainFormattedText(formatted.slice(cursor));
  if (after) parts.push({ type: "text", value: after });
  if (parts.some((part) => part.type === "blank")) return parts;

  const escaped = [...card.keywords]
    .sort((a, b) => b.length - a.length)
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return [{ type: "text", value: card.answer }];
  const keywordSet = new Set(card.keywords.map((keyword) => keyword.toLocaleLowerCase("ko-KR")));
  return card.answer
    .split(new RegExp(`(${escaped.join("|")})`, "gi"))
    .filter(Boolean)
    .map((part) => keywordSet.has(part.toLocaleLowerCase("ko-KR"))
      ? { type: "blank" as const, keyword: part }
      : { type: "text" as const, value: part });
}

function questionClozeParts(card: StudyCard): ClozePart[] {
  const formatted = card.questionFormat
    .replaceAll("[accent]", "[b]")
    .replaceAll("[/accent]", "[/b]");
  const parts: ClozePart[] = [];
  const boldPattern = /\[b\]([\s\S]*?)\[\/b\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(formatted))) {
    const before = plainFormattedText(formatted.slice(cursor, match.index));
    const keyword = plainFormattedText(match[1]).trim();
    if (before) parts.push({ type: "text", value: before });
    if (keyword) parts.push({ type: "blank", keyword });
    cursor = match.index + match[0].length;
  }
  const after = plainFormattedText(formatted.slice(cursor));
  if (after) parts.push({ type: "text", value: after });
  return parts.some((part) => part.type === "blank") ? parts : [{ type: "text", value: card.question }];
}

export function connectionPracticeParts(card: StudyCard) {
  const original = questionClozeParts(card);
  const keywords = original
    .filter((part): part is Extract<ClozePart, { type: "blank" }> => part.type === "blank")
    .map((part) => part.keyword);
  const unique = [...new Map(keywords.map((keyword) => [normalizeForMatch(keyword), keyword])).values()];
  const pattern = unique.sort((a, b) => b.length - a.length)
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const maskText = (value: string): ClozePart[] => {
    if (!pattern.length) return [{ type: "text", value }];
    return value.split(new RegExp(`(${pattern.join("|")})`, "gi")).filter(Boolean).map((text) => {
      const keyword = unique.find((candidate) => normalizeForMatch(candidate) === normalizeForMatch(text));
      return keyword ? { type: "text", value: text, keywordReference: keyword } : { type: "text", value: text };
    });
  };
  const seen = new Set<string>();
  const question = original.flatMap((part): ClozePart[] => {
    if (part.type === "text") return maskText(part.value);
    const key = normalizeForMatch(part.keyword);
    if (seen.has(key)) return [{ type: "text", value: part.keyword, keywordReference: part.keyword }];
    seen.add(key);
    return [part];
  });
  const answer = maskText(plainFormattedText(card.answerFormat || card.answer));
  return { question, answer };
}

function hasLowConnectivity(performance: ConnectionPerformance | undefined) {
  return Boolean(performance?.attempts && performance.connectivity < 70);
}

export function quizAnswerOrder(parts: ClozePart[]): QuizAnswerOrder {
  if (parts.some((part) => part.cellId)) {
    let groupOffset = 0;
    const groups: number[] = [];
    for (const cellId of [...new Set(parts.map((part) => part.cellId))]) {
      const cellParts = parts.filter((part) => part.cellId === cellId).map(({cellId: _cell, ...part}) => part);
      const order = quizAnswerOrder(cellParts);
      const count = cellParts.filter((part) => part.type === "blank").length;
      for (let i=0;i<count;i++) groups.push(groupOffset + quizAnswerGroup(order,i));
      groupOffset += count + 1;
    }
    return groups;
  }
  const blocks: Array<Array<{ index: number; separator: string; keyword: string }>> = [[]];
  let separator = "";
  let index = 0;
  for (const part of parts) {
    if (part.type === "text") {
      separator += part.value;
      continue;
    }
    if (index > 0 && /[\r\n][\t ]*[-–—•]/u.test(separator)) blocks.push([]);
    blocks[blocks.length - 1].push({ index: index++, separator, keyword: part.keyword });
    separator = "";
  }
  const groups: number[] = [];
  let group = 0;
  const delimiter = /[,，、·•ㆍ;；\r\n]/u;
  const context = (value: string) => value.normalize("NFC").replace(/^\s*[-–—•]\s*/u, "").replace(/[.!?。]\s*$/u, "").replace(/\s/gu, "");
  // Editors/OCR now save •. It must retain the same item boundaries as legacy
  // dashes; otherwise a standalone item merges into the next comma-list group.
  const bulletMark = /(?:^|[\r\n])([\t ]*)[-–—•]/u;
  const tailWords = blocks.flatMap((block, blockIndex) => block.map((item, position) => {
    const after = (block[position + 1]?.separator ?? blocks[blockIndex + 1]?.[0]?.separator ?? separator).split(delimiter)[0];
    return (item.keyword + after).trim().replace(/[.!?。]\s*$/u, "").split(/\s+/u).at(-1) ?? "";
  }));
  // A flat list with a common explicit item ending (e.g. “...의 원리”) can
  // wrap several items onto one bullet without making them a different group.
  const sharedBulletEnding = blocks.length > 1 && tailWords[0]?.length >= 2 && new Set(tailWords).size === 1
    && blocks.every((block) => bulletMark.test(block[0]?.separator ?? "") && block.slice(1).every((item) => delimiter.test(item.separator)));
  const sharedBulletContexts = new Map<string, number>();
  let bulletContexts = new Map<string, number>();
  for (const [blockIndex, block] of blocks.entries()) {
    const surroundings = block.map((item, position) => ({
      before: context(item.separator.split(delimiter).at(-1) ?? ""),
      after: context((block[position + 1]?.separator ?? blocks[blockIndex + 1]?.[0]?.separator ?? separator).split(delimiter)[0]),
    }));
    // One keyword per sibling bullet is one list, not a series of one-item groups.
    const bullet = block[0]?.separator.match(bulletMark);
    if (block.length === 1 && bullet && !sharedBulletEnding) {
      const signature = JSON.stringify([bullet[1], surroundings[0].before, surroundings[0].after]);
      if (!bulletContexts.has(signature)) bulletContexts.set(signature, group++);
      groups[block[0].index] = bulletContexts.get(signature)!;
      continue;
    }
    bulletContexts = new Map();
    const unordered = sharedBulletEnding || (block.length > 1 && block.slice(1).every((item) => delimiter.test(item.separator)));
    if (unordered && block.length > 1) {
      // “학생의 [능력], [적성], [진로]”: the leading possessive modifies the list.
      if (/의$/u.test(surroundings[0].before) && surroundings.slice(1).every((item) => !item.before)) surroundings[0].before = "";
      // A trailing phrase after bare list items applies to the whole list as well.
      if (surroundings.slice(0, -1).every((item) => !item.after)) surroundings[surroundings.length - 1].after = "";
    }
    const contexts = sharedBulletEnding ? sharedBulletContexts : new Map<string, number>();
    for (const [position, item] of block.entries()) {
      if (!unordered) {
        groups[item.index] = group++;
        continue;
      }
      const signature = JSON.stringify([sharedBulletEnding ? bullet?.[1] : "", surroundings[position].before, surroundings[position].after]);
      if (!contexts.has(signature)) contexts.set(signature, group++);
      groups[item.index] = contexts.get(signature)!;
    }
  }
  if (groups.length < 2 || new Set(groups).size === groups.length) return false;
  return new Set(groups).size === 1 ? true : groups;
}

function quizAnswerGroup(order: QuizAnswerOrder, index: number) {
  return typeof order === "boolean" ? order ? 0 : index : order[index] ?? index;
}

export function quizCorrectionOrder(order: QuizAnswerOrder, evaluations: Array<{ matched: boolean }>): QuizAnswerOrder {
  return typeof order === "boolean" ? order : order.filter((_, index) => !evaluations[index]?.matched);
}

export function evaluateQuizAnswers(keywords: string[], answers: string[], orderIndependent: QuizAnswerOrder) {
  if (!orderIndependent) {
    return keywords.map((keyword, index) => ({
      matched: normalizeForMatch(answers[index] ?? "") === normalizeForMatch(keyword),
      expectedKeyword: keyword,
    }));
  }

  const remaining = keywords.map((keyword, index) => ({ keyword, normalized: normalizeForMatch(keyword), group: quizAnswerGroup(orderIndependent, index) }));
  const evaluations = keywords.map((_, answerIndex) => {
    const answer = answers[answerIndex] ?? "";
    const normalizedAnswer = normalizeForMatch(answer);
    const matchIndex = normalizedAnswer ? remaining.findIndex((item) => item.group === quizAnswerGroup(orderIndependent, answerIndex) && item.normalized === normalizedAnswer) : -1;
    if (matchIndex < 0) return { matched: false, expectedKeyword: "" };
    const [matchedKeyword] = remaining.splice(matchIndex, 1);
    return { matched: true, expectedKeyword: matchedKeyword.keyword };
  });

  return evaluations.map((evaluation, index) => {
    if (evaluation.matched) return evaluation;
    const remainingIndex = remaining.findIndex((item) => item.group === quizAnswerGroup(orderIndependent, index));
    return { matched: false, expectedKeyword: remainingIndex < 0 ? "" : remaining.splice(remainingIndex, 1)[0].keyword };
  });
}

export function quizHintKeywords(keywords: string[], answers: string[], order: QuizAnswerOrder, hints: QuizCardHints = {}) {
  const evaluations = evaluateQuizAnswers(keywords, answers, order);
  const result = evaluations.map((evaluation) => evaluation.expectedKeyword);
  const remaining = keywords.map((keyword, index) => ({ keyword, group: quizAnswerGroup(order, index) }));
  evaluations.forEach((evaluation, index) => {
    if (!evaluation.matched) return;
    const matchedIndex = remaining.findIndex((item) => item.group === quizAnswerGroup(order, index)
      && normalizeForMatch(item.keyword) === normalizeForMatch(evaluation.expectedKeyword));
    if (matchedIndex >= 0) remaining.splice(matchedIndex, 1);
  });
  const prefixScore = (keyword: string, index: number) => normalizeForMatch(planQuizHint(keyword, answers[index] ?? "").answer).length;
  const pending = evaluations.flatMap((evaluation, index) => {
    if (evaluation.matched) return [];
    const candidates = remaining.filter((item) => item.group === quizAnswerGroup(order, index));
    return [{ index, score: Math.max(0, ...candidates.map((item) => prefixScore(item.keyword, index))),
      saved: candidates.some((item) => item.keyword === hints[index]?.keyword) ? 1 : 0 }];
  }).sort((a, b) => b.score - a.score || b.saved - a.saved || a.index - b.index);
  for (const { index } of pending) {
    const candidates = remaining.filter((item) => item.group === quizAnswerGroup(order, index));
    candidates.sort((a, b) => prefixScore(b.keyword, index) - prefixScore(a.keyword, index)
      || Number(b.keyword === hints[index]?.keyword) - Number(a.keyword === hints[index]?.keyword)
      || Number(b.keyword === evaluations[index].expectedKeyword) - Number(a.keyword === evaluations[index].expectedKeyword));
    const selected = candidates[0];
    if (!selected) continue;
    result[index] = selected.keyword;
    remaining.splice(remaining.indexOf(selected), 1);
  }
  return result;
}

export function planMatchedQuizAnswer(
  keywords: string[],
  answers: string[],
  index: number,
  value: string,
  orderIndependent: QuizAnswerOrder
) {
  const nextAnswers = [...answers];
  nextAnswers[index] = value;
  const evaluations = evaluateQuizAnswers(keywords, nextAnswers, orderIndependent);
  if (!evaluations[index]?.matched) return null;

  const allMatched = evaluations.length > 0 && evaluations.every((evaluation) => evaluation.matched);
  const nextIndex = allMatched
    ? -1
    : evaluations.findIndex((evaluation, answerIndex) => answerIndex > index && !evaluation.matched);

  return {
    answers: nextAnswers,
    allMatched,
    nextIndex: nextIndex >= 0
      ? nextIndex
      : evaluations.findIndex((evaluation) => !evaluation.matched),
  };
}

function QuizGradedAnswer({
  card,
  evaluations,
  partsOverride,
  mediaField = "answer",
}: {
  card: StudyCard;
  evaluations: Array<{ matched: boolean; expectedKeyword: string }>;
  partsOverride?: ClozePart[];
  mediaField?: MediaField;
}) {
  const table = readTable(card.answerFormat);
  const parts = partsOverride ?? clozeParts(card);
  if (table && parts.some((part) => part.cellId)) {
    const results = tableAttemptResults(parts, evaluations);
    return <><CardImages images={card.media?.[mediaField]} position="before" /><TableGrid doc={table} renderCell={(cell) => <>{parts.filter((part) => part.cellId === cell.id).map((part,index) => part.type === "text" ? <span key={index}>{part.value}</span> : <mark key={index} className={`quiz-answer-keyword ${results.find((item) => item.keywordKey === part.keywordId)?.matched ? "is-correct" : "is-incorrect"}`}>{part.keyword}</mark>)}</>} /><CardImages images={card.media?.[mediaField]} position="after" /></>;
  }
  const matchedKeywordCounts = new Map<string, number>();
  evaluations.forEach((evaluation) => {
    if (!evaluation.matched || !evaluation.expectedKeyword) return;
    const normalized = normalizeForMatch(evaluation.expectedKeyword);
    matchedKeywordCounts.set(normalized, (matchedKeywordCounts.get(normalized) ?? 0) + 1);
  });

  return <><CardImages images={card.media?.[mediaField]} position="before" />{(partsOverride ?? clozeParts(card)).map((part, index) => {
    if (part.type === "text") return <span key={`quiz-answer-text-${index}`}>{part.value}</span>;
    const normalized = normalizeForMatch(part.keyword);
    const matchedCount = matchedKeywordCounts.get(normalized) ?? 0;
    const matched = matchedCount > 0;
    if (matched) matchedKeywordCounts.set(normalized, matchedCount - 1);
    return (
      <mark
        className={`quiz-answer-keyword ${matched ? "is-correct" : "is-incorrect"}`}
        key={`quiz-answer-keyword-${index}`}
      >
        {part.keyword}
      </mark>
    );
  })}<CardImages images={card.media?.[mediaField]} position="after" /></>;
}

function parseCardTime(value: string | null) {
  if (!value) return null;
  const withTimezone = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(withTimezone);
  return Number.isFinite(parsed) ? parsed : null;
}

function reviewAgeDays(card: StudyCard) {
  const reviewed = parseCardTime(card.lastReviewedAt);
  if (reviewed === null) return 90;
  return Math.max(0, (Date.now() - reviewed) / 86_400_000);
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, durationMs) / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}초`;
}

function formatStudyDate(value: string | null) {
  const timestamp = parseCardTime(value);
  if (timestamp === null) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(timestamp);
}

export function excludeRecentlyStudiedCards<T extends Pick<StudyCard, "id" | "lastReviewedAt">>(
  cards: T[],
  stats: StudyStats,
  now: number
): T[] {
  const cutoff = now - 30 * 60 * 1000;
  return cards.filter((card) => {
    const id = String(card.id);
    const timestamps = [
      card.lastReviewedAt,
      stats.cardPerformance[id]?.lastAttemptedAt,
      stats.connectionPerformance[id]?.lastAttemptedAt,
      ...(stats.keywordPerformance[id] ?? []).map((item) => item.lastAttemptedAt),
    ];
    return !timestamps.some((value) => {
      const time = parseCardTime(value ?? null);
      return time !== null && time > cutoff;
    });
  });
}

export function groupQuizSetCards(
  items: QuizItem[],
  eligibleCards: Array<Pick<StudyCard, "id" | "archivedAt">>,
  sets: Array<Pick<StudySet, "cardIds">>
): QuizItem[] {
  const eligible = new Map(eligibleCards.map((card) => [card.id, card]));
  const original = new Map(items.map((item) => [item.cardId, item]));
  const memberships = new Map<number, number[]>();
  sets.forEach((set, index) => {
    for (const id of set.cardIds) {
      if (eligible.has(id)) memberships.set(id, [...(memberships.get(id) ?? []), index]);
    }
  });
  const seenCards = new Set<number>();
  const seenSets = new Set<number>();
  const result: QuizItem[] = [];
  for (const item of items) {
    const pending = [item.cardId];
    for (let index = 0; index < pending.length; index++) {
      const id = pending[index];
      const card = eligible.get(id);
      if (!card || seenCards.has(id)) continue;
      seenCards.add(id);
      result.push(original.get(id) ?? { cardId: id, reason: card.archivedAt ? "archive-review" : "recommended" });
      for (const setIndex of memberships.get(id) ?? []) {
        if (seenSets.has(setIndex)) continue;
        seenSets.add(setIndex);
        pending.push(...sets[setIndex].cardIds);
      }
    }
  }
  return result;
}

function createQuiz(
  cards: StudyCard[],
  performance: StudyStats["cardPerformance"],
  keywordPerformance: StudyStats["keywordPerformance"],
  connectionPerformance: StudyStats["connectionPerformance"]
): QuizItem[] {
  const eligible = cards.filter((card) => clozeParts(card).some((part) => part.type === "blank"));
  const ranked = eligible.map((card) => {
    const total = card.correctCount + card.incorrectCount;
    const lifetimeErrorRate = total ? card.incorrectCount / total : 0;
    const real = performance[String(card.id)];
    const realErrorRate = real?.attempts ? real.incorrect / real.attempts : .5;
    const slowScore = real ? Math.min(4, real.averageDurationMs / 10_000) : 2;
    const ageScore = Math.min(5, reviewAgeDays(card) / 18);
    const keywordRows = new Map(
      (keywordPerformance[String(card.id)] ?? []).map((item) => [item.keywordKey ?? normalizeForMatch(item.keyword), item])
    );
    const keywordKeys = isTableFormat(card.answerFormat) ? tableKeywords(card.answerFormat).map((item)=>item.keywordKey) : card.keywords.map(normalizeForMatch);
    const keywordWeaknesses = keywordKeys.map((key) => {
      const item = keywordRows.get(key);
      return item ? (item.incorrect + 1) / (item.attempts + 2) : .5;
    });
    const peakKeywordWeakness = keywordWeaknesses.length ? Math.max(...keywordWeaknesses) : .5;
    const averageKeywordWeakness = keywordWeaknesses.length
      ? keywordWeaknesses.reduce((sum, value) => sum + value, 0) / keywordWeaknesses.length
      : .5;
    const keywordWeaknessScore = peakKeywordWeakness * 8 + averageKeywordWeakness * 4;
    const connection = connectionPerformance[String(card.id)];
    const connectionWeaknessScore = connection?.attempts
      ? (1 - connection.connectivity / 100) * 6
      : 0;
    const score = card.incorrectCount * 3
      + lifetimeErrorRate * 6
      + realErrorRate * 9
      + slowScore
      + ageScore
      + keywordWeaknessScore
      + connectionWeaknessScore
      + (real ? 0 : 2);
    return { card, score };
  });
  return ranked
    .sort((a, b) => b.score - a.score || a.card.sortOrder - b.card.sortOrder || a.card.id - b.card.id)
    .slice(0, 5)
    .map(({ card }) => ({ cardId: card.id, reason: "recommended" }));
}

export function selectWeakKeywordReview(
  cards: Array<Pick<StudyCard, "id" | "keywords"> & { answerFormat?: string }>,
  keywordPerformance: StudyStats["keywordPerformance"],
  excludedCardIds: ReadonlySet<number> = new Set()
) {
  const available = cards.filter((card) => !excludedCardIds.has(card.id)).flatMap((card) => {
    const table = isTableFormat(card.answerFormat);
    const activeKeywords = new Map(table ? tableKeywords(card.answerFormat!).map((item) => [item.keywordKey,item.keyword]) : card.keywords.map((keyword) => [normalizeForMatch(keyword), keyword]));
    return (keywordPerformance[String(card.id)] ?? []).flatMap((item) => {
      const keyword = activeKeywords.get(table ? item.keywordKey ?? "" : normalizeForMatch(item.keyword));
      const errorRate = item.attempts ? item.incorrect / item.attempts : 0;
      if (
        !keyword
        || item.attempts < WEAK_KEYWORD_MIN_ATTEMPTS
        || item.incorrect < WEAK_KEYWORD_MIN_INCORRECT
        || errorRate < WEAK_KEYWORD_MIN_ERROR_RATE
      ) return [];
      return [{
        cardId: card.id,
        keyword,
        ...(table ? {keywordKey:item.keywordKey} : {}),
        attempts: item.attempts,
        incorrect: item.incorrect,
        errorRate,
        lastAttemptedAt: parseCardTime(item.lastAttemptedAt) ?? 0,
      }];
    });
  });

  return available.sort((left, right) =>
    right.errorRate - left.errorRate
    || right.incorrect - left.incorrect
    || left.lastAttemptedAt - right.lastAttemptedAt
    || left.cardId - right.cardId
  )[0] ?? null;
}

export function keywordReviewParts(card: StudyCard, keyword: string, keywordKey?: string): ClozePart[] {
  const target = normalizeForMatch(keyword);
  return clozeParts(card).map((part) => {
    if (part.type === "text" || (part.keywordId ? part.keywordId === keywordKey : normalizeForMatch(part.keyword) === target)) return part;
    return { type: "text", value: part.keyword, isCorrectAnswer: true, ...(part.cellId ? {cellId:part.cellId} : {}) };
  });
}

export function tableAttemptResults(parts: ClozePart[], evaluations: Array<{matched:boolean;expectedKeyword:string}>, order = quizAnswerOrder(parts)) {
  const blanks = parts.flatMap((part) => part.type === "blank" ? [part] : []);
  const available = blanks.map((part,index) => ({part,group:quizAnswerGroup(order,index)}));
  const targets = new Map<number, typeof blanks[number]>();
  for (const matched of [true,false]) evaluations.forEach((evaluation,index) => {
    if(evaluation.matched !== matched)return;
    const group=quizAnswerGroup(order,index);
    const position=available.findIndex((item)=>item.group===group && (!matched || normalizeForMatch(item.part.keyword)===normalizeForMatch(evaluation.expectedKeyword)));
    if(position>=0)targets.set(index,available.splice(position,1)[0].part);
  });
  return evaluations.map((evaluation,index) => {
    const part = blanks[index];
    const target = targets.get(index) ?? part;
    return { keyword: evaluation.expectedKeyword || part?.keyword || "", matched:evaluation.matched, ...(target?.keywordId ? {keywordKey:target.keywordId} : {}) };
  });
}

function tableHintResult(parts: ClozePart[], words: string[], index: number) {
  const result=tableAttemptResults(parts,words.map((expectedKeyword)=>({expectedKeyword,matched:true})))[index];
  return result ? [{...result,matched:false}] : [];
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="field-label">{children}</label>;
}

function ContentTypeBadge({ value }: { value: CardContentType }) {
  return <Badge variant="outline" className="content-type-badge">{value}</Badge>;
}

export function SubjectBadge({ subject, subjects }: { subject: string; subjects?: readonly string[] }) {
  return <Badge className={`subject-badge subject-palette-${subjectColorIndex(subject, subjects)}`}>{subject}</Badge>;
}

function MistakeCountBadge({ count }: { count: number }) {
  return (
    <Badge className={`mistake-count-badge${count > 0 ? " has-mistakes" : ""}`}>
      오답 {count}회
    </Badge>
  );
}

function archiveReviewLabel(card: StudyCard) {
  if (!card.archivedAt) return "";
  if (isArchiveReviewDue(card.archivedAt, card.archiveReviewDueAt)) return "복습 예정";
  const timestamp = parseCardTime(card.archiveReviewDueAt);
  if (timestamp === null) return "복습일 확인 중";
  const date = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(timestamp);
  return `${date} 복습`;
}

function ContentTypeStripeLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`content-type-stripe-legend${className ? ` ${className}` : ""}`} aria-label="분류별 띠색">
      {CARD_CONTENT_TYPES.map((contentType) => (
        <span key={contentType}><i className={contentTypeStripeClass(contentType)} aria-hidden="true" />{contentType}</span>
      ))}
    </div>
  );
}

function WrongCountSup({ count }: { count: number }) {
  return count > 0
    ? <sup className="flow-wrong-sup" aria-label={`오답 ${count}회`} title={`오답 ${count}회`}>{count}</sup>
    : null;
}

function preventEnterSubmit(event: React.KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter") return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    (target instanceof HTMLButtonElement && target.type === "submit")
  ) {
    event.preventDefault();
  }
}

type BulkArrowKey = "arrowdown" | "arrowleft" | "arrowright" | "arrowup";

function bulkCaretIsAtEdge(field: HTMLElement, key: BulkArrowKey) {
  const startEdge = key === "arrowup" || key === "arrowleft";
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.selectionStart === null || field.selectionEnd === null) return true;
    if (field.selectionStart !== field.selectionEnd) return false;
    return startEdge ? field.selectionStart === 0 : field.selectionEnd === field.value.length;
  }
  if (!field.isContentEditable) return true;

  const selection = window.getSelection();
  if (!selection?.rangeCount) return true;
  const selectedRange = selection.getRangeAt(0);
  if (!selectedRange.collapsed || !field.contains(selectedRange.commonAncestorContainer)) return false;
  const edgeRange = document.createRange();
  edgeRange.selectNodeContents(field);
  if (startEdge) edgeRange.setEnd(selectedRange.startContainer, selectedRange.startOffset);
  else edgeRange.setStart(selectedRange.endContainer, selectedRange.endOffset);
  return edgeRange.toString().length === 0;
}

export function bulkAnswerMemoArrowTarget(container: HTMLElement, field: HTMLElement, key: string) {
  const kind = field.dataset.bulkFocusKind;
  const destination = key === "arrowdown" && kind === "answer" ? "memo"
    : key === "arrowup" && kind === "memo" ? "answer" : null;
  if (!destination || !bulkCaretIsAtEdge(field, key as BulkArrowKey)) return null;
  return [...container.querySelectorAll<HTMLElement>("[data-bulk-focus-kind][data-bulk-row-id]")]
    .find(candidate => candidate.dataset.bulkRowId === field.dataset.bulkRowId
      && candidate.dataset.bulkFocusKind === destination && candidate.getClientRects().length > 0) ?? null;
}

export function placeBulkCaret(field: HTMLElement, edge: "start" | "end") {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const offset = edge === "start" ? 0 : field.value.length;
    field.setSelectionRange(offset, offset);
    return;
  }
  if (!field.isContentEditable) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(field);
  // Place the caret inside the first/last text node, including nested bold
  // and underline spans, rather than on the contenteditable container edge.
  let boundary: Node = field;
  while (edge === "start" ? boundary.firstChild : boundary.lastChild) {
    boundary = (edge === "start" ? boundary.firstChild : boundary.lastChild)!;
  }
  if (boundary.nodeType === Node.TEXT_NODE) {
    range.setStart(boundary, edge === "start" ? 0 : boundary.textContent?.length ?? 0);
    range.collapse(true);
  } else range.collapse(edge === "start");
  selection.removeAllRanges();
  selection.addRange(range);
}

export function CardDialog({
  open,
  onOpenChange,
  initial,
  subjects,
  onSaved,
  mobileLayered = false,
  mobileTransition = "idle",
  onMobileBackReady,
  layered = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: StudyCard | null;
  subjects: string[];
  onSaved: (card: StudyCard) => void;
  mobileLayered?: boolean;
  mobileTransition?: "idle" | "entering" | "leaving";
  onMobileBackReady?: (handler: (() => void) | null) => void;
  layered?: boolean;
}) {
  const [draft, setDraft] = useState<CardDraft>(() => {
    const next = draftFromCard(initial, readLastCardContentType());
    return next.subject || !subjects.length ? next : { ...next, subject: subjects[0] };
  });
  const originalDraftRef = useRef(JSON.stringify(draft));
  const formRef = useRef<HTMLFormElement | null>(null);
  const viewport = useVisibleViewport();
  const isMobile = viewport.width > 0 && viewport.width < 760;
  const [savingRequest, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const { uploading, uploadCount, onBusyChange } = useImageUploadGuard();
  const saving = savingRequest || uploading;
  const updateImages = (field: MediaField, images: CardImage[]) => setDraft((previous) => ({ ...previous, media: { ...normalizeMedia(previous.media), [field]: images } }));
  const [keywordChoices, setKeywordChoices] = useState<KeywordInheritanceChoice[]>([]);
  const subjectOptions = [...new Set([...subjects, draft.subject].filter(Boolean))];

  const requestClose = useCallback(() => {
    if (saving) return;
    if (isMobile && JSON.stringify(draft) !== originalDraftRef.current) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(false);
  }, [draft, isMobile, onOpenChange, saving]);

  const handleMobileBack = useCallback(() => {
    if (confirmClose) {
      setConfirmClose(false);
      return;
    }
    if (saving) return;
    if (keywordChoices.length) {
      setKeywordChoices([]);
      return;
    }
    requestClose();
  }, [confirmClose, keywordChoices.length, requestClose, saving]);

  useEffect(() => {
    if (!open || !onMobileBackReady) return;
    onMobileBackReady(handleMobileBack);
    return () => onMobileBackReady(null);
  }, [handleMobileBack, onMobileBackReady, open]);

  async function saveDraft(keywordInheritance: KeywordInheritanceChoice[] = []) {
    if (uploadCount.current) { toast.info("사진을 첨부하는 중이에요. 잠시만 기다려 주세요."); return; }
    setSaving(true);
    try {
      const payload = {
        ...draft,
        keywordsFromBold: true,
        keywordInheritance,
      };
      const result = await api<{ card: StudyCard }>(
        initial ? `/api/cards/${initial.id}` : "/api/cards",
        { method: initial ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      onSaved(result.card);
      setKeywordChoices([]);
      onOpenChange(false);
      toast.success(initial ? "카드를 수정했어요." : "새 카드를 저장했어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function requestSave() {
    const choices = initial && !isTableFormat(draft.answerFormat)
      ? keywordSplitChoices(initial.keywords, extractBoldKeywords(draft.answerFormat))
      : [];
    if (choices.length) {
      setKeywordChoices(choices);
      return;
    }
    void saveDraft();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    requestSave();
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { if (uploadCount.current) { toast.info("사진을 첨부하는 중이에요."); return; } if (next) onOpenChange(true); else requestClose(); }}>
      <DialogContent
        className={`card-editor-dialog${layered ? " stacked-dialog" : ""}${mobileLayered ? " is-mobile-layered" : ""}${mobileTransition !== "idle" ? ` is-mobile-${mobileTransition}` : ""} max-h-[92dvh] overflow-y-auto rounded-[28px] border-0 p-5 sm:max-w-xl sm:p-7`}
        overlayClassName={mobileLayered ? `mobile-layered-overlay${mobileTransition !== "idle" ? ` is-${mobileTransition}` : ""}` : layered ? "stacked-dialog-overlay" : undefined}
      >
        <DialogHeader className="pr-7 text-left">
          <div className="card-title-with-preview"><DialogTitle>{initial ? "카드 편집" : "새 카드"}</DialogTitle><div className="card-photo-toolbar"><PhotoAttachButton media={draft.media} onChange={updateImages} onBusyChange={onBusyChange} disabled={savingRequest} /><CardPreviewButton card={draft} /></div></div>
          <DialogDescription>질문은 짧게, 답은 내가 말할 문장처럼 적어보세요.</DialogDescription>
        </DialogHeader>
        <ImageMoveProvider media={draft.media} disabled={saving} onMove={(from, to, imageId) => setDraft((previous) => ({ ...previous, media: moveCardImage(previous.media, from, to, imageId) }))}>
        <form ref={formRef} className="card-form" onSubmit={submit} onKeyDown={preventEnterSubmit}>
          <section className="card-meta-panel" aria-label="카드 분류와 위치">
            <div className="card-location-grid">
              <div>
                <FieldLabel>과목</FieldLabel>
                <Select value={draft.subject} onValueChange={(subject) => setDraft((previous) => ({ ...previous, subject }))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="과목 선택" /></SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((subject) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel>섹션</FieldLabel>
                <Input value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })} placeholder="예: 교육과정" required />
              </div>
              <div>
                <FieldLabel>하위</FieldLabel>
                <Input value={draft.subsection} onChange={(e) => setDraft((previous) => ({ ...previous, subsection: e.target.value, detailSection: e.target.value ? previous.detailSection : "" }))} placeholder="선택" />
              </div>
              <div>
                <FieldLabel>세부</FieldLabel>
                <Input value={draft.detailSection} onChange={(e) => setDraft({ ...draft, detailSection: e.target.value })} placeholder="선택" />
              </div>
            </div>
            <div className="card-meta-controls">
              <div>
                <FieldLabel>분류</FieldLabel>
                <Select
                  value={draft.contentType}
                  onValueChange={(value) => {
                    const contentType = normalizeCardContentType(value);
                    setDraft((previous) => ({ ...previous, contentType }));
                    rememberLastCardContentType(contentType);
                  }}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CARD_CONTENT_TYPES.map((contentType) => <SelectItem key={contentType} value={contentType}>{contentType}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel>중요도</FieldLabel>
                <button
                  type="button"
                  className={`card-importance-toggle${draft.importance >= 2 ? " is-important" : ""}`}
                  aria-label={draft.importance >= 2 ? "중요 표시 해제" : "중요 카드로 표시"}
                  aria-pressed={draft.importance >= 2}
                  onClick={() => setDraft((previous) => ({ ...previous, importance: previous.importance >= 2 ? 1 : 2 }))}
                >
                  <Star fill={draft.importance >= 2 ? "currentColor" : "none"} />
                  <span>{draft.importance >= 2 ? "중요" : "일반"}</span>
                </button>
              </div>
            </div>
          </section>
          <div>
            <div className="card-field-heading"><FieldLabel>질문</FieldLabel><span>굵게 → 연결 키워드<span className="desktop-shortcut-help"> · ⌘/Ctrl+B 굵게 · U 밑줄</span></span></div>
            <FormattedTextEditor
              text={draft.question}
              images={draft.media.question} onImagesChange={(images) => updateImages("question", images)} onImageBusyChange={onBusyChange} imagesDisabled={savingRequest}
              format={draft.questionFormat}
              label="질문"
              placeholder="무엇을 떠올릴까요?"
              allowUnderline
              onChange={(question, questionFormat) => setDraft((previous) => ({ ...previous, question, questionFormat }))}
            />
          </div>
          <div>
            <div className="card-field-heading"><FieldLabel>답</FieldLabel><span>굵게 → 핵심 키워드<span className="desktop-shortcut-help"> · ⌘/Ctrl+B</span></span></div>
            <FormattedTextEditor
              text={draft.answer}
              images={draft.media.answer} onImagesChange={(images) => updateImages("answer", images)} onImageBusyChange={onBusyChange} imagesDisabled={savingRequest}
              format={draft.answerFormat}
              label="답"
              placeholder="핵심 답을 적어주세요."
              answer
              onChange={(answer, answerFormat) => setDraft((previous) => ({ ...previous, answer, answerFormat }))}
            />
          </div>
          <div>
            <FieldLabel>메모 (선택)</FieldLabel>
            <ImageField label="메모" mediaField="memo" images={draft.media.memo} onChange={(images) => updateImages("memo", images)} onBusyChange={onBusyChange} disabled={savingRequest}>
            <Textarea
              value={draft.memo}
              onChange={(event) => setDraft((previous) => ({ ...previous, memo: event.target.value }))}
              placeholder="관련 해설이나 청킹을 적어두세요."
              rows={4}
            />
            </ImageField>
          </div>
          <DialogFooter className="card-form-actions mt-2">
            <Button type="button" variant="outline" disabled={saving} onClick={requestClose}>취소</Button>
            <Button type="submit" disabled={saving}>{saving ? "저장 중…" : "저장하기"}</Button>
          </DialogFooter>
        </form>
        </ImageMoveProvider>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
      <AlertDialogContent overlayClassName="card-editor-alert-overlay" className="card-editor-alert-dialog rounded-[26px]">
        <AlertDialogHeader>
          <AlertDialogTitle>수정한 카드를 닫을까요?</AlertDialogTitle>
          <AlertDialogDescription>저장하지 않고 닫으면 이번 수정 내용은 사라져요.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>계속 편집</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={saving} onClick={() => { setConfirmClose(false); onOpenChange(false); }}>저장하지 않고 닫기</AlertDialogAction>
          <AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); setConfirmClose(false); formRef.current?.requestSubmit(); }}>저장하고 닫기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={keywordChoices.length > 0} onOpenChange={(nextOpen) => !nextOpen && !saving && setKeywordChoices([])}>
      <AlertDialogContent overlayClassName="card-editor-alert-overlay" className="card-editor-alert-dialog keyword-inheritance-dialog rounded-[26px]">
        <AlertDialogHeader>
          <AlertDialogTitle>기존 키워드 기록을 어디에 이어줄까요?</AlertDialogTitle>
          <AlertDialogDescription>모두 선택됨 · 전부 해제하면 새 기록으로 시작해요.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="keyword-inheritance-list">
          {keywordChoices.map((choice) => (
            <section className="keyword-inheritance-group" key={choice.sourceKeyword}>
              <p><span>나누기 전</span><strong>{choice.sourceKeyword}</strong></p>
              <div>
                {choice.targetKeywords.map((keyword) => (
                  <label key={keyword}>
                    <Checkbox
                      checked={choice.selectedTargetKeywords.includes(keyword)}
                      onCheckedChange={(checked) => setKeywordChoices((previous) =>
                        toggleKeywordInheritanceTarget(previous, choice.sourceKeyword, keyword, checked === true)
                      )}
                    />
                    <span>{keyword}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <AlertDialogFooter className="keyword-inheritance-actions">
          <AlertDialogCancel disabled={saving}>돌아가기</AlertDialogCancel>
          <AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); void saveDraft(keywordChoices); }}>
            {saving ? "저장 중…" : "선택대로 저장"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function FinalDeleteDialog({
  open,
  itemLabel,
  archiveAvailable,
  archiveMessage,
  busy = false,
  onOpenChange,
  onDelete,
  onArchive,
}: {
  open: boolean;
  itemLabel: string;
  archiveAvailable: boolean;
  archiveMessage: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void | Promise<void>;
  onArchive?: () => void | Promise<void>;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <AlertDialogContent size="sm" className="final-delete-dialog rounded-[24px]">
        <AlertDialogHeader>
          <AlertDialogTitle>마지막으로 한 번 더 확인해 주세요</AlertDialogTitle>
          <AlertDialogDescription><strong>{itemLabel}</strong> — 삭제하면 다시 복구할 수 없어요.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className={`final-delete-archive-note${archiveAvailable ? " is-available" : " is-unavailable"}`}>
          <span><Archive /></span>
          <div><strong>{archiveAvailable ? "삭제하지 않고 보관할 수도 있어요." : "이 항목은 보관할 수 없어요."}</strong><small>{archiveMessage}</small></div>
        </div>
        <AlertDialogFooter className="final-delete-actions">
          <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => { event.preventDefault(); void onDelete(); }}
          >삭제</AlertDialogAction>
          <AlertDialogAction
            variant="outline"
            className="final-archive-button"
            disabled={busy || !archiveAvailable || !onArchive}
            onClick={(event) => { event.preventDefault(); void onArchive?.(); }}
          ><Archive /> 보관</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function bulkEditorShortcutKey(event: { key: string; code?: string }) {
  // Physical key codes stay the same when the Korean/English input mode changes.
  if (event.code === "KeyZ" || event.key === "ㅋ") return "z";
  if (event.code === "KeyY" || event.key === "ㅛ") return "y";
  return event.key.toLowerCase();
}

export function bulkDuplicateInsertionIndex(event: React.KeyboardEvent<HTMLElement>, rows: Pick<BulkRow, "id" | "type">[]) {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || !event.shiftKey
    || event.altKey || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return null;
  if (!(event.target instanceof HTMLElement) || !event.currentTarget.contains(event.target)) return null;
  const gap = event.target.closest<HTMLElement>("[data-bulk-gap-index]");
  if (gap) {
    const index = Number(gap.dataset.bulkGapIndex);
    return Number.isInteger(index) && rows[index - 1]?.type === "card" ? index : null;
  }
  const field = event.target.closest<HTMLElement>("[data-bulk-focus-kind][data-bulk-row-id]");
  const index = rows.findIndex(row => row.id === field?.dataset.bulkRowId);
  return index >= 0 && rows[index].type === "card" ? index + 1 : null;
}

export function bulkBackspaceTarget(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Backspace" || event.defaultPrevented || event.repeat || event.shiftKey
    || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return null;
  const field = event.target instanceof HTMLElement ? event.target : null;
  if (!field || !event.currentTarget.contains(field) || !field.dataset.bulkRowId
    || !(field instanceof HTMLTextAreaElement || field.isContentEditable)) return null;
  const destination = field.dataset.bulkFocusKind === "memo" ? "answer"
    : field.dataset.bulkFocusKind === "answer" ? "question" : null;
  if (!destination || !bulkCaretIsAtEdge(field, "arrowleft")) return null;
  if (field.isContentEditable) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const prefix = selection.getRangeAt(0).cloneRange();
    prefix.setStart(field, 0);
    // Range.toString omits BRs: deleting a leading blank line is still editing,
    // not a request to leave the answer field.
    if (prefix.cloneContents().querySelector("br, img, hr")) return null;
  }
  return [...event.currentTarget.querySelectorAll<HTMLElement>("[data-bulk-row-id][data-bulk-focus-kind]")]
    .find(candidate => candidate.dataset.bulkRowId === field.dataset.bulkRowId
      && candidate.dataset.bulkFocusKind === destination && candidate.getClientRects().length > 0) ?? null;
}

export function isEmptyBulkRow(row: BulkRow) {
  if (row.type === "divider") return !row.title.trim();
  return !row.question.trim() && !plainFormattedText(row.questionFormat).trim()
    && !row.answer.trim() && !isTableFormat(row.answerFormat) && !plainFormattedText(row.answerFormat).trim()
    && !row.memo.trim() && !Object.values(normalizeMedia(row.media)).some(images => images.length > 0);
}

export function bulkEmptyRowRemoval(event: React.KeyboardEvent<HTMLElement>, rows: BulkRow[]) {
  if (event.key !== "Backspace" || event.defaultPrevented || event.repeat || event.shiftKey
    || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return null;
  const field = event.target instanceof HTMLElement ? event.target : null;
  if (!field || !event.currentTarget.contains(field)
    || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field.isContentEditable)) return null;
  const text = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : field.innerText;
  if (text.trim() || !bulkCaretIsAtEdge(field, "arrowleft")) return null;
  const id = field.closest<HTMLElement>("[data-bulk-empty-delete-row]")?.dataset.bulkEmptyDeleteRow;
  const row = rows.find(row => row.id === id);
  return row && isEmptyBulkRow(row) ? row : null;
}

export function bulkReverseTabTarget(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab" || !event.shiftKey || event.defaultPrevented || event.ctrlKey
    || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return null;
  const field = event.target instanceof HTMLElement ? event.target : null;
  const order = ["content-type", "question", "answer", "memo"];
  if (!field || !event.currentTarget.contains(field) || !field.dataset.bulkRowId
    || !order.includes(field.dataset.bulkFocusKind ?? "")) return null;
  // DOM order follows the card rows, including table-card titles. Exclude tools,
  // section headings and collapsed cards from this input-only reverse sequence.
  const fields = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-bulk-row-id][data-bulk-focus-kind]")]
    .filter(candidate => order.includes(candidate.dataset.bulkFocusKind ?? "") && candidate.getClientRects().length > 0);
  const index = fields.indexOf(field);
  return index > 0 ? fields[index - 1] : field;
}

export function bulkEnterNavigation(event: React.KeyboardEvent<HTMLElement>): { rowId: string; destination: BulkFocusKind | "new-card" } | null {
  if (event.key !== "Enter" || event.defaultPrevented || event.repeat || event.shiftKey
    || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return null;
  const field = event.target instanceof HTMLElement ? event.target : null;
  // Only the input itself: buttons, uploads and nested table editors keep Enter.
  if (!field || !event.currentTarget.contains(field) || !field.dataset.bulkRowId) return null;
  const kind = field.dataset.bulkFocusKind;
  const destination = kind === "content-type" ? "question" : kind === "question" ? "answer"
    : kind === "answer" ? "memo" : kind === "memo" || kind === "divider" ? "new-card" : null;
  return destination ? { rowId: field.dataset.bulkRowId, destination } : null;
}

export function isBulkCardSelectionTarget(target: EventTarget | null, row: Element) {
  if (!(target instanceof Element) || !row.contains(target)) return false;
  // Only the left/right rails, never an editor or an existing control.
  return Boolean(target.closest(".bulk-number-cell, .bulk-type-cell, .bulk-tools-cell"))
    && !target.closest("button, a, input, textarea, select, [contenteditable], [role='listbox'], [role='option'], [role='button']");
}

export function BulkCreateDialog({
  open,
  onOpenChange,
  initialSubject,
  initialSet,
  initialSelectedCardId,
  startInSetMode,
  subjects,
  cards,
  onSaved,
  onCardArchived,
  onSetSaved,
  onView,
  onMobileBackReady,
  layered = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSubject: string;
  initialSet: StudySet | null;
  initialSelectedCardId: number | null;
  startInSetMode: boolean;
  subjects: string[];
  cards: StudyCard[];
  onSaved: (cards: StudyCard[], subject: string) => void;
  onCardArchived: (card: StudyCard) => void;
  onSetSaved: (set: StudySet) => void;
  onView: (subject: string) => void;
  onMobileBackReady?: (handler: (() => void) | null) => void;
  layered?: boolean;
}) {
  const startingSubject = initialSet?.subject ?? initialSubject;
  const [selectedSubject, setSelectedSubject] = useState(startingSubject);
  const [lastContentType, setLastContentType] = useState<CardContentType>(() => readLastCardContentType());
  const [rows, setRows] = useState<BulkRow[]>(() => rowsFromCards(cards.filter((card) => card.subject === startingSubject), lastContentType));
  const [savingRequest, setSaving] = useState(false);
  const { uploading, uploadCount, onBusyChange } = useImageUploadGuard();
  const saving = savingRequest || uploading;
  const [editorSetSelection, setEditorSetSelection] = useState<string[] | null>(null);
  const editorSetSelectionRef = useRef<string[] | null>(null);
  const editorSelectionAnchorRef = useRef<string | null>(null);
  const selectionViewport = useVisibleViewport();
  const desktopSelection = selectionViewport.width >= 760 && desktopEditorSelection();
  const selectionBlocksEditing = !desktopSelection && editorSetSelection !== null;
  const [pendingSelectedRemoval, setPendingSelectedRemoval] = useState<string[] | null>(null);
  const [finalSelectedRemoval, setFinalSelectedRemoval] = useState<string[] | null>(null);
  const emptyDeletionIdsRef = useRef<number[] | null>(null);
  useEffect(() => {
    const selection = editorSetSelectionRef.current;
    if (!selection) return;
    const ids = new Set(rows.filter(row => row.type === "card").map(row => row.id));
    const next = selection.filter(id => ids.has(id));
    if (next.length !== selection.length) {
      editorSetSelectionRef.current = next.length ? next : null;
      setEditorSetSelection(editorSetSelectionRef.current);
    }
    if (editorSelectionAnchorRef.current && !ids.has(editorSelectionAnchorRef.current)) editorSelectionAnchorRef.current = null;
  }, [rows]);
  const [editorSetDetails, setEditorSetDetails] = useState(false);
  const setMode = startInSetMode || Boolean(initialSet) || editorSetDetails;
  const [setId, setSetId] = useState<number | null>(initialSet?.id ?? null);
  const [setName, setSetName] = useState(initialSet?.name ?? "");
  const [setMemo, setSetMemo] = useState(initialSet?.memo ?? "");
  const [setCardIds, setSetCardIds] = useState<number[]>(initialSet?.cardIds ?? (initialSelectedCardId ? [initialSelectedCardId] : []));
  const [setCreateStep, setSetCreateStep] = useState<"cards" | "details">("cards");
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dragTargetRowId, setDragTargetRowId] = useState<string | null>(null);
  const [pickedPointer, setPickedPointer] = useState<{ x: number; y: number } | null>(null);
  const [pickedDragMetrics, setPickedDragMetrics] = useState<BulkDragMetrics | null>(null);
  const [collapsedDividerIds, setCollapsedDividerIds] = useState<Set<string>>(() => new Set());
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [historyRevision, setHistoryRevision] = useState(0);
  const [savedEditorContents, setSavedEditorContents] = useState(new Map<string, { question: SavedEditorContent; answer: SavedEditorContent }>());
  const [pendingRemoval, setPendingRemoval] = useState<BulkRow | null>(null);
  const [finalPendingRemoval, setFinalPendingRemoval] = useState<BulkRow | null>(null);
  const keyboardRemovalIdRef = useRef<string | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const [pendingKeywordInheritance, setPendingKeywordInheritance] = useState<PendingKeywordInheritance[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [closing, setClosing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [mobileInsertIndex, setMobileInsertIndex] = useState<number | null>(null);
  const [mobileDraftRowId, setMobileDraftRowId] = useState<string | null>(null);
  const [mobileRecentlySavedRowId, setMobileRecentlySavedRowId] = useState<string | null>(null);
  const savedSnapshotRef = useRef(bulkSnapshot(selectedSubject, rows));
  const keywordInheritanceOverridesRef = useRef(new Map<string, KeywordInheritanceChoice[]>());
  const rowsRef = useRef(rows);
  const selectedSubjectRef = useRef(selectedSubject);
  const lastContentTypeRef = useRef(lastContentType);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAutoSaveRef = useRef<(delay?: number) => void>(() => undefined);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const saveQueuedRef = useRef(false);
  const saveWithErrorsRef = useRef(false);
  const restoredDraftRef = useRef(false);
  const undoStackRef = useRef<BulkRow[][]>([]);
  const redoStackRef = useRef<BulkRow[][]>([]);
  const lastHistoryChangeRef = useRef<{ key: string; at: number } | null>(null);
  const dragScrollFrameRef = useRef<number | null>(null);
  const dragScrollSpeedRef = useRef(0);
  const dragScrollContainerRef = useRef<HTMLElement | null>(null);
  const bulkDialogRef = useRef<HTMLDivElement | null>(null);
  const editorSetReturnScrollRef = useRef<number | null>(null);
  const mobilePositionListRef = useRef<HTMLDivElement | null>(null);
  const mobileReturnPositionRef = useRef<{ rowId: string | null; scrollTop: number } | null>(null);
  const mobileBackHandlerRef = useRef<() => void>(() => undefined);
  const mobileInitialPositionScrolledRef = useRef(false);
  const pickedPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastNativeDragEndAtRef = useRef(0);

  useLayoutEffect(() => {
    const dialog = bulkDialogRef.current?.querySelector<HTMLElement>(".bulk-form");
    if (!dialog || editorSetReturnScrollRef.current === null) return;
    // Keep the card editor mounted; only replace its content while editing the set.
    dialog.scrollTo({ top: editorSetDetails ? 0 : editorSetReturnScrollRef.current, behavior: "instant" });
    if (!editorSetDetails) editorSetReturnScrollRef.current = null;
  }, [editorSetDetails]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    selectedSubjectRef.current = selectedSubject;
  }, [selectedSubject]);

  useLayoutEffect(() => {
    if (
      !open
      || setMode
      || mobileInsertIndex !== null
      || mobileDraftRowId
      || mobileReturnPositionRef.current
      || mobileInitialPositionScrolledRef.current
    ) return;
    const frame = requestAnimationFrame(() => {
      const list = mobilePositionListRef.current;
      if (!list || list.clientHeight === 0) return;
      list.scrollTop = list.scrollHeight;
      mobileInitialPositionScrolledRef.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [mobileDraftRowId, mobileInsertIndex, open, rows.length, setMode]);

  useLayoutEffect(() => {
    if (mobileInsertIndex !== null || mobileDraftRowId || !mobileReturnPositionRef.current) return;
    const returnPosition = mobileReturnPositionRef.current;
    mobileReturnPositionRef.current = null;
    const frame = requestAnimationFrame(() => {
      const list = mobilePositionListRef.current;
      if (!list) return;
      const savedChoice = [...list.querySelectorAll<HTMLElement>("[data-mobile-position-row-id]")]
        .find((choice) => choice.dataset.mobilePositionRowId === returnPosition.rowId);
      if (!savedChoice) {
        list.scrollTop = returnPosition.scrollTop;
        return;
      }
      const centeredTop = savedChoice.offsetTop - (list.clientHeight - savedChoice.offsetHeight) / 2;
      list.scrollTo({
        top: Math.max(0, centeredTop),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [mobileDraftRowId, mobileInsertIndex, rows]);

  useEffect(() => {
    if (!mobileRecentlySavedRowId) return;
    const timer = window.setTimeout(() => setMobileRecentlySavedRowId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [mobileRecentlySavedRowId]);

  const pickingWithPointer = pickedPointer !== null;
  const followPickedPointer = useEffectEvent((event: PointerEvent) => {
    const nextPointer = { x: event.clientX, y: event.clientY };
    pickedPointerRef.current = nextPointer;
    setPickedPointer(nextPointer);
    updatePickedDropTarget(event.clientX, event.clientY);
    updatePickedAutoScroll(event.clientX, event.clientY);
  });
  const cancelPickedOnOutsidePress = useEffectEvent((event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".drag-handle")) return;
    const gap = target?.closest<HTMLElement>("[data-bulk-gap-index]");
    const dropLine = gap?.querySelector<HTMLElement>(".bulk-insert-actions");
    if (gap && dropLine && isBulkInsertionTargetHit(dropLine, event.clientX, event.clientY, 1)) return;
    cancelPickedRowMove();
  });

  useEffect(() => {
    if (!draggedRowId || !pickingWithPointer) return;
    document.addEventListener("pointermove", followPickedPointer);
    document.addEventListener("pointerdown", cancelPickedOnOutsidePress);
    return () => {
      document.removeEventListener("pointermove", followPickedPointer);
      document.removeEventListener("pointerdown", cancelPickedOnOutsidePress);
    };
  }, [draggedRowId, pickingWithPointer]);

  useEffect(() => {
    if (restoredDraftRef.current) return;
    restoredDraftRef.current = true;
    const subjectCards = cards.filter((card) => card.subject === startingSubject);
    const newestServerTime = Math.max(0, ...subjectCards.map((card) => Date.parse(card.updatedAt) || 0));
    const draft = readBulkDraft(startingSubject);
    if (!draft || Date.parse(draft.updatedAt) <= newestServerTime || bulkSnapshot(startingSubject, draft.rows) === savedSnapshotRef.current) return;
    rowsRef.current = draft.rows;
    setRows(draft.rows);
    setSaveState("unsaved");
    scheduleAutoSaveRef.current(800);
  }, [cards, startingSubject]);

  useEffect(() => {
    const flushDraft = () => persistDraftBackup();
    const flushHiddenDraft = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", flushHiddenDraft);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (dragScrollFrameRef.current !== null) cancelAnimationFrame(dragScrollFrameRef.current);
      flushDraft();
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", flushHiddenDraft);
    };
  }, []);

  function syncHistoryCounts() {
    setHistoryCounts({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  }

  function resetRowHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastHistoryChangeRef.current = null;
    syncHistoryCounts();
  }

  function rememberRowHistory(previous: BulkRow[], historyKey: string | null) {
    const now = Date.now();
    const lastChange = lastHistoryChangeRef.current;
    const coalesce = Boolean(historyKey && lastChange?.key === historyKey && now - lastChange.at < 800);
    if (!coalesce) undoStackRef.current = [...undoStackRef.current.slice(-99), previous];
    redoStackRef.current = [];
    lastHistoryChangeRef.current = historyKey ? { key: historyKey, at: now } : null;
    syncHistoryCounts();
  }

  function applyRowsFromHistory(next: BulkRow[]) {
    stopDragAutoScroll();
    pickedPointerRef.current = null;
    setPickedPointer(null);
    setPickedDragMetrics(null);
    rowsRef.current = next;
    setRows(next);
    setHistoryRevision((revision) => revision + 1);
    setSaveState(bulkSnapshot(selectedSubjectRef.current, next) === savedSnapshotRef.current ? "saved" : "unsaved");
    setDraggedRowId(null);
    setDragTargetRowId(null);
    lastHistoryChangeRef.current = null;
    scheduleDraftBackup();
    scheduleAutoSave(400);
  }

  function undoRows() {
    const previous = undoStackRef.current.at(-1);
    if (!previous) return;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-99), rowsRef.current];
    applyRowsFromHistory(previous);
    syncHistoryCounts();
  }

  function redoRows() {
    const next = redoStackRef.current.at(-1);
    if (!next) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-99), rowsRef.current];
    applyRowsFromHistory(next);
    syncHistoryCounts();
  }

  function changeRows(updater: (previous: BulkRow[]) => BulkRow[], historyKey: string | null = null) {
    const previous = rowsRef.current;
    const next = updater(previous);
    if (bulkSnapshot(selectedSubjectRef.current, previous) === bulkSnapshot(selectedSubjectRef.current, next)) return;
    rememberRowHistory(previous, historyKey);
    setSaveState(bulkSnapshot(selectedSubjectRef.current, next) === savedSnapshotRef.current ? "saved" : "unsaved");
    rowsRef.current = next;
    setRows(next);
    scheduleDraftBackup();
  }

  const selectableSetCards = cards
    .filter((card) => card.subject === selectedSubject)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  function updateAnswer(id: string, answer: string, answerFormat: string) {
    const current = rowsRef.current.find((row) => row.id === id);
    const formatOnly = current?.type === "card" && current.answer === answer && current.answerFormat !== answerFormat;
    changeRows(
      (previous) => previous.map((row) =>
        row.id === id && row.type === "card" ? { ...row, answer, answerFormat } : row
      ),
      formatOnly ? null : `answer:${id}`,
    );
  }

  function updateImages(id: string, field: MediaField, images: CardImage[]) {
    changeRows((previous) => previous.map((row) => row.id === id && row.type === "card"
      ? { ...row, media: { ...normalizeMedia(row.media), [field]: images } } : row), `media:${id}:${field}`);
    scheduleAutoSave();
  }

  function moveImage(id: string, from: MediaField, to: MediaField, imageId: string) {
    changeRows((previous) => previous.map((row) => row.id === id && row.type === "card"
      ? { ...row, media: moveCardImage(normalizeMedia(row.media), from, to, imageId) } : row));
    scheduleAutoSave();
  }

  function updateMemo(id: string, memo: string) {
    changeRows(
      (previous) => previous.map((row) =>
        row.id === id && row.type === "card" ? { ...row, memo } : row
      ),
      `memo:${id}`,
    );
  }

  function updateQuestion(id: string, question: string, questionFormat: string) {
    const current = rowsRef.current.find((row) => row.id === id);
    const formatOnly = current?.type === "card" && current.question === question && current.questionFormat !== questionFormat;
    changeRows(
      (previous) => previous.map((row) =>
        row.id === id && row.type === "card" ? { ...row, question, questionFormat } : row
      ),
      formatOnly ? null : `question:${id}`,
    );
  }

  function updateContentType(id: string, value: string) {
    const contentType = normalizeCardContentType(value);
    lastContentTypeRef.current = contentType;
    setLastContentType(contentType);
    rememberLastCardContentType(contentType);
    changeRows((previous) => previous.map((row) =>
      row.id === id && row.type === "card" ? { ...row, contentType } : row
    ));
    scheduleAutoSave();
  }

  function chooseMobileInsertPosition(index: number) {
    if (rowsRef.current.length >= 100) {
      toast.error("한 번에 편집할 수 있는 줄은 100개까지예요.");
      return;
    }
    mobileReturnPositionRef.current = {
      rowId: null,
      scrollTop: mobilePositionListRef.current?.scrollTop ?? 0,
    };
    setMobileRecentlySavedRowId(null);
    setMobileInsertIndex(index);
  }

  function startMobileDraft(kind: "card" | 1 | 2 | 3) {
    if (mobileInsertIndex === null || rowsRef.current.length >= 100) return;
    const hierarchy = hierarchyBefore(mobileInsertIndex);
    if (kind === 2 && !hierarchy.hasSection) {
      toast.error("먼저 상위 섹션을 만들어 주세요.");
      return;
    }
    if (kind === 3 && !hierarchy.hasSubsection) {
      toast.error("먼저 하부를 만들어 주세요.");
      return;
    }
    const next: BulkRow = kind === "card"
      ? newCardRow("", lastContentTypeRef.current)
      : { id: bulkRowId(), type: "divider", level: kind, title: "" };
    if (mobileReturnPositionRef.current) mobileReturnPositionRef.current.rowId = next.id;
    changeRows((previous) => [
      ...previous.slice(0, mobileInsertIndex),
      next,
      ...previous.slice(mobileInsertIndex),
    ]);
    setMobileDraftRowId(next.id);
  }

  function updateMobileDraft(updater: (row: BulkCardRow) => BulkCardRow) {
    if (!mobileDraftRowId) return;
    const current = rowsRef.current.find(row => row.id === mobileDraftRowId);
    if (!current || current.type !== "card") return;
    const next = updater(current);
    const formatOnly = current.question === next.question && current.answer === next.answer
      && (current.questionFormat !== next.questionFormat || current.answerFormat !== next.answerFormat);
    changeRows(
      (previous) => previous.map((row) =>
        row.id === mobileDraftRowId && row.type === "card" ? next : row
      ),
      formatOnly ? null : `mobile-card:${mobileDraftRowId}`,
    );
  }

  function updateMobileContentType(value: string) {
    const contentType = normalizeCardContentType(value);
    lastContentTypeRef.current = contentType;
    setLastContentType(contentType);
    rememberLastCardContentType(contentType);
    updateMobileDraft((row) => ({ ...row, contentType }));
  }

  function discardMobileDraft(returnToKind = false) {
    if (uploadCount.current) { toast.info("사진을 첨부하는 중이에요."); return; }
    if (!mobileDraftRowId) return;
    changeRows((previous) => {
      const next = previous.filter((row) => row.id !== mobileDraftRowId);
      return next.length ? next : [newCardRow("", lastContentTypeRef.current)];
    });
    setMobileRecentlySavedRowId(null);
    setMobileDraftRowId(null);
    if (!returnToKind) setMobileInsertIndex(null);
  }

  function cancelMobileInsertKind() {
    setMobileRecentlySavedRowId(null);
    setMobileInsertIndex(null);
  }

  async function saveMobileDraft() {
    const draftRow = rowsRef.current.find((row) => row.id === mobileDraftRowId);
    if (!draftRow) return;
    if (draftRow.type === "card" && (!draftRow.question.trim() || !draftRow.answer.trim())) {
      toast.error("질문과 답을 모두 입력해 주세요.");
      return;
    }
    if (draftRow.type === "divider" && !draftRow.title.trim()) {
      toast.error(`${draftRow.level === 1 ? "섹션" : draftRow.level === 2 ? "하부" : "세부"} 이름을 입력해 주세요.`);
      return;
    }
    const saved = await persistCards(true);
    if (!saved) return;
    const savedRowIndex = rowsRef.current.findIndex((row) => row.id === draftRow.id);
    setMobileRecentlySavedRowId(draftRow.id);
    const savedLabel = draftRow.type === "card" ? "카드" : draftRow.level === 1 ? "섹션" : draftRow.level === 2 ? "하부" : "세부";
    if (savedRowIndex < 0 || rowsRef.current.length >= 100) {
      setMobileDraftRowId(null);
      setMobileInsertIndex(null);
      toast.success(`${savedLabel}을 추가했어요.`);
      return;
    }

    const nextInsertIndex = savedRowIndex + 1;
    const nextCard = newCardRow("", lastContentTypeRef.current);
    mobileReturnPositionRef.current = {
      rowId: draftRow.id,
      scrollTop: mobileReturnPositionRef.current?.scrollTop ?? 0,
    };
    changeRows((previous) => [
      ...previous.slice(0, nextInsertIndex),
      nextCard,
      ...previous.slice(nextInsertIndex),
    ]);
    setMobileInsertIndex(nextInsertIndex);
    setMobileDraftRowId(nextCard.id);
    toast.success(`${savedLabel}을 추가했어요. 바로 아래에 새 카드를 이어서 만들어요.`);
  }

  function toggleImportant(id: string) {
    changeRows((previous) =>
      previous.map((row) =>
        row.id === id && row.type === "card"
          ? { ...row, important: !row.important }
          : row
      )
    );
    scheduleAutoSave();
  }

  function updateDivider(id: string, title: string) {
    changeRows(
      (previous) => previous.map((row) =>
        row.id === id && row.type === "divider" ? { ...row, title } : row
      ),
      `divider:${id}`,
    );
  }

  function insertCardAt(index: number, contentType = lastContentTypeRef.current) {
    if (rows.length >= 100) return;
    const next = newCardRow("", contentType);
    changeRows((previous) => [
      ...previous.slice(0, index),
      next,
      ...previous.slice(index),
    ]);
    focusBulkField("content-type", next.id);
  }

  function duplicateCardAbove(index: number) {
    const source = rowsRef.current[index - 1];
    if (rowsRef.current.length >= 100 || source?.type !== "card") return;
    const next = duplicateBulkCardRow(source);
    changeRows((previous) => [
      ...previous.slice(0, index),
      next,
      ...previous.slice(index),
    ]);
    focusBulkField("question", next.id);
  }

  function hierarchyBefore(index: number) {
    let hasSection = false;
    let hasSubsection = false;
    for (const row of rows.slice(0, index)) {
      if (row.type !== "divider") continue;
      if (row.level === 1) {
        hasSection = true;
        hasSubsection = false;
      } else if (row.level === 2 && hasSection) {
        hasSubsection = true;
      }
    }
    return { hasSection, hasSubsection };
  }

  function insertDividerAt(index: number, level: 1 | 2 | 3, focusAfterInsert = false) {
    if (rows.length >= 100) return;
    const hierarchy = hierarchyBefore(index);
    if (level === 2 && !hierarchy.hasSection) {
      toast.error("먼저 상위 섹션을 만들어 주세요.");
      return;
    }
    if (level === 3 && !hierarchy.hasSubsection) {
      toast.error("먼저 하위 섹션을 만들어 주세요.");
      return;
    }
    const next = { id: bulkRowId(), type: "divider" as const, level, title: "" };
    changeRows((previous) => [
      ...previous.slice(0, index),
      next,
      ...previous.slice(index),
    ]);
    if (focusAfterInsert) focusBulkField("divider", next.id);
  }

  function moveRow(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    changeRows((previous) => moveBulkRowGroup(previous, sourceId, targetId));
  }

  function toggleDividerCollapsed(rowId: string) {
    setCollapsedDividerIds((previous) => {
      const next = new Set(previous);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function handleBulkEditorNavigation(event: React.KeyboardEvent<HTMLFormElement>) {
    // React portals bubble through the card form, but the table dialog owns its keys.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (setMode || (!desktopEditorSelection() && editorSetSelectionRef.current !== null)) return;
    if (handleEditorListKey(event)) return;
    const emptyRow = bulkEmptyRowRemoval(event, rowsRef.current);
    if (emptyRow) {
      event.preventDefault();
      event.stopPropagation();
      if (!saving && !closing && !viewing && !uploadCount.current && !draggedRowId && !pendingRemoval && !finalPendingRemoval) {
        keyboardRemovalIdRef.current = emptyRow.id;
        setPendingRemoval(emptyRow);
      }
      return;
    }
    const previousField = bulkReverseTabTarget(event) ?? bulkBackspaceTarget(event);
    if (previousField) {
      event.preventDefault();
      event.stopPropagation();
      focusBulkElement(previousField, "end");
      return;
    }
    const duplicateIndex = bulkDuplicateInsertionIndex(event, rowsRef.current);
    if (duplicateIndex !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !saving && !closing && !viewing && !draggedRowId) duplicateCardAbove(duplicateIndex);
      return;
    }
    const navigation = bulkEnterNavigation(event);
    if (!navigation) return;
    const rowIndex = rows.findIndex(row => row.id === navigation.rowId);
    const row = rows[rowIndex];
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    if (row.type === "divider") {
      setCollapsedDividerIds(previous => { const next = new Set(previous); next.delete(row.id); return next; });
      insertCardAt(rowIndex + 1);
      return;
    }
    if (navigation.destination === "new-card") continueFromMemo(rowIndex, row.contentType);
    else focusBulkField(navigation.destination, row.id);
  }

  function handleBulkEditorKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    preventEnterSubmit(event);
    if (setMode) return;
    const key = bulkEditorShortcutKey(event);
    const shortcut = event.ctrlKey || event.metaKey;
    if (!event.altKey && shortcut && key === "z") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) redoRows();
      else undoRows();
      return;
    }
    if (!event.altKey && shortcut && key === "y" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      redoRows();
      return;
    }
    if (event.defaultPrevented || event.altKey || shortcut || event.shiftKey
      || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) return;

    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-bulk-focus-kind][data-bulk-row-id]")
      : null;
    if (!target || !bulkCaretIsAtEdge(target, key as "arrowup" | "arrowdown" | "arrowleft" | "arrowright")) return;

    const caretEdge = key === "arrowup" || key === "arrowleft" ? "end" : "start";
    // Answer and memo are vertically stacked inside the same card. Visit that
    // sibling before falling back to navigation between cards.
    const answerMemoTarget = bulkAnswerMemoArrowTarget(event.currentTarget, target, key);
    if (answerMemoTarget) {
      event.preventDefault();
      focusBulkElement(answerMemoTarget, caretEdge);
      return;
    }
    if (key === "arrowleft" || key === "arrowright") {
      const fields = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-bulk-focus-kind][data-bulk-row-id]")]
        .filter((field) => field.getClientRects().length > 0);
      const currentIndex = fields.indexOf(target);
      const nextField = fields[currentIndex + (key === "arrowleft" ? -1 : 1)];
      if (!nextField) return;
      event.preventDefault();
      focusBulkElement(nextField, caretEdge);
      return;
    }

    const visibleRowIds = visibleBulkRowIds(rows, collapsedDividerIds);
    const currentRowIndex = visibleRowIds.indexOf(target.dataset.bulkRowId ?? "");
    const nextRowId = visibleRowIds[currentRowIndex + (key === "arrowup" ? -1 : 1)];
    if (!nextRowId) return;
    const preferredKind = target.dataset.bulkFocusKind as BulkFocusKind;
    const nextRow = rows.find((row) => row.id === nextRowId);
    if (!nextRow) return;
    event.preventDefault();
    focusBulkField(nextRow.type === "divider" ? "divider" : preferredKind === "divider" ? "question" : preferredKind, nextRowId, caretEdge);
  }

  function createBulkDragGhost(rowId: string, width: number) {
    const sourceIndex = rowsRef.current.findIndex((row) => row.id === rowId);
    const source = rowsRef.current[sourceIndex];
    if (!source) return null;
    const group = rowsRef.current.slice(sourceIndex, bulkRowGroupEnd(rowsRef.current, sourceIndex));
    const cardsInGroup = group.filter((row): row is Extract<BulkRow, { type: "card" }> => row.type === "card");
    const dragGhost = document.createElement("div");
    dragGhost.className = `bulk-drag-ghost${source.type === "divider" ? " is-section-group" : " is-single-card"}`;
    dragGhost.style.width = `${width}px`;

    const heading = document.createElement("div");
    heading.className = "bulk-drag-ghost-heading";
    const headingText = document.createElement("strong");
    headingText.textContent = source.type === "divider"
      ? source.title || (source.level === 1 ? "섹션" : source.level === 2 ? "하위 섹션" : "세부 섹션")
      : source.question || "새 카드";
    const headingCount = document.createElement("span");
    headingCount.textContent = source.type === "divider" ? `${cardsInGroup.length}장 함께 이동` : "카드 1장";
    heading.append(headingText, headingCount);
    dragGhost.append(heading);

    if (source.type === "divider" && cardsInGroup.length > 0) {
      const stack = document.createElement("div");
      stack.className = "bulk-drag-ghost-stack";
      cardsInGroup.slice(0, 3).forEach((card, index) => {
        const cardPreview = document.createElement("div");
        cardPreview.className = "bulk-drag-ghost-card";
        cardPreview.style.setProperty("--stack-index", String(index));
        cardPreview.textContent = card.question || "내용을 입력하지 않은 카드";
        stack.append(cardPreview);
      });
      dragGhost.append(stack);
    }

    document.body.append(dragGhost);
    return dragGhost;
  }

  function stopDragAutoScroll() {
    dragScrollSpeedRef.current = 0;
    dragScrollContainerRef.current = null;
    if (dragScrollFrameRef.current !== null) cancelAnimationFrame(dragScrollFrameRef.current);
    dragScrollFrameRef.current = null;
  }

  function continueDragAutoScroll() {
    if (dragScrollFrameRef.current !== null) return;
    const scroll = () => {
      const container = dragScrollContainerRef.current;
      const speed = dragScrollSpeedRef.current;
      if (!container || speed === 0) {
        dragScrollFrameRef.current = null;
        return;
      }
      container.scrollTop += speed;
      const pointer = pickedPointerRef.current;
      if (pointer) updatePickedDropTarget(pointer.x, pointer.y);
      dragScrollFrameRef.current = requestAnimationFrame(scroll);
    };
    dragScrollFrameRef.current = requestAnimationFrame(scroll);
  }

  function setDragAutoScrollForPoint(container: HTMLElement, clientX: number, clientY: number) {
    const bounds = container.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
      stopDragAutoScroll();
      return;
    }
    const edgeSize = Math.min(96, Math.max(56, bounds.height * .18));
    const distanceFromTop = clientY - bounds.top;
    const distanceFromBottom = bounds.bottom - clientY;
    let speed = 0;
    if (distanceFromTop < edgeSize) {
      speed = -Math.max(4, Math.ceil((edgeSize - distanceFromTop) / edgeSize * 22));
    } else if (distanceFromBottom < edgeSize) {
      speed = Math.max(4, Math.ceil((edgeSize - distanceFromBottom) / edgeSize * 22));
    }

    if (speed === 0) {
      stopDragAutoScroll();
      return;
    }
    dragScrollContainerRef.current = container;
    dragScrollSpeedRef.current = speed;
    continueDragAutoScroll();
  }

  function updateDragAutoScroll(event: React.DragEvent<HTMLDivElement>) {
    if (!draggedRowId) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".bulk-insert-row")) setDragTargetRowId(null);
    const container = event.currentTarget.querySelector<HTMLElement>(".bulk-form");
    if (container) setDragAutoScrollForPoint(container, event.clientX, event.clientY);
  }

  function updatePickedAutoScroll(clientX: number, clientY: number) {
    const container = bulkDialogRef.current?.querySelector<HTMLElement>(".bulk-form");
    if (!container) return;
    setDragAutoScrollForPoint(container, clientX, clientY);
  }

  function updatePickedDropTarget(clientX: number, clientY: number) {
    const pointerTarget = document.elementFromPoint(clientX, clientY);
    const gap = pointerTarget?.closest<HTMLElement>("[data-bulk-gap-index]");
    const dropLine = gap?.querySelector<HTMLElement>(".bulk-insert-actions");
    const gapIndex = Number(gap?.dataset.bulkGapIndex);
    if (!draggedRowId || !gap || !dropLine || !Number.isInteger(gapIndex)
      || !isBulkInsertionTargetHit(dropLine, clientX, clientY, 1)) {
      setDragTargetRowId(null);
      return;
    }
    const targetId = bulkDropTargetForGap(rowsRef.current, draggedRowId, gapIndex);
    setDragTargetRowId(targetId);
  }

  function cancelPickedRowMove() {
    stopDragAutoScroll();
    pickedPointerRef.current = null;
    setPickedPointer(null);
    setPickedDragMetrics(null);
    setDraggedRowId(null);
    setDragTargetRowId(null);
  }

  function pickRowWithPointer(event: React.MouseEvent<HTMLButtonElement>, rowId: string) {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (performance.now() - lastNativeDragEndAtRef.current < 250) return;
    event.preventDefault();
    event.stopPropagation();
    if (draggedRowId === rowId && pickedPointerRef.current) {
      cancelPickedRowMove();
      return;
    }
    stopDragAutoScroll();
    const pointer = { x: event.clientX, y: event.clientY };
    const metrics = bulkDragMetrics(event.currentTarget, event.clientX);
    pickedPointerRef.current = pointer;
    setPickedPointer(pointer);
    setPickedDragMetrics(metrics);
    setDraggedRowId(rowId);
    setDragTargetRowId(null);
    lastHistoryChangeRef.current = null;
  }

  function placePickedRowAtGap(event: React.PointerEvent<HTMLElement>, gapIndex: number) {
    if (!pickedPointerRef.current || !draggedRowId) return;
    event.preventDefault();
    event.stopPropagation();
    const dropLine = event.currentTarget.querySelector<HTMLElement>(".bulk-insert-actions");
    const targetId = dropLine && isBulkInsertionTargetHit(dropLine, event.clientX, event.clientY, 1)
      ? bulkDropTargetForGap(rowsRef.current, draggedRowId, gapIndex)
      : null;
    const sourceId = draggedRowId;
    cancelPickedRowMove();
    if (!targetId || bulkDropPreviewIndex(rowsRef.current, sourceId, targetId) === null) return;
    moveRow(sourceId, targetId);
    scheduleAutoSave();
  }

  function leaveDragScrollArea(event: React.DragEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const pointerTarget = document.elementFromPoint(event.clientX, event.clientY);
    if (pointerTarget && container.contains(pointerTarget)) return;
    stopDragAutoScroll();
    setDragTargetRowId(null);
  }

  function beginRowDrag(event: React.DragEvent<HTMLButtonElement>, rowId: string) {
    pickedPointerRef.current = null;
    setPickedPointer(null);
    setPickedDragMetrics(null);
    const metrics = bulkDragMetrics(event.currentTarget, event.clientX);
    const dragGhost = createBulkDragGhost(rowId, metrics.width);
    if (dragGhost) {
      event.dataTransfer.setDragImage(dragGhost, metrics.grabOffsetX, 22);
      requestAnimationFrame(() => dragGhost.remove());
    }
    setDraggedRowId(rowId);
    setDragTargetRowId(null);
    lastHistoryChangeRef.current = null;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", rowId);
  }

  function previewGapDrop(event: React.DragEvent<HTMLElement>, gapIndex: number) {
    if (!draggedRowId) return;
    const dropLine = event.currentTarget.querySelector<HTMLElement>(".bulk-insert-actions");
    if (!dropLine || !isBulkInsertionTargetHit(dropLine, event.clientX, event.clientY, 1)) {
      setDragTargetRowId(null);
      return;
    }
    const targetId = bulkDropTargetForGap(rowsRef.current, draggedRowId, gapIndex);
    if (!targetId) {
      setDragTargetRowId(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragTargetRowId !== targetId) setDragTargetRowId(targetId);
  }

  function leaveGapDrop(event: React.DragEvent<HTMLElement>) {
    const dropZone = event.currentTarget;
    const { clientX, clientY } = event;
    requestAnimationFrame(() => {
      const pointerTarget = document.elementFromPoint(clientX, clientY);
      if (pointerTarget && dropZone.contains(pointerTarget)) return;
      if (pointerTarget?.closest(".bulk-insert-row")) return;
      setDragTargetRowId(null);
    });
  }

  function dropAtGap(event: React.DragEvent<HTMLElement>, gapIndex: number) {
    const targetId = draggedRowId ? bulkDropTargetForGap(rowsRef.current, draggedRowId, gapIndex) : null;
    dropRow(event, targetId);
  }

  function dropRow(event: React.DragEvent<HTMLElement>, targetId = dragTargetRowId) {
    event.preventDefault();
    const sourceId = draggedRowId;
    stopDragAutoScroll();
    pickedPointerRef.current = null;
    setPickedPointer(null);
    setPickedDragMetrics(null);
    setDraggedRowId(null);
    setDragTargetRowId(null);
    if (!sourceId || !targetId || bulkDropPreviewIndex(rowsRef.current, sourceId, targetId) === null) return;
    moveRow(sourceId, targetId);
    scheduleAutoSave();
  }

  function finishRowDrag() {
    lastNativeDragEndAtRef.current = performance.now();
    stopDragAutoScroll();
    pickedPointerRef.current = null;
    setPickedPointer(null);
    setPickedDragMetrics(null);
    setDraggedRowId(null);
    setDragTargetRowId(null);
  }

  function removeRow(id: string) {
    const row = rowsRef.current.find(row => row.id === id);
    if (row?.type === "card" && row.cardId !== null) {
      emptyDeletionIdsRef.current = [...new Set([...(emptyDeletionIdsRef.current ?? []), row.cardId])];
    }
    changeRows((previous) => {
      const next = previous.filter((row) => row.id !== id);
      return next.some((row) => row.type === "card") ? next : [...next, newCardRow("", lastContentTypeRef.current)];
    });
    scheduleAutoSave();
  }

  function continueBulkRemoval() {
    if (!pendingRemoval) return;
    setFinalPendingRemoval(pendingRemoval);
    setPendingRemoval(null);
  }

  function permanentlyRemoveBulkRow() {
    if (!finalPendingRemoval) return;
    const id = finalPendingRemoval.id;
    const fromKeyboard = keyboardRemovalIdRef.current === id;
    keyboardRemovalIdRef.current = null;
    const visibleIds = visibleBulkRowIds(rowsRef.current, collapsedDividerIds);
    const index = visibleIds.indexOf(id);
    const previousId = index > 0 ? visibleIds[index - 1] : null;
    const nextId = visibleIds[index + 1];
    removeRow(finalPendingRemoval.id);
    setFinalPendingRemoval(null);
    if (mobileDraftRowId === id) {
      setMobileDraftRowId(null);
      setMobileInsertIndex(null);
    } else if (fromKeyboard) {
      const target = rowsRef.current.find(row => row.id === (previousId ?? nextId)) ?? rowsRef.current[0];
      if (target) focusBulkField(target.type === "divider" ? "divider" : previousId ? "memo" : "question", target.id, previousId ? "end" : "start");
    }
  }

  async function archivePendingBulkCard() {
    if (finalPendingRemoval?.type !== "card" || !finalPendingRemoval.cardId) return;
    const savedCard = cards.find((card) => card.id === finalPendingRemoval.cardId);
    if (!savedCard || savedCard.archivedAt) return;
    setRemovalBusy(true);
    try {
      const result = await api<{ card: StudyCard }>(`/api/cards/${savedCard.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived: true }),
      });
      onCardArchived(result.card);
      setFinalPendingRemoval(null);
      toast.success("카드를 삭제하지 않고 보관함에 넣었어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "카드를 보관하지 못했습니다.");
    } finally {
      setRemovalBusy(false);
    }
  }

  function focusBulkElement(field: HTMLElement, caretEdge: "start" | "end" = "start") {
    field.focus({ preventScroll: true });
    placeBulkCaret(field, caretEdge);
    requestAnimationFrame(() => {
      // A blur-triggered save/render must not restore the destination's old caret.
      if (field.isConnected && document.activeElement === field) placeBulkCaret(field, caretEdge);
    });

    const dialog = field.closest<HTMLElement>(".bulk-form");
    if (!dialog) {
      field.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      return;
    }

    const dialogRect = dialog.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    const top = dialog.scrollTop
      + fieldRect.top
      - dialogRect.top
      - (dialog.clientHeight - fieldRect.height) / 2;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

    dialog.scrollTo({ top: Math.max(0, top), behavior });
  }

  function focusBulkField(attribute: BulkFocusKind, id: string, caretEdge: "start" | "end" = "start") {
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLElement>(`[data-bulk-${attribute}="${id}"]`);
      if (!field) return;
      focusBulkElement(field, caretEdge);
    });
  }

  function continueFromMemo(rowIndex: number, contentType: CardContentType) {
    insertCardAt(rowIndex + 1, contentType);
  }

  function continueSetCreateDetails() {
    if (setCardIds.length < 2) {
      toast.error("세트에 넣을 카드를 두 장 이상 골라 주세요.");
      return;
    }
    setSetCreateStep("details");
  }

  function cancelEditorSetSelection() {
    editorSelectionAnchorRef.current = null;
    editorSetSelectionRef.current = null;
    setEditorSetSelection(null);
    setEditorSetDetails(false);
    setSetId(null);
    setSetCreateStep("cards");
    setSetCardIds([]);
    setSetName("");
    setSetMemo("");
  }

  function selectEditorSetRow(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, rowId: string) {
    if (isPhotoInteraction(event.target) || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    const desktop = desktopEditorSelection();
    if (desktop && !(event.type === "keydown" && event.target === event.currentTarget)
      && !isBulkCardSelectionTarget(event.target, event.currentTarget)) return;
    if (setMode || (!desktop && !event.shiftKey && editorSetSelectionRef.current === null)) return;
    if (!desktop || event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (viewing || closing) return;
    cancelPickedRowMove();
    const previous = editorSetSelectionRef.current ?? [];
    const mode = !desktop ? "toggle" : event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "single";
    const visible = visibleBulkRowIds(rowsRef.current, collapsedDividerIds);
    const ids = rowsRef.current.filter(row => row.type === "card" && visible.includes(row.id)).map(row => row.id);
    const next = selectEditorItems(ids, previous, editorSelectionAnchorRef.current, rowId, mode);
    if (mode !== "range" || !editorSelectionAnchorRef.current) editorSelectionAnchorRef.current = rowId;
    editorSetSelectionRef.current = next;
    setEditorSetSelection(next);
    if (desktop && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      window.getSelection()?.removeAllRanges();
      event.currentTarget.focus({ preventScroll: true });
    }
  }

  function removeSelectedEditorCards() {
    if (!finalSelectedRemoval || saving || closing || viewing) return;
    const selected = new Set(finalSelectedRemoval);
    // Empty saves require an explicit deletion and an exact server-side ID check.
    emptyDeletionIdsRef.current = rowsRef.current.flatMap(row => row.type === "card" && selected.has(row.id) && row.cardId !== null ? [row.cardId] : []);
    changeRows(previous => {
      const next = previous.filter(row => row.type !== "card" || !selected.has(row.id));
      return next.some(row => row.type === "card") ? next : [...next, newCardRow("", lastContentTypeRef.current)];
    });
    setFinalSelectedRemoval(null);
    cancelEditorSetSelection();
    scheduleAutoSave();
  }

  async function createSetFromEditorSelection() {
    const selection = editorSetSelectionRef.current;
    if (!selection || selection.length < 2 || viewing || closing) return;
    setViewing(true);
    const saved = await persistCards(true);
    setViewing(false);
    // Esc/cancel during saving must not open a stale selection afterward.
    if (!saved || editorSetSelectionRef.current !== selection) return;
    const selectedRows = rowsRef.current.filter((row) => row.type === "card" && selection.includes(row.id));
    const ids = selectedRows.flatMap((row) => row.type === "card" && row.cardId !== null && row.question.trim() && row.answer.trim() ? [row.cardId] : []);
    if (ids.length !== selection.length) {
      toast.error("선택한 카드의 질문과 답을 모두 입력하고 저장해 주세요.");
      return;
    }
    setSetCardIds(ids);
    setSetCreateStep("details");
    editorSetReturnScrollRef.current = bulkDialogRef.current?.querySelector<HTMLElement>(".bulk-form")?.scrollTop ?? 0;
    setEditorSetDetails(true);
  }

  function toggleSetCard(cardId: number) {
    setSetCardIds((previous) => previous.includes(cardId)
      ? previous.filter((id) => id !== cardId)
      : [...previous, cardId]);
  }

  async function changeSubject(nextSubject: string) {
    if (!setMode) {
      const saved = await persistCards(true);
      if (!saved || uploadCount.current) return;
    }
    if (editorSetSelectionRef.current !== null) cancelEditorSetSelection();
    const subjectCards = cards.filter((card) => card.subject === nextSubject);
    const serverRows = rowsFromCards(subjectCards, lastContentTypeRef.current);
    const newestServerTime = Math.max(0, ...subjectCards.map((card) => Date.parse(card.updatedAt) || 0));
    const draft = readBulkDraft(nextSubject);
    const nextRows = draft && Date.parse(draft.updatedAt) > newestServerTime
      ? draft.rows
      : serverRows;
    setSelectedSubject(nextSubject);
    emptyDeletionIdsRef.current = null;
    selectedSubjectRef.current = nextSubject;
    setRows(nextRows);
    rowsRef.current = nextRows;
    savedSnapshotRef.current = bulkSnapshot(nextSubject, serverRows);
    setSaveState(bulkSnapshot(nextSubject, nextRows) === savedSnapshotRef.current ? "saved" : "unsaved");
    setDraggedRowId(null);
    setDragTargetRowId(null);
    pickedPointerRef.current = null;
    setPickedPointer(null);
    setPickedDragMetrics(null);
    setCollapsedDividerIds(new Set());
    mobileReturnPositionRef.current = null;
    setMobileRecentlySavedRowId(null);
    setMobileInsertIndex(null);
    setMobileDraftRowId(null);
    resetRowHistory();
    if (setMode) setSetCardIds([]);
    if (!setMode && bulkSnapshot(nextSubject, nextRows) !== savedSnapshotRef.current) scheduleAutoSave(800);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!setMode) {
      await persistCards(true);
      return;
    }
    if (!setId && setCreateStep === "cards") {
      continueSetCreateDetails();
      return;
    }

    if (!selectedSubject || !setName.trim()) {
      toast.error("과목과 세트 이름을 입력해 주세요.");
      return;
    }
    if (setCardIds.length < 2) {
      toast.error("비교할 카드를 두 장 이상 골라 주세요.");
      return;
    }

    const creatingSet = !setId;
    setSaving(true);
    try {
      const result = await api<{ set: StudySet }>(setId ? `/api/sets/${setId}` : "/api/sets", {
        method: setId ? "PATCH" : "POST",
        body: JSON.stringify({
          subject: selectedSubject,
          name: setName,
          memo: setMemo,
          cardIds: selectableSetCards.filter((card) => setCardIds.includes(card.id)).map((card) => card.id),
        }),
      });
      setSetId(result.set.id);
      setSetName(result.set.name);
      setSetMemo(result.set.memo);
      setSetCardIds(result.set.cardIds);
      onSetSaved(result.set);
      toast.success(setId ? "세트를 수정했어요." : "새 세트를 만들었어요.");
      if (editorSetDetails) cancelEditorSetSelection();
      else if (creatingSet) onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "세트를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function prepareCards(sourceRows: BulkRow[], subject: string, showErrors: boolean) {
    const fail = (message: string) => {
      if (showErrors) toast.error(message);
      return null;
    };
    if (!subject) return fail("과목을 선택해 주세요.");
    if (sourceRows.some((row) => row.type === "card" && Object.values(normalizeMedia(row.media)).some((images) => images.length) && (!row.question.trim() || !row.answer.trim()))) {
      return fail("사진을 넣은 카드에도 질문과 답을 적어 주세요. 사진은 임시저장에 보관되어 있어요.");
    }
    if (sourceRows.some((row) => row.type === "card" && Boolean(row.question.trim()) !== Boolean(row.answer.trim()))) {
      return fail("질문만 있거나 답만 있는 줄을 확인해 주세요.");
    }
    if (sourceRows.some((row) => row.type === "divider" && !row.title.trim())) {
      return fail("구분선의 이름을 적어 주세요.");
    }

    let sectionCreated = false;
    let subsectionCreated = false;
    for (const row of sourceRows) {
      if (row.type !== "divider") continue;
      if (row.level === 1) {
        sectionCreated = true;
        subsectionCreated = false;
      } else if (row.level === 2) {
        if (!sectionCreated) return fail("하위 섹션보다 먼저 상위 섹션을 만들어 주세요.");
        subsectionCreated = true;
      } else if (!sectionCreated || !subsectionCreated) {
        return fail("세부 섹션보다 먼저 하위 섹션을 만들어 주세요.");
      }
    }

    let section = "기본";
    let subsection = "";
    let detailSection = "";
    const cardsToSave: Array<{ id: number | null; contentType: CardContentType; section: string; subsection: string; detailSection: string; area: string; question: string; questionFormat: string; answer: string; answerFormat: string; memo: string; media: CardMedia; importance: number }> = [];
    const sourceCardRows: Array<Extract<BulkRow, { type: "card" }>> = [];
    for (const row of sourceRows) {
      if (row.type === "divider") {
        if (row.level === 1) {
          section = row.title.trim();
          subsection = "";
          detailSection = "";
        } else if (row.level === 2) {
          subsection = row.title.trim();
          detailSection = "";
        } else {
          detailSection = row.title.trim();
        }
      } else if (row.question.trim() && row.answer.trim()) {
        sourceCardRows.push(row);
        cardsToSave.push({
          id: row.cardId,
          contentType: row.contentType,
          section,
          subsection,
          detailSection,
          area: row.area,
          question: row.question.trim(),
          questionFormat: row.questionFormat.trim(),
          answer: row.answer.trim(),
          answerFormat: row.answerFormat.trim(),
          memo: row.memo.trim(),
          media: normalizeMedia(row.media),
          importance: row.important ? 2 : 1,
        });
      }
    }
    // A cleared saved row still belongs to the user (including after undo).
    // Only explicitly removed rows may authorize saving an empty collection.
    if (!cardsToSave.length && (emptyDeletionIdsRef.current === null || sourceRows.some(row => row.type === "card" && row.cardId !== null))) return fail("질문과 답을 한 줄 이상 입력해 주세요.");
    return { cardsToSave, sourceCardRows };
  }

  function mergeSavedRows(sourceRows: BulkRow[], sourceCardRows: Array<Extract<BulkRow, { type: "card" }>>, savedCards: StudyCard[]) {
    const savedByRowId = new Map(sourceCardRows.map((row, index) => [row.id, savedCards[index]]));
    const sourceByRowId = new Map(sourceCardRows.map((row) => [row.id, row]));
    const allSourceCardsByRowId = new Map(
      sourceRows.filter((row): row is Extract<BulkRow, { type: "card" }> => row.type === "card").map((row) => [row.id, row])
    );
    const sourceDividersByRowId = new Map(
      sourceRows.filter((row): row is Extract<BulkRow, { type: "divider" }> => row.type === "divider").map((row) => [row.id, row])
    );
    const applySaved = (row: BulkRow, preserveNewerText: boolean): BulkRow => {
      if (row.type === "divider") {
        const source = sourceDividersByRowId.get(row.id);
        if (!source || (preserveNewerText && row.title !== source.title)) return row;
        return { ...row, title: source.title.trim() };
      }
      const saved = savedByRowId.get(row.id);
      const source = sourceByRowId.get(row.id);
      if (!saved || !source) {
        const original = allSourceCardsByRowId.get(row.id);
        return original?.cardId && !original.question.trim() && !original.answer.trim()
          ? { ...row, cardId: null }
          : row;
      }
      const hasNewerText = preserveNewerText && (
        row.contentType !== source.contentType
        || row.area !== source.area
        || row.question !== source.question
        || row.questionFormat !== source.questionFormat
        || row.answer !== source.answer
        || row.answerFormat !== source.answerFormat
        || row.memo !== source.memo
        || JSON.stringify(normalizeMedia(row.media)) !== JSON.stringify(normalizeMedia(source.media))
        || row.important !== source.important
      );
      if (hasNewerText) return { ...row, cardId: saved.id };
      return {
        ...row,
        cardId: saved.id,
        contentType: normalizeCardContentType(saved.contentType),
        area: saved.area,
        question: saved.question,
        questionFormat: saved.questionFormat,
        answer: saved.answer,
        answerFormat: saved.answerFormat,
        memo: saved.memo,
        media: normalizeMedia(saved.media),
        important: saved.importance >= 2,
      };
    };
    return {
      savedSourceRows: sourceRows.map((row) => applySaved(row, false)),
      currentRows: rowsRef.current.map((row) => applySaved(row, true)),
    };
  }

  async function saveCardsOnce(showErrors: boolean) {
    if (uploadCount.current) {
      if (showErrors) toast.info("사진을 첨부하는 중이에요. 잠시만 기다려 주세요.");
      scheduleAutoSave(500);
      return false;
    }
    const sourceRows = rowsRef.current;
    const emptyDeletionIds = emptyDeletionIdsRef.current;
    const subject = selectedSubjectRef.current;
    const currentSnapshot = bulkSnapshot(subject, sourceRows);
    if (currentSnapshot === savedSnapshotRef.current) {
      setSaveState("saved");
      return true;
    }
    const prepared = prepareCards(sourceRows, subject, showErrors);
    if (!prepared) {
      setSaveState("unsaved");
      return false;
    }

    const inheritanceRequests = prepared.cardsToSave.flatMap((card) => {
      if (!card.id) return [];
      const previous = cards.find((item) => item.id === card.id);
      if (!previous || isTableFormat(card.answerFormat)) return [];
      const choices = keywordSplitChoices(previous.keywords, extractBoldKeywords(card.answerFormat));
      if (!choices.length) return [];
      return [{
        cardId: card.id,
        question: card.question,
        signature: keywordInheritanceSignature(card.id, choices),
        choices,
      }];
    });
    const unresolvedInheritance = inheritanceRequests.filter((item) => !keywordInheritanceOverridesRef.current.has(item.signature));
    if (unresolvedInheritance.length) {
      setPendingKeywordInheritance(unresolvedInheritance);
      setSaveState("unsaved");
      return false;
    }
    const cardsToSave = prepared.cardsToSave.map((card) => {
      const inheritance = inheritanceRequests.find((item) => item.cardId === card.id);
      return inheritance
        ? { ...card, keywordInheritance: keywordInheritanceOverridesRef.current.get(inheritance.signature) ?? [] }
        : card;
    });

    setSaving(true);
    setSaveState("saving");
    try {
      const result = await api<{ cards: StudyCard[] }>("/api/cards/organize", {
        method: "POST",
        body: JSON.stringify({ subject, cards: cardsToSave, ...(cardsToSave.length === 0 ? { deleteCardIds: emptyDeletionIds } : {}) }),
      });
      if (result.cards.length !== prepared.sourceCardRows.length) throw new Error("저장된 카드 수를 확인하지 못했어요.");
      onSaved(result.cards, subject);
      if (emptyDeletionIdsRef.current === emptyDeletionIds) emptyDeletionIdsRef.current = null;
      const merged = mergeSavedRows(sourceRows, prepared.sourceCardRows, result.cards);
      savedSnapshotRef.current = bulkSnapshot(subject, merged.savedSourceRows);
      rowsRef.current = merged.currentRows;
      setRows(merged.currentRows);
      const submittedRows = new Map(prepared.sourceCardRows.map((row) => [row.id, row]));
      setSavedEditorContents(new Map(merged.savedSourceRows.flatMap((row) => row.type === "card" ? [[row.id, {
        question: { text: row.question, format: row.questionFormat, sourceFormat: submittedRows.get(row.id)?.questionFormat ?? row.questionFormat },
        answer: { text: row.answer, format: row.answerFormat, sourceFormat: submittedRows.get(row.id)?.answerFormat ?? row.answerFormat },
      }] as const] : [])));
      setSaveState(bulkSnapshot(subject, merged.currentRows) === savedSnapshotRef.current ? "saved" : "unsaved");
      inheritanceRequests.forEach((item) => keywordInheritanceOverridesRef.current.delete(item.signature));
      persistDraftBackup();
      return true;
    } catch (error) {
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : "자동 저장하지 못했습니다.");
      return false;
    }
  }

  function persistCards(showErrors = false): Promise<boolean> {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    saveQueuedRef.current = true;
    if (showErrors) saveWithErrorsRef.current = true;
    if (savePromiseRef.current) return savePromiseRef.current;

    const runner = (async () => {
      let saved = true;
      while (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        saved = await saveCardsOnce(saveWithErrorsRef.current);
        if (!saved) {
          saveQueuedRef.current = false;
          break;
        }
      }
      return saved && bulkSnapshot(selectedSubjectRef.current, rowsRef.current) === savedSnapshotRef.current;
    })();
    savePromiseRef.current = runner;
    void runner.finally(() => {
      savePromiseRef.current = null;
      saveWithErrorsRef.current = false;
      setSaving(false);
    });
    return runner;
  }

  function scheduleAutoSave(delay = 250) {
    if (setMode) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void persistCards();
    }, delay);
  }

  scheduleAutoSaveRef.current = scheduleAutoSave;

  function confirmKeywordInheritance() {
    pendingKeywordInheritance.forEach((item) => {
      keywordInheritanceOverridesRef.current.set(item.signature, item.choices);
    });
    setPendingKeywordInheritance([]);
    void persistCards(true);
  }

  function persistDraftBackup() {
    const subject = selectedSubjectRef.current;
    const currentRows = rowsRef.current;
    if (bulkSnapshot(subject, currentRows) === savedSnapshotRef.current) {
      clearBulkDraft(subject);
      return;
    }
    writeBulkDraft(subject, currentRows);
  }

  function scheduleDraftBackup(delay = 500) {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      persistDraftBackup();
    }, delay);
  }

  async function requestClose() {
    if (uploadCount.current) { toast.info("사진을 첨부하는 중이에요."); return; }
    if (closing) return;
    setClosing(true);
    const saved = await persistCards(true);
    setClosing(false);
    if (saved && !uploadCount.current) onOpenChange(false);
  }

  mobileBackHandlerRef.current = () => {
    if (editorSetSelectionRef.current !== null && (!editorSetDetails || !saving)) {
      cancelEditorSetSelection();
      return;
    }
    if (removalBusy || saving || closing || viewing) return;
    if (pendingKeywordInheritance.length) {
      setPendingKeywordInheritance([]);
      return;
    }
    if (finalPendingRemoval) {
      setFinalPendingRemoval(null);
      return;
    }
    if (pendingRemoval) {
      setPendingRemoval(null);
      return;
    }
    if (!setId && setMode && setCreateStep === "details") {
      setSetCreateStep("cards");
      return;
    }
    if (!setMode && mobileDraftRowId) {
      discardMobileDraft(true);
      return;
    }
    if (!setMode && mobileInsertIndex !== null) {
      cancelMobileInsertKind();
      return;
    }
    if (setMode) {
      onOpenChange(false);
      return;
    }
    void requestClose();
  };

  useEffect(() => {
    if (!open || !onMobileBackReady) return;
    const handler = () => mobileBackHandlerRef.current();
    onMobileBackReady(handler);
    return () => onMobileBackReady(null);
  }, [onMobileBackReady, open]);

  async function requestView() {
    if (uploadCount.current) { toast.info("사진을 첨부하는 중이에요."); return; }
    if (closing || viewing) return;
    if (!prepareCards(rowsRef.current, selectedSubjectRef.current, true)) return;
    setViewing(true);
    const saved = await persistCards(true);
    setViewing(false);
    if (saved && !uploadCount.current) onView(selectedSubjectRef.current);
  }

  const draggedSourceIndex = draggedRowId ? rows.findIndex((row) => row.id === draggedRowId) : -1;
  const draggedSourceEnd = draggedSourceIndex >= 0 ? bulkRowGroupEnd(rows, draggedSourceIndex) : -1;
  const draggedRowIds = new Set(
    draggedSourceIndex >= 0 ? rows.slice(draggedSourceIndex, draggedSourceEnd).map((row) => row.id) : [],
  );
  const draggedSource = draggedSourceIndex >= 0 ? rows[draggedSourceIndex] : null;
  const draggedCards = draggedSourceIndex >= 0
    ? rows.slice(draggedSourceIndex, draggedSourceEnd).filter((row): row is Extract<BulkRow, { type: "card" }> => row.type === "card")
    : [];
  const dragPreviewIndex = draggedRowId && dragTargetRowId
    ? bulkDropPreviewIndex(rows, draggedRowId, dragTargetRowId)
    : null;
  const movedCount = Math.max(1, draggedSourceEnd - draggedSourceIndex);
  const movedLabel = draggedSource?.type === "divider"
    ? `${draggedSource.title || (draggedSource.level === 1 ? "섹션" : draggedSource.level === 2 ? "하위 섹션" : "세부 섹션")} 묶음 · ${movedCount}줄`
    : "카드 1장";
  const pointerGhostPosition = pickedPointer && pickedDragMetrics && typeof window !== "undefined"
    ? {
        left: bulkDragGhostLeft(pickedPointer.x, pickedDragMetrics.width, pickedDragMetrics.grabOffsetX, window.innerWidth),
        top: Math.max(12, Math.min(pickedPointer.y + 16, window.innerHeight - 150)),
        width: pickedDragMetrics.width,
      }
    : null;
  const hiddenRowIds = collapsedBulkRowIds(rows, collapsedDividerIds);
  const visibleRows = rows
    .map((row, rowIndex) => ({
      row,
      rowIndex,
      collapsed: row.type === "divider" && collapsedDividerIds.has(row.id),
      childCount: row.type === "divider" ? bulkRowGroupEnd(rows, rowIndex) - rowIndex - 1 : 0,
      nextInsertionIndex: row.type === "divider" && collapsedDividerIds.has(row.id)
        ? bulkRowGroupEnd(rows, rowIndex)
        : rowIndex + 1,
    }))
    .filter(({ row }) => !hiddenRowIds.has(row.id));
  const mobileDraftRow = rows.find((row) => row.id === mobileDraftRowId);
  const mobileDraftIndex = mobileDraftRow ? rows.findIndex((row) => row.id === mobileDraftRow.id) : -1;
  const mobileDraftPath = bulkSectionPathAtIndex(rows, mobileDraftIndex);
  const mobileInsertPath = bulkSectionPathAtIndex(rows, mobileInsertIndex ?? 0);
  const mobileInsertHierarchy = mobileInsertIndex === null ? { hasSection: false, hasSubsection: false } : hierarchyBefore(mobileInsertIndex);
  const mobileInsertLocations = rows.flatMap((row, rowIndex) => {
    if (row.type === "card" && !row.cardId && !row.question.trim() && !row.answer.trim()) return [];
    return [{ row, rowIndex, path: bulkSectionPathAtIndex(rows, rowIndex + 1) }];
  });
  const finalPendingSavedCard = finalPendingRemoval?.type === "card" && finalPendingRemoval.cardId
    ? cards.find((card) => card.id === finalPendingRemoval.cardId) ?? null
    : null;
  const finalPendingRemovalLabel = finalPendingRemoval?.type === "card"
    ? `카드 “${finalPendingRemoval.question || "내용을 입력하지 않은 카드"}”`
    : finalPendingRemoval
      ? `${finalPendingRemoval.level === 1 ? "섹션" : finalPendingRemoval.level === 2 ? "하부" : "세부"} “${finalPendingRemoval.title || "이름 없음"}”`
      : "선택한 항목";
  const finalPendingCanArchive = Boolean(finalPendingSavedCard && !finalPendingSavedCard.archivedAt);

  function insertionControls(index: number) {
    const hierarchy = hierarchyBefore(index);
    const cardAbove = rows[index - 1]?.type === "card";
    const dropTargetId = draggedRowId ? bulkDropTargetForGap(rows, draggedRowId, index) : null;
    const isDropActive = Boolean(draggedRowId && dropTargetId && dragPreviewIndex === index);
    return (
      <TableRow
        data-bulk-gap-index={index}
        className={`bulk-insert-row${draggedRowId ? " is-drop-zone" : ""}${dropTargetId ? " is-drop-available" : ""}${isDropActive ? " is-drop-active" : ""}`}
        onPointerDown={(event) => placePickedRowAtGap(event, index)}
        onDragEnter={(event) => previewGapDrop(event, index)}
        onDragOver={(event) => previewGapDrop(event, index)}
        onDragLeave={leaveGapDrop}
        onDrop={(event) => dropAtGap(event, index)}
      >
        <TableCell colSpan={6}>
          <div className="bulk-insert-actions">
            <div className="bulk-insert-hit-area">
              {!draggedRowId && (
                <div className="bulk-insert-button-group">
                  {cardAbove && <Button type="button" variant="ghost" size="sm" title="위 카드 복제 (Ctrl/⌘+Shift+Enter)" disabled={rows.length >= 100} onClick={() => duplicateCardAbove(index)}><Copy /> 위 카드 복제</Button>}
                  <Button type="button" variant="ghost" size="sm" disabled={rows.length >= 100} onClick={() => insertCardAt(index)}><Plus /> 여기에 카드</Button>
                  <Button type="button" variant="ghost" size="sm" disabled={rows.length >= 100} onClick={() => insertDividerAt(index, 1)}><Rows3 /> 섹션</Button>
                  {hierarchy.hasSection && <Button type="button" variant="ghost" size="sm" disabled={rows.length >= 100} onClick={() => insertDividerAt(index, 2)}><CornerDownRight /> 하위 섹션</Button>}
                  {hierarchy.hasSubsection && <Button type="button" variant="ghost" size="sm" disabled={rows.length >= 100} onClick={() => insertDividerAt(index, 3)}><ChevronRight /> 세부 섹션</Button>}
                </div>
              )}
            </div>
            {draggedRowId && isDropActive && (
              <div className="bulk-drop-preview-slot" role="status">
                <CornerDownRight aria-hidden="true" />
                <span><strong>{movedLabel}</strong><small>이 점선 사이에 끼워 넣기</small></span>
              </div>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        ref={bulkDialogRef}
        className={`bulk-dialog${setMode ? " set-editor-dialog" : ""}${layered ? " stacked-dialog" : ""} max-h-[96dvh] w-[calc(100%-12px)] max-w-none overflow-y-auto rounded-[22px] border-0 p-4 sm:w-[calc(100%-32px)] sm:max-w-[1240px] sm:p-7`}
        overlayClassName={layered ? "stacked-dialog-overlay" : undefined}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          if (!setMode) {
            event.preventDefault();
            // Keep opening focus from pulling the editor back to its first field.
            bulkDialogRef.current?.focus({ preventScroll: true });
            requestAnimationFrame(() => {
              const scroller = bulkDialogRef.current?.querySelector<HTMLElement>(".bulk-form");
              if (scroller?.isConnected) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
            });
            return;
          }
          if (!initialSet) return;
          const selected = bulkDialogRef.current?.querySelector<HTMLButtonElement>(".set-card-choice.is-selected");
          const scroller = bulkDialogRef.current?.querySelector<HTMLElement>(".bulk-form");
          if (!selected || !scroller) return;
          event.preventDefault();
          selected.focus({ preventScroll: true });
          requestAnimationFrame(() => {
            if (!selected.isConnected) return;
            scroller.scrollTo({ top: scroller.scrollTop + selected.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12, behavior: "instant" });
          });
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          // The dialog consumes Escape before document bubble listeners run.
          // Cancel the picked handle first, without clearing selection or closing.
          if (draggedRowId) {
            cancelPickedRowMove();
            return;
          }
          if (saving) return;
          if (editorSetSelectionRef.current !== null && (!editorSetDetails || !saving)) cancelEditorSetSelection();
          else if (setMode) onOpenChange(false);
        }}
        onInteractOutside={(event) => event.preventDefault()}
        onDragOver={updateDragAutoScroll}
        onDragLeave={leaveDragScrollArea}
      >
        <DialogHeader className="bulk-dialog-header text-left">
          <div className="bulk-dialog-title-row">
            <DialogTitle>
              {setMode
                ? setId ? "세트 수정하기" : "세트 만들기"
                : <><span className="bulk-desktop-copy">카드 편집하기</span><span className="mobile-bulk-copy">카드 추가</span></>}
            </DialogTitle>
            <div className="bulk-dialog-title-actions">
              {!setMode && (
                <div className="bulk-history-actions" aria-label="편집 이력">
                  <Button type="button" variant="ghost" size="icon-sm" disabled={historyCounts.undo === 0} onClick={undoRows} aria-label="되돌리기" title="되돌리기 (Ctrl/⌘+Z)"><Undo2 /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={historyCounts.redo === 0} onClick={redoRows} aria-label="다시 실행" title="다시 실행 (Ctrl/⌘+Shift+Z 또는 Ctrl/⌘+Y)"><Redo2 /></Button>
                </div>
              )}
            </div>
          </div>
          <DialogDescription className="bulk-dialog-description">
            {setMode
              ? setId
                ? "세트 정보와 포함할 카드를 함께 수정할 수 있어요."
                : setCreateStep === "cards"
                  ? "먼저 같은 과목의 카드를 두 장 이상 골라 주세요."
                  : `${setCardIds.length}장의 카드를 묶을 이름과 설명을 적어 주세요.`
              : <>
                  <span className="bulk-desktop-copy">{editorSetSelection !== null
                    ? `${editorSetSelection.length}장 선택 · Shift+클릭 범위 선택 · Ctrl/⌘+클릭 추가·해제 · Esc 선택 취소`
                    : "입력은 자동 저장돼요. 좌우 여백 클릭으로 카드 선택 · Shift+클릭 범위 선택 · Ctrl/⌘+클릭 추가·해제. 질문·답·메모와 버튼은 선택에서 제외돼요."}</span>
                  <span className="mobile-bulk-copy">{
                    mobileDraftRow
                      ? `${mobileDraftRow.type === "card" ? "카드 내용" : "이름"}을 저장하면 바로 아래에서 새 카드를 이어서 추가해요.`
                      : mobileInsertIndex !== null
                        ? "이 위치에 만들 항목을 선택하세요."
                        : "위치를 고른 뒤 카드·섹션·하부·세부 중 하나를 만들어요."
                  }</span>
                </>}
          </DialogDescription>
        </DialogHeader>

        <form className={`bulk-form${setMode ? " is-set-mode" : ""}`} onSubmit={submit} onKeyDownCapture={handleBulkEditorNavigation} onKeyDown={handleBulkEditorKeyDown}>
          {setMode ? (
            <>
              {setId || setCreateStep === "cards" ? (
                <>
                  {!setId && (
                    <section className="set-create-subject-panel">
                      <div>
                        <FieldLabel>과목</FieldLabel>
                        <Select value={selectedSubject} onValueChange={(value) => void changeSubject(value)}>
                          <SelectTrigger className="set-subject-select"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {subjects.map((subject) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <p>과목을 고르면 그 과목의 카드만 보여요.</p>
                    </section>
                  )}

                  {setId && (
                    <section className="set-editor-fields">
                      <div>
                        <FieldLabel>과목</FieldLabel>
                        <Select value={selectedSubject} disabled onValueChange={(value) => void changeSubject(value)}>
                          <SelectTrigger className="set-subject-select"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {subjects.map((subject) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <FieldLabel>세트 이름</FieldLabel>
                        <Input value={setName} onChange={(event) => setSetName(event.target.value)} placeholder="예: 총론에서 헷갈리는 원리" autoFocus />
                      </div>
                      <div className="set-memo-field">
                        <FieldLabel>설명 (선택)</FieldLabel>
                        <Textarea value={setMemo} onChange={(event) => setSetMemo(event.target.value)} placeholder="무엇을 비교해야 하는지 간단히 적어두세요." rows={2} />
                      </div>
                    </section>
                  )}

                  <div className="set-picker-heading">
                    <div><strong>카드 고르기</strong><small>카드를 누르면 선택하거나 해제할 수 있어요.</small></div>
                    <Badge className="set-count-badge">{setCardIds.length}장 선택</Badge>
                  </div>

                  {selectableSetCards.length ? (
                    <div className="set-card-picker" aria-label="세트에 넣을 카드 선택">
                      {selectableSetCards.map((card, cardIndex) => {
                        const previous = selectableSetCards[cardIndex - 1];
                        const showDivider = !previous
                          || previous.section !== card.section
                          || previous.subsection !== card.subsection
                          || previous.detailSection !== card.detailSection;
                        const selected = setCardIds.includes(card.id);
                        return (
                          <Fragment key={card.id}>
                            {showDivider && (
                              <div className="set-card-divider">
                                <Rows3 /> {card.section}{card.subsection ? ` › ${card.subsection}` : ""}{card.detailSection ? ` › ${card.detailSection}` : ""}
                              </div>
                            )}
                            <button
                              type="button"
                              className={`set-card-choice${selected ? " is-selected" : ""}`}
                              aria-pressed={selected}
                              onClick={() => toggleSetCard(card.id)}
                            >
                              <span>{selected ? <Check /> : cardIndex + 1}</span>
                              <div>
                                <strong className="set-card-question">{renderFormattedText(card.questionFormat, card.question)}</strong>
                                <span className="set-card-answer">
                                  <b>답</b>
                                  <span><AnswerContent card={card} /></span>
                                </span>
                                <span className="set-card-tags">
                                  <ContentTypeBadge value={card.contentType} />
                                  <small>{card.section}</small>
                                </span>
                              </div>
                            </button>
                          </Fragment>
                        );
                      })}
                    </div>
                  ) : (
                    <section className="set-picker-empty">이 과목에는 저장된 카드가 아직 없어요.</section>
                  )}
                </>
              ) : (
                <section className="set-create-details-panel">
                  <div className="set-create-details-summary">
                    <span><FolderHeart /></span>
                    <div><strong>{selectedSubject}</strong><small>{setCardIds.length}장의 선택한 카드</small></div>
                    <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => editorSetDetails ? setEditorSetDetails(false) : setSetCreateStep("cards")}>카드 변경</Button>
                  </div>
                  <label>
                    <FieldLabel>세트 이름</FieldLabel>
                    <Input value={setName} maxLength={100} onChange={(event) => setSetName(event.target.value)} placeholder="예: 총론에서 헷갈리는 원리" autoFocus />
                  </label>
                  <label>
                    <FieldLabel>설명 (선택)</FieldLabel>
                    <Textarea value={setMemo} maxLength={20000} onChange={(event) => setSetMemo(event.target.value)} placeholder="세트를 만든 목적이나 기억할 내용을 적어두세요." rows={5} />
                  </label>
                </section>
              )}
            </>
          ) : (
          <>
          <div className="bulk-desktop-editor">
          <div className="bulk-topbar">
            <div className="bulk-top-fields">
              <div>
                <FieldLabel>과목</FieldLabel>
                <Select value={selectedSubject} onValueChange={(value) => void changeSubject(value)}>
                  <SelectTrigger className="bulk-subject-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject) => <SelectItem key={subject} value={subject}>{subject}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p><CornerDownRight /> PC에서는 여섯 점을 클릭한 뒤 원하는 점선을 클릭하세요. Esc나 다른 곳 클릭으로 취소해요.</p>
          </div>

          <div className="bulk-table-shell">
            <Table className={`bulk-table${draggedRowId ? " is-reordering" : ""}`}>
              <TableHeader>
                <TableRow>
                  <TableHead className="bulk-number-head">#</TableHead>
                  <TableHead className="bulk-type-head">분류</TableHead>
                  <TableHead className="bulk-question-head">질문</TableHead>
                  <TableHead>답 · 메모</TableHead>
                  <TableHead colSpan={2} className="bulk-tools-head"><span className="sr-only">중요 · 미리보기 · 표 등록 · 삭제</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {insertionControls(0)}
                {visibleRows.map(({ row, rowIndex, collapsed, childCount, nextInsertionIndex }) => {
                  const tableCard = row.type === "card" && !!readTable(row.answerFormat);
                  const questionEditor = row.type === "card" && <FormattedTextEditor
                    text={row.question}
                    historyRevision={historyRevision}
                    savedContent={savedEditorContents.get(row.id)?.question}
                    autoSave
                    images={row.media?.question} onImagesChange={(images) => updateImages(row.id, "question", images)} onImageBusyChange={onBusyChange} imagesDisabled={savingRequest || closing || viewing}
                    format={row.questionFormat}
                    label={`${rowIndex + 1}번째 질문`}
                    placeholder="질문 입력"
                    allowUnderline compact dataBulkQuestion={row.id}
                    onChange={(question, questionFormat) => updateQuestion(row.id, question, questionFormat)}
                    onTabAtEnd={() => focusBulkField("answer", row.id)}
                    onBlur={() => scheduleAutoSave()}
                  />;
                  return (
                  <Fragment key={row.id}>
                  {row.type === "divider" ? (
                    <TableRow
                      data-bulk-empty-delete-row={row.id}
                      className={`divider-row${row.level === 2 ? " is-subsection" : row.level === 3 ? " is-detail-section" : ""}${collapsed ? " is-collapsed" : ""}${draggedRowIds.has(row.id) ? " is-dragging" : ""}`}
                    >
                      <TableCell colSpan={6}>
                        <div className="divider-input">
                          <button
                            type="button"
                            className="drag-handle"
                            draggable
                            aria-label={`${row.title || (row.level === 1 ? "섹션" : row.level === 2 ? "하위 섹션" : "세부 섹션")}과 하위 내용 함께 옮기기`}
                            title="클릭해서 하위 내용과 함께 이동"
                            aria-grabbed={draggedRowId === row.id}
                            aria-pressed={draggedRowId === row.id && Boolean(pickedPointer)}
                            onClick={(event) => pickRowWithPointer(event, row.id)}
                            onDragStart={(event) => beginRowDrag(event, row.id)}
                            onDragEnd={finishRowDrag}
                          ><GripVertical /></button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="divider-collapse-button"
                            aria-label={`${row.title || (row.level === 1 ? "섹션" : row.level === 2 ? "하위 섹션" : "세부 섹션")} ${collapsed ? "펼치기" : "접기"}`}
                            aria-expanded={!collapsed}
                            title={childCount > 0 ? `${childCount}개 하위 항목 ${collapsed ? "펼치기" : "접기"}` : "접을 하위 항목이 없어요"}
                            disabled={childCount === 0}
                            onClick={() => toggleDividerCollapsed(row.id)}
                          >{collapsed ? <ChevronRight /> : <ChevronDown />}</Button>
                          {row.level === 1 ? <Rows3 /> : row.level === 2 ? <CornerDownRight /> : <ChevronRight />}
                          <span>{row.level === 1 ? "섹션" : row.level === 2 ? "하위" : "세부"}</span>
                          <Input
                            data-bulk-divider={row.id}
                            data-bulk-row-id={row.id}
                            data-bulk-focus-kind="divider"
                            value={row.title}
                            onChange={(event) => updateDivider(row.id, event.target.value)}
                            onBlur={() => scheduleAutoSave()}
                            onKeyDown={(event) => {
                              if (event.key === "Tab" && !event.shiftKey) {
                                event.preventDefault();
                                insertDividerAt(nextInsertionIndex, row.level, true);
                              }
                            }}
                            placeholder={row.level === 1 ? "섹션 이름 (예: 성격, 목표)" : row.level === 2 ? "하위 섹션 이름" : "세부 섹션 이름"}
                            aria-label={row.level === 1 ? "섹션 이름" : row.level === 2 ? "하위 섹션 이름" : "세부 섹션 이름"}
                          />
                          <div className="divider-move-actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`${row.title || (row.level === 1 ? "섹션" : row.level === 2 ? "하위 섹션" : "세부 섹션")} 위로 이동`}
                              title="하위 내용과 함께 위로 이동"
                              disabled={!adjacentBulkDividerId(rows, row.id, "up")}
                              onClick={() => {
                                const targetId = adjacentBulkDividerId(rows, row.id, "up");
                                if (targetId) moveRow(row.id, targetId);
                                scheduleAutoSave();
                              }}
                            ><ChevronUp /></Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`${row.title || (row.level === 1 ? "섹션" : row.level === 2 ? "하위 섹션" : "세부 섹션")} 아래로 이동`}
                              title="하위 내용과 함께 아래로 이동"
                              disabled={!adjacentBulkDividerId(rows, row.id, "down")}
                              onClick={() => {
                                const targetId = adjacentBulkDividerId(rows, row.id, "down");
                                if (targetId) moveRow(row.id, targetId);
                                scheduleAutoSave();
                              }}
                            ><ChevronDown /></Button>
                          </div>
                          <Button type="button" variant="ghost" size="icon-sm" tabIndex={-1} aria-label="구분선 삭제" onClick={() => setPendingRemoval(row)}><X /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <ImageMoveProvider media={row.media} disabled={saving || closing || viewing || selectionBlocksEditing || !!draggedRowId} onMove={(from, to, imageId) => moveImage(row.id, from, to, imageId)}>
                    <TableRow
                      data-editor-card-row={row.id}
                      data-bulk-empty-delete-row={row.id}
                      className={`bulk-card-row${draggedRowIds.has(row.id) ? " is-dragging" : ""}${selectionBlocksEditing ? " is-set-selecting" : ""}${editorSetSelection?.includes(row.id) ? " is-set-selected" : ""}`}
                      aria-selected={editorSetSelection !== null ? editorSetSelection.includes(row.id) : undefined}
                      tabIndex={editorSetSelection !== null ? 0 : undefined}
                      onPointerDownCapture={(event) => {
                        if (isPhotoInteraction(event.target) || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
                        if (desktopEditorSelection() && !isBulkCardSelectionTarget(event.target, event.currentTarget)) return;
                        if (event.shiftKey || (desktopEditorSelection() ? event.metaKey || event.ctrlKey : editorSetSelectionRef.current !== null)) event.preventDefault();
                      }}
                      onClickCapture={(event) => selectEditorSetRow(event, row.id)}
                      onKeyDownCapture={(event) => {
                        if (isPhotoInteraction(event.target) || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
                        if (desktopEditorSelection() && event.target !== event.currentTarget) return;
                        if (editorSetSelectionRef.current === null || event.key === "Tab" || event.key === "Escape") return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (!event.repeat && (event.key === " " || event.key === "Enter")) selectEditorSetRow(event, row.id);
                      }}
                    >
                      <TableCell className="bulk-number-cell">
                        <div>
                          <button
                            type="button"
                            className="drag-handle"
                            draggable
                            aria-label="클릭해서 카드 순서 옮기기"
                            title="클릭해서 카드 이동"
                            aria-grabbed={draggedRowId === row.id}
                            aria-pressed={draggedRowId === row.id && Boolean(pickedPointer)}
                            onClick={(event) => pickRowWithPointer(event, row.id)}
                            onDragStart={(event) => beginRowDrag(event, row.id)}
                            onDragEnd={finishRowDrag}
                          ><GripVertical /></button>
                          <span>{editorSetSelection?.includes(row.id) ? <Check aria-label="카드 선택됨" /> : rows.slice(0, rowIndex + 1).filter((item) => item.type === "card").length}</span>
                        </div>
                      </TableCell>
                      <TableCell className="bulk-type-cell">
                        <div
                          className="bulk-type-listbox"
                          data-bulk-content-type={row.id}
                          data-bulk-row-id={row.id}
                          data-bulk-focus-kind="content-type"
                          role="listbox"
                          tabIndex={0}
                          aria-label={`${rows.slice(0, rowIndex + 1).filter((item) => item.type === "card").length}번째 카드 분류`}
                          aria-activedescendant={`bulk-type-${row.id}-${row.contentType}`}
                          autoFocus={row.cardId === null && rows.find((item) => item.type === "card")?.id === row.id}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                              event.preventDefault();
                              const currentIndex = CARD_CONTENT_TYPES.indexOf(row.contentType);
                              const nextIndex = Math.max(0, Math.min(
                                CARD_CONTENT_TYPES.length - 1,
                                currentIndex + (event.key === "ArrowDown" ? 1 : -1),
                              ));
                              updateContentType(row.id, CARD_CONTENT_TYPES[nextIndex]);
                            }
                            if (event.key === "Tab" && !event.shiftKey) {
                              event.preventDefault();
                              focusBulkField("question", row.id);
                            }
                          }}
                        >
                          {CARD_CONTENT_TYPES.map((contentType) => (
                            <button
                              key={contentType}
                              id={`bulk-type-${row.id}-${contentType}`}
                              type="button"
                              role="option"
                              tabIndex={-1}
                              aria-selected={row.contentType === contentType}
                              className={`bulk-type-option${row.contentType === contentType ? " is-selected" : ""}`}
                              onClick={(event) => {
                                updateContentType(row.id, contentType);
                                event.currentTarget.parentElement?.focus({ preventScroll: true });
                              }}
                            >{contentType}</button>
                          ))}
                        </div>
                      </TableCell>
                      {!tableCard && <TableCell className="bulk-question-cell">{questionEditor}</TableCell>}
                      <TableCell colSpan={tableCard ? 2 : 1} className={`bulk-answer-table-cell${tableCard ? " bulk-table-card-stack" : ""}`}>
                        <div className="bulk-answer-cell">
                          {tableCard && <div className="bulk-table-card-title">{questionEditor}</div>}
                          <FormattedTextEditor
                            text={row.answer}
                            historyRevision={historyRevision}
                            savedContent={savedEditorContents.get(row.id)?.answer}
                            autoSave
                            images={row.media?.answer} onImagesChange={(images) => updateImages(row.id, "answer", images)} onImageBusyChange={onBusyChange} imagesDisabled={savingRequest || closing || viewing}
                            format={row.answerFormat}
                            label={`${rowIndex + 1}번째 답`}
                            placeholder="답 입력"
                            answer
                            showTableButton={false}
                            compact
                            dataBulkAnswer={row.id}
                            onChange={(answer, answerFormat) => updateAnswer(row.id, answer, answerFormat)}
                            onTabAtEnd={() => focusBulkField("memo", row.id)}
                            onBlur={() => scheduleAutoSave()}
                          />
                          <div className="bulk-memo-field">
                            <label htmlFor={`bulk-memo-${row.id}`}>메모</label>
                            <ImageField label="메모" mediaField="memo" images={row.media?.memo} onChange={(images) => updateImages(row.id, "memo", images)} compact onBusyChange={onBusyChange} disabled={savingRequest || closing || viewing}>
                            <Textarea
                              id={`bulk-memo-${row.id}`}
                              data-bulk-memo={row.id}
                              data-bulk-row-id={row.id}
                              data-bulk-focus-kind="memo"
                              value={row.memo}
                              onChange={(event) => updateMemo(row.id, event.target.value)}
                              onBlur={() => scheduleAutoSave()}
                              onKeyDown={(event) => {
                                if (event.key === "Tab" && !event.shiftKey) {
                                  event.preventDefault();
                                  continueFromMemo(rowIndex, row.contentType);
                                }
                              }}
                              placeholder="관련 해설이나 청킹"
                              rows={1}
                            />
                            </ImageField>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell colSpan={2} className="bulk-tools-cell">
                        <div className="bulk-tools-diamond">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          tabIndex={-1}
                          aria-label={row.important ? "중요 표시 해제" : "중요 표시"}
                          aria-pressed={row.important}
                          className={row.important ? "star-button is-important" : "star-button"}
                          onClick={() => toggleImportant(row.id)}
                        >
                          <Star fill={row.important ? "currentColor" : "none"} />
                        </Button>
                        <CardPreviewButton card={row} />
                        <TableRegistration format={row.answerFormat} onChange={(answer,answerFormat)=>updateAnswer(row.id,answer,answerFormat)} disabled={savingRequest || closing || viewing} iconOnly />
                        <Button type="button" variant="ghost" size="icon-sm" tabIndex={-1} aria-label="카드 삭제" onClick={() => setPendingRemoval(row)}><Trash2 /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    </ImageMoveProvider>
                  )}
                  {insertionControls(nextInsertionIndex)}
                  </Fragment>
                );})}
              </TableBody>
            </Table>
          </div>
          </div>

          <section className="mobile-bulk-editor" aria-label="모바일 카드 편집">
            {mobileDraftRow ? (
              <>
                <section className="mobile-card-meta-panel" aria-label="새 항목 위치와 설정">
                  <div className="mobile-card-location-summary">
                    <span>고정 위치</span>
                    <strong>{selectedSubject}</strong>
                    <p>
                      {[mobileDraftPath.section, mobileDraftPath.subsection, mobileDraftPath.detailSection]
                        .filter(Boolean)
                        .map((part, index) => <Fragment key={`${part}-${index}`}>{index > 0 && <ChevronRight />}{part}</Fragment>)}
                    </p>
                  </div>
                  {mobileDraftRow.type === "card" && (
                    <div className="mobile-card-meta-controls">
                      <div>
                        <FieldLabel>분류</FieldLabel>
                        <Select value={mobileDraftRow.contentType} onValueChange={updateMobileContentType}>
                          <SelectTrigger className="mobile-content-type-select"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CARD_CONTENT_TYPES.map((contentType) => <SelectItem key={contentType} value={contentType}>{contentType}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <FieldLabel>중요도</FieldLabel>
                        <button
                          type="button"
                          className={`card-importance-toggle${mobileDraftRow.important ? " is-important" : ""}`}
                          aria-pressed={mobileDraftRow.important}
                          onClick={() => updateMobileDraft((row) => ({ ...row, important: !row.important }))}
                        >
                          <Star fill={mobileDraftRow.important ? "currentColor" : "none"} />
                          {mobileDraftRow.important ? "중요" : "일반"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {mobileDraftRow.type === "card" ? (
                  <ImageMoveProvider media={mobileDraftRow.media} disabled={saving || closing || viewing} onMove={(from, to, imageId) => moveImage(mobileDraftRow.id, from, to, imageId)}>
                  <section className="mobile-card-compose-card" data-bulk-empty-delete-row={mobileDraftRow.id}>
                    <div>
                      <div className="mobile-compose-heading"><FieldLabel>질문</FieldLabel><div className="card-photo-toolbar"><PhotoAttachButton media={normalizeMedia(mobileDraftRow.media)} onChange={(field, images) => updateImages(mobileDraftRow.id, field, images)} onBusyChange={onBusyChange} disabled={savingRequest || closing || viewing} /><CardPreviewButton card={mobileDraftRow} /></div></div>
                      <FormattedTextEditor
                        text={mobileDraftRow.question}
                        historyRevision={historyRevision}
                        images={mobileDraftRow.media?.question} onImagesChange={(images) => updateImages(mobileDraftRow.id, "question", images)} onImageBusyChange={onBusyChange} imagesDisabled={savingRequest || closing || viewing}
                        format={mobileDraftRow.questionFormat}
                        label="새 카드 질문"
                        placeholder="무엇을 떠올릴까요?"
                        allowUnderline
                        onChange={(question, questionFormat) => updateMobileDraft((row) => ({ ...row, question, questionFormat }))}
                      />
                    </div>
                    <div>
                      <FieldLabel>답</FieldLabel>
                      <FormattedTextEditor
                        text={mobileDraftRow.answer}
                        historyRevision={historyRevision}
                        images={mobileDraftRow.media?.answer} onImagesChange={(images) => updateImages(mobileDraftRow.id, "answer", images)} onImageBusyChange={onBusyChange} imagesDisabled={savingRequest || closing || viewing}
                        format={mobileDraftRow.answerFormat}
                        label="새 카드 답"
                        placeholder="핵심 답을 적어주세요."
                        answer
                        onChange={(answer, answerFormat) => updateMobileDraft((row) => ({ ...row, answer, answerFormat }))}
                      />
                    </div>
                    <div>
                      <FieldLabel>메모</FieldLabel>
                      <ImageField label="메모" mediaField="memo" images={mobileDraftRow.media?.memo} onChange={(images) => updateImages(mobileDraftRow.id, "memo", images)} onBusyChange={onBusyChange} disabled={savingRequest || closing || viewing}>
                      <Textarea
                        value={mobileDraftRow.memo}
                        onChange={(event) => updateMobileDraft((row) => ({ ...row, memo: event.target.value }))}
                        placeholder="관련 해설이나 청킹 (선택)"
                        rows={3}
                      />
                      </ImageField>
                    </div>
                  </section>
                  </ImageMoveProvider>
                ) : (
                  <section className={`mobile-divider-compose-card is-level-${mobileDraftRow.level}`} data-bulk-empty-delete-row={mobileDraftRow.id}>
                    <header>
                      <span>{mobileDraftRow.level === 1 ? <Rows3 /> : mobileDraftRow.level === 2 ? <CornerDownRight /> : <ChevronRight />}</span>
                      <div>
                        <small>새 구분 만들기</small>
                        <strong>{mobileDraftRow.level === 1 ? "섹션" : mobileDraftRow.level === 2 ? "하부" : "세부"}</strong>
                      </div>
                    </header>
                    <label>
                      <FieldLabel>{mobileDraftRow.level === 1 ? "섹션" : mobileDraftRow.level === 2 ? "하부" : "세부"} 이름</FieldLabel>
                      <Input
                        autoFocus
                        value={mobileDraftRow.title}
                        placeholder={`${mobileDraftRow.level === 1 ? "섹션" : mobileDraftRow.level === 2 ? "하부" : "세부"} 이름을 입력하세요.`}
                        onChange={(event) => updateDivider(mobileDraftRow.id, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          void saveMobileDraft();
                        }}
                      />
                    </label>
                    <p>저장하면 이 위치 뒤의 카드가 새 구분에 이어져요.</p>
                  </section>
                )}

                <div className="mobile-bulk-actions is-compose-actions">
                  <Button type="button" variant="outline" disabled={saving} onClick={() => discardMobileDraft(true)}><ArrowLeft /> 종류 변경</Button>
                  <Button type="button" disabled={saving} onClick={() => void saveMobileDraft()}>{saving ? "저장 중…" : `${mobileDraftRow.type === "card" ? "카드" : mobileDraftRow.level === 1 ? "섹션" : mobileDraftRow.level === 2 ? "하부" : "세부"} 저장`}</Button>
                </div>
              </>
            ) : mobileInsertIndex !== null ? (
              <>
                <div className="mobile-position-heading is-kind-heading">
                  <div><strong>무엇을 만들까요?</strong><small>선택한 위치에 넣을 항목을 고르세요.</small></div>
                  <Badge>종류 선택</Badge>
                </div>
                <section className="mobile-create-kind-panel" aria-label="새로 만들 항목 선택">
                  <div className="mobile-create-kind-location">
                    <span>선택한 위치</span>
                    <strong>{selectedSubject}</strong>
                    <p>{[mobileInsertPath.section, mobileInsertPath.subsection, mobileInsertPath.detailSection].filter(Boolean).join(" › ")}</p>
                  </div>
                  <div className="mobile-create-kind-grid">
                    <button type="button" className="is-card" onClick={() => startMobileDraft("card")}>
                      <span><BookOpen /></span><div><strong>카드</strong><small>질문과 답을 입력해요.</small></div><ChevronRight />
                    </button>
                    <button type="button" className="is-section" onClick={() => startMobileDraft(1)}>
                      <span><Rows3 /></span><div><strong>섹션</strong><small>가장 큰 구분을 만들어요.</small></div><ChevronRight />
                    </button>
                    <button type="button" className="is-subsection" disabled={!mobileInsertHierarchy.hasSection} onClick={() => startMobileDraft(2)}>
                      <span><CornerDownRight /></span><div><strong>하부</strong><small>{mobileInsertHierarchy.hasSection ? "섹션 안에 구분을 만들어요." : "먼저 섹션이 필요해요."}</small></div><ChevronRight />
                    </button>
                    <button type="button" className="is-detail" disabled={!mobileInsertHierarchy.hasSubsection} onClick={() => startMobileDraft(3)}>
                      <span><ChevronRight /></span><div><strong>세부</strong><small>{mobileInsertHierarchy.hasSubsection ? "하부 안에 구분을 만들어요." : "먼저 하부가 필요해요."}</small></div><ChevronRight />
                    </button>
                  </div>
                </section>
                <div className="mobile-bulk-actions is-kind-actions">
                  <Button type="button" variant="outline" onClick={cancelMobileInsertKind}><ArrowLeft /> 위치 변경</Button>
                </div>
              </>
            ) : (
              <>
                <div className="mobile-position-heading">
                  <div><strong>어디 뒤에 넣을까요?</strong><small>위치를 누른 다음 만들 항목을 고를 수 있어요.</small></div>
                  <Badge>{selectedSubject}</Badge>
                </div>
                <div ref={mobilePositionListRef} className="mobile-position-list" aria-label="새 항목 삽입 위치">
                  <button type="button" className="mobile-position-choice is-first" onClick={() => chooseMobileInsertPosition(0)}>
                    <span><Plus /></span>
                    <div><small>처음</small><strong>맨 앞에 추가</strong></div>
                    <ChevronRight />
                  </button>
                  {mobileInsertLocations.map(({ row, rowIndex, path }) => {
                    const label = row.type === "card" ? "카드" : row.level === 1 ? "섹션" : row.level === 2 ? "하위" : "세부";
                    const title = row.type === "card" ? row.question || "내용을 입력하지 않은 카드" : row.title;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        data-mobile-position-row-id={row.id}
                        className={`mobile-position-choice is-${row.type}${row.type === "divider" ? ` is-level-${row.level}` : ""}${mobileRecentlySavedRowId === row.id ? " is-recently-saved" : ""}`}
                        onClick={() => chooseMobileInsertPosition(rowIndex + 1)}
                      >
                        <span>{row.type === "card" ? <BookOpen /> : row.level === 1 ? <Rows3 /> : row.level === 2 ? <CornerDownRight /> : <ChevronRight />}</span>
                        <div>
                          <small>{label} 뒤에</small>
                          <strong>{title}</strong>
                          <em>{selectedSubject} · {[path.section, path.subsection, path.detailSection].filter(Boolean).join(" › ")}</em>
                        </div>
                        {mobileRecentlySavedRowId === row.id ? <Check aria-label="방금 저장됨" /> : <Plus />}
                      </button>
                    );
                  })}
                </div>
                <div className="mobile-bulk-actions is-location-actions">
                  <span className={`bulk-save-status is-${saveState}`} aria-live="polite">
                    {saveState === "saving" ? <Cloud /> : saveState === "saved" ? <Check /> : saveState === "error" ? <X /> : <Clock3 />}
                    {saveState === "saving" ? "저장 중…" : saveState === "saved" ? "저장됨" : saveState === "error" ? "저장 실패" : "변경됨"}
                  </span>
                  <Button type="button" variant="outline" disabled={closing} onClick={() => void requestClose()}>{closing ? "저장 중…" : "닫기"}</Button>
                </div>
              </>
            )}
          </section>
          </>
          )}

          <DialogFooter className={`bulk-footer${!setMode ? " bulk-desktop-footer" : ""}`}>
            {draggedRowId && <Button type="button" variant="outline" onPointerDown={(event)=>event.stopPropagation()} onClick={(event)=>{event.stopPropagation();const sourceId=draggedRowId;const target=bulkDropTargetForGap(rowsRef.current,sourceId,rowsRef.current.length);cancelPickedRowMove();if(target){moveRow(sourceId,target);scheduleAutoSave();}}}>맨 마지막으로 이동</Button>}
            {setMode ? (
              <>
                <Button type="button" variant="outline" disabled={saving} onClick={() => editorSetDetails ? cancelEditorSetSelection() : onOpenChange(false)}>{editorSetDetails ? "취소" : "닫기"}</Button>
                {!setId && setCreateStep === "cards" ? (
                  <Button type="button" disabled={setCardIds.length < 2} onClick={continueSetCreateDetails}>다음</Button>
                ) : (
                  <Button type="submit" disabled={saving || !setName.trim() || setCardIds.length < 2}>
                    {saving ? "저장 중…" : setId ? "세트 수정하기" : "만들기"}
                  </Button>
                )}
              </>
            ) : (
              <>
                <span className={`bulk-save-status is-${saveState}`} aria-live="polite">
                  {saveState === "saving" ? <Cloud /> : saveState === "saved" ? <Check /> : saveState === "error" ? <X /> : <Clock3 />}
                  {saveState === "saving" ? "저장 중…" : saveState === "saved" ? "자동 저장됨" : saveState === "error" ? "저장 실패" : "변경됨"}
                </span>
                {desktopSelection && editorSetSelection !== null && <Button type="button" variant="destructive" disabled={!editorSetSelection.length || saving || closing || viewing} onClick={() => setPendingSelectedRemoval([...editorSetSelection])}><Trash2 />선택 삭제 ({editorSetSelection.length})</Button>}
                <Button type="button" disabled={closing || viewing || (editorSetSelection !== null && editorSetSelection.length < 2)} onClick={() => void (editorSetSelection !== null ? createSetFromEditorSelection() : requestView())}>{viewing ? "준비 중…" : editorSetSelection !== null ? "세트" : "보기"}</Button>
                <Button type="button" variant="outline" disabled={closing || (viewing && editorSetSelection === null)} onClick={() => editorSetSelection !== null ? cancelEditorSetSelection() : void requestClose()}>{editorSetSelection !== null ? "취소" : closing ? "마지막 저장 중…" : "닫기"}</Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {pickedPointer && pointerGhostPosition && draggedSource && typeof document !== "undefined" && createPortal(
      <div
        className={`bulk-drag-ghost is-pointer-following${draggedSource.type === "divider" ? " is-section-group" : " is-single-card"}`}
        style={pointerGhostPosition}
        aria-hidden="true"
      >
        <div className="bulk-drag-ghost-heading">
          <strong>{draggedSource.type === "divider"
            ? draggedSource.title || (draggedSource.level === 1 ? "섹션" : draggedSource.level === 2 ? "하위 섹션" : "세부 섹션")
            : draggedSource.question || "새 카드"}</strong>
          <span>{draggedSource.type === "divider" ? `${draggedCards.length}장 함께 이동` : "카드 1장"}</span>
        </div>
        {draggedSource.type === "divider" && draggedCards.length > 0 && (
          <div className="bulk-drag-ghost-stack">
            {draggedCards.slice(0, 3).map((card, index) => (
              <div
                key={card.id}
                className="bulk-drag-ghost-card"
                style={{ top: index * 11, left: index * 5, right: index * 5, zIndex: 3 - index }}
              >{card.question || "내용을 입력하지 않은 카드"}</div>
            ))}
          </div>
        )}
      </div>,
      document.body,
    )}
    <AlertDialog open={pendingSelectedRemoval !== null} onOpenChange={nextOpen => { if (!nextOpen) setPendingSelectedRemoval(null); }}>
      <AlertDialogContent size="sm" className="rounded-[24px]">
        <AlertDialogHeader>
          <AlertDialogTitle>선택한 카드 {pendingSelectedRemoval?.length ?? 0}장을 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription>계속하면 삭제 전 마지막 확인 단계가 한 번 더 나와요. 아직 카드는 삭제되지 않습니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={saving || closing || viewing} onClick={() => { setFinalSelectedRemoval(pendingSelectedRemoval); setPendingSelectedRemoval(null); }}>계속</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={finalSelectedRemoval !== null} onOpenChange={nextOpen => { if (!nextOpen) setFinalSelectedRemoval(null); }}>
      <AlertDialogContent size="sm" className="rounded-[24px]">
        <AlertDialogHeader>
          <AlertDialogTitle>마지막으로 한 번 더 확인해 주세요</AlertDialogTitle>
          <AlertDialogDescription>선택한 카드 {finalSelectedRemoval?.length ?? 0}장과 해당 학습 기록이 함께 삭제되며 복구할 수 없습니다. 선택하지 않은 카드와 섹션은 유지됩니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={saving || closing || viewing} onClick={removeSelectedEditorCards}>선택 카드 삭제</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={Boolean(pendingRemoval)} onOpenChange={(nextOpen) => !nextOpen && setPendingRemoval(null)}>
      <AlertDialogContent size="sm" className="rounded-[24px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{pendingRemoval?.type === "divider" ? "이 구분을 삭제할까요?" : "이 카드를 표에서 삭제할까요?"}</AlertDialogTitle>
          <AlertDialogDescription>계속하면 삭제 전 마지막 확인 단계가 한 번 더 나와요.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={continueBulkRemoval}>계속</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <FinalDeleteDialog
      open={Boolean(finalPendingRemoval)}
      itemLabel={finalPendingRemovalLabel}
      archiveAvailable={finalPendingCanArchive}
      archiveMessage={finalPendingCanArchive
        ? "보관하면 학습 목록에서 숨겨지고, 보관함에서 다시 꺼낼 수 있어요."
        : finalPendingRemoval?.type === "card"
          ? finalPendingSavedCard?.archivedAt ? "이미 보관 중인 카드예요." : "아직 저장되지 않은 카드는 보관할 수 없어요."
          : "섹션·하부·세부 구분은 보관할 수 없어요."}
      busy={removalBusy}
      onOpenChange={(nextOpen) => !nextOpen && setFinalPendingRemoval(null)}
      onDelete={permanentlyRemoveBulkRow}
      onArchive={archivePendingBulkCard}
    />
    <AlertDialog open={pendingKeywordInheritance.length > 0} onOpenChange={(nextOpen) => !nextOpen && setPendingKeywordInheritance([])}>
      <AlertDialogContent className="keyword-inheritance-dialog rounded-[26px]">
        <AlertDialogHeader>
          <AlertDialogTitle>기존 키워드 기록을 어디에 이어줄까요?</AlertDialogTitle>
          <AlertDialogDescription>모두 선택됨 · 전부 해제하면 새 기록으로 시작해요.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="keyword-inheritance-list">
          {pendingKeywordInheritance.map((item) => (
            <section className="keyword-inheritance-card" key={item.signature}>
              <small className="keyword-inheritance-question">{item.question}</small>
              {item.choices.map((choice) => (
                <div className="keyword-inheritance-group" key={choice.sourceKeyword}>
                  <p><span>나누기 전</span><strong>{choice.sourceKeyword}</strong></p>
                  <div>
                    {choice.targetKeywords.map((keyword) => (
                      <label key={keyword}>
                        <Checkbox
                          checked={choice.selectedTargetKeywords.includes(keyword)}
                          onCheckedChange={(checked) => setPendingKeywordInheritance((previous) => previous.map((pending) =>
                            pending.signature === item.signature
                              ? { ...pending, choices: toggleKeywordInheritanceTarget(pending.choices, choice.sourceKeyword, keyword, checked === true) }
                              : pending
                          ))}
                        />
                        <span>{keyword}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
        <AlertDialogFooter className="keyword-inheritance-actions">
          <AlertDialogCancel>돌아가기</AlertDialogCancel>
          <AlertDialogAction onClick={confirmKeywordInheritance}>선택대로 저장</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

export function CompareSetCardList({ cards }: { cards: Pick<StudyCard, "id" | "question" | "questionFormat" | "contentType">[] }) {
  return (
    <ol className={`set-question-preview${cards.length > 2 ? " is-grid" : ""}`} aria-label={`세트에 포함된 카드 ${cards.length}장 중 처음 ${Math.min(cards.length, 4)}장 미리보기`}>
      {cards.slice(0, 4).map((card, index) => (
        <li key={card.id}>
          <span className="set-preview-number" aria-hidden="true">{index + 1}</span>
          <div className="set-preview-copy">
            <span className="set-preview-type">{card.contentType}</span>
            <p>{renderFormattedText(card.questionFormat, card.question)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TabPageHeading({
  eyebrow,
  title,
  description,
  addLabel,
  onAdd,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  addLabel?: string;
  onAdd?: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading app-tab-heading">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {action ?? (onAdd && <Button type="button" className="heading-add" size="icon" aria-label={addLabel} onClick={onAdd}><Plus /></Button>)}
    </div>
  );
}

export function SubjectChooser({
  subjects,
  cards,
  sets,
  dailyStats,
  onSelect,
  onSelectSets,
}: {
  subjects: string[];
  cards: StudyCard[];
  sets: StudySet[];
  dailyStats?: DailyStudyStats | null;
  onSelect: (subject: string) => void;
  onSelectSets: () => void;
}) {
  const extraSubjects = subjects.filter((subject) => !elementarySubjects.includes(subject));
  const groups: Array<{ label: string; subjects: Array<string | null> }> = [
    ...subjectGroups,
    ...(extraSubjects.length ? [{ label: "기타", subjects: extraSubjects }] : []),
  ];

  return (
    <section className="subject-chooser">
      <div className="subject-grid subject-important-grid">
        <Button
          type="button"
          variant="outline"
          className="subject-tile subject-tile-important"
          onClick={() => onSelect(IMPORTANT_VIEW)}
        >
          <span className="important-star"><Star fill="currentColor" /></span>
          <strong>중요 카드</strong>
          <small>{cards.filter((card) => !card.archivedAt && card.importance >= 2).length}장 모아보기</small>
          <ChevronRight />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="subject-tile subject-tile-important subject-tile-incorrect"
          onClick={() => onSelect(INCORRECT_VIEW)}
        >
          <span className="incorrect-icon"><RotateCcw /></span>
          <strong>오답 카드</strong>
          <small>{cards.filter((card) => !card.archivedAt && card.incorrectCount > 0).length}장 · 많이 틀린 순</small>
          <ChevronRight />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="subject-tile subject-tile-important subject-tile-archive"
          onClick={() => onSelect(ARCHIVED_VIEW)}
        >
          <span className="archive-icon"><Archive /></span>
          <strong>보관함</strong>
          <small>{cards.filter((card) => card.archivedAt).length}장 · 간격 복습</small>
          <ChevronRight />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="subject-tile subject-tile-important subject-tile-set"
          onClick={onSelectSets}
        >
          <span className="set-icon"><FolderHeart /></span>
          <strong>비교 세트</strong>
          <small>{sets.length ? `${sets.length}개 묶음 골라보기` : "아직 만든 세트 없음"}</small>
          <ChevronRight />
        </Button>
      </div>
      <div className="subject-groups">
        {groups.map((group) => (
          <section className="subject-group" key={group.label}>
            <div className="subject-group-heading">
              <h2>{group.label}</h2>
              {group.label !== "기타" && <span>{group.subjects.filter(Boolean).length}과목</span>}
            </div>
            <div className="subject-grid">
              {group.subjects.map((subject, index) => {
                if (!subject) {
                  return <span className="subject-tile-placeholder" aria-hidden="true" key={`${group.label}-blank-${index}`} />;
                }
                const count = cards.filter((card) => !card.archivedAt && card.subject === subject).length;
                const completedToday = subjectStudiedToday(subject, cards, dailyStats);
                return (
                  <Button
                    key={subject}
                    type="button"
                    variant="outline"
                    className={`subject-tile${completedToday ? " is-learned-today" : ""}`}
                    aria-label={completedToday ? `${subject} ${count}장, 오늘 학습 완료` : undefined}
                    title={completedToday ? "보관함을 제외한 모든 카드에 오늘 학습 기록이 있어요." : undefined}
                    onClick={() => onSelect(subject)}
                  >
                    <span className={`subject-dot subject-dot-${subjectColorIndex(subject, subjects)}`} />
                    <strong>{subject === "통합교과" ? "통합" : subject}</strong>
                    <small>
                      <span className="subject-card-count">{count ? `${count}장` : "아직 없음"}</span>
                      {completedToday && <span className="subject-today-complete"><Check aria-hidden="true" /><span><span className="subject-today-prefix">오늘 </span>완료</span></span>}
                    </small>
                    <ChevronRight />
                  </Button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function EmptyStudy({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-icon"><Layers3 /></div>
      <h2>첫 스제트를 만들어볼까요?</h2>
      <p>질문과 답을 연속으로 적으면 바로 복습할 수 있어요.</p>
      <Button size="lg" onClick={onAdd}><Plus /> 카드 추가하기</Button>
    </section>
  );
}

export function handleQuizReviewEnter(event: KeyboardEvent, button: HTMLButtonElement | null, desktop: boolean) {
  if (!desktop || event.key !== "Enter" || event.defaultPrevented || event.isComposing || event.keyCode === 229
    || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    || !button?.isConnected || button.disabled) return false;
  const target = event.target as HTMLElement | null;
  const control = target?.closest?.('input, textarea, select, a, button, [role="button"], [role="tab"], [contenteditable="true"]');
  if (control && control !== button) return false;
  event.preventDefault();
  if (event.repeat) return false;
  button.click();
  return true;
}

export function rememberHintScroll(root: HTMLElement | null) {
  const positions: Array<{ element: HTMLElement; top: number; left: number }> = [];
  for (let element = root; element; element = element.parentElement) positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
  const x = window.scrollX, y = window.scrollY;
  return () => {
    for (const { element, top, left } of positions) {
      if (!element.isConnected) continue;
      if (element.scrollTop !== top) element.scrollTop = top;
      if (element.scrollLeft !== left) element.scrollLeft = left;
    }
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo({ left: x, top: y, behavior: "instant" });
  };
}

export function revealInputInsideCloze(input: HTMLInputElement) {
  if (revealMobileStudyInput(input)) return;
  const tableScroller=input.closest?.<HTMLElement>(".answer-table-scroll");
  if(tableScroller?.classList?.contains("answer-table-scroll")) {
    const frame=tableScroller.getBoundingClientRect(),field=input.getBoundingClientRect();
    if(field.left<frame.left+8)tableScroller.scrollLeft+=field.left-frame.left-8;
    else if(field.right>frame.right-8)tableScroller.scrollLeft+=field.right-frame.right+8;
    if(field.top<frame.top+8)tableScroller.scrollTop+=field.top-frame.top-8;
    else if(field.bottom>frame.bottom-8)tableScroller.scrollTop+=field.bottom-frame.bottom+8;
  }
  const box = input.closest<HTMLElement>(".quiz-cloze-copy");
  if (!box || box.scrollHeight <= box.clientHeight) return;
  const frame = box.getBoundingClientRect(), field = input.getBoundingClientRect();
  const top = frame.top + box.clientTop + 6, bottom = frame.top + box.clientTop + box.clientHeight - 6;
  if (field.top < top) box.scrollTop += field.top - top;
  else if (field.bottom > bottom) box.scrollTop += field.bottom - bottom;
}

export function focusQuizInputAtEnd(input: HTMLInputElement | null | undefined) {
  if (!input || !input.isConnected || input.disabled) return false;
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  if (revealMobileStudyInput(input)) return true;
  if (input.closest?.(".study-keyword-attempt")) revealInputInsideCloze(input);
  else input.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

export function QuizCloze({
  card,
  answers,
  checked,
  autoFocusFirst = false,
  autoFocusMobile = false,
  partsOverride,
  orderIndependentOverride,
  inputLabel = "핵심 키워드",
  hints = {},
  matchFeedback = false,
  correctionMode = false,
  studyReview = false,
  guidedPractice = false,
  revealedKeywords = [],
  onChange,
  onFocusIndex,
  onHint,
  onSubmit,
  mobileSubmitOnLast = false,
  tableTabOrder = "vertical",
}: {
  card: StudyCard;
  answers: string[];
  checked: boolean;
  autoFocusFirst?: boolean;
  autoFocusMobile?: boolean;
  partsOverride?: ClozePart[];
  orderIndependentOverride?: QuizAnswerOrder;
  inputLabel?: string;
  hints?: QuizCardHints;
  matchFeedback?: boolean;
  correctionMode?: boolean;
  studyReview?: boolean;
  guidedPractice?: boolean;
  revealedKeywords?: string[];
  onChange: (index: number, value: string) => void;
  onFocusIndex?: (index: number) => void;
  onHint?: (index: number) => void;
  onSubmit: (answers?: string[]) => void;
  mobileSubmitOnLast?: boolean;
  tableTabOrder?: TableTabOrder;
}) {
  const parts = partsOverride ?? clozeParts(card);
  const table = parts.some((part) => part.cellId) ? readTable(card.answerFormat) : null;
  const clozeRootRef = useRef<HTMLDivElement | null>(null);
  const tableScrollTopRef = useRef(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const hintRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const hintResetKey = Object.entries(hints).map(([index,hint]) => `${index}:${hint?.revision ?? 0}:${hint?.stage}`).join("|");
  const [composition, setComposition] = useState<{ index: number | null; hintKey: string } | null>(null);
  const composingIndex = composition?.hintKey === hintResetKey ? composition.index : null;
  const setComposingIndex = (index: number | null) => setComposition({ index, hintKey: hintResetKey });
  const viewport = useVisibleViewport();
  const mobileLayout = useMobileTableLayout();
  const mobileTable = Boolean(table && mobileLayout);
  const [activeMobileIndex, setActiveMobileIndex] = useState<number | null>(null);
  const mobileInputRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const latestHintsRef = useRef(hints);
  useLayoutEffect(() => { latestHintsRef.current = hints; }, [hints]);
  const newlyMatchedIndicesRef = useRef(new Set<number>());
  const [newlyMatchedIndices, setNewlyMatchedIndices] = useState<Set<number>>(() => new Set());
  const pendingMatchedAnswerRef = useRef<{
    answers: string[];
    allMatched: boolean;
    nextIndex: number;
  } | null>(null);
  const acceptedInputsRef = useRef(new WeakSet<HTMLInputElement | HTMLTextAreaElement>());
  const keywords = parts
    .filter((part): part is Extract<ClozePart, { type: "blank" }> => part.type === "blank")
    .map((part) => part.keyword);
  const blankCount = keywords.length;
  const orderIndependent = orderIndependentOverride ?? quizAnswerOrder(parts);
  const evaluations = evaluateQuizAnswers(keywords, answers, orderIndependent);
  const hintKeywords = quizHintKeywords(keywords, answers, orderIndependent, hints);
  const mobileBlankOrder = table ? tableBlankOrder(table, parts, tableTabOrder) : [];
  const blankNumber = (index: number) => table ? mobileBlankOrder.indexOf(index) + 1 : index + 1;
  const lastMobileBlankIndex = mobileBlankOrder.at(-1);
  const allKeywordsMatched = evaluations.length > 0 && evaluations.every((item) => item.matched);
  const studyReviewTypography = studyReview && !table && (checked || correctionMode);

  useLayoutEffect(() => {
    const copy = clozeRootRef.current;
    if (!studyReviewTypography || !copy) return;
    const desktop = window.matchMedia("(min-width: 760px)");
    const reset = () => {
      copy.style.removeProperty("--study-review-size");
      copy.style.removeProperty("--study-review-leading");
    };
    const fit = () => {
      reset();
      const fits = () => copy.scrollHeight <= copy.clientHeight + 1;
      if (!desktop.matches || !copy.clientHeight || fits()) return;
      // Preserve a consistent size if tightening line spacing is enough.
      copy.style.setProperty("--study-review-leading", "1.58");
      for (const size of [17, 16]) {
        if (fits()) break;
        copy.style.setProperty("--study-review-size", `${size}px`);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(copy);
    desktop.addEventListener("change", fit);
    let active = true;
    void document.fonts?.ready.then(() => { if (active) fit(); });
    return () => {
      active = false;
      observer.disconnect();
      desktop.removeEventListener("change", fit);
      reset();
    };
  }, [studyReviewTypography, card.id, card.answerFormat, card.answer]);

  const showGuide = correctionMode || guidedPractice;
  // Corrected/partial attempts replace completed slots with fixed text. Include
  // those sources so their explanation references stay open without new grading.
  const fixedKeywords = parts.flatMap((part) => part.type === "text" && part.isCorrectAnswer ? [part.value] : []);
  const linkedKeywords = [...keywords, ...fixedKeywords];
  const linkedRevealed = new Set([
    ...fixedKeywords,
    ...evaluations.filter((item) => item.matched).map((item) => item.expectedKeyword),
  ].map(normalizeKeywordKey));
  const renderLinkedAnswerText = (text: string) => {
    const ranges = answerKeywordRanges(text, linkedKeywords);
    const result: React.ReactNode[] = [];
    let cursor = 0;
    for (const range of ranges) {
      result.push(text.slice(cursor, range.start));
      const matched = linkedRevealed.has(normalizeKeywordKey(range.keyword));
      result.push(<span key={`answer-mask-${range.start}`} className={`question-keyword-blank answer-keyword-blank ${matched ? "is-correct" : "is-missed"}${showGuide && !matched ? " has-guide" : ""}`} aria-label={matched || showGuide ? undefined : "정답 키워드와 함께 채워지는 빈칸"}>{matched || showGuide ? text.slice(range.start, range.end) : null}</span>);
      cursor = range.end;
    }
    result.push(text.slice(cursor));
    return result;
  };
  useLayoutEffect(() => {
    if (!table) return;
    const frame = window.requestAnimationFrame(() => {
      if (clozeRootRef.current) clozeRootRef.current.scrollTop = tableScrollTopRef.current;
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, correctionMode]);

  const revealMobileBlank = (index: number) => {
    const scroller = clozeRootRef.current;
    const blank = scroller?.querySelector<HTMLElement>(`[data-table-blank="${index}"]`);
    if (!scroller || !blank) return;
    if (revealMobileStudyInput(blank)) { scroller.style.removeProperty("--table-keyboard-inset"); return; }
    const frame = scroller.getBoundingClientRect();
    const field = blank.getBoundingClientRect();
    // iOS keeps the layout viewport tall when its keyboard covers the bottom.
    // Add that occluded distance to the scroll range, even for a short table.
    const keyboardInset = Math.max(0, frame.bottom - viewport.top - viewport.height);
    scroller.style.setProperty("--table-keyboard-inset", `${keyboardInset}px`);
    const visibleTop = Math.max(frame.top + 8, viewport.top + 8);
    const visibleBottom = Math.min(frame.bottom - 8, viewport.top + viewport.height - 8);
    if (visibleBottom <= visibleTop) return;
    if (field.top < visibleTop || field.bottom > visibleBottom) {
      const targetTop = visibleTop + Math.min(48, (visibleBottom - visibleTop) * .3);
      scroller.scrollTop += field.top - targetTop;
    }
  };

  useLayoutEffect(() => {
    if (!mobileTable || activeMobileIndex === null) return;
    const frame = window.requestAnimationFrame(() => revealMobileBlank(activeMobileIndex));
    return () => window.cancelAnimationFrame(frame);
    // The visual viewport changes after iOS opens or resizes the keyboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileTable, activeMobileIndex, viewport.height, viewport.top, viewport.width, answers, hintResetKey]);

  useLayoutEffect(() => {
    if (!mobileTable || checked || activeMobileIndex === null) {
      clozeRootRef.current?.style.removeProperty("--table-keyboard-inset");
    }
  }, [mobileTable, checked, activeMobileIndex]);

  const focusInput = (index: number) => {
    if (mobileTable) {
      if (index < 0 || index >= blankCount || evaluations[index]?.matched || checked) return false;
      const input = mobileInputRefs.current[index];
      if (!input?.isConnected || input.disabled) return false;
      setActiveMobileIndex(index);
      setComposingIndex(null);
      input.focus({preventScroll:true});
      input.setSelectionRange(input.value.length,input.value.length);
      return true;
    }
    const referencedInput = inputRefs.current[index];
    const input = referencedInput?.isConnected
      ? referencedInput
      : clozeRootRef.current?.querySelector<HTMLInputElement>(`input[data-cloze-index="${index}"]`) ?? null;
    return focusQuizInputAtEnd(input);
  };

  const focusAvailableInput = (startIndex: number, direction: 1 | -1) => {
    for (let index = startIndex; index >= 0 && index < blankCount; index += direction) {
      if (focusInput(index)) return true;
    }
    return false;
  };

  const focusTableInputFrom = (startIndex: number, includeStart = false) => {
    const position = mobileBlankOrder.indexOf(startIndex);
    const candidates = position < 0 ? mobileBlankOrder : [
      ...mobileBlankOrder.slice(position + (includeStart ? 0 : 1)),
      ...mobileBlankOrder.slice(0, position + (includeStart ? 0 : 1)),
    ];
    return candidates.some((index) => focusInput(index));
  };

  useLayoutEffect(() => {
    if (!autoFocusFirst || checked || (!showGuide && !autoFocusMobile && mobileLayout)) return;
    // Focus as soon as the fields are committed: waiting for a frame leaves
    // keyboard events on the old button or document body. Scrolling can wait.
    if (table) focusTableInputFrom(mobileBlankOrder[0], true);
    else focusAvailableInput(0, 1);
    // 카드나 안내 화면이 바뀔 때만 첫 빈칸으로 이동해요.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocusFirst, autoFocusMobile, card.id, checked, showGuide, mobileLayout]);

  const queueNextIfMatched = (index: number, value: string) => {
    pendingMatchedAnswerRef.current = planMatchedQuizAnswer(keywords, answers, index, value, orderIndependent);
    if (table && pendingMatchedAnswerRef.current && !pendingMatchedAnswerRef.current.allMatched) {
      const position = mobileBlankOrder.indexOf(index);
      const nextEvaluations = evaluateQuizAnswers(keywords, pendingMatchedAnswerRef.current.answers, orderIndependent);
      const next = [...mobileBlankOrder.slice(position + 1), ...mobileBlankOrder.slice(0, position)]
        .find((candidate) => !nextEvaluations[candidate]?.matched);
      if (next !== undefined) pendingMatchedAnswerRef.current.nextIndex = next;
    }
    if (matchFeedback && pendingMatchedAnswerRef.current && !evaluations[index]?.matched && !newlyMatchedIndicesRef.current.has(index)) {
      newlyMatchedIndicesRef.current.add(index);
      setNewlyMatchedIndices(new Set(newlyMatchedIndicesRef.current));
      try {
        window.navigator.vibrate?.(25);
      } catch {
        // 칸의 흔들림은 진동을 지원하지 않는 기기에서도 보여요.
      }
    }
  };

  const acceptInputValue = (index: number, input: HTMLInputElement | HTMLTextAreaElement, savedHint: QuizCardHints[number]) => {
    if (!input.isConnected || acceptedInputsRef.current.has(input) || latestHintsRef.current[index] !== savedHint) return;
    const value = input.value;
    queueNextIfMatched(index, value);
    if (pendingMatchedAnswerRef.current) {
      // A Korean IME can leave the final, already correct syllable composing until
      // another key is pressed. Commit an exact whole-keyword match now. Ignore
      // trailing composition events from this input so grading happens only once.
      acceptedInputsRef.current.add(input);
      setComposingIndex(null);
      if (!pendingMatchedAnswerRef.current.allMatched) deferMobileAnswerScroll(input);
      input.blur();
    }
    onChange(index, value);
  };

  const syncHintScroll = (index: number, input: HTMLInputElement) => {
    const hint = hintRefs.current[index];
    if (hint) hint.scrollLeft = input.scrollLeft;
  };

  const restoreHintFocus = useEffectEvent(() => {
    // Composition belongs to its hint revision; a replacement renders it inactive.
    pendingMatchedAnswerRef.current = null;
    if (mobileTable && activeMobileIndex !== null) {
      const input = mobileInputRefs.current[activeMobileIndex];
      input?.focus({preventScroll:true});
      input?.setSelectionRange(input.value.length,input.value.length);
    }
  });
  useLayoutEffect(() => { restoreHintFocus(); }, [hintResetKey]);

  useLayoutEffect(() => {
    inputRefs.current.forEach((input, index) => {
      if (input) syncHintScroll(index, input);
    });
  }, [answers, hints]);

  useLayoutEffect(() => {
    // Keep iOS's editable font at least 16px to avoid focus zoom, while rendering
    // at exactly the surrounding table's font size, line height and padding.
    mobileInputRefs.current.forEach((input) => {
      if (!input?.parentElement) return;
      const style = getComputedStyle(input.parentElement);
      const size = parseFloat(style.fontSize);
      const scale = Math.min(1, size / 16);
      input.style.setProperty("--table-input-font", `${size / scale}px`);
      input.style.lineHeight = `${parseFloat(style.lineHeight) / scale}px`;
      input.style.letterSpacing = `${(parseFloat(style.letterSpacing) || 0) / scale}px`;
      input.style.paddingInline = `${1 / scale}px`;
      input.style.width = `${100 / scale}%`;
      const mirror = input.parentElement.querySelector<HTMLElement>(".table-inline-measure");
      input.style.transform = `scale(${scale})`;
      // Mirror and native textarea wrapping can differ by a fraction of a pixel.
      // Use the native content height too so the final line is never hidden.
      if (mirror) {
        mirror.style.minHeight = "";
        const requiredHeight = Math.ceil(input.scrollHeight * scale);
        mirror.style.minHeight = `${Math.max(mirror.getBoundingClientRect().height, requiredHeight)}px`;
      }
      input.style.height = `${100 / scale}%`;
      input.scrollTop = 0;
      input.scrollLeft = 0;
    });
  }, [mobileTable, answers, hintResetKey, activeMobileIndex, viewport.width]);

  const applyMatchedAnswerEvent = useEffectEvent((pending: NonNullable<typeof pendingMatchedAnswerRef.current>) => {
    if (pending.allMatched) {
      // The mobile last-field Enter action is a manual fallback, not an opt-out
      // from auto-grading. Reuse the normal grading path (including hint/retry rules).
      if (mobileTable) {
        mobileInputRefs.current.forEach((input) => input?.blur());
        setActiveMobileIndex(null);
      }
      onSubmit(pending.answers);
      return;
    }
    if (table) { focusInput(pending.nextIndex); return; }
    if (!focusAvailableInput(pending.nextIndex, 1)) {
      focusAvailableInput(0, 1);
    }
  });

  useLayoutEffect(() => {
    const pending = pendingMatchedAnswerRef.current;
    if (!pending) return;
    pendingMatchedAnswerRef.current = null;
    if (checked) return;
    applyMatchedAnswerEvent(pending);
  }, [answers, card.id, checked]);

  const renderedParts = parts.map((part, index) => {
        if (part.type === "text") {
          const hidden = part.keywordReference && !checked
            && !revealedKeywords.some((keyword) => normalizeForMatch(keyword) === normalizeForMatch(part.keywordReference!));
          return <span key={`quiz-text-${index}`} className={hidden ? "connection-keyword-mask" : part.isCorrectAnswer ? "cloze-inline-answer is-correct is-review-text" : undefined} aria-label={hidden ? "질문 키워드와 함께 열리는 빈칸" : undefined}>{hidden ? "　…　" : part.isCorrectAnswer || part.keywordReference ? part.value : renderLinkedAnswerText(part.value)}</span>;
        }
        const currentIndex = parts.slice(0, index).filter((item) => item.type === "blank").length;
        const currentAnswer = answers[currentIndex] ?? "";
        const evaluation = evaluations[currentIndex] ?? { matched: false, expectedKeyword: part.keyword };
        const savedHint = hints[currentIndex];
        const hintKeyword = hintKeywords[currentIndex] || evaluation.expectedKeyword || savedHint?.keyword || part.keyword;
        const hint = savedHint
          ? { ...savedHint, keyword: hintKeyword, text: progressiveQuizHint(hintKeyword, savedHint.stage) }
          : undefined;
        const hintId = `quiz-hint-${card.id}-${currentIndex}`;
        const correctionId = `quiz-correction-${card.id}-${currentIndex}`;
        const guideTail = showGuide ? remainingCorrectionGuide(part.keyword, currentAnswer, composingIndex === currentIndex) : "";

        if (mobileTable && !checked && !(evaluation.matched && composingIndex !== currentIndex)) {
          const hintTail = showGuide ? guideTail : hint ? remainingQuizHint(hint.keyword,hint.stage,currentAnswer,composingIndex===currentIndex) : "";
          return <span key={`quiz-blank-${index}`} className={showGuide ? "table-inline-review" : undefined}>
            <span data-table-blank={currentIndex} className={`table-inline-blank ${evaluation.matched ? "is-correct" : "is-missed"}${activeMobileIndex===currentIndex?" is-active":""}`}>
            <span className="table-inline-measure" aria-hidden="true">{currentAnswer + hintTail || `빈칸 ${blankNumber(currentIndex)}`}{"\u200b"}</span>
            {(hint || showGuide) && <span className="table-inline-measure table-inline-guide-size" aria-hidden="true">{showGuide ? part.keyword : hint!.keyword}</span>}
            <textarea key={`mobile-${currentIndex}:${savedHint?.revision ?? 0}`} ref={(node)=>{mobileInputRefs.current[currentIndex]=node;}}
              data-cloze-index={currentIndex} data-mobile-cloze-card={card.id} value={currentAnswer}
              rows={1} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              enterKeyHint={mobileSubmitOnLast && currentIndex===lastMobileBlankIndex ? "done" : "next"}
              aria-label={`${blankNumber(currentIndex)}번째 ${inputLabel}`} aria-describedby={showGuide ? correctionId : hint ? hintId : undefined}
              placeholder={hint || showGuide ? "" : `빈칸 ${blankNumber(currentIndex)}`}
              onFocus={()=>{setActiveMobileIndex(currentIndex);onFocusIndex?.(currentIndex);window.requestAnimationFrame(()=>revealMobileBlank(currentIndex));}}
              onCompositionStart={()=>setComposingIndex(currentIndex)}
              onCompositionEnd={(event)=>{if(!event.currentTarget.isConnected||acceptedInputsRef.current.has(event.currentTarget)||latestHintsRef.current[currentIndex]!==savedHint)return;setComposingIndex(null);acceptInputValue(currentIndex,event.currentTarget,savedHint);}}
              onChange={(event)=>acceptInputValue(currentIndex,event.currentTarget,savedHint)}
              onKeyDown={(event)=>{
                if(event.nativeEvent.isComposing||event.keyCode===229)return;
                if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();nextMobile();return;}
                if((event.key!=="Tab"&&!event.key.startsWith("Arrow"))||event.ctrlKey||event.metaKey||event.altKey)return;
                const input=event.currentTarget,forward=event.key==="ArrowRight"||event.key==="ArrowDown";
                if(event.key!=="Tab"&&(input.selectionStart!==input.selectionEnd||(forward?input.selectionEnd!==input.value.length:input.selectionStart!==0)))return;
                const active=mobileBlankOrder.filter((i)=>mobileInputRefs.current[i]?.isConnected&&!evaluations[i]?.matched);
                const target=tableBlankNavigation(table!,parts,active,currentIndex,event.key,event.shiftKey,
                  (i)=>mobileInputRefs.current[i]?.getBoundingClientRect()??null,tableTabOrder);
                if(target!==null&&focusInput(target)){event.preventDefault();event.stopPropagation();}
              }}
            />
            {(hint || showGuide) && <span className="table-inline-hint" aria-hidden="true"><span className="cloze-hint-entered">{currentAnswer}</span><span>{hintTail}</span></span>}
            {hint && <span id={hintId} className="sr-only">{hint.stage===1?"첫 글자 힌트: ":"초성 힌트: "}{hint.text}</span>}
            </span>
            {showGuide && <span id={correctionId} className="sr-only">정답 {part.keyword} 전체를 따라 쓰세요.</span>}
          </span>;
        }

        if ((evaluation.matched && composingIndex !== currentIndex) || checked) {
          return (
            <span
              className={`cloze-inline-answer ${evaluation.matched ? "is-correct" : "is-incorrect"}${showGuide || checked ? " is-review-text" : ""}${evaluation.matched && newlyMatchedIndices.has(currentIndex) ? " is-just-matched" : ""}`}
              key={`quiz-blank-${index}`}
            >
              {currentAnswer.trim() || "미입력"}
            </span>
          );
        }

        const field = (
          <span className={`cloze-field is-missed${hint || showGuide ? " has-hint" : ""}${showGuide ? " is-correction" : ""}`} key={`quiz-blank-${index}`}>
            {(hint || showGuide) && <span className="cloze-field-size" aria-hidden="true">{showGuide ? part.keyword.normalize("NFC") : hint!.keyword.normalize("NFC")}</span>}
            <Input
              key={`input-${currentIndex}-${savedHint?.revision ?? 0}`}
              ref={(node) => { inputRefs.current[currentIndex] = node; }}
              data-cloze-index={currentIndex}
              value={currentAnswer}
              onFocus={() => onFocusIndex?.(currentIndex)}
              onScroll={(event) => syncHintScroll(currentIndex, event.currentTarget)}
              onCompositionStart={() => setComposingIndex(currentIndex)}
              onCompositionEnd={(event) => {if(!event.currentTarget.isConnected || acceptedInputsRef.current.has(event.currentTarget) || latestHintsRef.current[currentIndex] !== savedHint)return;setComposingIndex(null);acceptInputValue(currentIndex,event.currentTarget,savedHint);}}
              onChange={(event) => acceptInputValue(currentIndex,event.currentTarget,savedHint)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                const input = event.currentTarget;
                const selectionStart = input.selectionStart ?? 0;
                const selectionEnd = input.selectionEnd ?? selectionStart;
                const isDesktop = window.matchMedia("(min-width: 761px)").matches;

                if (isDesktop && onHint && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.repeat) return;
                  onFocusIndex?.(currentIndex);
                  onHint(currentIndex);
                  return;
                }

                if (table && (event.key === "Tab" || event.key.startsWith("Arrow"))) {
                  if(event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && event.key !== "Tab"))return;
                  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
                  const edge = event.key === "Tab" || (selectionStart === selectionEnd && (forward ? selectionEnd === input.value.length : selectionStart === 0));
                  if (!edge) return;
                  const activeIndices = mobileBlankOrder.filter((i) => inputRefs.current[i]?.isConnected && !evaluations[i]?.matched);
                  const nextIndex = tableBlankNavigation(table, parts, activeIndices, currentIndex, event.key, event.shiftKey,
                    (i) => inputRefs.current[i]?.getBoundingClientRect() ?? null, tableTabOrder);
                  if (nextIndex !== null && focusInput(nextIndex)) {event.preventDefault();event.stopPropagation();}
                  return;
                }

                if (isDesktop && (event.key === "ArrowLeft" || event.key === "Backspace") && selectionStart === 0 && selectionEnd === 0) {
                  if (focusAvailableInput(currentIndex - 1, -1)) event.preventDefault();
                  return;
                }

                if (isDesktop && event.key === "ArrowRight" && selectionStart === input.value.length && selectionEnd === input.value.length) {
                  if (focusAvailableInput(currentIndex + 1, 1)) event.preventDefault();
                  return;
                }

                if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  const direction = event.shiftKey ? -1 : 1;
                  if (focusAvailableInput(currentIndex + direction, direction)) event.preventDefault();
                  return;
                }

                if (event.key !== "Enter") return;
                event.preventDefault();
                if (focusAvailableInput(currentIndex + 1, 1)) {
                  return;
                }
                onSubmit();
              }}
              enterKeyHint={table ? currentIndex === lastMobileBlankIndex ? "done" : "next" : currentIndex < blankCount - 1 ? "next" : "done"}
              placeholder={hint || showGuide ? "" : `빈칸 ${blankNumber(currentIndex)}`}
              aria-label={`${blankNumber(currentIndex)}번째 ${inputLabel}`}
              aria-describedby={showGuide ? correctionId : hint ? hintId : undefined}
            />
            {hint && (
              <>
                <span ref={(node) => { hintRefs.current[currentIndex] = node; }} className="cloze-field-hint" aria-hidden="true">
                  <span className="cloze-hint-entered">{currentAnswer}</span><span>{remainingQuizHint(hint.keyword, hint.stage, currentAnswer, composingIndex === currentIndex)}</span>
                </span>
                <span id={hintId} className="sr-only" aria-live="polite">{hint.stage === 1 ? "첫 글자 힌트: " : "초성 힌트: "}{hint.text}</span>
              </>
            )}
            {showGuide && <>
              <span ref={(node) => { hintRefs.current[currentIndex] = node; }} className="cloze-field-hint" aria-hidden="true"><span className="cloze-hint-entered">{currentAnswer}</span><span>{guideTail}</span></span>
              <span id={correctionId} className="sr-only">정답 {part.keyword} 전체를 따라 쓰세요.</span>
            </>}
          </span>
        );
        return showGuide ? <span className={table ? "table-inline-review" : "cloze-inline-review"} key={`quiz-blank-${index}`}>{field}</span> : field;
      });
  const activeIndex = activeMobileIndex;
  const isLastMobileBlank = activeIndex !== null && lastMobileBlankIndex === activeIndex;
  const mobileAnswersFilled = keywords.every((_,index) => Boolean(answers[index]?.trim()));
  const mobileGradeReady = mobileSubmitOnLast && (isLastMobileBlank || allKeywordsMatched) && mobileAnswersFilled;
  const nextMobile = () => {
    if (activeIndex === null || composingIndex !== null) return;
    if (mobileGradeReady) {
      mobileInputRefs.current[activeIndex]?.blur();
      setActiveMobileIndex(null);
      onSubmit();
      return;
    }
    const position=mobileBlankOrder.indexOf(activeIndex);
    const next=[...mobileBlankOrder.slice(position+1),...mobileBlankOrder.slice(0,position)].find((i)=>!evaluations[i]?.matched);
    if(next !== undefined) focusInput(next);
    else { mobileInputRefs.current[activeIndex]?.blur(); setActiveMobileIndex(null); }
  };
  return <div ref={clozeRootRef} onScroll={table ? (event) => { tableScrollTopRef.current = event.currentTarget.scrollTop; } : undefined} className={`quiz-cloze-copy${table ? " is-table-cloze" : ""}${studyReviewTypography ? " is-study-review" : ""}${studyReviewTypography && correctionMode ? " is-study-correction" : ""}`}>{table ? <TableGrid doc={table} renderCell={(cell) => <>{renderedParts.filter((_,index) => parts[index].cellId === cell.id)}</>}/> : renderedParts}</div>;
}

export function shouldFocusConnectionContinue(checked: boolean, desktop: boolean) {
  return checked && desktop;
}

export function connectionContextPath(section: string, subsection: string, detailSection: string) {
  return [section, subsection, detailSection]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" › ");
}

export function ConnectionPractice({
  card,
  answers,
  checked,
  reverse,
  onChange,
  onSubmit,
  onContinue,
}: {
  card: StudyCard;
  answers: string[];
  checked: boolean;
  reverse: boolean;
  onChange: (index: number, value: string) => void;
  onSubmit: (answers?: string[]) => void;
  onContinue: () => void;
}) {
  const continueButtonRef = useRef<HTMLButtonElement | null>(null);
  const [correctionAnswers, setCorrectionAnswers] = useState<string[]>([]);
  const { question: promptParts, answer: answerParts } = connectionPracticeParts(card);
  const keywords = promptParts
    .filter((part): part is Extract<ClozePart, { type: "blank" }> => part.type === "blank")
    .map((part) => part.keyword);
  const evaluations = evaluateQuizAnswers(keywords, answers, true);
  const revealedKeywords = evaluations.filter((evaluation) => evaluation.matched).map((evaluation) => evaluation.expectedKeyword);
  const allFilled = keywords.length > 0 && keywords.every((_, index) => Boolean(answers[index]?.trim()));
  const connected = evaluations.length > 0 && evaluations.every((evaluation) => evaluation.matched);
  const correction = quizInlineCorrections(promptParts, evaluations, answers);
  const correctionKeywords = quizCorrectionKeywords(evaluations);
  const correctionOrder = quizCorrectionOrder(true, evaluations);
  const correctionsComplete = areQuizCorrectionsComplete(correctionKeywords, correctionAnswers, correctionOrder);
  const contextPath = connectionContextPath(card.section, card.subsection, card.detailSection);
  const paneFractions = connectionPaneFractions(card.answer, card.question, keywords.length);

  const submitConnection = (submitted?: string[]) => {
    const gradedAnswers = submitted ?? answers;
    const graded = evaluateQuizAnswers(keywords, gradedAnswers, true);
    setCorrectionAnswers(quizInlineCorrections(promptParts, graded, gradedAnswers).answers);
    onSubmit(submitted);
  };

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)").matches;
    if (!shouldFocusConnectionContinue(checked && correctionsComplete, desktop)) return;
    const frame = window.requestAnimationFrame(() => {
      continueButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [card.id, checked, correctionsComplete, reverse]);

  useEffect(() => {
    if (!checked || !correctionsComplete) return;
    const handleEnter = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      handleQuizReviewEnter(event, continueButtonRef.current, window.matchMedia("(min-width: 761px)").matches);
    };
    window.addEventListener("keydown", handleEnter);
    return () => window.removeEventListener("keydown", handleEnter);
  }, [checked, correctionsComplete]);

  return (
    <section className={`connection-practice${reverse ? " is-reverse" : ""}${checked ? " is-checked" : ""}`}>
      <header>
        <span className="connection-icon"><CornerDownRight /></span>
        <div>
          <small>질문과 답 연결하기 · {card.contentType}</small>
          <h2>{reverse ? "이 답은 어떤 질문과 연결될까요?" : "질문의 핵심도 완성해보세요"}</h2>
          <p>{reverse ? "연결성이 낮아 답을 보고 질문의 핵심을 떠올려요." : "아래 답을 보며 질문의 핵심을 한 번 더 연결해요."}</p>
        </div>
      </header>

      {contextPath && (
        <div className="connection-context-path" aria-label="질문 위치">
          <small>질문 위치</small>
          <p>{contextPath}</p>
        </div>
      )}

      <div className="connection-practice-body" style={{ gridTemplateRows: `minmax(0, ${paneFractions.answer}fr) minmax(0, ${paneFractions.question}fr)` }}>
        <div className={`connection-source-answer${answerDensityClass(card.answer)}`}>
          <small>{reverse ? "답" : "연결할 답"}</small>
          <p><ConnectionAnswerContent card={card} parts={answerParts} checked={checked} revealedKeywords={revealedKeywords} /></p>
        </div>

        <div className="connection-question-cloze">
          <KeywordAnswerLabel result={checked ? connected ? "correct" : "incorrect" : null} label="질문" />
          <QuizCloze
            key={`connection:${card.id}:${reverse}`}
            card={card}
            answers={checked && !connected ? correctionAnswers : answers}
            checked={checked && connected}
            autoFocusFirst={!checked || !connected}
            autoFocusMobile
            correctionMode={checked && !connected}
            partsOverride={checked && !connected ? correction.parts : promptParts}
            revealedKeywords={revealedKeywords}
            orderIndependentOverride={checked && !connected ? correctionOrder : true}
            inputLabel="질문 키워드"
            onChange={checked ? (index, value) => setCorrectionAnswers((previous) => {
              const next = [...previous];
              next[index] = value;
              return next;
            }) : onChange}
            onSubmit={checked ? () => undefined : submitConnection}
          />
        </div>
      </div>

      {!checked ? (
        <Button size="lg" onClick={() => submitConnection()} disabled={!allFilled}>연결 확인하기 <ChevronRight /></Button>
      ) : (
        <div className="connection-feedback keyword-review-actions">
          <p className="sr-only" role="status">{correctionsComplete ? "다음으로 넘어갈 수 있어요." : "회색 정답을 보며 틀린 키워드 전체를 다시 써주세요."}</p>
          <AnswerMemo memo={card.memo} images={card.media?.memo} />
          <Button ref={continueButtonRef} size="lg" disabled={!correctionsComplete} onClick={onContinue}>다음으로 <ChevronRight /></Button>
        </div>
      )}
    </section>
  );
}

export function DailyStatsReadout({ count, accuracy }: { count?: number; accuracy?: number | null }) {
  return <span className="daily-stats-readout">
    <span><small>오늘 학습</small><span className="daily-stats-value">{count === undefined ? "—" : `${count}장`}</span></span>
    <span><small>정답률</small><span className="daily-stats-value">{dailyAccuracyLabel(accuracy)}</span></span>
  </span>;
}

export function installEscapeFocusReset(targetWindow: Window, ownerDocument: Document) {
  const layerSelector = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"], [role="listbox"], [data-slot="popover-content"][data-state="open"]';
  const layerEvents = new WeakSet<KeyboardEvent>();
  let pending: number | undefined;
  const rememberEscapeLayer = (event: KeyboardEvent) => {
    if (event.key === "Escape" && ownerDocument.querySelector(layerSelector)) layerEvents.add(event);
  };
  const resetUnhandledEscapeFocus = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.cancelBubble || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || layerEvents.has(event)) return;
    const focused = ownerDocument.activeElement as HTMLElement | null;
    if (!focused || focused === ownerDocument.body || focused === ownerDocument.documentElement || typeof focused.blur !== "function") return;
    // Run after all Escape consumers; never blur a newly opened layer or restored focus.
    targetWindow.clearTimeout(pending);
    pending = targetWindow.setTimeout(() => {
      pending = undefined;
      if (!event.defaultPrevented && focused.isConnected && ownerDocument.activeElement === focused && !ownerDocument.querySelector(layerSelector)) focused.blur();
    }, 0);
  };
  targetWindow.addEventListener("keydown", rememberEscapeLayer, true);
  targetWindow.addEventListener("keydown", resetUnhandledEscapeFocus);
  return () => {
    targetWindow.clearTimeout(pending);
    targetWindow.removeEventListener("keydown", rememberEscapeLayer, true);
    targetWindow.removeEventListener("keydown", resetUnhandledEscapeFocus);
  };
}

export default function StudyApp() {
  useEffect(() => installEscapeFocusReset(window, document), []);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [sets, setSets] = useState<StudySet[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mainTab, setMainTab] = useState("study");
  const [pendingSessionExit, setPendingSessionExit] = useState<{ kind: "study" | "quiz"; action: () => void } | null>(null);
  const sessionExitFocusRef = useRef<HTMLElement | null>(null);
  const sessionEditingFocusRef = useRef<HTMLElement | null>(null);
  const [pendingSetStudyIds, setPendingSetStudyIds] = useState<number[] | null>(null);
  const [studyStagePlan, setStudyStagePlan] = useState<Record<number, LearningStage>>({});
  const [subject, setSubject] = useState("");
  const [section, setSection] = useState("all");
  const [importance, setImportance] = useState("all");
  const [reviewOrder, setReviewOrder] = useState("saved");
  const [selectedSessionMode, setStudySessionMode] = useState<StudySessionMode>("real");
  const [tableTabOrder, setTableTabOrder] = useState<TableTabOrder>("vertical");
  const [studyPaused, setStudyPaused] = useState(false);
  const studyPausedRef = useRef(false);
  const [studyStarted, setStudyStarted] = useState(false);
  const [studySequenceIds, setStudySequenceIds] = useState<number[]>([]);
  const [studiedCardIds, setStudiedCardIds] = useState<number[]>([]);
  const [studyFinished, setStudyFinished] = useState(false);
  const [studyRound, setStudyRound] = useState<StudyRound>("main");
  const [sessionIncorrectCardIds, setSessionIncorrectCardIds] = useState<number[]>([]);
  const [studyKeywordRetryAnswers, setStudyKeywordRetryAnswers] = useState<Record<number, string[]>>({});
  const [startingMistakeReview, setStartingMistakeReview] = useState(false);
  const [sectionAnnouncement, setSectionAnnouncement] = useState<SectionAnnouncement | null>(null);
  const [studySecondsLeft, setStudySecondsLeft] = useState(QUIZ_THINKING_TIME_SECONDS);
  const [resumeCardId, setResumeCardId] = useState<number | null>(null);
  const [resumeSequenceIds, setResumeSequenceIds] = useState<number[]>([]);
  const [resumeSessionMode, setResumeSessionMode] = useState<StudySessionMode | null>(null);
  const [startOrderOpen, setStartOrderOpen] = useState(false);
  const [rangeContentType, setRangeContentType] = useState<LearningContentType>("all");
  const [rangeSubject, setRangeSubject] = useState("all");
  const [todayReviewTurn, setTodayReviewTurn] = useState(0);
  const [todayReviewRetries, setTodayReviewRetries] = useState<Record<number, TodayReviewRetry>>({});
  const [rangeSelectedCardIds, setRangeSelectedCardIds] = useState<number[]>([]);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [studyReviewCard, setStudyReviewCard] = useState<StudyCard | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [fullTableAnswers, setFullTableAnswers] = useState<Record<string, string>>({});
  const [studyKeywordAnswers, setStudyKeywordAnswers] = useState<string[]>([]);
  const [studyCorrectionAnswers, setStudyCorrectionAnswers] = useState<string[]>([]);
  const [studyHints, setStudyHints] = useState<QuizCardHints>({});
  const studyHintsRef = useRef<QuizCardHints>({});
  const studyHintRetryAnswersRef = useRef<string[] | null>(null);
  const [studyFocusedBlankIndex, setStudyFocusedBlankIndex] = useState<number | null>(null);
  const [studyConnectionActive, setStudyConnectionActive] = useState(false);
  const [studyConnectionAnswers, setStudyConnectionAnswers] = useState<string[]>([]);
  const [studyConnectionChecked, setStudyConnectionChecked] = useState(false);
  const [studyConnectionReverse, setStudyConnectionReverse] = useState(false);
  const [studyRewriteMode, setStudyRewriteMode] = useState(false);
  const [studyInitialAttempt, setStudyInitialAttempt] = useState<{
    cardId: number;
    typedAnswer: string;
    keywordAnswers: string[];
    suggestedResult: "correct" | "incorrect" | null;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StudyCard | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSubject, setBulkSubject] = useState(elementarySubjects[0]);
  const [bulkStartSetMode, setBulkStartSetMode] = useState(false);
  const [linkingCardId, setLinkingCardId] = useState<number | null>(null);
  const [editingSet, setEditingSet] = useState<StudySet | null>(null);
  const [libraryView, setLibraryView] = useState("all");
  const [librarySubject, setLibrarySubject] = useState("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [setFilterSubject, setSetFilterSubject] = useState("all");
  const [setFilterQuery, setSetFilterQuery] = useState("");
  const [detailCardId, setDetailCardId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<StudyCard | null>(null);
  const [finalDeleting, setFinalDeleting] = useState<StudyCard | null>(null);
  const [deletingSet, setDeletingSet] = useState<StudySet | null>(null);
  const [finalDeletingSet, setFinalDeletingSet] = useState<StudySet | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [viewSetId, setViewSetId] = useState<number | null>(null);
  const [setStudySelecting, setSetStudySelecting] = useState(false);
  const [selectedLearningSetIds, setSelectedLearningSetIds] = useState<number[]>([]);
  const [learningSetIds, setLearningSetIds] = useState<number[]>([]);
  const announcedLearningSetRef = useRef<number | null>(null);
  const [flowAnswersHidden, setFlowAnswersHidden] = useState(false);
  const [flowAnswerExceptions, setFlowAnswerExceptions] = useState<number[]>([]);
  const [flowSetStep, setFlowSetStep] = useState<FlowSetStep>("idle");
  const [flowSetCardIds, setFlowSetCardIds] = useState<number[]>([]);
  const [flowSetName, setFlowSetName] = useState("");
  const [flowSetMemo, setFlowSetMemo] = useState("");
  const [flowSetSaving, setFlowSetSaving] = useState(false);
  const [returnToFlowAfterEdit, setReturnToFlowAfterEdit] = useState(false);
  const [returnToMobileCardsAfterEdit, setReturnToMobileCardsAfterEdit] = useState(false);
  const [returnToFlowAfterBulkEdit, setReturnToFlowAfterBulkEdit] = useState(false);
  const [mobileCardsOpen, setMobileCardsOpen] = useState(false);
  const [mobileEditorTransition, setMobileEditorTransition] = useState<"idle" | "entering" | "leaving">("idle");
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileBackRevision, setMobileBackRevision] = useState(0);
  const [mobileCardsJumpOpen, setMobileCardsJumpOpen] = useState(false);
  const [mobileCardIndex, setMobileCardIndex] = useState(0);
  const [mobileRevealedCardIds, setMobileRevealedCardIds] = useState<number[]>([]);
  const [quizSubject, setQuizSubject] = useState("all");
  const [quizItems, setQuizItems] = useState<QuizItem[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<string[]>([]);
  const [quizChecked, setQuizChecked] = useState(false);
  const [quizReviewCard, setQuizReviewCard] = useState<StudyCard | null>(null);
  const [quizCorrectionAnswers, setQuizCorrectionAnswers] = useState<string[]>([]);
  const [quizSessionRevision, setQuizSessionRevision] = useState(0);
  const [quizConnectionActive, setQuizConnectionActive] = useState(false);
  const [quizConnectionAnswers, setQuizConnectionAnswers] = useState<string[]>([]);
  const [quizConnectionChecked, setQuizConnectionChecked] = useState(false);
  const [quizConnectionReverse, setQuizConnectionReverse] = useState(false);
  const [quizRound, setQuizRound] = useState<QuizRound>("main");
  const [quizRetryItems, setQuizRetryItems] = useState<QuizItem[]>([]);
  const [quizRetryAnswers, setQuizRetryAnswers] = useState<Record<number, string[]>>({});
  const [quizHints, setQuizHints] = useState<Record<number, QuizCardHints>>({});
  const [quizFocusedBlankIndex, setQuizFocusedBlankIndex] = useState<number | null>(null);
  const [quizTotal, setQuizTotal] = useState(0);
  const [quizSecondsLeft, setQuizSecondsLeft] = useState(QUIZ_THINKING_TIME_SECONDS);
  const [quizPaused, setQuizPaused] = useState(false);
  const quizPausedRef = useRef(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizSelectionTime, setQuizSelectionTime] = useState(() => Date.now());
  const stageCard = cards.find(card => card.id === studySequenceIds.find(id => !studiedCardIds.includes(id)));
  const activeLearningStage = stageCard ? studyStagePlan[stageCard.id] ?? learningStage(stageCard) : "keyword";
  const todayReview = studyRound === "today-review";
  const studySessionMode: StudySessionMode = todayReview ? "real" : selectedSessionMode;
  const sessionRootRef = useMobileStudyViewport((mainTab === "study" && studyStarted && !studyFinished) || (mainTab === "quiz" && quizItems.length > 0 && !quizFinished));

  useEffect(() => {
    if (mainTab !== "quiz") return;
    const frame = window.requestAnimationFrame(() => setQuizSelectionTime(Date.now()));
    const timer = window.setInterval(() => setQuizSelectionTime(Date.now()), 30_000);
    return () => { window.cancelAnimationFrame(frame); window.clearInterval(timer); };
  }, [mainTab]);
  const [studyStats, setStudyStats] = useState<StudyStats>(() => emptyStudyStats());
  const [dailyStats, setDailyStats] = useState<DailyStudyStats | null>(null);
  const dailyStatsRequestRef = useRef(0);
  const [statsSubject, setStatsSubject] = useState("");
  const [overallStatsOpen, setOverallStatsOpen] = useState(false);
  const mobileCardsDialogRef = useRef<HTMLDivElement>(null);
  const mobileCardsTrackRef = useRef<HTMLDivElement>(null);
  const cardDialogMobileBackRef = useRef<(() => void) | null>(null);
  const bulkDialogMobileBackRef = useRef<(() => void) | null>(null);
  const mobileHistoryGuardRef = useRef(false);
  const mobileHistorySuppressPopRef = useRef(false);
  const mobileEditorCloseTimerRef = useRef<number | null>(null);
  const flowTableScrollRef = useRef<HTMLDivElement>(null);
  const flowReturnScrollTopRef = useRef(0);
  const restoreFlowScrollRef = useRef(false);
  const typedAnswerRef = useRef<HTMLTextAreaElement>(null);
  const suggestedResultButtonRef = useRef<HTMLButtonElement>(null);
  const pendingReviewPromisesRef = useRef(new Map<number, Promise<boolean>>());
  const quizHintsRef = useRef<Record<number, QuizCardHints>>({});
  const quizReviewSequenceRef = useRef(new Map<number, Promise<boolean>>());
  const quizScoredCardIdsRef = useRef(new Set<number>());
  const quizAttemptLockRef = useRef<string | null>(null);
  const previousSectionPathRef = useRef<SectionPath | null>(null);
  const studyTimerDeadlineRef = useRef<number | null>(null);
  const studyTimerRemainingMsRef = useRef(QUIZ_THINKING_TIME_SECONDS * 1000);
  const resolvedStudyCardIdRef = useRef<number | null>(null);
  const quizTimerDeadlineRef = useRef<number | null>(null);
  const quizNextButtonRef = useRef<HTMLButtonElement | null>(null);
  const quizTimerRemainingMsRef = useRef(QUIZ_THINKING_TIME_SECONDS * 1000);
  const resolvedQuizPhaseRef = useRef<string | null>(null);
  const replayedReviewsRef = useRef(false);

  const registerCardDialogMobileBack = useCallback((handler: (() => void) | null) => {
    cardDialogMobileBackRef.current = handler;
  }, []);
  const registerBulkDialogMobileBack = useCallback((handler: (() => void) | null) => {
    bulkDialogMobileBackRef.current = handler;
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const syncViewport = () => setIsMobileViewport(query.matches);
    syncViewport();
    query.addEventListener("change", syncViewport);
    return () => query.removeEventListener("change", syncViewport);
  }, []);

  useLayoutEffect(() => {
    if (!flowOpen || flowSetStep === "details" || !restoreFlowScrollRef.current) return;
    const frame = requestAnimationFrame(() => {
      const tableShell = flowTableScrollRef.current;
      if (!tableShell) return;
      tableShell.scrollTop = flowReturnScrollTopRef.current;
      restoreFlowScrollRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [flowOpen, flowSetStep]);
  const replayedStudyRunsRef = useRef(false);
  const replayedKeywordAttemptsRef = useRef(false);
  const replayedConnectionAttemptsRef = useRef(false);
  const studyKeywordAttemptRecordedRef = useRef(false);
  const quizKeywordAttemptRecordedRef = useRef(false);
  const studyRunAttemptsRef = useRef<StudyRunAttempt[]>([]);
  const studyQuestionDurationMsRef = useRef(new Map<number, number>());

  useEffect(() => {
    return () => {
      if (mobileEditorCloseTimerRef.current !== null) window.clearTimeout(mobileEditorCloseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      try {
        if (active && window.localStorage.getItem(STUDY_SESSION_MODE_KEY) === "practice") {
          setStudySessionMode("practice");
        }
      } catch {
        // 이 기기에서 저장할 수 없으면 이번 실행에서만 선택을 유지해요.
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      try {
        if (active && window.localStorage.getItem(TABLE_TAB_ORDER_KEY) === "horizontal") setTableTabOrder("horizontal");
      } catch {
        // 저장소를 사용할 수 없는 환경에서는 세로 기본값을 유지해요.
      }
    });
    return () => { active = false; };
  }, []);

  const changeTableTabOrder = (next: TableTabOrder) => {
    setTableTabOrder(next);
    try { window.localStorage.setItem(TABLE_TAB_ORDER_KEY, next); } catch { /* 현재 화면에는 선택을 유지해요. */ }
  };

  const loadCards = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [cardResult, setResult, statsResult] = await Promise.all([
        api<{ cards: StudyCard[] }>("/api/cards"),
        api<{ sets: StudySet[] }>("/api/sets"),
        api<{ stats: StudyStats }>("/api/stats").catch(() => ({ stats: emptyStudyStats() })),
      ]);
      setCards(cardResult.cards);
      setSets(setResult.sets);
      setStudyStats(statsResult.stats);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "카드를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ cards: StudyCard[] }>("/api/cards"),
      api<{ sets: StudySet[] }>("/api/sets"),
      api<{ stats: StudyStats }>("/api/stats").catch(() => ({ stats: emptyStudyStats() })),
    ])
      .then(([cardResult, setResult, statsResult]) => {
        if (active) {
          setCards(cardResult.cards);
          setSets(setResult.sets);
          setStudyStats(statsResult.stats);
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "카드를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading || replayedReviewsRef.current) return;
    replayedReviewsRef.current = true;
    let active = true;

    void (async () => {
      for (const review of readPendingReviews()) {
        try {
          const response = await sendReviewResult(review);
          forgetPendingReview(review.eventId);
          if (active && (!review.statisticsOnly || review.learningKind)) setCards((previous) => mergeReviewResponse(previous, review.cardId, response));
        } catch {
          // 연결이 돌아오면 다음 실행에서 같은 기록을 중복 없이 다시 전송해요.
        }
      }
      if (active) refreshDailyStudyStats();
    })();

    return () => {
      active = false;
    };
  }, [loading]);

  useEffect(() => {
    if (loading || replayedStudyRunsRef.current) return;
    replayedStudyRunsRef.current = true;
    let active = true;

    void (async () => {
      for (const run of readPendingStudyRuns()) {
        try {
          const response = await sendStudyRun(run);
          forgetPendingStudyRun(run.eventId);
          if (active) setStudyStats(response.stats);
        } catch {
          // 연결이 돌아오면 다음 실행에서 같은 완주 기록을 중복 없이 다시 전송해요.
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loading]);

  useEffect(() => {
    if (loading || replayedKeywordAttemptsRef.current) return;
    replayedKeywordAttemptsRef.current = true;
    let active = true;

    void (async () => {
      for (const attempt of readPendingKeywordAttempts()) {
        try {
          const response = await sendKeywordAttempt(attempt);
          forgetPendingKeywordAttempt(attempt.eventId);
          if (active) {
            setStudyStats((previous) => ({
              ...previous,
              keywordPerformance: {
                ...previous.keywordPerformance,
                [String(response.cardId)]: response.keywordPerformance,
              },
            }));
          }
        } catch {
          // 연결이 돌아오면 다음 실행에서 같은 기록을 중복 없이 다시 전송해요.
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loading]);

  useEffect(() => {
    if (loading || replayedConnectionAttemptsRef.current) return;
    replayedConnectionAttemptsRef.current = true;
    let active = true;

    void (async () => {
      for (const attempt of readPendingConnectionAttempts()) {
        try {
          const response = await sendConnectionAttempt(attempt);
          forgetPendingConnectionAttempt(attempt.eventId);
          if (active) {
            setStudyStats((previous) => ({
              ...previous,
              connectionPerformance: {
                ...previous.connectionPerformance,
                [String(response.cardId)]: response.connection,
              },
            }));
          }
        } catch {
          // 연결이 돌아오면 다음 실행에서 같은 기록을 중복 없이 다시 전송해요.
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loading]);

  const subjects = useMemo(() => {
    const extras = [...new Set(cards.filter((card) => !card.archivedAt).map((card) => card.subject))]
      .filter((item) => !elementarySubjects.includes(item))
      .sort();
    return [...elementarySubjects, ...extras];
  }, [cards]);
  const activeStudySetId = setIdFromStudyValue(subject);
  const activeStudySet = activeStudySetId === null
    ? null
    : sets.find((set) => set.id === activeStudySetId) ?? null;
  const activeSubjectDailyStats = dailyStats?.subjects.find((summary) => summary.subject === subject);
  const selectedSubjectDailyStats = dailyStats?.subjects.find((summary) => summary.subject === statsSubject);
  const selectedSubjectStats = studyStats.summaries.find((summary) => summary.subject === statsSubject) ?? null;
  const detailCard = detailCardId === null ? null : cards.find((card) => card.id === detailCardId) ?? null;
  const detailCardPerformance = detailCard ? studyStats.cardPerformance[String(detailCard.id)] : undefined;
  const detailKeywordPerformance = detailCard ? studyStats.keywordPerformance[String(detailCard.id)] ?? [] : [];
  const detailConnectionPerformance = detailCard ? studyStats.connectionPerformance[String(detailCard.id)] : undefined;
  const learningSets = useMemo(() => learningSetIds.flatMap((id) => sets.find((set) => set.id === id) ?? []), [learningSetIds, sets]);
  const scopedCards = useMemo(
    () => subject === SELECTED_SETS_VIEW
      ? Array.from(new Map(learningSets.flatMap((set) => cards.filter((card) => !card.archivedAt && set.cardIds.includes(card.id)).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)).map((card) => [card.id, card])).values())
      : activeStudySet
      ? cards
        .filter((card) => !card.archivedAt && activeStudySet.cardIds.includes(card.id))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      : subject === IMPORTANT_VIEW
        ? cards.filter((card) => !card.archivedAt && card.importance >= 2)
        : subject === INCORRECT_VIEW
          ? cards.filter((card) => !card.archivedAt && card.incorrectCount > 0)
          : subject === ARCHIVED_VIEW
            ? cards.filter((card) => card.archivedAt)
            : cards.filter((card) => !card.archivedAt && card.subject === subject),
    [activeStudySet, cards, subject, learningSets]
  );
  const sections = useMemo(() => [...new Set(scopedCards.map((card) => card.section))].sort(), [scopedCards]);
  const todayReviewCardIds = useMemo(() => {
    if (subject !== INCORRECT_VIEW || dailyStats?.date !== koreanStudyDay().date) return [];
    const pending = new Set(dailyStats.reviewCardIds ?? []);
    return cards.filter(card => !card.archivedAt && pending.has(card.id)).map(card => card.id);
  }, [cards, dailyStats, subject]);

  const filtered = useMemo(() => {
    const matches = scopedCards.filter((card) =>
      Boolean(subject) &&
      (section === "all" || card.section === section) &&
      (reviewOrder === "saved" || card.incorrectCount > 0) &&
      (importance === "all" ||
        (importance === "important" && card.importance >= 2) ||
        (importance === "normal" && card.importance === 1))
    );
    const ordered = reviewOrder === "most-wrong"
      ? [...matches].sort((a, b) => b.incorrectCount - a.incorrectCount || a.sortOrder - b.sortOrder || a.id - b.id)
      : matches;
    if (subject === SELECTED_SETS_VIEW) return ordered;
    return activeStudySet
      ? groupCardsBySets(ordered, [activeStudySet], ordered)
      : groupCardsBySets(ordered, sets, cards);
  }, [activeStudySet, cards, importance, reviewOrder, scopedCards, section, sets, subject]);

  const studyContextKey = useMemo(
    () => studyProgressKey(subject === SELECTED_SETS_VIEW ? `${subject}:${learningSetIds.join(",")}` : subject, section, "all", importance, reviewOrder),
    [importance, reviewOrder, section, subject, learningSetIds]
  );

  useEffect(() => {
    let active = true;
    if (!subject || !filtered.length) {
      queueMicrotask(() => {
        if (!active) return;
        setResumeCardId(null);
        setResumeSequenceIds([]);
        setResumeSessionMode(null);
      });
      return () => { active = false; };
    }

    const filteredIds = new Set(filtered.map((card) => card.id));
    const applyProgress = (saved: SavedStudyProgress | null) => {
      if (!active) return;
      const validCardId = saved?.nextCardId && filteredIds.has(saved.nextCardId) ? saved.nextCardId : null;
      const savedSequence = saved?.sequenceIds.filter((id) => filteredIds.has(id)) ?? [];
      const completeSequence = savedSequence.length ? savedSequence : filtered.map((card) => card.id);
      setResumeCardId(validCardId);
      setResumeSequenceIds(validCardId ? completeSequence : []);
      setResumeSessionMode(validCardId ? savedStudySessionMode(saved?.sessionMode) : null);
    };

    const local = readLocalStudyProgress(studyContextKey);
    applyProgress(local);
    void api<{ progress: SavedStudyProgress | null }>(`/api/progress?contextKey=${encodeURIComponent(studyContextKey)}`)
      .then(({ progress: server }) => {
        if (!active) return;
        const latestLocal = readLocalStudyProgress(studyContextKey);
        const localTime = latestLocal ? Date.parse(latestLocal.updatedAt) : 0;
        const serverTime = server ? Date.parse(server.updatedAt) : 0;
        if (latestLocal && localTime >= serverTime) {
          applyProgress(latestLocal);
          void syncStudyProgress(studyContextKey, latestLocal).catch(() => undefined);
        } else if (server) {
          writeLocalStudyProgress(studyContextKey, server);
          applyProgress(server);
        } else {
          applyProgress(null);
        }
      })
      .catch(() => {
        // 서버가 잠시 끊겨도 기기에 저장된 진도로 계속할 수 있어요.
      });

    return () => {
      active = false;
    };
  }, [filtered, studyContextKey, subject]);

  const librarySubjects = useMemo(() => {
    const extras = [...new Set(cards.map((card) => card.subject))]
      .filter((item) => !elementarySubjects.includes(item))
      .sort();
    return [...elementarySubjects, ...extras].filter((subjectName) => cards.some((card) => card.subject === subjectName));
  }, [cards]);
  const libraryCards = useMemo(() => {
    const searchTerms = libraryQuery
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return cards.filter((card) => {
      const matchesView = libraryView === "archived"
        ? Boolean(card.archivedAt)
        : !card.archivedAt && (libraryView === "important"
          ? card.importance >= 2
          : libraryView === "incorrect"
            ? card.incorrectCount > 0
            : true);
      const matchesSubject = librarySubject === "all" || card.subject === librarySubject;
      const searchText = [
        card.subject,
        card.section,
        card.subsection,
        card.detailSection,
        card.question,
        card.answer,
        card.memo,
        ...card.keywords,
      ].join(" ").normalize("NFKC").toLocaleLowerCase("ko-KR");
      const matchesSearch = searchTerms.every((term) => searchText.includes(term));
      return matchesView && matchesSubject && matchesSearch;
    });
  }, [cards, libraryQuery, librarySubject, libraryView]);
  const setLibrarySubjects = useMemo(() => {
    const extras = [...new Set(sets.map((set) => set.subject))]
      .filter((item) => !elementarySubjects.includes(item))
      .sort();
    return [...elementarySubjects, ...extras].filter((subjectName) => sets.some((set) => set.subject === subjectName));
  }, [sets]);
  const librarySets = useMemo(
    () => filterLibrarySets(sets, cards, setFilterSubject, setFilterQuery),
    [sets, cards, setFilterSubject, setFilterQuery]
  );
  const viewStudySet = sets.find((set) => set.id === viewSetId) ?? null;
  const flowCards = useMemo(
    () => [...(viewStudySet ? cards.filter((card) => viewStudySet.cardIds.includes(card.id)) : filtered)].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [filtered, cards, viewStudySet]
  );
  const mobileFlowItems = useMemo(() => mobileFlowItemsForCards(flowCards), [flowCards]);
  const mobileFlowJumpItems = useMemo(() => mobileFlowJumpItemsFor(mobileFlowItems), [mobileFlowItems]);
  const selectedFlowSetCards = useMemo(
    () => flowCards.filter((card) => flowSetCardIds.includes(card.id)),
    [flowCards, flowSetCardIds]
  );
  const quizRestedCards = useMemo(
    () => excludeRecentlyStudiedCards(cards, studyStats, quizSelectionTime),
    [cards, studyStats, quizSelectionTime]
  );
  const quizEligibleCards = useMemo(
    () => quizRestedCards.filter((card) =>
      (quizSubject === ARCHIVED_VIEW
        ? Boolean(card.archivedAt)
        : !card.archivedAt && (quizSubject === "all" || card.subject === quizSubject)) &&
      clozeParts(card).some((part) => part.type === "blank")
    ),
    [quizRestedCards, quizSubject]
  );
  const dueArchivedQuizCards = useMemo(
    () => quizSubject === ARCHIVED_VIEW
      ? []
      : quizRestedCards.filter((card) =>
        Boolean(card.archivedAt) &&
        (quizSubject === "all" || card.subject === quizSubject) &&
        isArchiveReviewDue(card.archivedAt, card.archiveReviewDueAt) &&
        clozeParts(card).some((part) => part.type === "blank")
      ),
    [quizRestedCards, quizSubject]
  );
  const quizMainItems = useMemo(() => {
    const recommended = createQuiz(quizEligibleCards, studyStats.cardPerformance, studyStats.keywordPerformance, studyStats.connectionPerformance);
    if (quizSubject === ARCHIVED_VIEW) return groupQuizSetCards(recommended.map((item) => ({ ...item, reason: "archive-review" as const })), quizEligibleCards, sets);
    const archived = createQuiz(dueArchivedQuizCards, studyStats.cardPerformance, studyStats.keywordPerformance, studyStats.connectionPerformance)
      .slice(0, 2).map((item) => ({ ...item, reason: "archive-review" as const }));
    return groupQuizSetCards([...recommended, ...archived], [...quizEligibleCards, ...dueArchivedQuizCards], sets);
  }, [quizEligibleCards, dueArchivedQuizCards, quizSubject, sets, studyStats.cardPerformance, studyStats.keywordPerformance, studyStats.connectionPerformance]);
  const quizWeakKeywordReview = useMemo(
    () => selectWeakKeywordReview(quizEligibleCards, studyStats.keywordPerformance, new Set(quizMainItems.map((item) => item.cardId))),
    [quizEligibleCards, studyStats.keywordPerformance, quizMainItems]
  );
  const quizStartItems = useMemo(() => groupQuizSetCards(
    quizWeakKeywordReview
      ? [...quizMainItems, { cardId: quizWeakKeywordReview.cardId, reason: "keyword-review", keyword: quizWeakKeywordReview.keyword, keywordKey: quizWeakKeywordReview.keywordKey }]
      : quizMainItems,
    [...quizEligibleCards, ...dueArchivedQuizCards],
    sets
  ), [quizMainItems, quizWeakKeywordReview, quizEligibleCards, dueArchivedQuizCards, sets]);
  const quizStartCount = quizStartItems.length;

  const studySequenceCards = useMemo(
    () => studySequenceIds
      .map((id) => cards.find((card) => card.id === id))
      .filter((card): card is StudyCard => Boolean(card)),
    [cards, studySequenceIds]
  );
  const liveStudyCard = studyStarted && !studyFinished
    ? studySequenceCards.find((card) => !studiedCardIds.includes(card.id)) ?? null
    : null;
  const current = cardWithReviewContent(liveStudyCard, studyReviewCard);
  const currentStudyTable = readTable(current?.answerFormat);
  const fullStudyParts = current ? clozeParts(current) : [];
  const pendingTodayRetry = todayReview && current ? todayReviewRetries[current.id] : undefined;
  const todayRetry = pendingTodayRetry?.source === JSON.stringify(fullStudyParts) ? pendingTodayRetry : undefined;
  const mode: StudyMode = activeLearningStage === "full" && !todayRetry ? "write" : "reveal";
  const currentStudyParts = todayRetry?.parts ?? fullStudyParts;
  const currentStudyOrder = todayRetry?.order ?? quizAnswerOrder(currentStudyParts);
  // Keep the full-card record guard even without a separate row-range selector.
  const studyTablePartial = Boolean(currentStudyTable && currentStudyParts.filter((part) => part.type === "blank").length
    < tableParts(currentStudyTable).filter((part) => part.type === "blank").length);
  const currentStudyKeywords = currentStudyParts
    .filter((part): part is Extract<ClozePart, { type: "blank" }> => part.type === "blank");
  const currentStudyEvaluations = evaluateQuizAnswers(
    currentStudyKeywords.map((part) => part.keyword),
    studyKeywordAnswers,
    currentStudyOrder
  );
  const studyKeywordsAllFilled = currentStudyKeywords.length > 0
    && currentStudyKeywords.every((_, answerIndex) => Boolean(studyKeywordAnswers[answerIndex]?.trim()));
  const studyGuidedFull = studySessionMode === "practice" && (mode === "write" || currentStudyKeywords.length === 0);
  const studyKeywordMode = !studyGuidedFull && mode === "reveal" && currentStudyKeywords.length > 0;
  const currentStudyTimeLimit = mode === "write" ? Math.max(90, Math.min(1800, (current?.answer.length ?? 0) * 2)) : studyQuestionTimeLimit(
    current,
    studyKeywordMode && studyRound === "mistake-review" && current ? studyKeywordRetryAnswers[current.id] ?? [] : [],
    isMobileViewport
  );
  const studyCorrectionParts = quizInlineCorrections(currentStudyParts, currentStudyEvaluations, studyKeywordAnswers, currentStudyOrder).parts;
  const studyCorrectionKeywords = quizCorrectionKeywords(currentStudyEvaluations);
  const studyCorrectionOrder = quizCorrectionOrder(currentStudyOrder, currentStudyEvaluations);
  const studyCorrectionsComplete = areQuizCorrectionsComplete(studyCorrectionKeywords, studyCorrectionAnswers, studyCorrectionOrder);
  const studyQuestionRevealedKeywords = answerVisible && !studyKeywordMode
    ? currentStudyKeywords.map((part) => part.keyword)
    : [...currentStudyEvaluations, ...(answerVisible ? evaluateQuizAnswers(studyCorrectionKeywords, studyCorrectionAnswers, studyCorrectionOrder) : [])]
      .filter((item) => item.matched).map((item) => item.expectedKeyword);
  const currentStudyQuestionKeywords = current
    ? connectionPracticeParts(current).question.flatMap((part) => part.type === "blank" ? [part.keyword] : [])
    : [];
  const currentStudyConnectionPerformance = current
    ? studyStats.connectionPerformance[String(current.id)]
    : undefined;
  const currentStudyConnectionReverse = hasLowConnectivity(currentStudyConnectionPerformance);
  const rangeSubjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach(card => counts.set(card.subject, (counts.get(card.subject) ?? 0) + 1));
    return counts;
  }, [filtered]);
  const rangeSubjectCards = useMemo(() => subject === INCORRECT_VIEW && rangeSubject !== "all"
    ? filtered.filter(card => card.subject === rangeSubject) : filtered, [filtered, rangeSubject, subject]);
  const rangeCards = useMemo(() => learningCardsForContentType(rangeSubjectCards, rangeContentType), [rangeSubjectCards, rangeContentType]);
  const rangeContentTypeCounts = useMemo(() => new Map(
    LEARNING_CONTENT_TYPE_OPTIONS.map(({ value }) => [value, learningCardsForContentType(rangeSubjectCards, value).length])
  ), [rangeSubjectCards]);
  const rangeSelectedCardIdSet = useMemo(() => new Set(rangeSelectedCardIds), [rangeSelectedCardIds]);
  const selectedRangeCount = rangeSelectedCardIds.length;
  const allVisibleRangeCardsSelected = rangeCards.length > 0 && rangeCards.every((card) => rangeSelectedCardIdSet.has(card.id));
  const currentQuizItem = quizItems[quizIndex] ?? null;
  const liveQuizCard = currentQuizItem
    ? cards.find((card) => card.id === currentQuizItem.cardId) ?? null
    : null;
  const currentQuizCard = cardWithReviewContent(liveQuizCard, quizReviewCard);
  const currentQuizTable = readTable(currentQuizCard?.answerFormat);
  const currentQuizCardId = currentQuizCard?.id ?? null;
  const currentQuizKeywordReview = currentQuizItem?.reason === "keyword-review"
    ? currentQuizItem.keyword
    : undefined;
  const currentQuizParts = currentQuizKeywordReview && currentQuizCard
    ? keywordReviewParts(currentQuizCard, currentQuizKeywordReview, currentQuizItem?.keywordKey)
    : currentQuizCard ? clozeParts(currentQuizCard) : [];
  const currentQuizKeywords = currentQuizParts
    .filter((part): part is Extract<ClozePart, { type: "blank" }> => part.type === "blank");
  const currentQuizOrder = quizAnswerOrder(currentQuizParts);
  const currentQuizEvaluations = evaluateQuizAnswers(
    currentQuizKeywords.map((part) => part.keyword),
    quizAnswers,
    currentQuizOrder
  );
  const quizAllFilled = currentQuizKeywords.length > 0 && currentQuizKeywords.every((_, answerIndex) => Boolean(quizAnswers[answerIndex]?.trim()));
  const quizAllCorrect = currentQuizEvaluations.length > 0 && currentQuizEvaluations.every((evaluation) => evaluation.matched);
  const currentQuizTimeLimit = quizQuestionTimeLimit(
    currentQuizKeywords.map((part) => part.keyword),
    quizRound === "retry" && currentQuizCard ? quizRetryAnswers[currentQuizCard.id] ?? [] : [],
    currentQuizOrder,
    isMobileViewport,
    currentQuizCard?.questionFormat || currentQuizCard?.question || ""
  );
  const currentQuizCorrectionKeywords = quizChecked ? quizCorrectionKeywords(currentQuizEvaluations) : [];
  const currentQuizCorrectionParts = quizInlineCorrections(currentQuizParts, currentQuizEvaluations, quizAnswers).parts;
  const currentQuizCorrectionOrder = quizCorrectionOrder(currentQuizOrder, currentQuizEvaluations);
  const quizCorrectionsComplete = areQuizCorrectionsComplete(
    currentQuizCorrectionKeywords, quizCorrectionAnswers, currentQuizCorrectionOrder
  );
  const quizQuestionRevealedKeywords = [...currentQuizEvaluations,
    ...(quizChecked ? evaluateQuizAnswers(currentQuizCorrectionKeywords, quizCorrectionAnswers, currentQuizCorrectionOrder) : [])]
    .filter((item) => item.matched).map((item) => item.expectedKeyword);
  const currentQuizHints = currentQuizCard && !currentQuizKeywordReview ? quizHints[currentQuizCard.id] ?? {} : {};
  const currentQuizHintKeywords = quizHintKeywords(currentQuizKeywords.map((part) => part.keyword), quizAnswers, currentQuizOrder, currentQuizHints);
  const currentQuizUsedHint = Object.keys(currentQuizHints).length > 0;
  const quizHasUnresolvedKeyword = currentQuizEvaluations.some((evaluation) => !evaluation.matched);
  const currentQuizHintTargetIndex = unresolvedQuizHintIndex(currentQuizEvaluations, quizFocusedBlankIndex);
  const currentQuizHintTargetStage = currentQuizHintTargetIndex >= 0
    ? planQuizHint(currentQuizHintKeywords[currentQuizHintTargetIndex] ?? "", quizAnswers[currentQuizHintTargetIndex] ?? "").stage
    : 1;
  const currentQuizQuestionKeywords = currentQuizCard
    ? connectionPracticeParts(currentQuizCard).question.flatMap((part) => part.type === "blank" ? [part.keyword] : [])
    : [];
  const currentQuizConnectionPerformance = currentQuizCard
    ? studyStats.connectionPerformance[String(currentQuizCard.id)]
    : undefined;
  const currentQuizConnectionReverse = hasLowConnectivity(currentQuizConnectionPerformance);

  function resetStudy() {
    setPendingSetStudyIds(null);
    studyPausedRef.current = false;
    setStudyPaused(false);
    studyKeywordAttemptRecordedRef.current = false;
    setStudyStarted(false);
    setStudySequenceIds([]);
    setStudiedCardIds([]);
    setStudyFinished(false);
    setStudyRound("main");
    setTodayReviewRetries({});
    setSessionIncorrectCardIds([]);
    setStudyKeywordRetryAnswers({});
    setStartingMistakeReview(false);
    setSectionAnnouncement(null);
    previousSectionPathRef.current = null;
    setStudySecondsLeft(QUIZ_THINKING_TIME_SECONDS);
    studyTimerDeadlineRef.current = null;
    studyTimerRemainingMsRef.current = QUIZ_THINKING_TIME_SECONDS * 1000;
    resolvedStudyCardIdRef.current = null;
    setAnswerVisible(false);
    setTypedAnswer("");
    setFullTableAnswers({});
    setStudyKeywordAnswers([]);
    setStudyConnectionActive(false);
    setStudyConnectionAnswers([]);
    setStudyConnectionChecked(false);
    setStudyConnectionReverse(false);
    setStudyRewriteMode(false);
    setStudyInitialAttempt(null);
    setStartOrderOpen(false);
    resetStudyKeywordSupport();
    studyRunAttemptsRef.current = [];
    studyQuestionDurationMsRef.current.clear();
  }

  function rememberStudyPosition(nextCardId: number | null, sequenceIds = studySequenceIds, sessionMode = studySessionMode) {
    const progress: SavedStudyProgress = { nextCardId, sequenceIds, sessionMode, updatedAt: new Date().toISOString() };
    writeLocalStudyProgress(studyContextKey, progress);
    void syncStudyProgress(studyContextKey, progress).catch(() => undefined);
    setResumeCardId(nextCardId);
    setResumeSequenceIds(nextCardId === null ? [] : sequenceIds);
    setResumeSessionMode(nextCardId === null ? null : sessionMode);
  }

  function startStudyAt(startCardId: number, savedSequence?: number[], savedMode?: StudySessionMode | null) {
    if (!filtered.length || (studyStarted && !studyFinished)) return;
    beginStudy(startCardId, savedSequence, savedStudySessionMode(savedMode) ?? studySessionMode);
  }

  function beginStudy(startCardId: number, savedSequence: number[] | undefined, selectedMode: StudySessionMode, todayIds?: number[]) {
    const nextSequence = remainingStudySequence(todayIds ?? filtered.map((card) => card.id), startCardId, savedSequence);
    if (!nextSequence.length) return;
    if (!todayIds) applyStudySessionMode(selectedMode);
    studyPausedRef.current = false;
    setStudyPaused(false);
    setStudyStagePlan(Object.fromEntries(cards.filter(card => nextSequence.includes(card.id)).map(card => [card.id,
      todayIds && !clozeParts(card).some(part => part.type === "blank") ? "full" : learningStage(card)])));
    setStudySequenceIds(nextSequence);
    announcedLearningSetRef.current = null;
    studyKeywordAttemptRecordedRef.current = false;
    setStudiedCardIds([]);
    setStudyFinished(false);
    setStudyRound(todayIds ? "today-review" : "main");
    setTodayReviewTurn(0);
    setTodayReviewRetries({});
    setSessionIncorrectCardIds([]);
    setStudyKeywordRetryAnswers({});
    setStartingMistakeReview(false);
    setSectionAnnouncement(null);
    previousSectionPathRef.current = null;
    const timeLimit = studyQuestionTimeLimit(cards.find((card) => card.id === nextSequence[0]) ?? null, [], isMobileViewport);
    setStudySecondsLeft(timeLimit);
    studyTimerDeadlineRef.current = null;
    studyTimerRemainingMsRef.current = timeLimit * 1000;
    resolvedStudyCardIdRef.current = null;
    setAnswerVisible(false);
    setTypedAnswer("");
    setFullTableAnswers({});
    setStudyKeywordAnswers([]);
    setStudyConnectionActive(false);
    setStudyConnectionAnswers([]);
    setStudyConnectionChecked(false);
    setStudyConnectionReverse(false);
    setStudyRewriteMode(false);
    setStudyInitialAttempt(null);
    setStudyStarted(true);
    resetStudyKeywordSupport();
    setStartOrderOpen(false);
    studyRunAttemptsRef.current = [];
    studyQuestionDurationMsRef.current.clear();
    if (!todayIds) rememberStudyPosition(nextSequence[0] ?? null, nextSequence, selectedMode);
  }

  function startTodayReview() {
    if (!todayReviewCardIds.length || (studyStarted && !studyFinished)) return;
    beginStudy(todayReviewCardIds[0], todayReviewCardIds, "real", todayReviewCardIds);
  }

  function openStartOrderChooser() {
    setRangeContentType("all");
    setRangeSubject("all");
    setRangeSelectedCardIds([]);
    setStartOrderOpen(true);
  }

  function toggleStudyCard(cardId: number) {
    setRangeSelectedCardIds((current) => {
      const selected = new Set(current);
      if (selected.has(cardId)) selected.delete(cardId);
      else selected.add(cardId);
      return filtered.filter((card) => selected.has(card.id)).map((card) => card.id);
    });
  }

  function selectAllVisibleRangeCards() {
    setRangeSelectedCardIds((current) => {
      const selected = new Set(current);
      rangeCards.forEach((card) => selected.add(card.id));
      return filtered.filter((card) => selected.has(card.id)).map((card) => card.id);
    });
  }

  function toggleStudySection(cardId: number, level: LearningRangeLevel) {
    const sectionCardIds = learningCardIdsForSection(rangeCards, cardId, level);
    if (!sectionCardIds.length) return;
    setRangeSelectedCardIds((current) => {
      const selected = new Set(current);
      const removeSection = sectionCardIds.every((id) => selected.has(id));
      sectionCardIds.forEach((id) => {
        if (removeSection) selected.delete(id);
        else selected.add(id);
      });
      return filtered.filter((card) => selected.has(card.id)).map((card) => card.id);
    });
  }

  function startSelectedRange() {
    const selectedIds = filtered.filter((card) => rangeSelectedCardIdSet.has(card.id)).map((card) => card.id);
    if (!selectedIds.length) return;
    startStudyAt(selectedIds[0], selectedIds);
  }

  function chooseSubject(value: string) {
    resetStudy();
    setSubject(value);
    setSection("all");
    setImportance("all");
    setReviewOrder(value === INCORRECT_VIEW ? "most-wrong" : "saved");
  }

  function chooseSet(set: StudySet) {
    if (setStudySelecting) {
      setSelectedLearningSetIds((previous) => previous.includes(set.id) ? previous.filter((id) => id !== set.id) : [...previous, set.id]);
      return;
    }
    // Open above the sets tab so closing returns to the original list.
    if (window.matchMedia("(max-width: 759px)").matches) openMobileCards(set.id);
    else openFlowTable(false, set.id);
  }

  function cancelSetStudySelection() {
    setSelectedLearningSetIds([]);
    setSetStudySelecting(false);
  }

  useEffect(() => {
    if (mainTab !== "sets" || !setStudySelecting) return;
    const cancelSetStudyOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Let any foreground dialog handle Escape before the underlying selection.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      event.preventDefault();
      event.stopPropagation();
      cancelSetStudySelection();
      document.querySelector<HTMLButtonElement>(".set-study-action")?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", cancelSetStudyOnEscape);
    return () => window.removeEventListener("keydown", cancelSetStudyOnEscape);
  }, [mainTab, setStudySelecting]);

  function handleSetStudyAction() {
    if (!setStudySelecting) {
      setSelectedLearningSetIds([]);
      setSetStudySelecting(true);
      return;
    }
    if (!selectedLearningSetIds.length) { cancelSetStudySelection(); return; }
    const chosen = sets.filter((set) => selectedLearningSetIds.includes(set.id));
    const ids = [...new Set(chosen.flatMap((set) => cards.filter((card) => !card.archivedAt && set.cardIds.includes(card.id)).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((card) => card.id)))];
    if (!ids.length) { toast.error("선택한 세트에 학습할 카드가 없어요."); return; }
    resetStudy();
    setLearningSetIds(chosen.map((set) => set.id));
    setSubject(SELECTED_SETS_VIEW);
    setSection("all");
    setImportance("all");
    setReviewOrder("saved");
    setMainTab("study");
    setSetStudySelecting(false);
    setPendingSetStudyIds(ids);
  }

  const startSetStudyEvent = useEffectEvent((ids: number[]) => startStudyAt(ids[0], ids));
  useEffect(() => {
    if (!pendingSetStudyIds || subject !== SELECTED_SETS_VIEW || studyStarted) return;
    if (!pendingSetStudyIds.every(id => filtered.some(card => card.id === id))) return;
    setPendingSetStudyIds(null);
    startSetStudyEvent(pendingSetStudyIds);
  }, [pendingSetStudyIds, subject, studyStarted, filtered]);

  function leaveStudySelection() {
    requestSessionExit(() => {
      const returnToSets = Boolean(activeStudySet) || subject === SELECTED_SETS_VIEW;
      resetStudy();
      setSubject("");
      if (returnToSets) setMainTab("sets");
    });
  }

  const activeSession = mainTab === "study" && studyStarted && !studyFinished ? "study"
    : mainTab === "quiz" && quizItems.length > 0 && !quizFinished ? "quiz" : null;
  function requestSessionExit(action: () => void) {
    if (!activeSession) { action(); return; }
    sessionExitFocusRef.current = sessionEditingFocusRef.current?.isConnected ? sessionEditingFocusRef.current
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingSessionExit({ kind: activeSession, action });
  }
  function changeMainTab(next: string) {
    if (next === mainTab) return;
    requestSessionExit(() => {
      if (activeSession === "study") resetStudy();
      if (activeSession === "quiz") resetQuiz();
      setMainTab(next);
    });
  }
  useEffect(() => {
    if (!activeSession) return;
    const confirmUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", confirmUnload);
    return () => window.removeEventListener("beforeunload", confirmUnload);
  }, [activeSession]);

  useEffect(() => {
    if (mainTab !== "study" || !subject || studyStarted || studyFinished) return;
    const foregroundEscapes = new WeakSet<KeyboardEvent>();
    const rememberReadyStudyOverlay = (event: KeyboardEvent) => {
      if (event.key === "Escape" && document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) foregroundEscapes.add(event);
    };
    const leaveReadyStudyOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.cancelBubble || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || foregroundEscapes.has(event)) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) return;
      event.preventDefault();
      event.stopPropagation();
      leaveStudySelection();
    };
    window.addEventListener("keydown", rememberReadyStudyOverlay, true);
    window.addEventListener("keydown", leaveReadyStudyOnEscape);
    return () => {
      window.removeEventListener("keydown", rememberReadyStudyOverlay, true);
      window.removeEventListener("keydown", leaveReadyStudyOnEscape);
    };
  }, [activeStudySet, mainTab, subject, studyStarted, studyFinished]);

  function openMobileCards(setId: number | null = null) {
    setViewSetId(setId);
    if (mobileEditorCloseTimerRef.current !== null) window.clearTimeout(mobileEditorCloseTimerRef.current);
    mobileEditorCloseTimerRef.current = null;
    setReturnToMobileCardsAfterEdit(false);
    setMobileEditorTransition("idle");
    setMobileCardIndex(0);
    setMobileRevealedCardIds([]);
    setMobileCardsJumpOpen(false);
    setMobileCardsOpen(true);
  }

  function rememberFlowScrollPosition() {
    const tableShell = flowTableScrollRef.current;
    if (!tableShell) return;
    flowReturnScrollTopRef.current = tableShell.scrollTop;
    restoreFlowScrollRef.current = true;
  }

  function openFlowTable(restorePosition = false, setId: number | null = null) {
    if (!restorePosition) {
      setViewSetId(setId);
      flowReturnScrollTopRef.current = 0;
      restoreFlowScrollRef.current = false;
      resetFlowSetBuilder();
    }
    setFlowAnswersHidden(false);
    setFlowAnswerExceptions([]);
    setFlowOpen(true);
  }

  function resetFlowSetBuilder() {
    setFlowSetStep("idle");
    setFlowSetCardIds([]);
    setFlowSetName("");
    setFlowSetMemo("");
    setFlowSetSaving(false);
  }

  function handleFlowOpenChange(open: boolean) {
    setFlowOpen(open);
    if (!open) resetFlowSetBuilder();
  }

  function startFlowSetSelection() {
    setFlowAnswersHidden(false);
    setFlowAnswerExceptions([]);
    setFlowSetCardIds([]);
    setFlowSetName("");
    setFlowSetMemo("");
    setFlowSetStep("select");
  }

  function toggleFlowSetCard(card: StudyCard) {
    setFlowSetCardIds((previous) => {
      if (previous.includes(card.id)) return previous.filter((id) => id !== card.id);
      if (previous.length >= 100) {
        toast.error("한 세트에는 카드를 최대 100장까지 넣을 수 있어요.");
        return previous;
      }
      const selectedSubject = flowCards.find((item) => previous.includes(item.id))?.subject;
      if (selectedSubject && selectedSubject !== card.subject) {
        toast.error("한 세트에는 같은 과목의 카드만 넣을 수 있어요.");
        return previous;
      }
      return [...previous, card.id];
    });
  }

  function selectFlowCard(event: React.MouseEvent, card: StudyCard) {
    if (isPhotoInteraction(event.target) || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (viewStudySet || (flowSetStep !== "select" && !event.shiftKey)) return;
    event.preventDefault();
    event.stopPropagation();
    if (flowSetStep === "idle") startFlowSetSelection();
    toggleFlowSetCard(card);
  }

  function continueFlowSetDetails() {
    if (flowSetCardIds.length < 2) {
      toast.error("세트에 넣을 카드를 두 장 이상 골라 주세요.");
      return;
    }
    rememberFlowScrollPosition();
    setFlowSetStep("details");
  }

  function backToFlowSetSelection() {
    setFlowSetStep("select");
  }

  async function createFlowSet(event: FormEvent) {
    event.preventDefault();
    const selectedSubject = selectedFlowSetCards[0]?.subject ?? "";
    if (!selectedSubject || !flowSetName.trim()) {
      toast.error("세트 제목을 입력해 주세요.");
      return;
    }
    if (selectedFlowSetCards.length < 2) {
      toast.error("세트에 넣을 카드를 두 장 이상 골라 주세요.");
      return;
    }

    setFlowSetSaving(true);
    try {
      const result = await api<{ set: StudySet }>("/api/sets", {
        method: "POST",
        body: JSON.stringify({
          subject: selectedSubject,
          name: flowSetName,
          memo: flowSetMemo,
          cardIds: selectedFlowSetCards.map((card) => card.id),
        }),
      });
      saveSetToList(result.set);
      resetFlowSetBuilder();
      toast.success("새 세트를 만들었어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "세트를 저장하지 못했습니다.");
    } finally {
      setFlowSetSaving(false);
    }
  }

  function toggleAllFlowAnswers() {
    setFlowAnswersHidden((hidden) => !hidden);
    setFlowAnswerExceptions([]);
  }

  function toggleFlowAnswer(cardId: number) {
    setFlowAnswerExceptions((previous) => previous.includes(cardId)
      ? previous.filter((id) => id !== cardId)
      : [...previous, cardId]
    );
  }

  function isFlowAnswerHidden(cardId: number) {
    return flowAnswersHidden !== flowAnswerExceptions.includes(cardId);
  }

  function toggleMobileCardAnswer(cardId: number) {
    setMobileRevealedCardIds((previous) => previous.includes(cardId)
      ? previous.filter((id) => id !== cardId)
      : [...previous, cardId]
    );
  }

  function moveMobileCard(nextIndex: number) {
    const clamped = Math.max(0, Math.min(mobileFlowItems.length - 1, nextIndex));
    const track = mobileCardsTrackRef.current;
    const slide = track?.children.item(clamped) as HTMLElement | null;
    setMobileCardsJumpOpen(false);
    setMobileCardIndex(clamped);
    if (!track || !slide) return;
    track.scrollTo({
      left: slide.offsetLeft - track.offsetLeft,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  function updateMobileCardIndex() {
    const track = mobileCardsTrackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    Array.from(track.children).forEach((child, index) => {
      const slide = child as HTMLElement;
      const distance = Math.abs(slide.offsetLeft + slide.clientWidth / 2 - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    setMobileCardIndex(closestIndex);
  }

  function openBulkCreate(value?: string) {
    const resolved = value && value !== IMPORTANT_VIEW && value !== INCORRECT_VIEW && value !== ARCHIVED_VIEW && !value.startsWith(SET_VIEW_PREFIX)
      ? value
      : subject && subject !== IMPORTANT_VIEW && subject !== INCORRECT_VIEW && subject !== ARCHIVED_VIEW && !subject.startsWith(SET_VIEW_PREFIX)
        ? subject
        : elementarySubjects[0];
    setBulkSubject(resolved);
    setEditingSet(null);
    setBulkStartSetMode(false);
    setLinkingCardId(null);
    setReturnToFlowAfterBulkEdit(false);
    setBulkOpen(true);
  }

  function handleBulkDialogOpenChange(open: boolean) {
    setBulkOpen(open);
    if (open || !returnToFlowAfterBulkEdit) return;
    setReturnToFlowAfterBulkEdit(false);
    restoreFlowScrollRef.current = false;
  }

  function viewFromCardEditor(nextSubject: string) {
    resetStudy();
    setSubject(nextSubject);
    setSection("all");
    setImportance("all");
    setReviewOrder("saved");
    setBulkSubject(nextSubject);
    setReturnToFlowAfterBulkEdit(false);
    setBulkOpen(false);
    window.setTimeout(() => {
      if (window.matchMedia("(min-width: 760px)").matches) openFlowTable(true);
      else openMobileCards();
    }, 0);
  }

  function openSetCreate(value?: string) {
    const resolved = value && subjects.includes(value)
      ? value
      : activeStudySet?.subject ?? elementarySubjects[0];
    setBulkSubject(resolved);
    setEditingSet(null);
    setBulkStartSetMode(true);
    setLinkingCardId(null);
    setBulkOpen(true);
  }

  function openSetCreateForCard(card: StudyCard) {
    setBulkSubject(card.subject);
    setEditingSet(null);
    setBulkStartSetMode(true);
    setLinkingCardId(card.id);
    setBulkOpen(true);
  }

  function openSetEdit(set: StudySet) {
    setBulkSubject(set.subject);
    setEditingSet(set);
    setBulkStartSetMode(true);
    setLinkingCardId(null);
    setBulkOpen(true);
  }

  function editSetFromFlow() {
    if (!viewStudySet) return;
    setReturnToFlowAfterBulkEdit(true);
    openSetEdit(viewStudySet);
  }

  function openEdit(card: StudyCard) {
    setReturnToFlowAfterEdit(false);
    setReturnToMobileCardsAfterEdit(false);
    setMobileEditorTransition("idle");
    setEditing(cards.find((item) => item.id === card.id) ?? card);
    setDialogOpen(true);
  }

  function openEditFromFlow(card: StudyCard) {
    setReturnToFlowAfterEdit(true);
    setReturnToMobileCardsAfterEdit(false);
    setMobileEditorTransition("idle");
    setEditing(card);
    setDialogOpen(true);
  }

  function openEditFromMobileCards(card: StudyCard) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (mobileEditorCloseTimerRef.current !== null) window.clearTimeout(mobileEditorCloseTimerRef.current);
    mobileEditorCloseTimerRef.current = null;
    setReturnToFlowAfterEdit(false);
    setReturnToMobileCardsAfterEdit(true);
    setMobileCardsJumpOpen(false);
    setEditing(card);
    setMobileEditorTransition(reduceMotion ? "idle" : "entering");
    setDialogOpen(true);
  }

  function handleCardDialogOpenChange(open: boolean) {
    if (!open && returnToMobileCardsAfterEdit) {
      if (mobileEditorTransition === "leaving") return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (mobileEditorCloseTimerRef.current !== null) window.clearTimeout(mobileEditorCloseTimerRef.current);
      if (reduceMotion) {
        setDialogOpen(false);
        setMobileEditorTransition("idle");
        setReturnToMobileCardsAfterEdit(false);
        return;
      }
      setMobileEditorTransition("leaving");
      mobileEditorCloseTimerRef.current = window.setTimeout(() => {
        setDialogOpen(false);
        setMobileEditorTransition("idle");
        setReturnToMobileCardsAfterEdit(false);
        mobileEditorCloseTimerRef.current = null;
      }, 220);
      return;
    }
    setDialogOpen(open);
    if (!open && returnToFlowAfterEdit) {
      setReturnToFlowAfterEdit(false);
    }
  }

  function refreshStudyStats() {
    void api<{ stats: StudyStats }>("/api/stats")
      .then((result) => setStudyStats(result.stats))
      .catch(() => undefined);
  }

  function refreshDailyStudyStats() {
    const requestId = ++dailyStatsRequestRef.current;
    const day = koreanStudyDay().date;
    setDailyStats((previous) => previous && previous.date !== day ? null : previous);
    void api<{ daily: DailyStudyStats }>("/api/stats?daily=1")
      .then(({ daily }) => {
        if (requestId === dailyStatsRequestRef.current) setDailyStats(daily);
      })
      .catch(() => { /* Keep the last confirmed result until the next refresh. */ });
  }

  const refreshDailyStudyStatsEvent = useEffectEvent(refreshDailyStudyStats);
  useEffect(() => {
    refreshDailyStudyStatsEvent();
    const refresh = () => { if (document.visibilityState === "visible") refreshDailyStudyStatsEvent(); };
    const timer = window.setInterval(refresh, 60_000);
    let midnightTimer: number;
    const refreshAtMidnight = () => {
      midnightTimer = window.setTimeout(() => {
        refreshDailyStudyStatsEvent();
        refreshAtMidnight();
      }, Math.max(50, Date.parse(koreanStudyDay().end) - Date.now() + 50));
    };
    refreshAtMidnight();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(midnightTimer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  function queueStatisticsOnlyReview(card: StudyCard, reviewMode: StudyMode, result: "correct" | "incorrect", answer: string, learning?: { learningKind?: LearningKind; hintUsed?: boolean }) {
    queueReviewResult(card, reviewMode, result, answer, { ...learning, statisticsOnly: true, queueAfterPending: true, quietArchiveChange: true });
  }

  function saveToList(card: StudyCard) {
    setCards((previous) => {
      const exists = previous.some((item) => item.id === card.id);
      return exists ? previous.map((item) => (item.id === card.id ? card : item)) : [card, ...previous];
    });
    refreshStudyStats();
  }

  function saveBulkToList(organized: StudyCard[], selectedSubject: string) {
    const organizedIds = new Set(organized.map((card) => card.id));
    const removedIds = new Set(cards
      .filter((card) => card.subject === selectedSubject && !organizedIds.has(card.id))
      .map((card) => card.id));
    setCards((previous) => [
      ...organized,
      ...previous.filter((card) => card.subject !== selectedSubject),
    ]);
    if (removedIds.size) {
      setSets((previous) => previous.map((set) => ({
        ...set,
        cardIds: set.cardIds.filter((cardId) => !removedIds.has(cardId)),
      })));
    }
    refreshStudyStats();
    setMainTab("study");
    chooseSubject(selectedSubject);
  }

  function saveSetToList(savedSet: StudySet) {
    setSets((previous) => {
      const exists = previous.some((set) => set.id === savedSet.id);
      const next = exists
        ? previous.map((set) => set.id === savedSet.id ? savedSet : set)
        : [...previous, savedSet];
      return next.sort((a, b) => a.subject.localeCompare(b.subject, "ko") || a.name.localeCompare(b.name, "ko"));
    });
    if (returnToFlowAfterBulkEdit) handleBulkDialogOpenChange(false);
  }

  async function toggleCardImportance(displayedCard: StudyCard) {
    const card = cards.find((item) => item.id === displayedCard.id) ?? displayedCard;
    const nextImportance = card.importance >= 2 ? 1 : 2;
    try {
      const result = await api<{ card: StudyCard }>(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          subject: card.subject,
          contentType: card.contentType,
          section: card.section,
          subsection: card.subsection,
          detailSection: card.detailSection,
          area: card.area,
          importance: nextImportance,
          question: card.question,
          questionFormat: card.questionFormat,
          answer: card.answer,
          answerFormat: card.answerFormat,
          memo: card.memo,
          keywords: card.keywords,
        }),
      });
      saveToList(result.card);
      toast.success(nextImportance >= 2 ? "중요 카드로 표시했어요." : "중요 표시를 해제했어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "중요 표시를 바꾸지 못했습니다.");
    }
  }

  async function toggleCardArchived(card: StudyCard) {
    const archive = !card.archivedAt;
    try {
      const result = await api<{ card: StudyCard }>(`/api/cards/${card.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived: archive }),
      });
      saveToList(result.card);
      toast.success(archive ? "카드를 보관함에 넣었어요." : "카드를 학습 목록으로 다시 옮겼어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "보관 상태를 바꾸지 못했습니다.");
    }
  }

  function resetQuizAssistState() {
    setQuizReviewCard(null);
    setQuizHints({});
    quizHintsRef.current = {};
    setQuizFocusedBlankIndex(null);
    quizReviewSequenceRef.current.clear();
    quizScoredCardIdsRef.current.clear();
    quizAttemptLockRef.current = null;
  }

  function startQuiz() {
    if (quizPausedRef.current) return;
    const nextItems: QuizItem[] = [...quizStartItems];
    if (!nextItems.length) {
      toast("출제 가능한 카드가 없어요. 최근 30분 안에 학습한 카드는 잠시 쉬어요.");
      return;
    }
    setQuizItems(nextItems);
    quizPausedRef.current = false;
    setQuizPaused(false);
    setQuizSessionRevision((revision) => revision + 1);
    setQuizCorrectionAnswers([]);
    quizKeywordAttemptRecordedRef.current = false;
    setQuizIndex(0);
    setQuizAnswers([]);
    setQuizChecked(false);
    setQuizConnectionActive(false);
    setQuizConnectionAnswers([]);
    setQuizConnectionChecked(false);
    setQuizConnectionReverse(false);
    setQuizRound("main");
    setQuizRetryItems([]);
    setQuizRetryAnswers({});
    resetQuizAssistState();
    setQuizTotal(nextItems.length);
    setQuizScore(0);
    setQuizFinished(false);
  }

  function leaveQuiz() {
    if (quizPausedRef.current) return;
    requestSessionExit(resetQuiz);
  }

  function resetQuiz() {
    quizPausedRef.current = false;
    setQuizPaused(false);
    setQuizCorrectionAnswers([]);
    setQuizItems([]);
    setQuizAnswers([]);
    setQuizChecked(false);
    setQuizConnectionActive(false);
    setQuizConnectionAnswers([]);
    setQuizConnectionChecked(false);
    setQuizConnectionReverse(false);
    setQuizRound("main");
    setQuizRetryItems([]);
    setQuizRetryAnswers({});
    setQuizTotal(0);
    setQuizFinished(false);
    resetQuizAssistState();
  }

  function updateQuizAnswer(answerIndex: number, value: string) {
    if (quizPausedRef.current) return;
    if (quizChecked) return;
    setQuizAnswers((previous) => {
      const next = [...previous];
      next[answerIndex] = value;
      return next;
    });
  }

  function updateStudyKeywordAnswer(answerIndex: number, value: string) {
    if (studyPausedRef.current) return;
    setStudyKeywordAnswers((previous) => {
      const next = [...previous];
      next[answerIndex] = value;
      return next;
    });
  }

  function tableReviewKeywordIds(card: StudyCard) {
    if (!isTableFormat(card.answerFormat)) return undefined;
    const parts = mainTab === "quiz" ? currentQuizParts : currentStudyParts;
    return parts.flatMap((part) => part.type === "blank" && part.keywordId ? [part.keywordId] : []);
  }

  function queueKeywordAttempt(card: StudyCard, results: Array<{ keyword: string; matched: boolean; keywordKey?: string }>) {
    const uniqueResults = results.filter((item, index, source) => {
      const key = item.keywordKey ?? normalizeForMatch(item.keyword);
      return Boolean(key) && source.findIndex((candidate) => (candidate.keywordKey ?? normalizeForMatch(candidate.keyword)) === key) === index;
    });
    if (!uniqueResults.length) return;

    const attempt: PendingKeywordAttempt = {
      eventId: reviewEventId(),
      cardId: card.id,
      results: uniqueResults,
    };
    rememberPendingKeywordAttempt(attempt);
    setStudyStats((previous) => {
      const existing = previous.keywordPerformance[String(card.id)] ?? [];
      const existingByKeyword = new Map(existing.map((item) => [item.keywordKey ?? normalizeForMatch(item.keyword), item]));
      const entries = isTableFormat(card.answerFormat) ? tableKeywords(card.answerFormat) : card.keywords.map((keyword) => ({ keyword, keywordKey: normalizeForMatch(keyword) }));
      const updated = entries.map(({ keyword, keywordKey: key }) => {
        const stored = existingByKeyword.get(key);
        const result = uniqueResults.find((item) => (item.keywordKey ?? normalizeForMatch(item.keyword)) === key);
        const attempts = (stored?.attempts ?? 0) + (result ? 1 : 0);
        const correct = (stored?.correct ?? 0) + (result?.matched ? 1 : 0);
        return {
          keyword,
          keywordKey: key,
          attempts,
          correct,
          incorrect: Math.max(0, attempts - correct),
          accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
          lastAttemptedAt: result ? new Date().toISOString() : stored?.lastAttemptedAt ?? null,
        };
      });
      return {
        ...previous,
        keywordPerformance: { ...previous.keywordPerformance, [String(card.id)]: updated },
      };
    });

    void sendKeywordAttempt(attempt)
      .then((response) => {
        forgetPendingKeywordAttempt(attempt.eventId);
        setStudyStats((previous) => ({
          ...previous,
          keywordPerformance: {
            ...previous.keywordPerformance,
            [String(response.cardId)]: response.keywordPerformance,
          },
        }));
      })
      .catch(() => {
        // 기기에 보관한 뒤 연결이 돌아오면 다시 저장해요.
      });
  }

  function recordStudyKeywordAttempt(card: StudyCard, results: Array<{ keyword: string; matched: boolean; keywordKey?: string }>) {
    if (studyKeywordAttemptRecordedRef.current) return;
    studyKeywordAttemptRecordedRef.current = true;
    const recorded = studyRecordedKeywords(results, studySessionMode);
    if (recorded.length) queueKeywordAttempt(card, recorded);
  }

  function recordQuizKeywordAttempt(card: StudyCard, results: Array<{ keyword: string; matched: boolean; keywordKey?: string }>) {
    if (quizKeywordAttemptRecordedRef.current) return;
    quizKeywordAttemptRecordedRef.current = true;
    queueKeywordAttempt(card, results);
  }

  function queueConnectionAttempt(card: StudyCard, connected: boolean) {
    const attempt: PendingConnectionAttempt = {
      eventId: reviewEventId(),
      cardId: card.id,
      connected,
    };
    rememberPendingConnectionAttempt(attempt);
    setStudyStats((previous) => {
      const stored = previous.connectionPerformance[String(card.id)];
      const attempts = (stored?.attempts ?? 0) + 1;
      const connectedCount = (stored?.connected ?? 0) + (connected ? 1 : 0);
      return {
        ...previous,
        connectionPerformance: {
          ...previous.connectionPerformance,
          [String(card.id)]: {
            attempts,
            connected: connectedCount,
            connectivity: Math.round((connectedCount / attempts) * 100),
            lastAttemptedAt: new Date().toISOString(),
          },
        },
      };
    });

    void sendConnectionAttempt(attempt)
      .then((response) => {
        forgetPendingConnectionAttempt(attempt.eventId);
        setStudyStats((previous) => ({
          ...previous,
          connectionPerformance: {
            ...previous.connectionPerformance,
            [String(response.cardId)]: response.connection,
          },
        }));
      })
      .catch(() => {
        // 기기에 보관한 뒤 연결이 돌아오면 다시 저장해요.
      });
  }

  function updateStudyConnectionAnswer(answerIndex: number, value: string) {
    if (studyPausedRef.current) return;
    setStudyConnectionAnswers((previous) => {
      const next = [...previous];
      next[answerIndex] = value;
      return next;
    });
  }

  function updateQuizConnectionAnswer(answerIndex: number, value: string) {
    if (quizPausedRef.current) return;
    setQuizConnectionAnswers((previous) => {
      const next = [...previous];
      next[answerIndex] = value;
      return next;
    });
  }

  function gradeStudyConnection(answersOverride?: string[]) {
    if (studyPausedRef.current) return;
    if (!current || !studyConnectionActive || studyConnectionChecked) return;
    const answersToGrade = answersOverride ?? studyConnectionAnswers;
    const connected = evaluateQuizAnswers(currentStudyQuestionKeywords, answersToGrade, true)
      .every((evaluation) => evaluation.matched);
    setStudyConnectionAnswers(answersToGrade);
    setStudyConnectionChecked(true);
    queueConnectionAttempt(current, connected);
  }

  function gradeQuizConnection(answersOverride?: string[]) {
    if (quizPausedRef.current) return;
    if (!currentQuizCard || !quizConnectionActive || quizConnectionChecked) return;
    const answersToGrade = answersOverride ?? quizConnectionAnswers;
    const connected = evaluateQuizAnswers(currentQuizQuestionKeywords, answersToGrade, true)
      .every((evaluation) => evaluation.matched);
    setQuizConnectionAnswers(answersToGrade);
    setQuizConnectionChecked(true);
    queueConnectionAttempt(currentQuizCard, connected);
  }

  function captureStudyQuestionDuration(cardId: number) {
    if (studySessionMode !== "real" || studyQuestionDurationMsRef.current.has(cardId)) return;
    studyTimerRemainingMsRef.current = remainingStudyTime(studyTimerDeadlineRef.current, studyTimerRemainingMsRef.current, Date.now());
    studyTimerDeadlineRef.current = null;
    setStudySecondsLeft(Math.ceil(studyTimerRemainingMsRef.current / 1000));
    const durationMs = Math.max(0, Math.min(
      currentStudyTimeLimit * 1000,
      currentStudyTimeLimit * 1000 - studyTimerRemainingMsRef.current
    ));
    studyQuestionDurationMsRef.current.set(cardId, Math.round(durationMs));
  }

  function revealStudyAnswerWithoutKeywords() {
    if (studyPausedRef.current) return;
    if (!current || answerVisible) return;
    captureStudyQuestionDuration(current.id);
    setStudyReviewCard(current);
    setAnswerVisible(true);
  }

  function resetStudyKeywordSupport() {
    setStudyReviewCard(null);
    setStudyCorrectionAnswers([]);
    studyHintsRef.current = {};
    studyHintRetryAnswersRef.current = null;
    setStudyHints({});
    setStudyFocusedBlankIndex(null);
  }

  function revealStudyHint(preferredIndex: number | null = studyFocusedBlankIndex) {
    if (!studyHintAllowed(studySessionMode, studyRound)) return;
    if (studyPausedRef.current || !current || answerVisible || !studyKeywordMode || studyConnectionActive) return;
    const index = unresolvedQuizHintIndex(currentStudyEvaluations, preferredIndex);
    if (index < 0) return;
    const hints = studyHintsRef.current;
    const keyword = quizHintKeywords(currentStudyKeywords.map((part) => part.keyword), studyKeywordAnswers, quizAnswerOrder(currentStudyParts), hints)[index];
    if (!keyword) return;
    const plan = planQuizHint(keyword, studyKeywordAnswers[index] ?? "");
    if (studySessionMode === "real" && studyHintRetryAnswersRef.current === null) {
      studyHintRetryAnswersRef.current = studyKeywordAnswers.map((answer, answerIndex) => currentStudyEvaluations[answerIndex]?.matched ? answer : "");
    }
    const restoreScroll = rememberHintScroll(document.querySelector<HTMLElement>(".study-keyword-attempt .quiz-cloze-copy"));
    const tableHint = isTableFormat(current.answerFormat) ? tableHintResult(currentStudyParts, quizHintKeywords(currentStudyKeywords.map((part)=>part.keyword), studyKeywordAnswers, quizAnswerOrder(currentStudyParts), hints), index) : [];
    const alreadyHinted = tableHint[0]?.keywordKey && Object.values(hints).some((hint)=>hint?.keywordKey===tableHint[0].keywordKey);
    if (!hints[index] && studySessionMode === "real" && !alreadyHinted) {
      if(isTableFormat(current.answerFormat)) queueKeywordAttempt(current, tableHint);
      else queueKeywordAttempt(current, [{ keyword, matched: false }]);
    }
    studyHintsRef.current = { ...hints, [index]: { keyword, stage: plan.stage, text: progressiveQuizHint(keyword, plan.stage), keywordKey:tableHint[0]?.keywordKey, revision:(hints[index]?.revision ?? 0)+1 } };
    setStudyHints(studyHintsRef.current);
    updateStudyKeywordAnswer(index, plan.answer);
    setStudyFocusedBlankIndex(index);
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`textarea[data-mobile-cloze-card="${current.id}"][data-cloze-index="${index}"], .study-keyword-attempt input[data-cloze-index="${index}"]`);
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(plan.answer.length, plan.answer.length);
      restoreScroll();
      if (input instanceof HTMLInputElement) revealInputInsideCloze(input);
    });
  }

  function gradeStudyKeywords(answersOverride?: string[], timedOut = false) {
    if (studyPausedRef.current) return;
    if (!current || answerVisible || currentStudyKeywords.length === 0) return;
    const answersToGrade = answersOverride ?? studyKeywordAnswers;
    const allFilled = currentStudyKeywords.every((_, answerIndex) => Boolean(answersToGrade[answerIndex]?.trim()));
    if (!allFilled && !timedOut) return;
    const evaluations = evaluateQuizAnswers(
      currentStudyKeywords.map((part) => part.keyword),
      answersToGrade,
      currentStudyOrder
    );
    if (studySessionMode === "real") recordStudyKeywordAttempt(current, tableAttemptResults(currentStudyParts, evaluations, currentStudyOrder));
    setStudyInitialAttempt({
      cardId: current.id,
      typedAnswer: "",
      keywordAnswers: [...answersToGrade],
      suggestedResult: evaluations.length > 0 && evaluations.every((evaluation) => evaluation.matched) ? "correct" : "incorrect",
    });
    captureStudyQuestionDuration(current.id);
    setStudyKeywordAnswers(answersToGrade);
    setStudyCorrectionAnswers(quizInlineCorrections(currentStudyParts, evaluations, answersToGrade, currentStudyOrder).answers);
    setStudyReviewCard(current);
    setAnswerVisible(true);
  }

  const gradeStudyKeywordsEvent = useEffectEvent(gradeStudyKeywords);

  function showWrittenAnswer(timedOut = false) {
    if (studyPausedRef.current) return;
    if (!current || answerVisible || (!timedOut && !studyRewriteMode && !typedAnswer.trim())) return;
    if (!studyRewriteMode) {
      const matches = fullWriteKeywordMatches(current, typedAnswer, fullTableAnswers);
      setStudyInitialAttempt({
        cardId: current.id,
        typedAnswer,
        keywordAnswers: [],
        suggestedResult: timedOut ? "incorrect" : matches.length > 0 ? matches.every((match) => match.matched) ? "correct" : "incorrect" : null,
      });
      captureStudyQuestionDuration(current.id);
    }
    setStudyReviewCard(current);
    setAnswerVisible(true);
  }

  const showWrittenAnswerEvent = useEffectEvent(showWrittenAnswer);

  function completeGuidedFullPractice() {
    if (studyPausedRef.current || !current || answerVisible || !studyGuidedFull) return;
    setStudyInitialAttempt({ cardId: current.id, typedAnswer: "", keywordAnswers: [], suggestedResult: "correct" });
    captureStudyQuestionDuration(current.id);
    setStudyReviewCard(current);
    setAnswerVisible(true);
  }

  function queueReviewResult(
    card: StudyCard,
    reviewMode: StudyMode,
    result: "correct" | "incorrect",
    answer: string,
    options?: { after?: Promise<boolean>; queueAfterPending?: boolean; quietArchiveChange?: boolean; learningKind?: LearningKind; hintUsed?: boolean; statisticsOnly?: boolean; tableKeywordIds?: string[] }
  ): QueuedReviewResult | null {
    const tableKeywordIds = options?.tableKeywordIds ?? tableReviewKeywordIds(card);
    const fullCoverage = !tableKeywordIds || (tableKeywordIds.length > 0 && tableKeywordIds.length === tableKeywords(card.answerFormat).length)
      || options?.learningKind === "full" || (options?.learningKind === "practice" && reviewMode === "write");
    const statisticsOnly = options?.statisticsOnly === true || !fullCoverage;
    const activeRequest = pendingReviewPromisesRef.current.get(card.id);
    if (activeRequest && !options?.queueAfterPending) return null;
    const pendingReview: PendingReview = {
      eventId: reviewEventId(),
      cardId: card.id,
      mode: reviewMode,
      result,
      typedAnswer: answer,
      attemptedAt: new Date().toISOString(),
      tableKeywordIds,
      learningKind: options?.learningKind, hintUsed: options?.hintUsed, statisticsOnly,
    };
    rememberPendingReview(pendingReview);
    const reviewedAt = new Date().toISOString();
    let rollbackCard = card;
    setCards((previous) => {
      const next = previous.map((item) => {
        if (item.id !== card.id) return item;
        rollbackCard = item;
        const nextProgress = statisticsOnly ? { incorrectCount: item.incorrectCount, correctStreak: item.correctStreak, masteryStreak: item.masteryStreak } : nextReviewProgress(item, result);
        const learningProgress = nextLearningProgress(item, { kind: pendingReview.learningKind, result, hinted: pendingReview.hintUsed, fullCoverage, statisticsOnly, at: reviewedAt });
        const shouldAutoArchive = pendingReview.learningKind === "full" && result === "correct" && !statisticsOnly && !item.archivedAt && completedLearningStages(learningProgress);
        const nextReviewStage = item.archivedAt && result === "correct"
          ? nextArchiveReviewStage(item.archiveReviewStage)
          : 0;
        const optimisticArchive = statisticsOnly ? {} : result === "incorrect" && item.archivedAt
          ? { archivedAt: null, archiveReviewStage: 0, archiveReviewDueAt: null }
          : item.archivedAt && result === "correct"
            ? {
              archivedAt: item.archivedAt,
              archiveReviewStage: nextReviewStage,
              archiveReviewDueAt: archiveReviewDueAt(reviewedAt, nextReviewStage),
            }
            : shouldAutoArchive
              ? {
                archivedAt: reviewedAt,
                archiveReviewStage: 0,
                archiveReviewDueAt: archiveReviewDueAt(reviewedAt, 0),
              }
              : {
                archivedAt: item.archivedAt,
                archiveReviewStage: item.archiveReviewStage,
                archiveReviewDueAt: item.archiveReviewDueAt,
              };
        return {
          ...item,
          correctCount: item.correctCount + (!statisticsOnly && result === "correct" ? 1 : 0),
          ...nextProgress,
          ...learningProgress,
          lastReviewedAt: statisticsOnly ? item.lastReviewedAt : reviewedAt,
          ...optimisticArchive,
        };
      });
      return next;
    });

    const predecessor = activeRequest ?? options?.after;
    const request: Promise<boolean> = (async () => {
      if (predecessor && !(await predecessor)) {
        throw new Error("앞선 기록을 아직 저장하지 못했습니다.");
      }
      return sendReviewResult(pendingReview);
    })()
      .then((response) => {
        forgetPendingReview(pendingReview.eventId);
        refreshDailyStudyStats();
        if (pendingReviewPromisesRef.current.get(card.id) === request) {
          setCards((previous) => {
            const next = mergeReviewResponse(previous, card.id, response);
            return next;
          });
        }
        if (!options?.quietArchiveChange) {
          if (!rollbackCard.archivedAt && response.archivedAt) {
            toast.success("키워드 3회·전체 쓰기 2회를 마쳐 보관함에 넣었어요.");
          } else if (rollbackCard.archivedAt && !response.archivedAt) {
            toast("보관 복습에서 틀려 학습 목록으로 다시 옮겼어요.", { icon: "↺" });
          }
        }
        return true;
      })
      .catch((error) => {
        if (pendingReviewPromisesRef.current.get(card.id) === request) {
          setCards((previous) => {
            const next = previous.map((item) => item.id === card.id ? rollbackCard : item);
            return next;
          });
          toast.error(error instanceof Error ? `${error.message} 다음 실행 때 순서대로 저장할게요.` : "복습 결과는 보관했고 다음 실행 때 순서대로 저장할게요.");
        }
        return false;
      })
      .finally(() => {
        if (pendingReviewPromisesRef.current.get(card.id) === request) {
          pendingReviewPromisesRef.current.delete(card.id);
        }
      });
    pendingReviewPromisesRef.current.set(card.id, request);
    return { request };
  }

  function saveCompletedStudyRun(subjectName: string, attempts: StudyRunAttempt[]) {
    const run: PendingStudyRun = {
      eventId: reviewEventId(),
      subject: subjectName,
      attempts,
    };
    rememberPendingStudyRun(run);
    void sendStudyRun(run)
      .then((response) => {
        forgetPendingStudyRun(run.eventId);
        setStudyStats(response.stats);
      })
      .catch(() => {
        toast.error("완주 통계는 보관했고, 연결이 돌아오면 다시 저장할게요.");
      });
  }

  async function startMistakeReview() {
    const reviewIds = sessionIncorrectCardIds.filter((cardId) => cards.some((card) => card.id === cardId));
    if (!reviewIds.length || startingMistakeReview) return;

    setStartingMistakeReview(true);
    const pendingSaves = reviewIds
      .map((cardId) => pendingReviewPromisesRef.current.get(cardId))
      .filter((request): request is Promise<boolean> => Boolean(request));
    if (pendingSaves.length) await Promise.all(pendingSaves);

    setStudyRound("mistake-review");
    studyKeywordAttemptRecordedRef.current = false;
    setStudySequenceIds(reviewIds);
    setStudiedCardIds([]);
    setStudyFinished(false);
    setSectionAnnouncement(null);
    previousSectionPathRef.current = null;
    const timeLimit = studyQuestionTimeLimit(cards.find((card) => card.id === reviewIds[0]) ?? null,
      studyKeywordRetryAnswers[reviewIds[0]] ?? [], isMobileViewport);
    setStudySecondsLeft(timeLimit);
    studyTimerDeadlineRef.current = null;
    studyTimerRemainingMsRef.current = timeLimit * 1000;
    resolvedStudyCardIdRef.current = null;
    setAnswerVisible(false);
    setTypedAnswer("");
    setFullTableAnswers({});
    setStudyKeywordAnswers(studyKeywordRetryAnswers[reviewIds[0]] ?? []);
    setStudyConnectionActive(false);
    setStudyConnectionAnswers([]);
    setStudyConnectionChecked(false);
    setStudyConnectionReverse(false);
    setStudyRewriteMode(false);
    setStudyInitialAttempt(null);
    studyRunAttemptsRef.current = [];
    resetStudyKeywordSupport();
    studyQuestionDurationMsRef.current.clear();
    setStudyStarted(true);
    setStartingMistakeReview(false);
    toast(mode === "reveal" ? "재도전 대상 키워드를 다시 채워요." : "재도전 대상 카드를 다시 풀어요.", { icon: "↺" });
  }

  function record(result: "correct" | "incorrect", reason: StudyRecordReason = "manual", skipConnection = false) {
    if (studyPausedRef.current) return;
    if (!current || resolvedStudyCardIdRef.current === current.id) return;
    if (studyKeywordMode && (!answerVisible || !studyCorrectionsComplete)) return;
    if (!todayReview && !skipConnection && studyKeywordMode && studySessionMode === "real" && result === "correct" && reason === "manual" && currentStudyQuestionKeywords.length > 0) {
      setStudyConnectionActive(true);
      setStudyConnectionAnswers([]);
      setStudyConnectionChecked(false);
      setStudyConnectionReverse(currentStudyConnectionReverse);
      return;
    }
    resolvedStudyCardIdRef.current = current.id;
    const initialAttempt = studyInitialAttempt?.cardId === current.id ? studyInitialAttempt : null;
    const recordedAnswer = mode === "write" && !studyKeywordMode
      ? initialAttempt?.typedAnswer ?? typedAnswer
      : (initialAttempt?.keywordAnswers ?? studyKeywordAnswers).join(" | ");
    if (reason === "question-timeout") {
      recordStudyKeywordAttempt(current, tableAttemptResults(currentStudyParts, currentStudyKeywords.map((part) => ({ expectedKeyword: part.keyword, matched: false }))));
    }
    if (mode === "write" && !studyGuidedFull && reason === "manual") recordStudyKeywordAttempt(current, fullWriteKeywordMatches(current, recordedAnswer, fullTableAnswers));
    const usedHint = Object.keys(studyHintsRef.current).length > 0;
    const outcome = studyAttemptOutcome(studySessionMode, studyRound, result, usedHint);
    // Completing the remaining blanks resolves the card across this session.
    // It does not advance the independent full-recall learning streak.
    const learningKind: LearningKind | undefined = todayRetry ? undefined : studySessionMode === "practice" ? "practice" : studyKeywordMode ? "keyword" : "full";
    const completedTableKeywordIds = todayRetry && result === "correct" && currentStudyTable
      ? tableKeywords(current.answerFormat).map(({ keywordKey }) => keywordKey)
      : undefined;
    const recordsCardResult = outcome.reviewResult !== null;
    if (recordsCardResult && !queueReviewResult(current, mode, result, recordedAnswer, { learningKind, hintUsed: usedHint, queueAfterPending: todayReview, tableKeywordIds: completedTableKeywordIds })) {
      resolvedStudyCardIdRef.current = null;
      return;
    }
    if (!recordsCardResult) queueStatisticsOnlyReview(current, studyGuidedFull ? "write" : mode, result, recordedAnswer, { learningKind, hintUsed: usedHint });
    if (todayReview && result === "incorrect" && currentStudyKeywords.length) {
      const keywords = currentStudyKeywords.map(part => part.keyword);
      const submitted = studyKeywordMode ? initialAttempt?.keywordAnswers ?? studyKeywordAnswers : keywords;
      const writtenMatches = studyKeywordMode ? [] : currentStudyTable
        ? fullWriteKeywordMatches(current, recordedAnswer, fullTableAnswers)
        : keywordMatches(keywords, recordedAnswer);
      const evaluations = studyKeywordMode ? evaluateQuizAnswers(keywords, submitted, currentStudyOrder)
        : currentStudyKeywords.map(part => ({
            expectedKeyword: part.keyword,
            matched: writtenMatches.some(match => match.matched && (part.keywordId
              ? "keywordKey" in match && match.keywordKey === part.keywordId
              : normalizeForMatch(match.keyword) === normalizeForMatch(part.keyword))),
          }));
      if (evaluations.some(evaluation => !evaluation.matched)) {
        const { parts } = quizInlineCorrections(currentStudyParts, evaluations, submitted, currentStudyOrder);
        const retry = { source: JSON.stringify(fullStudyParts), parts, order: quizCorrectionOrder(currentStudyOrder, evaluations) };
        setTodayReviewRetries(previous => ({ ...previous, [current.id]: retry }));
      }
    }
    if (outcome.retry) {
      setSessionIncorrectCardIds((previous) => previous.includes(current.id) ? previous : [...previous, current.id]);
      if (studyKeywordMode) {
        const firstKeywordAnswers = initialAttempt?.keywordAnswers ?? studyKeywordAnswers;
        const firstEvaluations = evaluateQuizAnswers(
          currentStudyKeywords.map((part) => part.keyword),
          firstKeywordAnswers,
          quizAnswerOrder(currentStudyParts)
        );
        const allKeywordsMatched = firstEvaluations.length > 0
          && firstEvaluations.every((evaluation) => evaluation.matched);
        const retryAnswers = studySessionMode === "real" && usedHint
          ? studyHintRetryAnswersRef.current ?? []
          : allKeywordsMatched
          ? []
          : firstKeywordAnswers.map((answer, index) => firstEvaluations[index]?.matched ? answer : "");
        setStudyKeywordRetryAnswers((previous) => ({ ...previous, [current.id]: retryAnswers }));
      }
    }
    const reviewStep = todayReview ? advanceTodayReview(studySequenceCards.map(card => card.id), studiedCardIds, current.id, result === "correct") : null;
    const completedIds = new Set(reviewStep?.completed ?? [...studiedCardIds, current.id]);
    const nextCardId = reviewStep ? reviewStep.nextCardId : studySequenceIds.find((cardId) => !completedIds.has(cardId)) ?? null;
    const finishedNow = nextCardId === null;
    if (reviewStep) {
      setStudySequenceIds(reviewStep.sequence);
      setTodayReviewTurn(turn => turn + 1);
    }
    if (studySessionMode === "real" && studyRound === "main" && !studyTablePartial) {
      const durationMs = reason === "question-timeout"
        ? currentStudyTimeLimit * 1000
        : studyQuestionDurationMsRef.current.get(current.id) ?? 0;
      const nextAttempts = [
        ...studyRunAttemptsRef.current.filter((attempt) => attempt.cardId !== current.id),
        { cardId: current.id, question: current.question, result, durationMs },
      ];
      studyRunAttemptsRef.current = nextAttempts;

      const sequenceIdSet = new Set(studySequenceIds);
      const subjectCardIds = cards
        .filter((card) => card.subject === current.subject && (!card.archivedAt || sequenceIdSet.has(card.id)))
        .map((card) => card.id);
      const isFullSubjectRun = finishedNow
        && !activeStudySet
        && subject === current.subject
        && subject !== IMPORTANT_VIEW
        && subject !== INCORRECT_VIEW
        && subject !== ARCHIVED_VIEW
        && section === "all"
        && importance === "all"
        && reviewOrder === "saved"
        && subjectCardIds.length === studySequenceIds.length
        && subjectCardIds.every((cardId) => sequenceIdSet.has(cardId));
      if (isFullSubjectRun && nextAttempts.length === studySequenceIds.length) {
        saveCompletedStudyRun(current.subject, nextAttempts);
      }
    }
    setStudiedCardIds([...completedIds]);
    if (finishedNow) {
      setStudyFinished(true);
      if (!todayReview) rememberStudyPosition(null);
    } else if (!todayReview) {
      rememberStudyPosition(nextCardId);
    }
    setAnswerVisible(false);
    setTypedAnswer("");
    setFullTableAnswers({});
    setStudyKeywordAnswers(
      studyRound === "mistake-review" && nextCardId !== null
        ? studyKeywordRetryAnswers[nextCardId] ?? []
        : []
    );
    setStudyConnectionActive(false);
    setStudyConnectionAnswers([]);
    setStudyConnectionChecked(false);
    setStudyConnectionReverse(false);
    setStudyRewriteMode(false);
    setStudyInitialAttempt(null);
    studyKeywordAttemptRecordedRef.current = false;
    resetStudyKeywordSupport();
    const timeoutLabel = `문제 풀이 ${currentStudyTimeLimit}초가`;
    const isRetryRound = studyRound === "mistake-review";
    const message = todayReview
      ? finishedNow ? "오늘 복습을 모두 마쳤어요." : result === "correct" ? "맞았어요. 남은 카드로 갈게요." : "이 카드는 잠시 뒤 다시 나와요."
      : studySessionMode === "real" && usedHint && outcome.retry && result === "correct"
      ? "정답 기록은 보류했어요. 힌트 없이 재도전에 성공하면 정답 1회로 기록해요."
      : reason !== "manual"
      ? isRetryRound
        ? finishedNow
          ? `${timeoutLabel} 지나 재도전을 마쳤어요. 오답 횟수는 추가하지 않았어요.`
          : `${timeoutLabel} 지나 다음 문제로 넘어가요. 오답 횟수는 추가하지 않았어요.`
        : finishedNow
          ? `${timeoutLabel} 지나 오답 횟수에 반영했고, 학습을 마쳤어요.`
          : `${timeoutLabel} 지나 오답 횟수에 반영하고 다음 문제로 넘어가요.`
      : finishedNow
        ? isRetryRound
          ? "이번 재도전을 마쳤어요."
          : result === "incorrect"
            ? "학습을 마쳤어요. 오답은 기록했고 재도전에서 다시 풀어요."
            : "학습을 모두 마쳤어요."
        : result === "correct"
          ? isRetryRound
            ? "재도전 정답을 기록했어요. 다음 카드로 갈게요."
            : "맞았어요. 다음 카드로 갈게요."
          : isRetryRound
            ? "재도전에서는 오답 횟수를 추가하지 않았어요."
            : "오답 1회를 기록했어요. 마지막 재도전에서 다시 풀어요.";
    const practiceMessage = studySessionMode === "practice"
      ? `따라 쓰기를 마쳤어요. ${finishedNow ? "연습을 마쳤어요." : "다음 카드로 갈게요."}` : message;
    toast(practiceMessage, { icon: reason !== "manual" ? "⏱" : finishedNow || result === "correct" ? "✓" : "↺" });
  }

  function finishStudyConnection() {
    if (studyPausedRef.current) return;
    if (!studyConnectionChecked) return;
    setStudyConnectionActive(false);
    record("correct", "manual", true);
  }


  function returnToWriting() {
    if (mode !== "write" || !answerVisible || studySessionMode !== "practice") return;
    setStudyRewriteMode(true);
    setAnswerVisible(false);
  }

  function changeStudySessionMode(practice: boolean) {
    if (studyStarted && !studyFinished) return;
    applyStudySessionMode(practice ? "practice" : "real");
  }

  function applyStudySessionMode(nextMode: StudySessionMode) {
    setStudySessionMode(nextMode);
    try {
      window.localStorage.setItem(STUDY_SESSION_MODE_KEY, nextMode);
    } catch {
      // 이번 실행에서는 상태가 그대로 유지돼요.
    }
  }

  function pauseStudy() {
    if (!current || studySessionMode !== "real" || studyPausedRef.current) return;
    studyPausedRef.current = true;
    studyTimerRemainingMsRef.current = remainingStudyTime(studyTimerDeadlineRef.current, studyTimerRemainingMsRef.current, Date.now());
    studyTimerDeadlineRef.current = null;
    setStudySecondsLeft(Math.ceil(studyTimerRemainingMsRef.current / 1000));
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setStudyPaused(true);
  }

  function resumeStudy() {
    studyPausedRef.current = false;
    setStudyPaused(false);
  }

  function pauseQuiz() {
    if (mainTab !== "quiz" || !currentQuizCard || quizFinished || quizPausedRef.current) return;
    quizPausedRef.current = true;
    quizTimerRemainingMsRef.current = remainingStudyTime(quizTimerDeadlineRef.current, quizTimerRemainingMsRef.current, Date.now());
    quizTimerDeadlineRef.current = null;
    setQuizSecondsLeft(Math.ceil(quizTimerRemainingMsRef.current / 1000));
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setQuizPaused(true);
  }

  function resumeQuiz() {
    quizPausedRef.current = false;
    setQuizPaused(false);
  }

  function revealQuizHint(preferredIndex: number | null = quizFocusedBlankIndex) {
    if (quizPausedRef.current) return;
    if (
      !currentQuizCard
      || !currentQuizItem
      || quizChecked
      || quizConnectionActive
      || currentQuizKeywordReview
      || quizRound !== "main"
    ) return;

    const savedCardHints = quizHintsRef.current[currentQuizCard.id] ?? {};
    const keywordIndex = unresolvedQuizHintIndex(currentQuizEvaluations, preferredIndex);
    if (keywordIndex < 0) return;
    const keyword = quizHintKeywords(currentQuizKeywords.map((part) => part.keyword), quizAnswers, currentQuizOrder, savedCardHints)[keywordIndex] ?? "";
    if (!keyword) return;
    const hintPlan = planQuizHint(keyword, quizAnswers[keywordIndex] ?? "");
    const restoreScroll = rememberHintScroll(document.querySelector<HTMLElement>(".quiz-answer-panel .quiz-cloze-copy"));
    const tableHint = isTableFormat(currentQuizCard.answerFormat) ? tableHintResult(currentQuizParts, quizHintKeywords(currentQuizKeywords.map((part)=>part.keyword), quizAnswers, currentQuizOrder, savedCardHints), keywordIndex) : [];
    const nextHint: QuizBlankHint = {
      stage: hintPlan.stage,
      keyword,
      text: progressiveQuizHint(keyword, hintPlan.stage),
      keywordKey:tableHint[0]?.keywordKey,
    };
    const isFirstHintForCard = Object.keys(savedCardHints).length === 0;
    const isFirstHintForKeyword = !savedCardHints[keywordIndex] && !(nextHint.keywordKey && Object.values(savedCardHints).some((hint)=>hint?.keywordKey===nextHint.keywordKey));

    if (isFirstHintForKeyword) {
      if(isTableFormat(currentQuizCard.answerFormat)) queueKeywordAttempt(currentQuizCard, tableHint);
      else queueKeywordAttempt(currentQuizCard, [{ keyword, matched: false }]);
    }

    if (isFirstHintForCard) {
      setQuizRetryItems((previous) => previous.some((item) => item.cardId === currentQuizItem.cardId)
        ? previous
        : [...previous, currentQuizItem]);
      setQuizRetryAnswers((previous) => ({
        ...previous,
        [currentQuizCard.id]: quizAnswers.map((answer, index) => currentQuizEvaluations[index]?.matched ? answer : ""),
      }));
    }

    const nextCardHints = { ...savedCardHints, [keywordIndex]: nextHint };
    nextHint.revision = (savedCardHints[keywordIndex]?.revision ?? 0)+1;
    quizHintsRef.current = {
      ...quizHintsRef.current,
      [currentQuizCard.id]: nextCardHints,
    };
    setQuizHints(quizHintsRef.current);
    setQuizAnswers((previous) => {
      const next = [...previous];
      next[keywordIndex] = hintPlan.answer;
      return next;
    });
    setQuizFocusedBlankIndex(keywordIndex);
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`textarea[data-mobile-cloze-card="${currentQuizCard.id}"][data-cloze-index="${keywordIndex}"], .quiz-answer-panel input[data-cloze-index="${keywordIndex}"]`);
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(hintPlan.answer.length, hintPlan.answer.length);
      restoreScroll();
      if (input instanceof HTMLInputElement) revealInputInsideCloze(input);
    });
    if (isFirstHintForCard) {
      toast("힌트를 사용한 키워드는 오답 1회로 기록해요. 같은 키워드의 다음 힌트는 추가되지 않아요.", { icon: "💡" });
    }
  }

  function resolveQuizAttempt(forceIncorrect = false, answersOverride?: string[]) {
    if (quizPausedRef.current) return;
    if (!currentQuizCard || quizChecked) return;
    const answersToGrade = answersOverride ?? quizAnswers;
    const evaluationsToGrade = evaluateQuizAnswers(
      currentQuizKeywords.map((part) => part.keyword),
      answersToGrade,
      currentQuizOrder
    );
    const allFilled = currentQuizKeywords.length > 0
      && currentQuizKeywords.every((_, answerIndex) => Boolean(answersToGrade[answerIndex]?.trim()));
    if (!forceIncorrect && !allFilled) return;
    const attemptKey = `${currentQuizCard.id}:${quizRound}:${quizIndex}`;
    if (quizAttemptLockRef.current === attemptKey) return;
    quizAttemptLockRef.current = attemptKey;
    const isCorrect = !forceIncorrect
      && evaluationsToGrade.length > 0
      && evaluationsToGrade.every((evaluation) => evaluation.matched);
    setQuizReviewCard(currentQuizCard);
    if (currentQuizKeywordReview) {
      queueStatisticsOnlyReview(currentQuizCard, "write", isCorrect ? "correct" : "incorrect", answersToGrade.join(" | "));
      recordQuizKeywordAttempt(currentQuizCard, [{ keyword: currentQuizKeywordReview, matched: isCorrect, keywordKey: currentQuizItem?.keywordKey }]);
      setQuizAnswers([...answersToGrade]);
      setQuizCorrectionAnswers(quizInlineCorrections(currentQuizParts, evaluationsToGrade, answersToGrade).answers);
      setQuizChecked(true);
      if (isCorrect) setQuizScore((value) => value + 1);
      return;
    }
    const wasHinted = Object.keys(quizHintsRef.current[currentQuizCard.id] ?? {}).length > 0;
    const outcome = quizAttemptOutcome(quizRound, isCorrect, wasHinted);
    if (outcome.reviewResult) {
      const queued = queueReviewResult(
        currentQuizCard,
        "write",
        outcome.reviewResult,
        answersToGrade.join(" | "),
        { after: quizReviewSequenceRef.current.get(currentQuizCard.id), queueAfterPending: true, learningKind: "keyword", hintUsed: wasHinted }
      );
      if (!queued) {
        if (quizAttemptLockRef.current === attemptKey) quizAttemptLockRef.current = null;
        return;
      }
      quizReviewSequenceRef.current.set(currentQuizCard.id, queued.request);
    }
    if (!outcome.reviewResult) queueStatisticsOnlyReview(currentQuizCard, "write", isCorrect ? "correct" : "incorrect", answersToGrade.join(" | "), { learningKind: "keyword", hintUsed: wasHinted });
    recordQuizKeywordAttempt(currentQuizCard, tableAttemptResults(currentQuizParts, evaluationsToGrade));
    setQuizAnswers([...answersToGrade]);
    setQuizCorrectionAnswers(quizInlineCorrections(currentQuizParts, evaluationsToGrade, answersToGrade).answers);

    if (outcome.retry) {
      if (currentQuizItem) {
        setQuizRetryItems((previous) => previous.some((item) => item.cardId === currentQuizItem.cardId)
          ? previous
          : [...previous, currentQuizItem]);
        setQuizRetryAnswers((previous) => ({
          ...previous,
          [currentQuizItem.cardId]: wasHinted
            ? previous[currentQuizItem.cardId] ?? []
            : answersToGrade.map((answer, index) => evaluationsToGrade[index]?.matched ? answer : ""),
        }));
      }
      setQuizChecked(true);
      toast(isCorrect
        ? "힌트 없이 재도전에 성공하면 정답 1회로 기록해요."
        : forceIncorrect
          ? "제한시간이 지나 오답 1회로 기록했어요. 마지막에 재도전해요."
          : "오답 1회로 기록했어요. 마지막에 다시 풀어보세요.", { icon: "↺" });
      return;
    }

    setQuizChecked(true);
    if (outcome.reviewResult === "correct" && !quizScoredCardIdsRef.current.has(currentQuizCard.id)) {
      quizScoredCardIdsRef.current.add(currentQuizCard.id);
      setQuizScore((value) => value + 1);
    }
    if (forceIncorrect) toast("제한시간이 지났어요. 재도전 오답은 추가로 기록하지 않아요.", { icon: "⏱" });
  }

  function gradeQuiz(answersOverride?: string[]) {
    if (quizPausedRef.current) return;
    resolveQuizAttempt(false, answersOverride);
  }

  function nextQuizQuestion(skipConnection = false) {
    if (quizPausedRef.current) return;
    if (!quizChecked || !quizCorrectionsComplete) return;
    if (
      !skipConnection
      && !currentQuizKeywordReview
      && quizChecked
      && quizAllCorrect
      && currentQuizQuestionKeywords.length > 0
      && !quizConnectionActive
    ) {
      setQuizConnectionActive(true);
      setQuizConnectionAnswers([]);
      setQuizConnectionChecked(false);
      setQuizConnectionReverse(currentQuizConnectionReverse);
      return;
    }
    setQuizCorrectionAnswers([]);
    setQuizReviewCard(null);
    if (quizIndex + 1 >= quizItems.length) {
      if (quizRound === "main" && quizRetryItems.length) {
        setQuizItems(quizRetryItems);
        setQuizIndex(0);
        setQuizAnswers(quizRetryAnswers[quizRetryItems[0].cardId] ?? []);
        setQuizChecked(false);
        setQuizConnectionActive(false);
        setQuizConnectionAnswers([]);
        setQuizConnectionChecked(false);
        setQuizConnectionReverse(false);
        setQuizFocusedBlankIndex(null);
        quizAttemptLockRef.current = null;
        quizKeywordAttemptRecordedRef.current = false;
        setQuizRound("retry");
        toast(`재도전에서는 틀렸던 ${quizRetryItems.length}문제의 틀린 키워드만 다시 풀어요.`, { icon: "↺" });
        return;
      }
      setQuizFinished(true);
      return;
    }
    const nextQuizItem = quizItems[quizIndex + 1];
    setQuizIndex((value) => value + 1);
    setQuizAnswers(quizRound === "retry" && nextQuizItem ? quizRetryAnswers[nextQuizItem.cardId] ?? [] : []);
    setQuizChecked(false);
    setQuizConnectionActive(false);
    setQuizConnectionAnswers([]);
    setQuizConnectionChecked(false);
    setQuizConnectionReverse(false);
    setQuizFocusedBlankIndex(null);
    quizAttemptLockRef.current = null;
    quizKeywordAttemptRecordedRef.current = false;
  }

  function finishQuizConnection() {
    if (quizPausedRef.current) return;
    if (!quizConnectionChecked) return;
    setQuizConnectionActive(false);
    setQuizConnectionReverse(false);
    nextQuizQuestion(true);
  }

  const resolveQuizAttemptEvent = useEffectEvent(resolveQuizAttempt);

  function continueCardDeletion() {
    if (!deleting) return;
    setFinalDeleting(deleting);
    setDeleting(null);
  }

  function continueSetDeletion() {
    if (!deletingSet) return;
    setFinalDeletingSet(deletingSet);
    setDeletingSet(null);
  }

  async function deleteCard() {
    if (!finalDeleting) return;
    setDeleteBusy(true);
    try {
      await api(`/api/cards/${finalDeleting.id}`, { method: "DELETE" });
      setCards((previous) => previous.filter((card) => card.id !== finalDeleting.id));
      setSets((previous) => previous.map((set) => ({
        ...set,
        cardIds: set.cardIds.filter((cardId) => cardId !== finalDeleting.id),
      })));
      setFinalDeleting(null);
      toast.success("카드를 삭제했어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function archiveDeletingCard() {
    if (!finalDeleting) return;
    if (finalDeleting.archivedAt) {
      setFinalDeleting(null);
      toast.success("이미 보관함에 있는 카드예요.");
      return;
    }
    setDeleteBusy(true);
    try {
      const result = await api<{ card: StudyCard }>(`/api/cards/${finalDeleting.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived: true }),
      });
      saveToList(result.card);
      setFinalDeleting(null);
      toast.success("카드를 삭제하지 않고 보관함에 넣었어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "카드를 보관하지 못했습니다.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function deleteStudySet() {
    if (!finalDeletingSet) return;
    setDeleteBusy(true);
    try {
      await api(`/api/sets/${finalDeletingSet.id}`, { method: "DELETE" });
      setSets((previous) => previous.filter((set) => set.id !== finalDeletingSet.id));
      if (activeStudySetId === finalDeletingSet.id) {
        resetStudy();
        setSubject("");
      }
      setFinalDeletingSet(null);
      toast.success("세트만 삭제했어요. 카드는 그대로 남아 있어요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "세트를 삭제하지 못했습니다.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const answered = answerVisible;
  const progress = studySequenceCards.length ? (studiedCardIds.length / studySequenceCards.length) * 100 : 0;
  const currentKeywordMatches = current && answered
    ? mode === "write" && !studyKeywordMode
      ? fullWriteKeywordMatches(current, typedAnswer, fullTableAnswers)
      : currentStudyKeywords.map((part, index) => ({
          keyword: part.keyword,
          matched: currentStudyEvaluations[index]?.matched ?? false,
        }))
    : [];
  const suggestedResult: "correct" | "incorrect" | null = currentKeywordMatches.length
    ? currentKeywordMatches.every((item) => item.matched) ? "correct" : "incorrect"
    : null;
  const decisionSuggestedResult = (studyRewriteMode || (mode === "write" && !studyKeywordMode)) && studyInitialAttempt?.cardId === current?.id
    ? studyInitialAttempt?.suggestedResult ?? suggestedResult
    : suggestedResult;
  const currentPaneFractions = current && answered
    ? answerPaneFractions(mode === "reveal" ? current.answer : typedAnswer, current.answer, current.memo)
    : null;
  useEffect(() => {
    if (!current || todayReview) return;
    if (subject === SELECTED_SETS_VIEW) {
      const set = learningSets.find((item) => item.cardIds.includes(current.id));
      if (set && announcedLearningSetRef.current !== set.id) {
        const firstSet = announcedLearningSetRef.current === null;
        announcedLearningSetRef.current = set.id;
        if (firstSet) return;
        setSectionAnnouncement({ section: "", subsection: "", detailSection: "", changed: { section: false, subsection: false, detailSection: false }, setInfo: { name: set.name, memo: set.memo } });
      }
      return;
    }
    const nextPath: SectionPath = {
      section: current.section,
      subsection: current.subsection,
      detailSection: current.detailSection,
    };
    const previousPath = previousSectionPathRef.current;
    if (!previousPath) { previousSectionPathRef.current = nextPath; return; }
    const changed = {
      section: !previousPath || previousPath.section !== nextPath.section,
      subsection: !previousPath || previousPath.subsection !== nextPath.subsection,
      detailSection: !previousPath || previousPath.detailSection !== nextPath.detailSection,
    };
    if (Object.values(changed).some(Boolean)) {
      setSectionAnnouncement({
        ...nextPath,
        changed,
      });
      previousSectionPathRef.current = nextPath;
    }
  }, [current, subject, learningSets, todayReview]);

  useEffect(() => {
    if (!sectionAnnouncement) return;
    const dismissAnnouncement = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setSectionAnnouncement(null);
    };
    window.addEventListener("keydown", dismissAnnouncement, true);
    return () => window.removeEventListener("keydown", dismissAnnouncement, true);
  }, [sectionAnnouncement]);

  useEffect(() => {
    if (!current || answered) return;
    const timeLimit = currentStudyTimeLimit;
    studyTimerDeadlineRef.current = null;
    studyTimerRemainingMsRef.current = timeLimit * 1000;
    resolvedStudyCardIdRef.current = null;
    let active = true;
    queueMicrotask(() => {
      if (active) setStudySecondsLeft(timeLimit);
    });
    return () => { active = false; };
  }, [answered, current?.id, currentStudyTimeLimit, mode, studyRound, studySessionMode, todayReviewTurn]);

  useEffect(() => {
    const timerPaused = todayReview || !current || studyPaused || Boolean(pendingSessionExit) || studySessionMode !== "real" || studyConnectionActive || answered || Boolean(sectionAnnouncement) || dialogOpen || bulkOpen;
    if (timerPaused) return;

    const cardId = current.id;
    studyTimerDeadlineRef.current = Date.now() + studyTimerRemainingMsRef.current;
    const updateTimer = () => {
      if (studyPausedRef.current) return;
      const deadline = studyTimerDeadlineRef.current;
      if (deadline === null) return;
      const remainingMs = Math.max(0, deadline - Date.now());
      studyTimerRemainingMsRef.current = remainingMs;
      setStudySecondsLeft(Math.ceil(remainingMs / 1000));
      if (remainingMs === 0 && resolvedStudyCardIdRef.current !== cardId) {
        if (studyKeywordMode) gradeStudyKeywordsEvent(undefined, true);
        else showWrittenAnswerEvent(true);
      }
    };
    const timer = window.setInterval(updateTimer, 200);

    return () => {
      window.clearInterval(timer);
      const deadline = studyTimerDeadlineRef.current;
      if (deadline !== null) {
        studyTimerRemainingMsRef.current = Math.max(0, deadline - Date.now());
        studyTimerDeadlineRef.current = null;
      }
    };
  }, [answered, bulkOpen, current, currentStudyTimeLimit, mode, dialogOpen, sectionAnnouncement, studyConnectionActive, studySessionMode, studyPaused, studyKeywordMode, pendingSessionExit, todayReview]);

  useEffect(() => {
    if (currentQuizCardId === null || quizFinished || quizChecked) return;
    const timeLimit = currentQuizTimeLimit;
    quizTimerDeadlineRef.current = null;
    quizTimerRemainingMsRef.current = timeLimit * 1000;
    resolvedQuizPhaseRef.current = null;
    let active = true;
    queueMicrotask(() => {
      if (active) setQuizSecondsLeft(timeLimit);
    });
    return () => { active = false; };
  }, [currentQuizCardId, currentQuizTimeLimit, quizChecked, quizFinished, quizRound, quizIndex, quizSessionRevision]);

  useEffect(() => {
    const timerPaused = mainTab !== "quiz" || quizPaused || Boolean(pendingSessionExit) || !currentQuizCard || quizFinished || quizChecked || quizConnectionActive || dialogOpen || bulkOpen;
    if (timerPaused) return;

    const phaseKey = `${quizSessionRevision}:${currentQuizCard.id}:${quizRound}:${quizIndex}`;
    quizTimerDeadlineRef.current = Date.now() + quizTimerRemainingMsRef.current;
    const updateTimer = () => {
      if (quizPausedRef.current) return;
      const deadline = quizTimerDeadlineRef.current;
      if (deadline === null) return;
      const remainingMs = Math.max(0, deadline - Date.now());
      quizTimerRemainingMsRef.current = remainingMs;
      setQuizSecondsLeft(Math.ceil(remainingMs / 1000));
      if (remainingMs !== 0 || resolvedQuizPhaseRef.current === phaseKey) return;
      resolvedQuizPhaseRef.current = phaseKey;
      resolveQuizAttemptEvent(true);
    };
    const timer = window.setInterval(updateTimer, 200);

    return () => {
      window.clearInterval(timer);
      const deadline = quizTimerDeadlineRef.current;
      if (deadline !== null) {
        quizTimerRemainingMsRef.current = Math.max(0, deadline - Date.now());
        quizTimerDeadlineRef.current = null;
      }
    };
  }, [bulkOpen, currentQuizCard, currentQuizTimeLimit, dialogOpen, mainTab, quizChecked, quizConnectionActive, quizFinished, quizIndex, quizRound, quizSessionRevision, quizPaused, pendingSessionExit]);

  useEffect(() => {
    if (mainTab !== "quiz" || !quizChecked || !quizCorrectionsComplete || quizFinished || quizConnectionActive || dialogOpen || bulkOpen) return;
    const handleEnter = (event: KeyboardEvent) => {
      if (quizPausedRef.current) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      handleQuizReviewEnter(event, quizNextButtonRef.current, window.matchMedia("(min-width: 761px)").matches);
    };
    window.addEventListener("keydown", handleEnter);
    return () => window.removeEventListener("keydown", handleEnter);
  }, [mainTab, quizChecked, quizCorrectionsComplete, quizFinished, quizConnectionActive, dialogOpen, bulkOpen]);

  useEffect(() => {
    if (!answered || !decisionSuggestedResult || studyConnectionActive || (studyKeywordMode && !studyCorrectionsComplete)) return;
    suggestedResultButtonRef.current?.focus({ preventScroll: true });
  }, [answered, current?.id, decisionSuggestedResult, mode, studyConnectionActive, studyKeywordMode, studyCorrectionsComplete]);

  const studyCardId = current?.id;
  const studyAnswerAutoFocus = !dialogOpen && !bulkOpen && !sectionAnnouncement;
  useLayoutEffect(() => {
    if (mainTab !== "study" || mode !== "write" || answered || !studyCardId || studyPaused || !studyAnswerAutoFocus) return;
    typedAnswerRef.current?.focus({ preventScroll: true });
  }, [answered, studyCardId, mainTab, mode, studyPaused, studyAnswerAutoFocus]);

  useEffect(() => {
    if (mode !== "write" || studySessionMode !== "practice" || !answered || studyConnectionActive || !current || dialogOpen || bulkOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      setStudyRewriteMode(true);
      setAnswerVisible(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [answered, bulkOpen, current, dialogOpen, mode, studyConnectionActive, studySessionMode]);

  const performMobileBack = useEffectEvent(() => {
    if (pendingSessionExit) { setPendingSessionExit(null); return; }
    if (dismissPhotoLayer()) return;
    if (studyPausedRef.current || quizPausedRef.current) return;
    if (finalDeleting) { if (!deleteBusy) setFinalDeleting(null); return; }
    if (finalDeletingSet) { if (!deleteBusy) setFinalDeletingSet(null); return; }
    if (deleting) { setDeleting(null); return; }
    if (deletingSet) { setDeletingSet(null); return; }
    if (mobileCardsJumpOpen) { setMobileCardsJumpOpen(false); return; }
    if (statsSubject) { setStatsSubject(""); return; }
    if (overallStatsOpen) { setOverallStatsOpen(false); return; }
    if (startOrderOpen) { setStartOrderOpen(false); setRangeSelectedCardIds([]); return; }
    if (sectionAnnouncement) { setSectionAnnouncement(null); return; }
    if (dialogOpen) { cardDialogMobileBackRef.current?.(); return; }
    if (bulkOpen) { bulkDialogMobileBackRef.current?.(); return; }
    if (flowOpen) {
      if (flowSetSaving) return;
      if (flowSetStep === "details") backToFlowSetSelection();
      else if (flowSetStep === "select") resetFlowSetBuilder();
      else handleFlowOpenChange(false);
      return;
    }
    if (mobileCardsOpen) { setMobileCardsOpen(false); setMobileCardsJumpOpen(false); return; }
    if (detailCardId !== null) { setDetailCardId(null); return; }
    if (quizConnectionActive) {
      setQuizConnectionActive(false);
      setQuizConnectionAnswers([]);
      setQuizConnectionChecked(false);
      setQuizConnectionReverse(false);
      return;
    }
    if (mainTab === "quiz" && (quizItems.length > 0 || quizFinished)) { leaveQuiz(); return; }
    if (studyConnectionActive) {
      setStudyConnectionActive(false);
      setStudyConnectionAnswers([]);
      setStudyConnectionChecked(false);
      setStudyConnectionReverse(false);
      return;
    }
    if (mainTab === "study" && subject) {
      if (studyStarted || studyFinished) requestSessionExit(resetStudy);
      else leaveStudySelection();
      return;
    }
    if (mainTab !== "study") setMainTab("study");
  });

  const mobileBackAvailable = Boolean(
    finalDeleting
    || finalDeletingSet
    || deleting
    || deletingSet
    || mobileCardsJumpOpen
    || statsSubject
    || overallStatsOpen
    || startOrderOpen
    || sectionAnnouncement
    || dialogOpen
    || bulkOpen
    || flowOpen
    || mobileCardsOpen
    || detailCardId !== null
    || quizConnectionActive
    || (mainTab === "quiz" && (quizItems.length > 0 || quizFinished))
    || studyConnectionActive
    || (mainTab === "study" && Boolean(subject))
    || mainTab !== "study"
  );

  useEffect(() => {
    const pushHistoryGuard = () => {
      const preservedState = typeof window.history.state === "object" && window.history.state !== null
        ? window.history.state
        : {};
      window.history.pushState({ ...preservedState, teacherStudyMobileBack: true }, "", window.location.href);
      mobileHistoryGuardRef.current = true;
    };
    const handlePopState = () => {
      if (mobileHistorySuppressPopRef.current) {
        mobileHistorySuppressPopRef.current = false;
        mobileHistoryGuardRef.current = false;
        if ((isMobileViewport && mobileBackAvailable) || activeSession) pushHistoryGuard();
        return;
      }
      if (!mobileHistoryGuardRef.current) return;
      mobileHistoryGuardRef.current = false;
      performMobileBack();
      setMobileBackRevision((value) => value + 1);
    };

    window.addEventListener("popstate", handlePopState);
    if (!mobileHistorySuppressPopRef.current) {
      mobileHistoryGuardRef.current = window.history.state?.teacherStudyMobileBack === true;
    }
    const needsHistoryGuard = (isMobileViewport && mobileBackAvailable) || Boolean(activeSession);
    if (!mobileHistorySuppressPopRef.current && needsHistoryGuard && !mobileHistoryGuardRef.current) pushHistoryGuard();
    else if (!mobileHistorySuppressPopRef.current && !needsHistoryGuard && mobileHistoryGuardRef.current) {
      mobileHistorySuppressPopRef.current = true;
      mobileHistoryGuardRef.current = false;
      window.history.back();
    }
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isMobileViewport, mobileBackAvailable, mobileBackRevision, activeSession]);

  useEffect(() => {
    const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
    if (!mobileBackAvailable || !standalone || !isMobileViewport) return;
    let gesture: { startX: number; startY: number; startedAt: number } | null = null;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { gesture = null; return; }
      const touch = event.touches[0];
      const target = event.target instanceof Element ? event.target : null;
      const startsInExcludedControl = Boolean(target?.closest("input, textarea, select, [contenteditable='true'], [role='slider'], [data-mobile-back-swipe-ignore]"));
      const startsInCardTrack = Boolean(target?.closest(".mobile-cards-track"));
      const edgeWidth = Math.min(24, window.innerWidth * .08);
      gesture = touch.clientX <= edgeWidth
        && !startsInExcludedControl
        && (!startsInCardTrack || mobileCardIndex === 0)
        ? { startX: touch.clientX, startY: touch.clientY, startedAt: Date.now() }
        : null;
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (!gesture || event.changedTouches.length !== 1) { gesture = null; return; }
      const touch = event.changedTouches[0];
      const shouldGoBack = isMobileBackSwipeGesture({
        startX: gesture.startX,
        startY: gesture.startY,
        endX: touch.clientX,
        endY: touch.clientY,
        viewportWidth: window.innerWidth,
        durationMs: Date.now() - gesture.startedAt,
      });
      gesture = null;
      if (shouldGoBack && mobileHistoryGuardRef.current) window.history.back();
    };
    const cancelGesture = () => { gesture = null; };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", cancelGesture, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", cancelGesture);
    };
  }, [isMobileViewport, mobileBackAvailable, mobileCardIndex]);

  const shortcutScreen: ShortcutScreen = mainTab === "cards" ? "cards"
    : mainTab === "sets" ? setStudySelecting ? "set-selection" : "sets"
    : mainTab === "quiz" ? quizPaused ? "paused" : !quizItems.length || quizFinished ? "quiz-ready"
      : quizConnectionActive ? "quiz-review" : currentQuizTable ? "quiz-table" : quizChecked ? "quiz-review" : "quiz-keywords"
    : !subject ? "home" : !studyStarted || studyFinished ? "study-ready"
      : studyPaused ? "paused" : currentStudyTable ? "study-table"
      : mode === "write" && !studyKeywordMode ? "study-write" : "study-keywords";

  return (
    <DaySettingProvider><PhotoViewerProvider><main ref={sessionRootRef} onFocusCapture={event => {
      if (event.target instanceof HTMLElement && event.target.matches("input, textarea") && event.target.closest(".study-card, .quiz-card")) sessionEditingFocusRef.current = event.target;
    }} className={`app-page${mainTab === "quiz" ? " is-quiz-tab" : ""}${mainTab === "study" ? " is-study-tab" : ""}${mainTab === "study" && subject ? " is-studying" : ""}${mainTab === "study" && subject && studyStarted && !studyFinished ? " is-study-active" : ""}${mainTab === "quiz" && quizItems.length && !quizFinished ? " is-quizzing" : ""}${isMobileViewport && ((mainTab === "study" && studyStarted && !studyFinished) || (mainTab === "quiz" && quizItems.length > 0 && !quizFinished)) ? " mobile-session-layout" : ""}`}>
      <Tabs value={mainTab} onValueChange={changeMainTab} className="app-shell">
        <header className="app-header">
          <div>
            <div className="brand-line"><span className="brand-mark" aria-hidden="true" /><span>{SITE_NAME}</span></div>
            <p>{loading ? "불러오는 중…" : <><span className="desktop-card-count">{`학습 ${cards.filter((card) => !card.archivedAt).length}장 · 보관 ${cards.filter((card) => card.archivedAt).length}장 · ${sets.length}개 세트`}</span><span className="mobile-card-count">카드 {cards.length}장</span></>}</p>
          </div>
          <div className="app-header-actions">
            <div className="daily-summary-controls"><DaySettingButton />
            <Button type="button" variant="outline" className="overall-stats-button daily-stats-button" aria-label="오늘 학습 통계 보기" onClick={() => setOverallStatsOpen(true)}>
              <DailyStatsReadout count={dailyStats?.learnedCardCount} accuracy={dailyStats?.accuracy} />
            </Button>
            </div>
            <div className="sync-pill" aria-label="동기화"><Cloud /><span>동기화</span></div>
          </div>
        </header>

        <TabsList className="main-tabs-list" aria-label="주요 메뉴" data-mobile-back-swipe-ignore>
          <TabsTrigger value="quiz"><BrainCircuit />퀴즈</TabsTrigger>
          <TabsTrigger value="study"><BookOpen />학습</TabsTrigger>
          <TabsTrigger value="cards"><Layers3 />카드</TabsTrigger>
          <TabsTrigger value="sets"><FolderHeart />세트</TabsTrigger>
        </TabsList>

        <TabsContent value="quiz" className="tab-page quiz-page">
          {!quizItems.length && !quizFinished && (
            <TabPageHeading
              eyebrow="MEMORY QUIZ"
              title="퀴즈"
              description="실전 기록을 분석해 지금 가장 필요한 5문제를 골라요."
            />
          )}
          {loadError ? (
            <section className="error-state"><p>{loadError}</p><Button variant="outline" onClick={() => void loadCards()}><RotateCcw /> 다시 불러오기</Button></section>
          ) : loading ? (
            <section className="loading-card"><div /><div /><div /></section>
          ) : quizFinished ? (
            <section className="quiz-summary">
              <div className="quiz-summary-icon"><BrainCircuit /></div>
              <span className="eyebrow">QUIZ COMPLETE</span>
              <h1>{quizScore} / {quizTotal}</h1>
              <p>{quizScore === quizTotal ? "핵심 키워드를 모두 기억했어요!" : "틀린 카드는 잠시 간격을 두고 다시 복습해요."}</p>
              <div>
                <Button size="lg" onClick={startQuiz} disabled={!quizStartCount}><RotateCcw /> 다른 문제 풀기</Button>
                <Button size="lg" variant="outline" onClick={() => leaveQuiz()}>과목 바꾸기</Button>
              </div>
              {!quizStartCount && <p>최근 학습한 카드를 제외하면 출제할 카드가 없어요. 다른 과목을 선택하거나 잠시 후 다시 시작해 주세요.</p>}
            </section>
          ) : !quizItems.length ? (
            <>
              <section className="quiz-launch-card">
                <div className="quiz-launch-icon"><BrainCircuit /></div>
                <h2>핵심 키워드만 채워보세요</h2>
                <p>최근 30분 안에 학습한 카드는 제외하고, 실전 기록·풀이 시간·오답을 반영해 추천해요.</p>
                <div className="quiz-launch-controls">
                  <Select value={quizSubject} onValueChange={setQuizSubject}>
                    <SelectTrigger className="quiz-subject-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체 과목</SelectItem>
                      {subjects.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                      <SelectItem value={ARCHIVED_VIEW}>보관함만</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="lg" onClick={startQuiz} disabled={!quizStartCount}>
                    <BrainCircuit /> {quizStartCount ? `${quizStartCount}문제 시작` : "출제할 카드 없음"}
                  </Button>
                </div>
                <small>{quizSubject === ARCHIVED_VIEW
                  ? `보관함의 퀴즈 가능 카드 ${quizEligibleCards.length}장 중 골라요.`
                  : `퀴즈 가능 카드 ${quizEligibleCards.length}장${dueArchivedQuizCards.length ? ` · 복습 예정 보관 카드 ${quizStartItems.filter((item) => item.reason === "archive-review").length}장 추가` : ""} · 같은 세트는 이어서 출제해요.`}</small>
              </section>
            </>
          ) : currentQuizCard && currentQuizItem ? (
            <section className="quiz-session">
              <div className="quiz-toolbar" inert={quizPaused}>
                <Button variant="ghost" onClick={() => leaveQuiz()}><ArrowLeft /> 퀴즈 나가기</Button>
                <QuizRestartButton key={quizSessionRevision} onRestart={startQuiz} disabled={quizPaused} />
              </div>
              <div className="study-progress-row quiz-progress-row">
                <Button variant="ghost" className="mobile-session-back" aria-label="퀴즈 나가기" disabled={quizPaused} onPointerDown={event => event.preventDefault()} onClick={leaveQuiz}><ArrowLeft /><span>퀴즈</span></Button>
                <div className="session-progress-summary"><span>{quizIndex + 1}/{quizItems.length}</span></div>
                <Progress value={((quizIndex + 1) / quizItems.length) * 100} />
                <div className="study-progress-meta">
                  <span>{quizConnectionActive ? "질문 연결" : quizRound === "retry" ? "재도전" : "맞춤 추천"}</span>
                  {quizRound === "main" && !quizChecked && !quizConnectionActive && !currentQuizKeywordReview && <Button type="button" variant="outline" className="mobile-session-hint" disabled={quizPaused || !quizHasUnresolvedKeyword || currentQuizHintTargetIndex < 0} onMouseDown={event => event.preventDefault()} onClick={() => revealQuizHint()}><Lightbulb /> 힌트</Button>}
                  <StudyClockControl activity="퀴즈" seconds={quizSecondsLeft} phase={quizConnectionActive ? "연결" : quizChecked ? "정답" : "문제"}
                    paused={quizPaused} untimed={quizConnectionActive || quizChecked} blocked={dialogOpen || bulkOpen} onPause={pauseQuiz} onResume={resumeQuiz} />
                </div>
              </div>
              <article inert={quizPaused} className={`quiz-card${quizConnectionActive ? " is-connection" : ""}${currentQuizTable && !quizConnectionActive ? " is-table-session" : ""}${wrongLevelClass(currentQuizCard.incorrectCount)}`}>
                {quizConnectionActive ? (
                  <ConnectionPractice
                    key={`quiz-connection:${currentQuizCard.id}:${quizRound}:${quizIndex}:${quizConnectionReverse}`}
                    card={currentQuizCard}
                    answers={quizConnectionAnswers}
                    checked={quizConnectionChecked}
                    reverse={quizConnectionReverse}
                    onChange={updateQuizConnectionAnswer}
                    onSubmit={gradeQuizConnection}
                    onContinue={finishQuizConnection}
                  />
                ) : <>
                <section className="quiz-question-panel">
                  <div className="card-meta session-card-meta">
                    <div className="session-card-meta-line">
                      <div className="quiz-meta-badges">
                        <SubjectBadge subject={currentQuizCard.subject} subjects={subjects} />
                        <ContentTypeBadge value={currentQuizCard.contentType} />
                        <MistakeCountBadge count={currentQuizCard.incorrectCount} />
                        <Badge className={currentQuizItem.reason === "archive-review" ? "archive-review-badge" : currentQuizKeywordReview ? "weak-keyword-badge" : "review-gap-badge"}>
                          {currentQuizItem.reason === "archive-review" ? <Archive /> : currentQuizKeywordReview ? <KeyRound /> : <BrainCircuit />}
                          {currentQuizItem.reason === "archive-review" ? "보관 복습" : currentQuizKeywordReview ? "키워드 집중 복습" : "맞춤 추천"}
                        </Badge>
                      </div>
                      <div className="question-card-actions quiz-card-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className={`study-importance-button${currentQuizCard.importance >= 2 ? " is-important" : ""}`}
                        aria-label={currentQuizCard.importance >= 2 ? "중요 표시 해제" : "중요 카드로 표시"}
                        aria-pressed={currentQuizCard.importance >= 2}
                        onClick={() => void toggleCardImportance(currentQuizCard)}
                      ><Star fill={currentQuizCard.importance >= 2 ? "currentColor" : "none"} /></Button>
                      {quizChecked && <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(currentQuizCard)}><Pencil /> 편집</Button>}
                      </div>
                    </div>
                    <span className="section-path">{currentQuizCard.section}{currentQuizCard.subsection ? ` › ${currentQuizCard.subsection}` : ""}{currentQuizCard.detailSection ? ` › ${currentQuizCard.detailSection}` : ""}</span>
                  </div>
                  <p className={currentQuizTable ? "table-session-title" : undefined}><QuestionContent card={currentQuizCard} hiddenKeywords={currentQuizKeywords.map((part) => part.keyword)} revealedKeywords={quizQuestionRevealedKeywords} /></p>
                </section>
                <section className={`quiz-answer-panel${quizChecked ? " is-checked" : ""}${currentQuizTable ? " is-table-session" : ""}`}>
                  <div className="quiz-answer-heading">
                    <KeywordAnswerLabel result={quizChecked ? quizAllCorrect ? "correct" : "incorrect" : null} label={currentQuizKeywordReview ? "약한 키워드만 다시 쓰기" : "핵심 키워드 채우기"} />
                    {quizRound === "main" && !quizChecked && !currentQuizKeywordReview && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="quiz-hint-button"
                        onMouseDown={(event) => event.preventDefault()}
                        aria-keyshortcuts="Control+Enter Meta+Enter"
                        title={`${currentQuizHintTargetStage === 1 ? "첫 음절" : "초성"} 힌트 (Ctrl/⌘+Enter)`}
                        disabled={!quizHasUnresolvedKeyword || currentQuizHintTargetIndex < 0}
                        onClick={() => revealQuizHint()}
                      ><Lightbulb /> 힌트</Button>
                    )}
                    {quizRound === "retry" && currentQuizUsedHint && !quizChecked ? (
                      <span className="quiz-retry-hint-note"><Lightbulb /> 힌트 없이 다시 확인</span>
                    ) : null}
                  </div>
                  {quizChecked && currentQuizCorrectionKeywords.length > 0 ? (
                    <QuizCloze
                      key={`quiz:${quizSessionRevision}:${currentQuizCard.id}:${quizRound}:${quizIndex}`}
                      card={currentQuizCard}
                      tableTabOrder={tableTabOrder}
                      partsOverride={currentQuizCorrectionParts}
                      orderIndependentOverride={currentQuizCorrectionOrder}
                      answers={quizCorrectionAnswers}
                      checked={false}
                      autoFocusFirst
                      inputLabel="오답 수정"
                      correctionMode
                      matchFeedback
                      onChange={(index, value) => setQuizCorrectionAnswers((previous) => {
                        if (quizPausedRef.current) return previous;
                        const next = [...previous];
                        next[index] = value;
                        return next;
                      })}
                      onSubmit={() => undefined}
                    />
                  ) : <QuizCloze
                    key={`quiz:${quizSessionRevision}:${currentQuizCard.id}:${quizRound}:${quizIndex}`}
                    card={currentQuizCard}
                    tableTabOrder={tableTabOrder}
                    partsOverride={currentQuizParts}
                    answers={quizAnswers}
                    checked={quizChecked}
                    autoFocusFirst
                    hints={quizRound === "main" ? currentQuizHints : {}}
                    matchFeedback
                    onChange={updateQuizAnswer}
                    onFocusIndex={setQuizFocusedBlankIndex}
                    onHint={quizRound === "main" && !currentQuizKeywordReview ? revealQuizHint : undefined}
                    onSubmit={gradeQuiz}
                  />}
                  {!quizChecked ? (
                    <Button size="lg" onClick={() => gradeQuiz()} disabled={!quizAllFilled}>
                      채점하기 <ChevronRight />
                    </Button>
                  ) : (
                    <div className={`quiz-feedback keyword-review-actions ${quizAllCorrect ? "is-correct" : "is-incorrect"}`}>
                      <KeywordReviewMaterials card={currentQuizCard} />
                        {currentQuizKeywordReview && (
                          <p className="sr-only">키워드 기록만 갱신하며 카드 전체의 정답·오답 횟수는 바꾸지 않아요.</p>
                        )}
                        {currentQuizCorrectionKeywords.length > 0 && (
                          <p className="sr-only" role="status">{quizCorrectionsComplete ? "다시 쓰기 완료! 다음으로 넘어갈 수 있어요." : "회색 정답을 보며 틀린 키워드 전체를 다시 써주세요."}</p>
                        )}
                      <Button ref={quizNextButtonRef} size="lg" aria-keyshortcuts="Enter" disabled={!quizCorrectionsComplete} onClick={() => nextQuizQuestion()}>{quizIndex + 1 >= quizItems.length ? quizRound === "main" && quizRetryItems.length ? "재도전 시작" : "결과 보기" : "다음 문제"} <ChevronRight /></Button>
                    </div>
                  )}
                </section>
                </>}
              </article>
            </section>
          ) : (
            <section className="no-result"><p>퀴즈 카드를 불러오지 못했어요.</p><Button variant="outline" onClick={startQuiz}>다시 뽑기</Button></section>
          )}
        </TabsContent>

        <TabsContent value="study" className="tab-page study-page">
          {!subject && (
            <TabPageHeading
              eyebrow="START STUDY"
              title="어떤 과목을 공부할까요?"
              description="과목을 고르면 그 과목의 스제트만 바로 시작해요."
              addLabel="카드 추가하기"
              onAdd={() => openBulkCreate()}
            />
          )}
          {loadError ? (
            <section className="error-state"><p>{loadError}</p><Button variant="outline" onClick={() => void loadCards()}><RotateCcw /> 다시 불러오기</Button></section>
          ) : loading ? (
            <section className="loading-card"><div /><div /><div /></section>
          ) : !subject ? (
            <SubjectChooser subjects={subjects} cards={cards} sets={sets} dailyStats={dailyStats} onSelect={chooseSubject} onSelectSets={() => setMainTab("sets")} />
          ) : (
            <>
              <section className="study-toolbar">
                <div className="selected-subject-row">
                  <Button variant="ghost" className="selected-subject" onPointerDown={event => event.preventDefault()} onClick={leaveStudySelection}>
                    <ArrowLeft /> <span><small>{activeStudySet ? "비교 세트" : subject === IMPORTANT_VIEW || subject === INCORRECT_VIEW || subject === ARCHIVED_VIEW ? "따로 모아보기" : "선택한 과목"}</small><strong>{activeStudySet?.name ?? (subject === IMPORTANT_VIEW ? "중요 카드" : subject === INCORRECT_VIEW ? "오답 카드" : subject === ARCHIVED_VIEW ? "보관함" : subject)}</strong></span>
                  </Button>
                  <div className="study-heading-actions">
                    {!activeStudySet && subject !== SELECTED_SETS_VIEW && subject !== IMPORTANT_VIEW && subject !== INCORRECT_VIEW && subject !== ARCHIVED_VIEW && (
                      <div className="daily-summary-controls"><DaySettingButton /><Button
                        type="button"
                        variant="outline"
                        className="subject-stats-button daily-stats-button"
                        onClick={() => setStatsSubject(subject)}
                        aria-label={`${subject} 오늘 학습 통계 보기`}
                      >
                        <DailyStatsReadout count={dailyStats ? activeSubjectDailyStats?.learnedCardCount ?? 0 : undefined} accuracy={activeSubjectDailyStats?.accuracy} />
                      </Button></div>
                    )}
                    <StudyModeSwitch mode={studySessionMode} disabled={studyStarted && !studyFinished} onCheckedChange={changeStudySessionMode} />
                    {subject !== ARCHIVED_VIEW && subject !== SELECTED_SETS_VIEW && <Button type="button" className="heading-add" size="icon" aria-label="카드 정리하고 추가하기" onClick={() => openBulkCreate(activeStudySet?.subject ?? subject)}><Plus /></Button>}
                  </div>
                </div>
                {!activeStudySet && subject !== SELECTED_SETS_VIEW && <div className="filter-row" data-mobile-back-swipe-ignore>
                  <Select value={section} onValueChange={(value) => requestSessionExit(() => { resetStudy(); setSection(value); })}>
                    <SelectTrigger className="filter-select"><SelectValue placeholder="섹션" /></SelectTrigger>
                    <SelectContent><SelectItem value="all">전체 섹션</SelectItem>{sections.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                  </Select>
                  {subject !== IMPORTANT_VIEW && (
                    <Select value={importance} onValueChange={(value) => requestSessionExit(() => { resetStudy(); setImportance(value); })}>
                      <SelectTrigger className="filter-select importance-filter"><Star /><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">전체 카드</SelectItem><SelectItem value="important">★ 중요만</SelectItem><SelectItem value="normal">일반만</SelectItem></SelectContent>
                    </Select>
                  )}
                  <Select value={reviewOrder} onValueChange={(value) => requestSessionExit(() => { resetStudy(); setReviewOrder(value); })}>
                    <SelectTrigger className="filter-select review-filter"><RotateCcw /><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="saved">기본 순서</SelectItem>
                      <SelectItem value="incorrect">오답만</SelectItem>
                      <SelectItem value="most-wrong">많이 틀린 순</SelectItem>
                    </SelectContent>
                  </Select>
                </div>}

                <div className="study-mode-row">
                  <Tabs value="writing" onValueChange={(value) => {
                    if (value === "view") {
                      if (window.matchMedia("(max-width: 759px)").matches) openMobileCards();
                      else openFlowTable();
                    }
                  }} className="study-mode-tabs">
                    <TabsList className="mode-tabs">
                      <TabsTrigger value="writing"><Pencil /> 쓰기</TabsTrigger>
                      <TabsTrigger value="view" disabled={!flowCards.length}><BookOpen /> 보기</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </section>

              {(filtered.length > 0 || subject === INCORRECT_VIEW) && !studyStarted ? (
                <section className="study-start">
                  <div className="study-start-card">
                    <span className="study-start-icon"><BookOpen /></span>
                    <div>
                      <span className="eyebrow">READY TO STUDY</span>
                      <h1>어디서 시작할까요?</h1>
                      <p>{filtered.length}장의 카드가 준비됐어요. 단계별 학습은 키워드 3회 → 전체 쓰기 2회 순서로 진행해요.</p>
                    </div>
                    <div className={`study-start-buttons${subject === INCORRECT_VIEW ? " has-today-review" : ""}`}>
                      {subject === INCORRECT_VIEW && <Button size="lg" variant="secondary" disabled={!todayReviewCardIds.length} onClick={startTodayReview}><RotateCcw /> 오늘 복습</Button>}
                      <Button size="lg" variant="outline" disabled={!resumeCardId} onClick={() => resumeCardId && startStudyAt(resumeCardId, resumeSequenceIds, resumeSessionMode)}><Clock3 /> 이어하기</Button>
                      <Button size="lg" disabled={!filtered.length} onClick={() => filtered[0] && startStudyAt(filtered[0].id)}><RotateCcw /> 처음부터</Button>
                    </div>
                    {subject === INCORRECT_VIEW && <small>{todayReviewCardIds.length ? `오늘 틀리고 아직 맞히지 못한 카드 ${todayReviewCardIds.length}장` : dailyStats ? "오늘 다시 풀 오답이 없어요." : "오늘의 풀이 기록을 확인하고 있어요."}</small>}
                    <Button size="lg" variant="secondary" className="start-order-button" disabled={!filtered.length} onClick={openStartOrderChooser}><Rows3 /> 학습 범위 정하기 <ChevronRight /></Button>
                    {!resumeCardId && <small>아직 이어갈 학습 위치가 없어요.</small>}
                  </div>
                </section>
              ) : studyFinished ? (
                <section className="study-complete">
                  <div className="study-complete-icon"><Check /></div>
                  <span className="eyebrow">{todayReview ? "TODAY'S REVIEW" : studyRound === "mistake-review" ? "RETRY COMPLETE" : "STUDY COMPLETE"}</span>
                  <h1>{todayReview ? "오늘 복습을 마쳤어요" : studyRound === "mistake-review" ? "재도전을 마쳤어요" : "학습을 모두 마쳤어요"}</h1>
                  <p>
                    {todayReview ? `오늘 복습 대상 ${studySequenceCards.length}장을 모두 맞혔어요.` : studyRound === "mistake-review"
                      ? `재도전 대상 ${studySequenceCards.length}장의 카드를 다시 풀었어요.`
                      : `이번 학습에서 ${studySequenceCards.length}장의 카드를 한 번씩 복습했어요.`}
                  </p>
                  <div className="study-complete-actions">
                    {studyRound === "main" && sessionIncorrectCardIds.length > 0 && (
                      <Button size="lg" className="mistake-review-button" disabled={startingMistakeReview} onClick={() => void startMistakeReview()}>
                        <RotateCcw /> {startingMistakeReview ? "재도전 준비 중…" : `재도전 ${sessionIncorrectCardIds.length}장 시작`}
                      </Button>
                    )}
                    <div className="study-complete-secondary-actions">
                      <Button size="lg" variant="outline" onClick={() => { resetStudy(); setSubject(""); }}><ArrowLeft /> 홈으로 나가기</Button>
                      {todayReview ? <Button size="lg" onClick={resetStudy}>오답 카드로 돌아가기 <ChevronRight /></Button>
                        : <Button size="lg" variant={studyRound === "main" && sessionIncorrectCardIds.length > 0 ? "outline" : "default"} onClick={() => filtered[0] && startStudyAt(filtered[0].id)}><RotateCcw /> 전체 다시 학습</Button>}
                    </div>
                  </div>
                </section>
              ) : current ? (
                <section className="study-area">
                  <div className="study-progress-row">
                    <Button variant="ghost" className="mobile-session-back" aria-label="학습 나가기" onPointerDown={event => event.preventDefault()} onClick={leaveStudySelection}><ArrowLeft /><span>{activeStudySet?.name ?? (subject === IMPORTANT_VIEW ? "중요 카드" : subject === INCORRECT_VIEW ? "오답 카드" : subject === ARCHIVED_VIEW ? "보관함" : subject)}</span></Button>
                    <div className="session-progress-summary"><span>{todayReview ? `${studiedCardIds.length}/${studySequenceCards.length}장 정답` : `${studiedCardIds.length + 1}/${studySequenceCards.length}`}</span><span className="learning-stage-label">{todayReview ? "오늘 복습" : learningStageLabel(current)}</span></div>
                    <Progress value={progress} />
                    <div className="study-progress-meta">
                      <span>{studyConnectionActive ? "질문 연결" : importanceLabel[normalizeImportance(current.importance)]}</span>
                      {!answered && !studyConnectionActive && studyKeywordMode && studyHintAllowed(studySessionMode, studyRound) && <Button type="button" variant="outline" className="mobile-session-hint" disabled={studyPaused || currentStudyEvaluations.every(item => item.matched)} onMouseDown={event => event.preventDefault()} onClick={() => revealStudyHint()}><Lightbulb /> 힌트</Button>}
                      {studySessionMode === "real" && !todayReview && <StudyClockControl seconds={studySecondsLeft} phase={studyConnectionActive ? "연결" : answered ? "정답" : "문제"}
                        paused={studyPaused} untimed={studyConnectionActive || answered} blocked={dialogOpen || bulkOpen || Boolean(sectionAnnouncement)} onPause={pauseStudy} onResume={resumeStudy} />}
                    </div>
                  </div>

                  <article inert={studyPaused} className={`study-card${studyConnectionActive ? " is-connection" : ""}${currentStudyTable && !studyConnectionActive ? " is-table-session" : ""}${wrongLevelClass(current.incorrectCount)}`}>
                    {studyConnectionActive ? (
                      <ConnectionPractice
                        key={`study-connection:${current.id}:${studyRound}:${studyConnectionReverse}`}
                        card={current}
                        answers={studyConnectionAnswers}
                        checked={studyConnectionChecked}
                        reverse={studyConnectionReverse}
                        onChange={updateStudyConnectionAnswer}
                        onSubmit={gradeStudyConnection}
                        onContinue={finishStudyConnection}
                      />
                    ) : <>
                    <section className="question-panel">
                      <div className="question-panel-top">
                        <div className="card-meta session-card-meta">
                          <div className="session-card-meta-line">
                            <SubjectBadge subject={current.subject} subjects={subjects} />
                            <ContentTypeBadge value={current.contentType} />
                            <MistakeCountBadge count={current.incorrectCount} />
                            {activeStudySet && <Badge className="set-study-badge"><FolderHeart /> {activeStudySet.name}</Badge>}
                          </div>
                          <span className="section-path">{current.section}{current.subsection ? ` › ${current.subsection}` : ""}{current.detailSection ? ` › ${current.detailSection}` : ""}</span>
                        </div>
                        <div className="question-card-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className={`study-importance-button${current.importance >= 2 ? " is-important" : ""}`}
                            aria-label={current.importance >= 2 ? "중요 표시 해제" : "중요 카드로 표시"}
                            aria-pressed={current.importance >= 2}
                            onClick={() => void toggleCardImportance(current)}
                          ><Star fill={current.importance >= 2 ? "currentColor" : "none"} /></Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => openSetCreateForCard(current)}><FolderHeart /> 연결</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(current)}><Pencil /> 편집</Button>
                        </div>
                      </div>
                      {currentStudyTable ? <p className="table-session-title"><QuestionContent card={current} hiddenKeywords={currentStudyKeywords.map((part) => part.keyword)} revealedKeywords={studyQuestionRevealedKeywords} guidedPractice={studySessionMode === "practice"} /></p> : <StudyQuestionText text={current.question} format={current.questionFormat} images={current.media?.question} hiddenKeywords={currentStudyKeywords.map((part) => part.keyword)} revealedKeywords={studyQuestionRevealedKeywords} guidedPractice={studySessionMode === "practice"} />}
                    </section>

                    <section className={`answer-panel ${answered ? "is-visible" : ""}${currentStudyTable ? " is-table-session" : ""}`}>
                      {studyGuidedFull ? (
                        <GuidedFullPractice key={`guided-full:${current.id}:${studyRound}:${studyRewriteMode}`} card={current} completed={answered} onComplete={completeGuidedFullPractice} autoFocus={studyAnswerAutoFocus} tableTabOrder={tableTabOrder} />
                      ) : mode === "reveal" ? (
                        <div
                          className={`study-keyword-mode${answered && currentStudyKeywords.length > 0 ? " is-answered" : ""}${currentStudyTable ? " is-table-session" : ""}`}
                        >
                          <div className="quiz-answer-heading">
                            <KeywordAnswerLabel result={answered && currentStudyKeywords.length > 0 ? suggestedResult : null} />
                            {!answered && currentStudyKeywords.length > 0 && studySessionMode === "real" && studyHintAllowed(studySessionMode, studyRound) && (
                              <Button type="button" variant="outline" size="sm" className="quiz-hint-button" onMouseDown={(event) => event.preventDefault()} aria-keyshortcuts="Control+Enter Meta+Enter" title="힌트 (Ctrl/⌘+Enter)" onClick={() => revealStudyHint()} disabled={currentStudyEvaluations.every((item) => item.matched)}><Lightbulb /> 힌트</Button>
                            )}
                          </div>
                          {currentStudyKeywords.length > 0 ? (
                            <>
                              <div className={`study-keyword-attempt${answered ? answerDensityClass(current.answer) : ""}`}>
                                {answered && studyCorrectionKeywords.length > 0 ? <QuizCloze
                                  key={`study:${current.id}:${studyRound}:${todayReviewTurn}`}
                                  card={current}
                                  tableTabOrder={tableTabOrder}
                                  partsOverride={studyCorrectionParts}
                                  orderIndependentOverride={studyCorrectionOrder}
                                  answers={studyCorrectionAnswers}
                                  checked={false}
                                  autoFocusFirst={!sectionAnnouncement && !dialogOpen && !bulkOpen}
                                  inputLabel="오답 수정"
                                  correctionMode
                                  studyReview
                                  matchFeedback
                                  onChange={(index, value) => {
                                    if (studyPausedRef.current) return;
                                    setStudyCorrectionAnswers((previous) => {
                                      const next = [...previous];
                                      next[index] = value;
                                      return next;
                                    });
                                  }}
                                  onSubmit={() => undefined}
                                /> : <QuizCloze
                                  key={`study:${current.id}:${studyRound}:${todayReviewTurn}`}
                                  card={current}
                                  tableTabOrder={tableTabOrder}
                                  partsOverride={currentStudyParts}
                                  orderIndependentOverride={currentStudyOrder}
                                  answers={studyKeywordAnswers}
                                  checked={answered}
                                  studyReview
                                  autoFocusFirst={!sectionAnnouncement && !dialogOpen && !bulkOpen}
                                  hints={studyHints}
                                  guidedPractice={studySessionMode === "practice"}
                                  matchFeedback
                                  onChange={updateStudyKeywordAnswer}
                                  onFocusIndex={setStudyFocusedBlankIndex}
                                  onHint={studySessionMode === "real" && studyHintAllowed(studySessionMode, studyRound) ? revealStudyHint : undefined}
                                  onSubmit={gradeStudyKeywords}
                                  mobileSubmitOnLast={Boolean(currentStudyTable)}
                                />}
                              </div>
                              {!answered && studySessionMode === "real" && (
                                <Button size="lg" onClick={() => gradeStudyKeywords()} disabled={!studyKeywordsAllFilled}>채점하기 <ChevronRight /></Button>
                              )}
                              {answered && (
                                <>
                                  {studyCorrectionKeywords.length > 0 && <p className="sr-only" role="status">{studyCorrectionsComplete ? "다시 쓰기 완료! 다음으로 넘어갈 수 있어요." : "회색 정답을 보며 틀린 키워드 전체를 다시 써주세요."}</p>}
                                  <KeywordReviewMaterials card={current} />
                                </>
                              )}
                            </>
                          ) : answered ? (
                            <div className={`answer-copy${answerDensityClass(current.answer)}`}><AnswerJudgment result={null} /><p><AnswerContent card={current} /></p><AnswerMemo memo={current.memo} images={current.media?.memo} /></div>
                          ) : (
                            <div className="study-keyword-empty">
                              <p>핵심 키워드가 없는 카드예요. 단계별 보관을 진행하려면 편집에서 답의 핵심 부분을 볼드체로 지정해 주세요. 지금은 정답을 비교하며 복습할 수 있어요.</p>
                              <Button size="lg" onClick={revealStudyAnswerWithoutKeywords}>정답 확인하기 <ChevronRight /></Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div
                          className={`write-mode${answered ? " is-answered" : ""}`}
                          style={answered && currentPaneFractions ? {
                            gridTemplateRows: `minmax(0, ${currentPaneFractions.user}fr) minmax(0, ${currentPaneFractions.judgment}fr)`,
                          } : undefined}
                        >
                          <div className={`typed-area${answered ? answerDensityClass(typedAnswer) : ""}${answered && studySessionMode === "practice" ? " is-returnable" : ""}`}>
                            <span className="typed-answer-heading">
                              <span className="answer-label">내 답</span>
                              {!answered && <small className="desktop-shortcut-help">Enter로 확인 · Shift+Enter로 줄바꿈</small>}
                            </span>
                            <div className="typed-input-wrap">
                              {currentStudyTable ? <FullTableWriting key={`${current.id}:${todayReviewTurn}`} card={current} values={fullTableAnswers} onChange={(values, answer) => { if (studyPausedRef.current) return; setFullTableAnswers(values); setTypedAnswer(answer); }} disabled={answered || studyPaused} autoFocus={studyAnswerAutoFocus} tableTabOrder={tableTabOrder} /> : <Textarea
                                ref={typedAnswerRef}
                                value={typedAnswer}
                                onChange={(e) => { if (!studyPausedRef.current) setTypedAnswer(e.target.value); }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                                  event.preventDefault();
                                  showWrittenAnswer();
                                }}
                                placeholder="떠오르는 답을 직접 써보세요."
                                className="typed-textarea"
                                disabled={answered || studyPaused}
                              />}
                              {answered && studySessionMode === "practice" && (
                                <button type="button" className="typed-return-overlay" aria-label="내 답을 다시 쓰기" onClick={returnToWriting}>
                                  <span aria-hidden="true"><RotateCcw /></span>
                                </button>
                              )}
                            </div>
                            {!answered && <Button size="lg" onClick={() => showWrittenAnswer()} disabled={!studyRewriteMode && !typedAnswer.trim()}>{studyRewriteMode ? "확인하기" : "정답과 비교하기"} <ChevronRight /></Button>}
                          </div>
                          {answered && (
                            <div className={`comparison-answer${answerDensityClass(current.answer)}`}>
                              <span className="comparison-answer-heading"><AnswerJudgment result={suggestedResult} />{studySessionMode === "practice" && <small className="desktop-shortcut-help">Esc로 다시 쓰기</small>}</span>
                              <p className="full-write-proposal">키워드 {currentKeywordMatches.filter(item => item.matched).length}/{currentKeywordMatches.length}개 확인 · 내용을 비교한 뒤 아래에서 결과를 확정해 주세요.</p>
                              <div>
                                {currentStudyTable ? <AnswerContent card={current} /> : currentKeywordMatches.length > 0
                                  ? <QuizGradedAnswer card={current} evaluations={currentKeywordMatches.map(({ keyword, matched }) => ({ expectedKeyword: keyword, matched }))} />
                                  : <AnswerContent card={current} />}
                              </div>
                              <AnswerMemo memo={current.memo} images={current.media?.memo} />
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                    </>}
                  </article>

                  {answered && !studyConnectionActive && (
                    <div className="result-actions">
                      {studySessionMode === "practice" ? (
                        <Button ref={suggestedResultButtonRef} size="lg" disabled={studyKeywordMode && !studyCorrectionsComplete} onClick={() => record("correct")}>다음으로 <ChevronRight /></Button>
                      ) : studyKeywordMode ? (
                        <Button ref={suggestedResultButtonRef} size="lg" disabled={!studyCorrectionsComplete} onClick={() => record(decisionSuggestedResult ?? "incorrect")}>
                          {studyCorrectionsComplete ? "다음으로" : "틀린 키워드를 다시 써주세요"} <ChevronRight />
                        </Button>
                      ) : decisionSuggestedResult ? (
                        <>
                          <Button variant="outline" size="lg" onClick={() => record(decisionSuggestedResult === "correct" ? "incorrect" : "correct")}>
                            {decisionSuggestedResult === "correct" ? <X /> : <Check />} {decisionSuggestedResult === "correct" ? "오답으로 변경" : "정답으로 인정"}
                          </Button>
                          <Button ref={suggestedResultButtonRef} variant={decisionSuggestedResult === "incorrect" ? "destructive" : "default"} size="lg" onClick={() => record(decisionSuggestedResult)}>
                            {decisionSuggestedResult === "correct" ? <Check /> : <X />} {decisionSuggestedResult === "correct" ? "정답으로 다음" : "오답으로 다음"}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="outline" size="lg" onClick={() => record("incorrect")}><X /> 틀렸어요</Button>
                          <Button size="lg" onClick={() => record("correct")}><Check /> 맞았어요</Button>
                        </>
                      )}
                    </div>
                  )}
                </section>
              ) : (
                <section className="no-result">
                  <p>{scopedCards.length ? "이 조건에 맞는 카드가 없어요." : activeStudySet ? "이 세트에 남아 있는 카드가 없어요." : subject === IMPORTANT_VIEW ? "중요 표시한 카드가 아직 없어요." : subject === INCORRECT_VIEW ? "틀린 카드가 아직 없어요." : subject === ARCHIVED_VIEW ? "보관한 카드가 아직 없어요." : `${subject} 스제트가 아직 없어요.`}</p>
                  {scopedCards.length > 0 && <Button variant="outline" onClick={() => { setSection("all"); setImportance("all"); setReviewOrder(subject === INCORRECT_VIEW ? "most-wrong" : "saved"); resetStudy(); }}>필터 초기화</Button>}
                </section>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="cards" className="tab-page cards-page">
          <TabPageHeading eyebrow="MY CARDS" title="내 스제트" description="표에 질문과 답을 연속으로 입력하세요." addLabel="카드 추가하기" onAdd={() => openBulkCreate()} />
          <div className="library-search">
            <Search aria-hidden="true" />
            <Input
              type="search"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
              placeholder="질문·답·메모 검색"
              aria-label="카드 검색"
              autoComplete="off"
            />
            {libraryQuery && <Button type="button" variant="ghost" size="icon-sm" aria-label="검색어 지우기" onClick={() => setLibraryQuery("")}><X /></Button>}
          </div>
          <div className="library-filter-row">
            <Tabs value={libraryView} onValueChange={setLibraryView} className="library-filter-tabs">
              <TabsList>
                <TabsTrigger value="all">전체 {cards.filter((card) => !card.archivedAt).length}</TabsTrigger>
                <TabsTrigger value="important"><Star fill="currentColor" /> 중요 {cards.filter((card) => !card.archivedAt && card.importance >= 2).length}</TabsTrigger>
                <TabsTrigger value="incorrect"><RotateCcw /> 오답 {cards.filter((card) => !card.archivedAt && card.incorrectCount > 0).length}</TabsTrigger>
                <TabsTrigger value="archived"><Archive /> 보관 {cards.filter((card) => card.archivedAt).length}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="library-filter-selects">
              <Select value={librarySubject} onValueChange={setLibrarySubject}>
                <SelectTrigger className="library-subject-select" aria-label="카드 과목 선택"><span className="library-filter-kind">과목</span><SelectValue placeholder="전체 과목" /></SelectTrigger>
                <SelectContent className="library-subject-menu" position="popper" side="bottom" align="start" sideOffset={4} avoidCollisions={false}>
                  <SelectItem value="all">전체 과목</SelectItem>
                  {librarySubjects.map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {libraryView === "archived" && (
            <div className="archive-guide">
              <BrainCircuit aria-hidden="true" />
              <p><strong>보관 복습 기준</strong><span>힌트 없이 키워드 연속 3회, 전체 쓰기 연속 2회를 마치면 자동 보관하고, 1·3·7·14일 간격으로 다시 확인해요. 이후에는 14일마다 복습하며, 틀리면 학습 목록으로 돌아옵니다.</span></p>
            </div>
          )}
          {loading ? (
            <section className="loading-card"><div /><div /><div /></section>
          ) : cards.length === 0 ? (
            <EmptyStudy onAdd={() => openBulkCreate()} />
          ) : libraryCards.length === 0 ? (
            <section className="no-result"><p>{libraryQuery.trim() ? "검색 조건에 맞는 카드가 없어요." : librarySubject !== "all" ? "이 과목에 해당하는 카드가 없어요." : libraryView === "important" ? "중요 표시한 카드가 아직 없어요." : libraryView === "incorrect" ? "오답 카드가 아직 없어요." : libraryView === "archived" ? "보관한 카드가 아직 없어요." : "카드가 아직 없어요."}</p></section>
          ) : (
            <div className="card-list">
              {libraryCards.map((card) => {
                const performance = studyStats.cardPerformance[String(card.id)];
                const accuracy = performance?.attempts
                  ? Math.round(((performance.attempts - performance.incorrect) / performance.attempts) * 100)
                  : null;
                const sectionParts = [card.section, card.subsection, card.detailSection].filter(Boolean);
                const tableDoc = readTable(card.answerFormat);
                return (
                <article
                  className={`library-card${wrongLevelClass(card.incorrectCount)}`}
                  key={card.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${card.question} 카드 자세히 보기`}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    setDetailCardId(card.id);
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                      event.preventDefault();
                      setDetailCardId(card.id);
                    }
                  }}
                >
                  <div className="library-meta">
                    <div className="library-meta-line">
                      <SubjectBadge subject={card.subject} subjects={subjects} />
                      <ContentTypeBadge value={card.contentType} />
                      <MistakeCountBadge count={card.incorrectCount} />
                      {card.importance >= 2 && <Badge className="important-badge"><Star fill="currentColor" /> 중요</Badge>}
                      {card.archivedAt && <Badge className="archive-review-badge"><Archive /> {archiveReviewLabel(card)}</Badge>}
                    </div>
                    <div className="library-section-path" aria-label={`섹션 ${sectionParts.join(" 다음 ")}`}>
                      {sectionParts.map((part, index) => (
                        <span className="library-section-part" key={`${index}-${part}`}>
                          {index > 0 && <b aria-hidden="true">›</b>}
                          <span>{part}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <h2><QuestionContent card={card} /></h2>
                  {tableDoc ? <div className="library-table-preview"><TableAnswer doc={tableDoc} buttonOnly /></div> : <p><AnswerContent card={card} /></p>}
                  {(card.memo || !!card.media?.memo.length) && <div className="library-memo"><BookOpen /><p><MemoContent card={card} /></p></div>}
                  <footer><span className="library-card-stats"><small>누적 정답 {card.correctCount} · 오답 {card.incorrectCount}</small><strong>{performance ? `실전 정답률 ${accuracy}% · 평균 ${formatDuration(performance.averageDurationMs)}` : "실전 기록 없음"}</strong></span><div><Button variant="ghost" size="icon-sm" className={card.archivedAt ? "archive-button is-archived" : "archive-button"} aria-label={card.archivedAt ? "보관함에서 꺼내기" : "보관함에 넣기"} aria-pressed={Boolean(card.archivedAt)} onClick={() => void toggleCardArchived(card)}>{card.archivedAt ? <ArchiveRestore /> : <Archive />}</Button><Button variant="ghost" size="icon-sm" className={card.importance >= 2 ? "star-button is-important" : "star-button"} aria-label={card.importance >= 2 ? "중요 표시 해제" : "중요 표시"} aria-pressed={card.importance >= 2} onClick={() => void toggleCardImportance(card)}><Star fill={card.importance >= 2 ? "currentColor" : "none"} /></Button><Button variant="ghost" size="icon-sm" aria-label="수정" onClick={() => openEdit(card)}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label="삭제" onClick={() => setDeleting(card)}><Trash2 /></Button></div></footer>
                </article>
              )})}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sets" className="tab-page sets-page">
          <TabPageHeading eyebrow="COMPARE SETS" title="비교 세트" description={setStudySelecting ? "학습할 세트를 선택하세요." : "헷갈리는 카드를 묶어서 이어서 공부하세요."} action={<Button className="set-study-action" data-action={setStudySelecting ? selectedLearningSetIds.length ? "start" : "cancel" : "learn"} onClick={handleSetStudyAction}><LibraryBig />{setStudySelecting ? selectedLearningSetIds.length ? "시작" : "취소" : "학습"}</Button>} />
          <div className="library-search">
            <Search aria-hidden="true" />
            <Input
              type="search"
              value={setFilterQuery}
              onChange={(event) => setSetFilterQuery(event.target.value)}
              placeholder="세트명·메모·카드 내용 검색"
              aria-label="세트 검색"
              autoComplete="off"
            />
            {setFilterQuery && <Button type="button" variant="ghost" size="icon-sm" aria-label="세트 검색어 지우기" onClick={() => setSetFilterQuery("")}><X /></Button>}
          </div>
          <div className="library-filter-row set-filter-row">
            <div className="library-filter-selects">
              <Select value={setFilterSubject} onValueChange={setSetFilterSubject}>
                <SelectTrigger className="library-subject-select" aria-label="세트 과목 선택"><span className="library-filter-kind">과목</span><SelectValue placeholder="전체 과목" /></SelectTrigger>
                <SelectContent className="library-subject-menu" position="popper" side="bottom" align="start" sideOffset={4} avoidCollisions={false}>
                  <SelectItem value="all">전체 과목</SelectItem>
                  {setLibrarySubjects.map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {loading ? (
            <section className="loading-card"><div /><div /><div /></section>
          ) : sets.length === 0 ? (
            <section className="empty-state set-empty-state">
              <div className="empty-icon"><FolderHeart /></div>
              <h2>첫 비교 세트를 만들어볼까요?</h2>
              <p>헷갈리는 카드를 두 장 이상 골라 한 묶음으로 만들 수 있어요.</p>
              <Button size="lg" onClick={() => openSetCreate()}>세트 만들기</Button>
            </section>
          ) : librarySets.length === 0 ? (
            <section className="no-result"><p>{setFilterQuery.trim() ? "검색 조건에 맞는 세트가 없어요." : "이 과목에 해당하는 세트가 없어요."}</p></section>
          ) : (
            <div className="set-list">
              {librarySets.map((set) => {
                const memberCards = cards
                  .filter((card) => set.cardIds.includes(card.id))
                  .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
                return (
                  <article className={`set-library-card${setStudySelecting && selectedLearningSetIds.includes(set.id) ? " is-study-selected" : ""}`} key={set.id} role="button" tabIndex={0} aria-pressed={setStudySelecting ? selectedLearningSetIds.includes(set.id) : undefined} aria-label={`${set.name} ${setStudySelecting ? "학습 선택" : "모아보기"}`} onClick={() => chooseSet(set)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); chooseSet(set); } }}>
                    <header>
                      <div><SubjectBadge subject={set.subject} subjects={subjects} /><span>{memberCards.length}장</span></div>
                      <div hidden={setStudySelecting}>
                        <Button variant="ghost" size="icon-sm" aria-label={`${set.name} 수정`} onClick={(event) => { event.stopPropagation(); openSetEdit(set); }}><Pencil /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`${set.name} 삭제`} onClick={(event) => { event.stopPropagation(); setDeletingSet(set); }}><Trash2 /></Button>
                      </div>
                    </header>
                    <h2><FolderHeart /> {set.name}</h2>
                    {set.memo && <p className="set-library-memo">{set.memo}</p>}
                    <CompareSetCardList cards={memberCards} />
                  </article>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(detailCard)} onOpenChange={(open) => !open && setDetailCardId(null)}>
        <DialogContent className="card-detail-dialog max-w-4xl">
          {detailCard && (
            <>
              <DialogHeader className="pr-8 text-left">
                <div className="card-detail-meta">
                  <SubjectBadge subject={detailCard.subject} subjects={subjects} />
                  <ContentTypeBadge value={detailCard.contentType} />
                  <MistakeCountBadge count={detailCard.incorrectCount} />
                  <span>{detailCard.section}{detailCard.subsection ? ` › ${detailCard.subsection}` : ""}{detailCard.detailSection ? ` › ${detailCard.detailSection}` : ""}</span>
                  {detailCard.importance >= 2 && <Badge className="important-badge"><Star fill="currentColor" /> 중요</Badge>}
                  {detailCard.archivedAt && <Badge className="archive-review-badge"><Archive /> {archiveReviewLabel(detailCard)}</Badge>}
                </div>
                <DialogTitle>카드 전체 정보</DialogTitle>
                <DialogDescription>질문과 답, 학습 기록을 빠짐없이 보여줘요.</DialogDescription>
              </DialogHeader>

              <div className="card-detail-scroll">
                <section className="card-detail-copy">
                  <small>질문</small>
                  <div><QuestionContent card={detailCard} /></div>
                </section>
                <section className="card-detail-copy is-answer">
                  <small>답</small>
                  <div><AnswerContent card={detailCard} /></div>
                </section>
                {(detailCard.memo || !!detailCard.media?.memo.length) && (
                  <section className="card-detail-copy is-memo">
                    <small>메모</small>
                    <div><MemoContent card={detailCard} /></div>
                  </section>
                )}

                <section className="card-detail-stats" aria-label="카드 학습 통계">
                  <div><small>누적 정답</small><strong>{detailCard.correctCount}회</strong></div>
                  <div><small>현재 오답</small><strong>{detailCard.incorrectCount}회</strong></div>
                  <div><small>실전 정답률</small><strong>{detailCardPerformance?.attempts ? `${Math.round(((detailCardPerformance.attempts - detailCardPerformance.incorrect) / detailCardPerformance.attempts) * 100)}%` : "기록 없음"}</strong></div>
                  <div><small>평균 풀이 시간</small><strong>{detailCardPerformance ? formatDuration(detailCardPerformance.averageDurationMs) : "기록 없음"}</strong></div>
                  <div><small>질문 연결성</small><strong>{detailConnectionPerformance?.attempts ? `${detailConnectionPerformance.connectivity}% (${detailConnectionPerformance.connected}/${detailConnectionPerformance.attempts})` : "기록 없음"}</strong></div>
                  <div><small>마지막 학습</small><strong>{formatStudyDate(detailCard.lastReviewedAt)}</strong></div>
                </section>

                <section className="card-keyword-stats">
                  <header><div><KeyRound /><strong>키워드별 기록</strong></div><small>카드 오답 횟수와 별개이며 퀴즈 선정에만 사용해요.</small></header>
                  {detailCard.keywords.length ? (
                    <div className="card-keyword-stat-list">
                      {(isTableFormat(detailCard.answerFormat) ? tableKeywords(detailCard.answerFormat) : detailCard.keywords.map((keyword) => ({keyword,keywordKey:normalizeForMatch(keyword),cellId:""}))).map(({keyword,keywordKey,cellId}) => {
                        const performance = detailKeywordPerformance.find((item) => (item.keywordKey ?? normalizeForMatch(item.keyword)) === keywordKey);
                        const table = readTable(detailCard.answerFormat),cell = table?.cells.find((item)=>item.id===cellId);
                        return (
                          <div className="card-keyword-stat" key={keywordKey}>
                            <mark>{cell && table && <small>{table.rows.indexOf(cell.row)+1}행 {table.columns.indexOf(cell.column)+1}열 · </small>}{keyword}</mark>
                            <span><small>정답률</small><strong>{performance?.attempts ? `${performance.accuracy}%` : "기록 없음"}</strong></span>
                            <span><small>정답</small><strong>{performance?.correct ?? 0}/{performance?.attempts ?? 0}회</strong></span>
                            <span><small>오답</small><strong>{performance?.incorrect ?? 0}회</strong></span>
                          </div>
                        );
                      })}
                    </div>
                  ) : <div className="card-keyword-empty">굵게 지정된 핵심 키워드가 없어요.</div>}
                </section>
              </div>

              <DialogFooter className="card-detail-actions">
                <Button type="button" variant="destructive" onClick={() => { setDetailCardId(null); setDeleting(detailCard); }}><Trash2 /> 삭제</Button>
                <Button type="button" variant="outline" onClick={() => { setDetailCardId(null); void toggleCardArchived(detailCard); }}>{detailCard.archivedAt ? <ArchiveRestore /> : <Archive />} {detailCard.archivedAt ? "학습 목록으로" : "보관함으로"}</Button>
                <Button type="button" variant="outline" onClick={() => { setDetailCardId(null); openEdit(detailCard); }}><Pencil /> 수정</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {bulkOpen && <BulkCreateDialog layered={returnToFlowAfterBulkEdit} key={`${bulkSubject}-${bulkStartSetMode}-${editingSet?.id ?? "new"}-${linkingCardId ?? "none"}-${bulkOpen}`} open={bulkOpen} onOpenChange={handleBulkDialogOpenChange} initialSubject={bulkSubject} initialSet={editingSet} initialSelectedCardId={linkingCardId} startInSetMode={bulkStartSetMode} subjects={subjects} cards={cards} onSaved={saveBulkToList} onCardArchived={saveToList} onSetSaved={saveSetToList} onView={viewFromCardEditor} onMobileBackReady={registerBulkDialogMobileBack} />}
      {flowOpen && (
        <Dialog open={flowOpen} onOpenChange={(open) => { if (!bulkOpen && !dialogOpen) handleFlowOpenChange(open); }}>
          <DialogContent
            onEscapeKeyDown={(event) => {
              if (flowSetStep === "idle") return;
              event.preventDefault();
              event.stopPropagation();
              if (flowSetSaving) return;
              if (flowSetStep === "details") backToFlowSetSelection();
              else resetFlowSetBuilder();
            }}
            className={`flow-dialog${flowSetStep !== "idle" ? ` is-set-${flowSetStep}` : ""} max-h-[96dvh] w-[calc(100%-12px)] max-w-none overflow-hidden rounded-[22px] border-0 p-4 sm:w-[calc(100%-32px)] sm:max-w-[1120px] sm:p-7`}>
            {flowSetStep === "idle" && (
              <div className="flow-view-actions">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="flow-answer-visibility-button"
                  aria-label={flowAnswersHidden ? "모든 답 보기" : "모든 답 가리기"}
                  aria-pressed={flowAnswersHidden}
                  title={flowAnswersHidden ? "모든 답 보기" : "모든 답 가리기"}
                  onClick={toggleAllFlowAnswers}
                >
                  {flowAnswersHidden ? <Eye /> : <EyeOff />}
                </Button>
                {viewStudySet && <Button type="button" variant="ghost" size="sm" className="view-edit-button" onClick={editSetFromFlow}><Pencil /> 수정</Button>}
              </div>
            )}
            <DialogHeader className="pr-24 text-left">
              <DialogTitle>
                {flowSetStep === "select"
                  ? "세트에 넣을 카드 선택"
                  : flowSetStep === "details"
                    ? "세트 정보 입력"
                    : viewStudySet?.name ?? `${subject === IMPORTANT_VIEW ? "중요 카드" : subject === INCORRECT_VIEW ? "오답 카드" : subject === ARCHIVED_VIEW ? "보관함" : subject} 전체 흐름`}
              </DialogTitle>
              <DialogDescription>
                {flowSetStep === "select"
                  ? `${flowSetCardIds.length}장 선택됨 · 질문이나 답을 눌러 카드를 고르세요.`
                  : flowSetStep === "details"
                    ? `${flowSetCardIds.length}장을 묶을 제목과 설명을 적어 주세요.`
                    : viewStudySet ? "질문을 누르면 수정하고, 답을 누르면 가리거나 다시 볼 수 있어요." : "질문을 누르면 수정하고, 답을 누르면 가려요. Shift+클릭으로 세트에 넣을 카드를 선택하세요."}
              </DialogDescription>
            </DialogHeader>
            {flowSetStep !== "details" ? (
              <>
                <ContentTypeStripeLegend />
                <div ref={flowTableScrollRef} className="flow-table-shell">
                  <div className="flow-table-frame">
                  <Table className="flow-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="flow-question-head">질문</TableHead>
                        <TableHead>답 · 메모</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {flowCards.map((card, cardIndex) => {
                        const context = `${card.subject}|${card.section}|${card.subsection}|${card.detailSection}`;
                        const previous = flowCards[cardIndex - 1];
                        const previousContext = previous ? `${previous.subject}|${previous.section}|${previous.subsection}|${previous.detailSection}` : "";
                        const path = [card.section, card.subsection, card.detailSection].filter(Boolean).join(" › ");
                        const selectingSet = flowSetStep === "select";
                        const setSelected = flowSetCardIds.includes(card.id);
                        const answerHidden = selectingSet ? false : isFlowAnswerHidden(card.id);
                        const tableCard = !!readTable(card.answerFormat);
                        const question = (
                                <button
                                  type="button"
                                  className="flow-question-edit"
                                  aria-label={selectingSet ? `${card.question} 카드 ${setSelected ? "선택 해제" : "선택"}` : `${card.question} 카드 수정`}
                                  aria-pressed={selectingSet ? setSelected : undefined}
                                  title={selectingSet ? (setSelected ? "선택 해제" : "세트에 추가") : "질문 수정"}
                                  onClick={() => selectingSet ? toggleFlowSetCard(card) : openEditFromFlow(card)}
                                >
                                  {selectingSet && (
                                    <span className="flow-set-selection-mark" aria-hidden="true">
                                      {setSelected ? <Check /> : cardIndex + 1}
                                    </span>
                                  )}
                                  <p>
                                    <WrongCountSup count={card.incorrectCount} />
                                    <QuestionContent card={card} />
                                  </p>
                                </button>
                        );
                        const answer = (
                                <button
                                  type="button"
                                  className="flow-answer-toggle"
                                  aria-label={selectingSet ? `${card.question} 카드 ${setSelected ? "선택 해제" : "선택"}` : answerHidden ? "답 보기" : "답 다시 가리기"}
                                  aria-pressed={selectingSet ? setSelected : !answerHidden}
                                  title={selectingSet ? (setSelected ? "선택 해제" : "세트에 추가") : answerHidden ? "답 보기" : "답 가리기"}
                                  onClick={() => selectingSet ? toggleFlowSetCard(card) : toggleFlowAnswer(card.id)}
                                >
                                  {answerHidden ? (
                                    <span className="flow-answer-concealed"><EyeOff /><strong>눌러서 답 보기</strong></span>
                                  ) : (
                                    <div className="flow-answer-block">
                                      <p><AnswerContent card={card} /></p>
                                      {(card.memo || !!card.media?.memo.length) && (
                                        <div className="flow-memo-inline">
                                          <span>메모</span>
                                          <p><MemoContent card={card} /></p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </button>
                        );
                        return (
                          <Fragment key={`flow-${card.id}`}>
                            {context !== previousContext && (
                              <TableRow className="flow-section-row">
                                <TableCell colSpan={2}><strong>{path}</strong></TableCell>
                              </TableRow>
                            )}
                            <TableRow onClickCapture={(event) => selectFlowCard(event, card)} className={`flow-card-row ${contentTypeStripeClass(card.contentType)}${selectingSet ? " is-set-selecting" : ""}${setSelected ? " is-set-selected" : ""}`}>
                              {tableCard ? (
                                <TableCell colSpan={2} className="flow-table-card-cell">
                                  <div className="flow-table-card-title">{question}</div>
                                  <div className={`flow-table-card-answer${answerHidden ? " is-hidden" : ""}`}>{answer}</div>
                                </TableCell>
                              ) : <>
                                <TableCell className="flow-question-cell">{question}</TableCell>
                                <TableCell className={`flow-answer-cell${answerHidden ? " is-hidden" : ""}`}>{answer}</TableCell>
                              </>}
                            </TableRow>
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </div>
                {flowSetStep === "select" && (
                  <DialogFooter className="flow-set-footer">
                    <span className="flow-set-selection-count" aria-live="polite"><FolderHeart /><strong>{flowSetCardIds.length}장</strong> 선택</span>
                    <Button type="button" variant="outline" onClick={resetFlowSetBuilder}>취소</Button>
                    <Button type="button" disabled={flowSetCardIds.length < 2} onClick={continueFlowSetDetails}>저장</Button>
                  </DialogFooter>
                )}
              </>
            ) : (
              <form className="flow-set-details-form" onSubmit={createFlowSet}>
                <section className="flow-set-details">
                  <div className="flow-set-details-summary">
                    <span><FolderHeart /></span>
                    <div>
                      <strong>{selectedFlowSetCards[0]?.subject}</strong>
                      <small>{selectedFlowSetCards.length}장의 선택한 카드</small>
                    </div>
                  </div>
                  <label className="flow-set-field">
                    <span>제목</span>
                    <Input autoFocus value={flowSetName} maxLength={100} placeholder="예: 교육과정 핵심 비교" onChange={(event) => setFlowSetName(event.target.value)} />
                  </label>
                  <label className="flow-set-field">
                    <span>설명 <small>선택</small></span>
                    <Textarea value={flowSetMemo} maxLength={20000} placeholder="세트를 만든 목적이나 기억할 내용을 적어 두세요." onChange={(event) => setFlowSetMemo(event.target.value)} />
                  </label>
                </section>
                <DialogFooter className="flow-set-footer">
                  <Button type="button" variant="outline" disabled={flowSetSaving} onClick={backToFlowSetSelection}>뒤로</Button>
                  <Button type="submit" disabled={flowSetSaving || !flowSetName.trim()}>{flowSetSaving ? "만드는 중…" : "만들기"}</Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}
      {mobileCardsOpen && (
        <Dialog open={mobileCardsOpen} onOpenChange={(open) => { setMobileCardsOpen(open); if (!open) setMobileCardsJumpOpen(false); }}>
          <DialogContent
            ref={mobileCardsDialogRef}
            edgeToEdge
            className="mobile-cards-dialog max-w-none border-0 p-4"
          >
            <DialogHeader className="mobile-cards-heading pr-10 text-left">
              <DialogTitle>{viewStudySet?.name ?? "카드로 보기"}</DialogTitle>
              <DialogDescription>{mobileCardIndex + 1} / {mobileFlowItems.length} · 섹션 안내 카드와 함께 좌우로 넘겨보세요.</DialogDescription>
            </DialogHeader>
            <div ref={mobileCardsTrackRef} className="mobile-cards-track" onScroll={updateMobileCardIndex}>
              {mobileFlowItems.map((item) => {
                if (item.type === "section") {
                  const guideTitle = item.changeLevel === "section"
                    ? item.section || "미분류"
                    : item.changeLevel === "subsection"
                      ? item.subsection || "하부 없음"
                      : item.detailSection || "세부 없음";
                  const guideLabel = mobileFlowLevelLabel(item.changeLevel);
                  return (
                    <article className={`mobile-flow-section-card is-${item.changeLevel}`} key={item.id} aria-label={`${guideLabel} ${guideTitle} 안내`}>
                      <header>
                        <Badge variant="secondary">{item.subject}</Badge>
                        <span>{guideLabel}</span>
                      </header>
                      <section className="mobile-flow-section-copy">
                        <span className="mobile-flow-section-icon">
                          {item.changeLevel === "section" ? <Rows3 /> : item.changeLevel === "subsection" ? <CornerDownRight /> : <ChevronRight />}
                        </span>
                        <small>이어서 볼 {guideLabel}</small>
                        <h2 style={{ fontSize: `${mobileFlowTitleFontSize(guideTitle, item.changeLevel)}px` }}>{guideTitle}</h2>
                        <div className="mobile-flow-section-path">
                          <div className="is-section"><small>섹션</small><strong style={{ fontSize: `${mobileFlowTitleFontSize(item.section || "미분류", "section", 15, 176)}px` }}>{item.section || "미분류"}</strong></div>
                          {item.subsection && <div className="is-subsection"><small>하부</small><strong style={{ fontSize: `${mobileFlowTitleFontSize(item.subsection, "subsection", 15, 176)}px` }}>{item.subsection}</strong></div>}
                          {item.detailSection && <div className="is-detail"><small>세부</small><strong style={{ fontSize: `${mobileFlowTitleFontSize(item.detailSection, "detail", 15, 176)}px` }}>{item.detailSection}</strong></div>}
                        </div>
                        <p>{item.cardCount}장의 카드가 이어져요.</p>
                      </section>
                      <footer><span>옆으로 넘겨 시작하기</span><ChevronRight /></footer>
                    </article>
                  );
                }
                const { card, cardNumber } = item;
                return (
                  <article className={`mobile-flow-card ${contentTypeStripeClass(card.contentType)}${wrongLevelClass(card.incorrectCount)}`} key={item.id} aria-label={`${cardNumber}번째 ${card.contentType} 카드`}>
                    <header>
                      <div className="mobile-flow-card-subject">
                        <SubjectBadge subject={card.subject} subjects={subjects} />
                        <span>{cardNumber} / {flowCards.length}</span>
                      </div>
                      <button
                        type="button"
                        className={`mobile-flow-importance-toggle${card.importance >= 2 ? " is-important" : ""}`}
                        aria-label={card.importance >= 2 ? "중요 표시 해제" : "중요 카드로 표시"}
                        aria-pressed={card.importance >= 2}
                        onClick={() => void toggleCardImportance(card)}
                      >
                        <Star fill={card.importance >= 2 ? "currentColor" : "none"} />
                        <span>{card.importance >= 2 ? "중요" : "일반"}</span>
                      </button>
                    </header>
                    <section className="mobile-flow-question">
                      <button
                        type="button"
                        className="mobile-flow-question-edit"
                        aria-label={`${card.question} 카드 편집`}
                        title="질문을 눌러 카드 편집"
                        onClick={() => openEditFromMobileCards(card)}
                      >
                        <div className="mobile-flow-question-context">
                          <strong>{card.section}</strong>
                          {card.subsection && <span>› {card.subsection}</span>}
                          {card.detailSection && <span>› {card.detailSection}</span>}
                        </div>
                        <p><WrongCountSup count={card.incorrectCount} /><QuestionContent card={card} /></p>
                      </button>
                    </section>
                    <section className="mobile-flow-answer">
                      <button
                        type="button"
                        className={`mobile-flow-answer-toggle${mobileRevealedCardIds.includes(card.id) ? " is-revealed" : " is-hidden"}`}
                        aria-label={mobileRevealedCardIds.includes(card.id) ? "답 다시 가리기" : "답 보기"}
                        aria-pressed={mobileRevealedCardIds.includes(card.id)}
                        onClick={() => toggleMobileCardAnswer(card.id)}
                      >
                        {mobileRevealedCardIds.includes(card.id) ? (
                          <>
                            <span>답</span>
                            <p><AnswerContent card={card} /></p>
                            {(card.memo || !!card.media?.memo.length) && <div className="mobile-flow-memo"><span>메모</span><p><MemoContent card={card} /></p></div>}
                          </>
                        ) : (
                          <span className="mobile-flow-reveal">
                            <span><BookOpen /></span>
                            <strong>눌러서 답 보기</strong>
                            <small>정답·오답 기록은 남지 않아요.</small>
                          </span>
                        )}
                      </button>
                    </section>
                  </article>
                );
              })}
            </div>
            <div className="mobile-cards-nav">
              <Button type="button" variant="outline" size="icon" className="mobile-cards-arrow" aria-label="이전 카드" disabled={mobileCardIndex === 0} onClick={() => moveMobileCard(mobileCardIndex - 1)}><ChevronLeft /></Button>
              <Popover modal open={mobileCardsJumpOpen} onOpenChange={setMobileCardsJumpOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="mobile-cards-page-button" aria-label="페이지와 섹션 바로 이동" aria-expanded={mobileCardsJumpOpen}>
                    <span aria-live="polite"><strong>{mobileCardIndex + 1}</strong> / {mobileFlowItems.length}</span>
                    <ChevronUp />
                  </button>
                </PopoverTrigger>
                <PopoverContent container={mobileCardsDialogRef.current} side="top" align="center" sideOffset={10} collisionPadding={14} className="mobile-cards-jump-menu">
                  <header><div><strong>바로 이동</strong><small>섹션·하부·세부를 눌러 이동해요.</small></div><Badge>{flowCards[0]?.subject}</Badge></header>
                  <nav className="mobile-cards-jump-list" aria-label="카드 위치 바로 이동">
                    {mobileFlowJumpItems.map((jumpItem) => (
                      <button
                        type="button"
                        key={jumpItem.id}
                        className={`mobile-cards-jump-item is-${jumpItem.level}`}
                        aria-current={mobileCardIndex === jumpItem.itemIndex ? "page" : undefined}
                        onClick={() => moveMobileCard(jumpItem.itemIndex)}
                      >
                        <span>{mobileFlowLevelLabel(jumpItem.level)}</span>
                        <strong style={{ fontSize: `${mobileFlowTitleFontSize(jumpItem.label, jumpItem.level, 15, 204)}px` }}>{jumpItem.label}</strong>
                        <ChevronRight />
                      </button>
                    ))}
                  </nav>
                </PopoverContent>
              </Popover>
              <Button type="button" variant="outline" size="icon" className="mobile-cards-arrow" aria-label="다음 카드" disabled={mobileCardIndex + 1 >= mobileFlowItems.length} onClick={() => moveMobileCard(mobileCardIndex + 1)}><ChevronRight /></Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={pendingSessionExit !== null} onOpenChange={open => { if (!open) setPendingSessionExit(null); }}>
        <AlertDialogContent onCloseAutoFocus={event => {
          event.preventDefault();
          if (sessionExitFocusRef.current?.isConnected) sessionExitFocusRef.current.focus({ preventScroll: true });
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>풀이를 나갈까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSessionExit?.kind === "quiz"
                ? "이미 채점한 퀴즈 결과는 저장돼요. 아직 채점하지 않은 답과 남은 재도전은 종료돼요."
                : todayReview ? "확정한 풀이 결과는 저장돼요. 오늘 복습을 다시 열면 아직 못 맞힌 카드부터 풀 수 있어요."
                : "다음 문제로 넘기며 확정한 카드 결과는 저장돼요. 현재 카드의 입력과 미확정 결과는 사라지고, 이어하기는 이 카드부터 시작해요."}
              {" "}이미 기록된 키워드 채점과 힌트 사용 이력은 유지돼요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 풀기</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const action = pendingSessionExit?.action; setPendingSessionExit(null); action?.(); }}>나가기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {startOrderOpen && (
        <Dialog open={startOrderOpen} onOpenChange={(open) => { setStartOrderOpen(open); if (!open) setRangeSelectedCardIds([]); }}>
          <DialogContent className="start-order-dialog max-h-[88dvh] overflow-hidden rounded-[24px] border-0 p-4 sm:max-w-2xl sm:p-6">
            <DialogHeader className="pr-8 text-left">
              <DialogTitle>학습 범위 정하기</DialogTitle>
              <DialogDescription>원하는 섹션이나 카드를 눌러 학습 범위에 추가하세요. 다시 누르면 제외돼요.</DialogDescription>
            </DialogHeader>
            {subject === INCORRECT_VIEW && <label className="start-order-subject-filter">
              <span id="start-order-subject-title">과목</span>
              <select aria-labelledby="start-order-subject-title" value={rangeSubject} onChange={event => setRangeSubject(event.target.value)}>
                <option value="all">전체 과목 ({filtered.length}장)</option>
                {[...rangeSubjectCounts].map(([name, count]) => <option key={name} value={name}>{name} ({count}장)</option>)}
              </select>
            </label>}
            <section className="start-order-type-filter" aria-labelledby="start-order-type-title">
              <span id="start-order-type-title">분류</span>
              <RadioGroup
                value={rangeContentType}
                onValueChange={(value) => {
                  setRangeContentType(value as LearningContentType);
                }}
                className="start-order-type-options"
                aria-label="학습할 카드 분류"
              >
                {LEARNING_CONTENT_TYPE_OPTIONS.map((option) => (
                  <label key={option.value} className="start-order-type-option">
                    <RadioGroupItem value={option.value} className="sr-only" />
                    <strong>{option.label}</strong>
                    <small>{rangeContentTypeCounts.get(option.value) ?? 0}장</small>
                  </label>
                ))}
              </RadioGroup>
            </section>
            <div className="start-order-summary" aria-live="polite">
              <span>선택한 학습 범위 <strong>{selectedRangeCount}장</strong></span>
              <div className="start-order-summary-actions">
                <Button type="button" variant="ghost" size="sm" disabled={!rangeCards.length || allVisibleRangeCardsSelected} onClick={selectAllVisibleRangeCards}>전체 선택</Button>
                <Button type="button" variant="ghost" size="sm" disabled={!selectedRangeCount} onClick={() => setRangeSelectedCardIds([])}>전체 해제</Button>
              </div>
            </div>
            <ContentTypeStripeLegend className="start-order-stripe-legend" />
            <div className="start-order-table-shell">
              <Table className="start-order-table">
                <TableHeader>
                  <TableRow><TableHead>#</TableHead><TableHead>질문</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {rangeCards.map((card, cardIndex) => {
                    const pathParts = [
                      { level: "section" as const, label: card.section },
                      { level: "subsection" as const, label: card.subsection },
                      { level: "detailSection" as const, label: card.detailSection },
                    ].filter((part) => Boolean(part.label));
                    const path = pathParts.map((part) => part.label).join(" › ");
                    const previousCard = rangeCards[cardIndex - 1];
                    const previousPath = previousCard ? [previousCard.section, previousCard.subsection, previousCard.detailSection].filter(Boolean).join(" › ") : "";
                    const isSelected = rangeSelectedCardIdSet.has(card.id);
                    return (
                      <Fragment key={`start-${card.id}`}>
                        {(path !== previousPath || (subject === INCORRECT_VIEW && card.subject !== previousCard?.subject)) && (
                          <TableRow className="start-order-section-row">
                            <TableCell colSpan={2}>
                              <nav className="start-order-section-path" aria-label="학습 범위 섹션">
                                {subject === INCORRECT_VIEW && <strong className="start-order-subject-name">{card.subject}</strong>}
                                {pathParts.map((part, partIndex) => {
                                  const sectionCardIds = learningCardIdsForSection(rangeCards, card.id, part.level);
                                  const sectionSelected = sectionCardIds.length > 0 && sectionCardIds.every((id) => rangeSelectedCardIdSet.has(id));
                                  return (
                                    <Fragment key={`${card.id}-${part.level}`}>
                                      {partIndex > 0 && <ChevronRight aria-hidden="true" />}
                                      <button
                                        type="button"
                                        className={sectionSelected ? "is-selected" : ""}
                                        aria-pressed={sectionSelected}
                                        onClick={() => toggleStudySection(card.id, part.level)}
                                        aria-label={`${part.label} 섹션의 하위 내용을 학습 범위에서 ${sectionSelected ? "제외" : "추가"}`}
                                      >
                                        {part.label}
                                      </button>
                                    </Fragment>
                                  );
                                })}
                              </nav>
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow className={`start-order-card-row ${contentTypeStripeClass(card.contentType)}${isSelected ? " is-selected" : ""}`}>
                          <TableCell>{cardIndex + 1}</TableCell>
                          <TableCell>
                            <button type="button" className="start-order-choice" aria-pressed={isSelected} onClick={() => toggleStudyCard(card.id)} aria-label={`${cardIndex + 1}번 카드를 학습 범위에서 ${isSelected ? "제외" : "추가"}`}>
                              <span className="start-order-question">{renderFormattedText(card.questionFormat, card.question)}</span>
                              <span className={`start-order-mark${isSelected ? " is-selected" : ""}`}>{isSelected ? <Check /> : <Plus />}</span>
                            </button>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                  {!rangeCards.length && (
                    <TableRow>
                      <TableCell colSpan={2} className="start-order-empty">이 분류에 저장된 카드가 아직 없어요.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <Button type="button" size="lg" className="start-range-submit" disabled={!selectedRangeCount} onClick={startSelectedRange}>
              {selectedRangeCount ? `${selectedRangeCount}장 학습 시작` : "섹션이나 카드를 추가해 주세요"}
            </Button>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={overallStatsOpen} onOpenChange={setOverallStatsOpen}>
        <DialogContent className="study-stats-dialog overall-stats-dialog max-w-4xl">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>오늘의 학습 통계</DialogTitle>
            <DialogDescription>한국 시간 기준 · 연습·실전·퀴즈 포함. 같은 카드는 하루에 한 장으로 세고, 정답률은 재도전을 포함한 각 풀이 결과로 계산해요. 힌트와 오답 고쳐 쓰기는 별도 풀이로 세지 않아요.</DialogDescription>
          </DialogHeader>
          <div className="study-stats-summary daily-stats-summary">
            <div><small>오늘 학습한 카드</small><strong>{dailyStats ? `${dailyStats.learnedCardCount}장` : "—"}</strong></div>
            <div><small>오늘 정답률</small><strong>{dailyAccuracyLabel(dailyStats?.accuracy)}</strong></div>
          </div>
          <div className="study-stats-table-shell overall-stats-table-shell">
            <Table className="overall-stats-table">
              <TableHeader><TableRow><TableHead>과목</TableHead><TableHead>오늘 학습</TableHead><TableHead>오늘 정답률</TableHead></TableRow></TableHeader>
              <TableBody>
                {librarySubjects.map((subjectName) => {
                  const summary = dailyStats?.subjects.find((item) => item.subject === subjectName);
                  return (
                    <TableRow key={subjectName}>
                      <TableCell><button type="button" className="overall-subject-link" onClick={() => { setOverallStatsOpen(false); setStatsSubject(subjectName); }}>{subjectName}<ChevronRight /></button></TableCell>
                      <TableCell>{dailyStats ? `${summary?.learnedCardCount ?? 0}장` : "—"}</TableCell>
                      <TableCell>{dailyAccuracyLabel(summary?.accuracy)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(statsSubject)} onOpenChange={(open) => !open && setStatsSubject("")}>
        <DialogContent className="study-stats-dialog max-w-3xl">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>{statsSubject} 오늘의 학습</DialogTitle>
            <DialogDescription>한국 시간 기준 · 연습·실전·퀴즈 포함. 같은 카드는 하루에 한 장으로 세고, 정답률은 오늘 풀이 결과를 합쳐 계산해요.</DialogDescription>
          </DialogHeader>
          <div className="study-stats-summary daily-stats-summary">
            <div><small>오늘 학습한 카드</small><strong>{dailyStats ? `${selectedSubjectDailyStats?.learnedCardCount ?? 0}장` : "—"}</strong></div>
            <div><small>오늘 정답률</small><strong>{dailyAccuracyLabel(selectedSubjectDailyStats?.accuracy)}</strong></div>
          </div>
          <p className="daily-stats-detail">오늘 {selectedSubjectDailyStats?.attempts ?? 0}회 풀이 · 정답 {selectedSubjectDailyStats?.correctCount ?? 0}회</p>
          <details className="previous-study-stats">
            <summary>기존 실전 완주 기록</summary>
          {selectedSubjectStats ? (
            <>
              <div className="study-stats-summary">
                <div><small>완주</small><strong>{selectedSubjectStats.completionCount}회</strong></div>
                <div><small>최근 정답률</small><strong>{selectedSubjectStats.latestAccuracy}%</strong></div>
                <div><small>평균 정답률</small><strong>{selectedSubjectStats.averageAccuracy}%</strong></div>
                <div><small>평균 풀이 시간</small><strong>{formatDuration(selectedSubjectStats.averageDurationMs)}</strong></div>
              </div>
              <div className="study-stats-latest">
                <div className="study-stats-latest-heading">
                  <div><small>최근 완주</small><strong>{new Date(selectedSubjectStats.latestCompletedAt).toLocaleDateString("ko-KR")}</strong></div>
                  <Badge variant="secondary">정답률 {selectedSubjectStats.latestAccuracy}%</Badge>
                </div>
                <div className="study-stats-table-shell">
                  <Table className="study-stats-table">
                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead>문제</TableHead><TableHead>결과</TableHead><TableHead>시간</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {selectedSubjectStats.latestAttempts.map((attempt, attemptIndex) => (
                        <TableRow key={`${attempt.cardId}-${attemptIndex}`}>
                          <TableCell>{attemptIndex + 1}</TableCell>
                          <TableCell>{attempt.question}</TableCell>
                          <TableCell><Badge className={attempt.result === "correct" ? "stats-result-correct" : "stats-result-incorrect"}>{attempt.result === "correct" ? "정답" : "오답"}</Badge></TableCell>
                          <TableCell>{formatDuration(attempt.durationMs)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          ) : (
            <div className="study-stats-empty"><BarChart3 /><strong>아직 실전 완주 기록이 없어요.</strong><p>전체 카드를 실전 모드로 한 번 끝내면 통계가 시작돼요.</p></div>
          )}
          </details>
        </DialogContent>
      </Dialog>
      {sectionAnnouncement && <Dialog open onOpenChange={(open) => !open && setSectionAnnouncement(null)}>
        <DialogContent
          className="section-announcement-dialog max-w-sm cursor-pointer rounded-[26px] border-0 p-0"
          aria-describedby="section-announcement-guide"
          onClick={() => setSectionAnnouncement(null)}
        >
          <div className="section-announcement-copy">
            <span className="eyebrow">{sectionAnnouncement.setInfo ? "COMPARE SET" : "NEW STUDY SECTION"}</span>
            <DialogTitle>{sectionAnnouncement.setInfo?.name ?? "새 학습 구간이에요"}</DialogTitle>
            {sectionAnnouncement.setInfo && <p className="set-announcement-memo">{sectionAnnouncement.setInfo.memo || "이 세트의 카드들을 이어서 학습해요."}</p>}
            {!sectionAnnouncement.setInfo && <div className="section-announcement-lines">
              {sectionAnnouncement?.section && <div className={sectionAnnouncement.changed.section ? "is-changed" : ""}><small>섹션</small><strong>{sectionAnnouncement.section}</strong>{sectionAnnouncement.changed.section && <span>NEW</span>}</div>}
              {sectionAnnouncement?.subsection && <div className={sectionAnnouncement.changed.subsection ? "is-changed" : ""}><small>하위 섹션</small><strong>{sectionAnnouncement.subsection}</strong>{sectionAnnouncement.changed.subsection && <span>NEW</span>}</div>}
              {sectionAnnouncement?.detailSection && <div className={sectionAnnouncement.changed.detailSection ? "is-changed" : ""}><small>세부 섹션</small><strong>{sectionAnnouncement.detailSection}</strong>{sectionAnnouncement.changed.detailSection && <span>NEW</span>}</div>}
            </div>}
            <p id="section-announcement-guide">Enter · Esc 또는 화면을 눌러 계속</p>
          </div>
        </DialogContent>
      </Dialog>}
      {dialogOpen && <CardDialog layered={returnToFlowAfterEdit} key={editing?.id ?? "new"} open={dialogOpen} onOpenChange={handleCardDialogOpenChange} initial={editing} subjects={subjects} onSaved={saveToList} mobileLayered={returnToMobileCardsAfterEdit} mobileTransition={mobileEditorTransition} onMobileBackReady={registerCardDialogMobileBack} />}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent size="sm" className="rounded-[24px]">
          <AlertDialogHeader><AlertDialogTitle>이 카드를 삭제할까요?</AlertDialogTitle><AlertDialogDescription>계속하면 삭제 전 마지막 확인 단계가 한 번 더 나와요.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={continueCardDeletion}>계속</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <FinalDeleteDialog
        open={Boolean(finalDeleting)}
        itemLabel={`카드 “${finalDeleting?.question || "선택한 카드"}”`}
        archiveAvailable={Boolean(finalDeleting && !finalDeleting.archivedAt)}
        archiveMessage={finalDeleting?.archivedAt
          ? "이미 보관 중인 카드예요. 삭제하지 않으려면 취소를 눌러 주세요."
          : "보관하면 학습 목록에서 숨겨지고, 보관함에서 다시 꺼낼 수 있어요."}
        busy={deleteBusy}
        onOpenChange={(open) => !open && setFinalDeleting(null)}
        onDelete={deleteCard}
        onArchive={archiveDeletingCard}
      />
      <AlertDialog open={Boolean(deletingSet)} onOpenChange={(open) => !open && setDeletingSet(null)}>
        <AlertDialogContent size="sm" className="rounded-[24px]">
          <AlertDialogHeader><AlertDialogTitle>이 세트를 삭제할까요?</AlertDialogTitle><AlertDialogDescription>계속하면 삭제 전 마지막 확인 단계가 한 번 더 나와요. 안에 묶인 카드는 그대로 남아 있어요.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={continueSetDeletion}>계속</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <FinalDeleteDialog
        open={Boolean(finalDeletingSet)}
        itemLabel={`세트 “${finalDeletingSet?.name || "선택한 세트"}”`}
        archiveAvailable={false}
        archiveMessage="세트는 보관 기능이 없어요. 취소하면 세트와 카드를 모두 그대로 유지해요."
        busy={deleteBusy}
        onOpenChange={(open) => !open && setFinalDeletingSet(null)}
        onDelete={deleteStudySet}
      />
      <ShortcutHelp screen={shortcutScreen} tableTabOrder={tableTabOrder} onTableTabOrderChange={changeTableTabOrder} />
      <Toaster position="top-center" />
    </main></PhotoViewerProvider></DaySettingProvider>
  );
}

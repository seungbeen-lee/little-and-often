import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const daySettings = sqliteTable("day_settings", {
  ownerId: text("owner_id").primaryKey(),
  targetDate: text("target_date").notNull(),
});

export const tableTemplates = sqliteTable("table_templates", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  format: text("format").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("table_templates_owner_idx").on(table.ownerId)]);

export const cards = sqliteTable(
  "cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerEmail: text("owner_email").notNull(),
    subject: text("subject").notNull(),
    contentType: text("content_type").notNull().default("기타"),
    section: text("section").notNull(),
    subsection: text("subsection").notNull().default(""),
    detailSection: text("detail_section").notNull().default(""),
    area: text("area").notNull().default(""),
    importance: integer("importance").notNull().default(2),
    question: text("question").notNull(),
    questionFormat: text("question_format").notNull().default(""),
    answer: text("answer").notNull(),
    answerFormat: text("answer_format").notNull().default(""),
    memo: text("memo").notNull().default(""),
    media: text("media").notNull().default("{}"),
    keywords: text("keywords").notNull().default("[]"),
    sortOrder: integer("sort_order").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    incorrectCount: integer("incorrect_count").notNull().default(0),
    correctStreak: integer("correct_streak").notNull().default(0),
    masteryStreak: integer("mastery_streak").notNull().default(0),
    keywordSuccessStreak: integer("keyword_success_streak").notNull().default(0),
    fullWriteSuccessStreak: integer("full_write_success_streak").notNull().default(0),
    keywordLastSucceededAt: text("keyword_last_succeeded_at"),
    lastReviewedAt: text("last_reviewed_at"),
    archivedAt: text("archived_at"),
    archiveReviewStage: integer("archive_review_stage").notNull().default(0),
    archiveReviewDueAt: text("archive_review_due_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("cards_owner_idx").on(table.ownerEmail),
    index("cards_owner_subject_idx").on(table.ownerEmail, table.subject),
    index("cards_owner_archive_due_idx").on(table.ownerEmail, table.archivedAt, table.archiveReviewDueAt),
  ]
);

export const cardImages = sqliteTable("card_images", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("card_images_owner_idx").on(table.ownerEmail)]);

export const reviews = sqliteTable(
  "reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    ownerEmail: text("owner_email").notNull(),
    mode: text("mode", { enum: ["reveal", "write"] }).notNull(),
    result: text("result", { enum: ["correct", "incorrect"] }).notNull(),
    typedAnswer: text("typed_answer"),
    statisticsOnly: integer("statistics_only", { mode: "boolean" }).notNull().default(false),
    learningKind: text("learning_kind", { enum: ["practice", "keyword", "full"] }),
    hintUsed: integer("hint_used", { mode: "boolean" }).notNull().default(false),
    coverage: text("coverage", { enum: ["full", "partial"] }).notNull().default("full"),
    keywordIds: text("keyword_ids").notNull().default("[]"),
    eventId: text("event_id"),
    reviewedAt: text("reviewed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("reviews_owner_idx").on(table.ownerEmail),
    index("reviews_owner_reviewed_at_idx").on(table.ownerEmail, table.reviewedAt),
    index("reviews_card_idx").on(table.cardId),
    uniqueIndex("reviews_owner_event_idx").on(table.ownerEmail, table.eventId),
  ]
);

export const keywordStats = sqliteTable(
  "keyword_stats",
  {
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    ownerEmail: text("owner_email").notNull(),
    keywordKey: text("keyword_key").notNull(),
    keyword: text("keyword").notNull(),
    attempts: integer("attempts").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    lastAttemptedAt: text("last_attempted_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.keywordKey] }),
    index("keyword_stats_owner_idx").on(table.ownerEmail),
    index("keyword_stats_owner_card_idx").on(table.ownerEmail, table.cardId),
  ]
);

export const keywordAttemptEvents = sqliteTable(
  "keyword_attempt_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerEmail: text("owner_email").notNull(),
    eventId: text("event_id").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    attemptedAt: text("attempted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("keyword_attempt_events_owner_idx").on(table.ownerEmail),
    uniqueIndex("keyword_attempt_events_owner_event_idx").on(table.ownerEmail, table.eventId),
  ]
);

export const connectionStats = sqliteTable(
  "connection_stats",
  {
    cardId: integer("card_id")
      .primaryKey()
      .references(() => cards.id, { onDelete: "cascade" }),
    ownerEmail: text("owner_email").notNull(),
    attempts: integer("attempts").notNull().default(0),
    connectedCount: integer("connected_count").notNull().default(0),
    lastAttemptedAt: text("last_attempted_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("connection_stats_owner_idx").on(table.ownerEmail),
  ]
);

export const connectionAttemptEvents = sqliteTable(
  "connection_attempt_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerEmail: text("owner_email").notNull(),
    eventId: text("event_id").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    connected: integer("connected", { mode: "boolean" }).notNull(),
    attemptedAt: text("attempted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("connection_attempt_events_owner_idx").on(table.ownerEmail),
    uniqueIndex("connection_attempt_events_owner_event_idx").on(table.ownerEmail, table.eventId),
  ]
);

export const studyRuns = sqliteTable(
  "study_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerEmail: text("owner_email").notNull(),
    eventId: text("event_id").notNull(),
    subject: text("subject").notNull(),
    totalCount: integer("total_count").notNull(),
    correctCount: integer("correct_count").notNull(),
    totalDurationMs: integer("total_duration_ms").notNull(),
    attempts: text("attempts").notNull().default("[]"),
    completedAt: text("completed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("study_runs_owner_idx").on(table.ownerEmail),
    index("study_runs_owner_subject_idx").on(table.ownerEmail, table.subject),
    uniqueIndex("study_runs_owner_event_idx").on(table.ownerEmail, table.eventId),
  ]
);

export const studyProgress = sqliteTable(
  "study_progress",
  {
    ownerEmail: text("owner_email").notNull(),
    contextKey: text("context_key").notNull(),
    nextCardId: integer("next_card_id").notNull(),
    sequenceIds: text("sequence_ids").notNull().default("[]"),
    sessionMode: text("session_mode", { enum: ["real", "practice"] }),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.ownerEmail, table.contextKey] }),
    index("study_progress_owner_idx").on(table.ownerEmail),
  ]
);

export const studySets = sqliteTable(
  "study_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerEmail: text("owner_email").notNull(),
    subject: text("subject").notNull(),
    name: text("name").notNull(),
    memo: text("memo").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("study_sets_owner_idx").on(table.ownerEmail),
    index("study_sets_owner_subject_idx").on(table.ownerEmail, table.subject),
  ]
);

export const studySetCards = sqliteTable(
  "study_set_cards",
  {
    setId: integer("set_id")
      .notNull()
      .references(() => studySets.id, { onDelete: "cascade" }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.setId, table.cardId] }),
    index("study_set_cards_set_idx").on(table.setId, table.sortOrder),
    index("study_set_cards_card_idx").on(table.cardId),
  ]
);

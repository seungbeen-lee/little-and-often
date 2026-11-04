ALTER TABLE `cards` ADD `keyword_last_succeeded_at` text;--> statement-breakpoint
-- Only carry timestamps proven by an unhinted, whole-card keyword result.
-- Older cumulative mastery counts alone cannot establish this evidence.
UPDATE cards SET keyword_last_succeeded_at = (
  SELECT MAX(reviewed_at) FROM reviews
  WHERE reviews.card_id = cards.id AND reviews.owner_email = cards.owner_email
    AND learning_kind = 'keyword' AND result = 'correct'
    AND hint_used = 0 AND statistics_only = 0 AND coverage = 'full'
) WHERE keyword_success_streak > 0;

// Boundaries are UTC instants for the current Korean calendar day.
export const DAILY_STUDY_QUERY = `
  SELECT c.subject AS subject,
         COUNT(DISTINCT r.card_id) AS learnedCardCount,
         JSON_GROUP_ARRAY(DISTINCT r.card_id) AS learnedCardIds,
         COUNT(*) AS attempts,
         SUM(CASE WHEN r.result = 'correct' THEN 1 ELSE 0 END) AS correctCount
  FROM reviews r
  JOIN cards c ON c.id = r.card_id AND c.owner_email = r.owner_email
  WHERE r.owner_email = ? AND r.reviewed_at >= ? AND r.reviewed_at < ?
  GROUP BY c.subject
  ORDER BY c.subject
`;

// A correction, hint-assisted answer or partial success does not resolve a
// missed card. Use the latest qualifying result, including mistakes on retries.
export const DAILY_REVIEW_QUERY = `
  WITH latest AS (
    SELECT r.card_id, r.result,
           ROW_NUMBER() OVER (PARTITION BY r.card_id ORDER BY r.reviewed_at DESC, r.id DESC) AS position
    FROM reviews r
    JOIN cards c ON c.id = r.card_id AND c.owner_email = r.owner_email
    WHERE r.owner_email = ? AND r.reviewed_at >= ? AND r.reviewed_at < ?
      AND c.archived_at IS NULL
      AND (r.result = 'incorrect' OR (r.result = 'correct' AND r.statistics_only = 0 AND r.hint_used = 0 AND r.coverage = 'full'))
  )
  SELECT card_id AS cardId FROM latest WHERE position = 1 AND result = 'incorrect'
`;

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

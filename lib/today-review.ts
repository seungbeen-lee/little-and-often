/** Keep the session total fixed: a miss moves to the back; a hit leaves the queue. */
export function advanceTodayReview(sequence: number[], completed: number[], cardId: number, correct: boolean) {
  const nextSequence = correct ? sequence : [...sequence.filter(id => id !== cardId), cardId];
  const nextCompleted = correct ? [...new Set([...completed, cardId])] : completed;
  return { sequence: nextSequence, completed: nextCompleted, nextCardId: nextSequence.find(id => !nextCompleted.includes(id)) ?? null };
}

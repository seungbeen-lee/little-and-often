type SearchableSet = { subject: string; name: string; memo: string; cardIds: number[] };
type SearchableCard = { id: number; section: string; subsection: string; detailSection: string; question: string; answer: string; memo: string };

export function filterLibrarySets<T extends SearchableSet>(sets: T[], cards: SearchableCard[], subject: string, query: string): T[] {
  const terms = query.normalize("NFKC").toLocaleLowerCase("ko-KR").trim().split(/\s+/u).filter(Boolean);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  return sets.filter((set) => {
    if (subject !== "all" && set.subject !== subject) return false;
    if (!terms.length) return true;
    const searchText = [set.subject, set.name, set.memo, ...set.cardIds.flatMap((id) => {
      const card = cardsById.get(id);
      return card ? [card.section, card.subsection, card.detailSection, card.question, card.answer, card.memo] : [];
    })].join(" ").normalize("NFKC").toLocaleLowerCase("ko-KR");
    return terms.every((term) => searchText.includes(term));
  });
}
